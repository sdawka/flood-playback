import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type Map } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export type Product = 'flood' | 'satellite';
export type RegionId = 'brahmaputra' | 'barak';

export const REGIONS: Array<{ id: RegionId; label: string; bounds: [number, number, number, number] }> = [
  { id: 'brahmaputra', label: 'Brahmaputra / Assam', bounds: [88.8, 24.5, 96.8, 29.5] },
  { id: 'barak', label: 'Barak / Sylhet', bounds: [90.3, 23.5, 93, 25.6] }
];

export const DATES = Array.from({ length: 19 }, (_, index) => `2022-06-${String(index + 12).padStart(2, '0')}`);

export interface MapStatus {
  phase: 'loading' | 'ready' | 'error';
  message: string;
  date: string;
  product: Product;
}

export interface ObservationFrame {
  date: string;
  product: Product;
  opacity: number;
}

export interface RasterRequest {
  lifecycle: number;
  raster: number;
}

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const GIBS_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const MATRIX_SET = 'GoogleMapsCompatible_Level9';
const RASTER_SOURCE_PREFIX = 'nasa-gibs-observation';
const RASTER_LAYER = 'nasa-gibs-observation';
const LOAD_TIMEOUT_MS = 20_000;

const PRODUCTS: Record<Product, { layer: string; extension: 'png' | 'jpeg' }> = {
  flood: { layer: 'MODIS_Combined_Flood_3-Day', extension: 'png' },
  satellite: { layer: 'MODIS_Terra_CorrectedReflectance_Bands721', extension: 'jpeg' }
};

const LAYERS = new Set(Object.values(PRODUCTS).map(({ layer }) => layer));

// Vite must serve MapLibre's separate worker asset before any map is created.
setWorkerUrl(workerUrl);

function isProduct(value: unknown): value is Product {
  return value === 'flood' || value === 'satellite';
}

function assertDate(date: string) {
  if (!DATES.includes(date)) throw new Error(`Unknown observation date: ${date}`);
}

function clampOpacity(opacity: number) {
  if (!Number.isFinite(opacity)) return 0.8;
  return Math.max(0, Math.min(1, opacity));
}

/** Validates one frame before it reaches a MapLibre raster source. */
export function normalizeFrame(frame: ObservationFrame): ObservationFrame {
  assertDate(frame.date);
  if (!isProduct(frame.product)) throw new Error(`Unknown observation product: ${String(frame.product)}`);
  return { date: frame.date, product: frame.product, opacity: clampOpacity(frame.opacity) };
}

/** A raster callback may only update the currently mounted map and frame. */
export function isCurrentRasterRequest(current: RasterRequest, candidate: RasterRequest) {
  return current.lifecycle === candidate.lifecycle && current.raster === candidate.raster;
}

/** Builds a finite, known NASA GIBS EPSG:3857 tile URL. */
export function gibsTileUrl(layer: string, date: string, z: number, x: number, y: number) {
  if (!LAYERS.has(layer)) throw new Error(`Unknown GIBS layer: ${layer}`);
  assertDate(date);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 9 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    throw new Error('Invalid GIBS tile coordinates');
  }
  const extension = Object.values(PRODUCTS).find((product) => product.layer === layer)!.extension;
  return `${GIBS_ROOT}/${layer}/default/${date}/${MATRIX_SET}/${z}/${y}/${x}.${extension}`;
}

function tileTemplate(frame: ObservationFrame) {
  const product = PRODUCTS[frame.product];
  return `${GIBS_ROOT}/${product.layer}/default/${frame.date}/${MATRIX_SET}/{z}/{y}/{x}.${product.extension}`;
}

function statusFor(phase: MapStatus['phase'], message: string, frame: ObservationFrame): MapStatus {
  return { phase, message, date: frame.date, product: frame.product };
}

function firstSymbolLayer(map: Map) {
  return map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
}

function removeObservationRaster(map: Map, sourceId: string | undefined) {
  if (map.getLayer(RASTER_LAYER)) map.removeLayer(RASTER_LAYER);
  if (sourceId && map.getSource(sourceId)) map.removeSource(sourceId);
}

export function createObservationMap(container: HTMLElement, onStatus: (status: MapStatus) => void) {
  let currentFrame = normalizeFrame({ date: '2022-06-24', product: 'flood', opacity: 0.8 });
  let currentRegion: RegionId = 'brahmaputra';
  let map: Map | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let lifecycle = 0;
  let rasterGeneration = 0;
  let destroyed = false;
  let basemapReady = false;
  let activeRasterSource: string | undefined;
  let failedRasterGeneration: number | undefined;
  let rasterLoadPending = false;
  let rasterListener: ((event: { sourceId?: string; isSourceLoaded?: boolean }) => void) | undefined;
  let rasterLoadingListener: ((event: { sourceId?: string }) => void) | undefined;
  let rasterListenerMap: Map | undefined;
  let currentStatus = statusFor('loading', 'Starting map…', currentFrame);

  const emit = (phase: MapStatus['phase'], message: string, frame = currentFrame) => {
    currentStatus = statusFor(phase, message, frame);
    onStatus(currentStatus);
  };

  function clearRasterLoadTimer() {
    if (loadTimer) clearTimeout(loadTimer);
    loadTimer = undefined;
  }

  function clearRasterWatcher() {
    clearRasterLoadTimer();
    if (rasterListener && rasterListenerMap) rasterListenerMap.off('sourcedata', rasterListener);
    if (rasterLoadingListener && rasterListenerMap) rasterListenerMap.off('sourcedataloading', rasterLoadingListener);
    rasterListener = undefined;
    rasterLoadingListener = undefined;
    rasterListenerMap = undefined;
    rasterLoadPending = false;
  }

  function clearMap() {
    clearRasterWatcher();
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    if (map) {
      map.remove();
      map = undefined;
    }
    basemapReady = false;
    activeRasterSource = undefined;
  }

  function failRaster(request: RasterRequest, frame: ObservationFrame, message: string) {
    if (destroyed || !isCurrentRasterRequest({ lifecycle, raster: rasterGeneration }, request)) return;
    if (failedRasterGeneration === request.raster) return;
    failedRasterGeneration = request.raster;
    clearRasterWatcher();
    emit('error', message, frame);
  }

  function beginRasterLoad(request: RasterRequest, frame: ObservationFrame) {
    if (destroyed || failedRasterGeneration === request.raster || !isCurrentRasterRequest({ lifecycle, raster: rasterGeneration }, request)) return;
    if (!rasterLoadPending) emit('loading', `Loading NASA ${frame.product} imagery for ${frame.date}…`, frame);
    rasterLoadPending = true;
    clearRasterLoadTimer();
    loadTimer = setTimeout(() => {
      failRaster(request, frame, 'NASA imagery is taking too long to load. Check your connection and retry.');
    }, LOAD_TIMEOUT_MS);
  }

  function mountRaster(activeMap: Map, token: number) {
    const generation = ++rasterGeneration;
    const request = { lifecycle: token, raster: generation };
    const frame = currentFrame;
    const sourceId = `${RASTER_SOURCE_PREFIX}-${token}-${generation}`;
    failedRasterGeneration = undefined;
    clearRasterWatcher();
    removeObservationRaster(activeMap, activeRasterSource);
    activeRasterSource = sourceId;
    activeMap.addSource(sourceId, {
      type: 'raster',
      tiles: [tileTemplate(frame)],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 9,
      attribution: 'NASA GIBS / MODIS'
    });
    const onSourceLoading = (event: { sourceId?: string }) => {
      if (event.sourceId === sourceId) beginRasterLoad(request, frame);
    };
    const onSourceData = (event: { sourceId?: string; isSourceLoaded?: boolean; tile?: unknown }) => {
      // Raster source metadata can say it is loaded before the map has painted
      // any tiles. A tile-bearing completion event proves a visible request ran.
      if (destroyed || !rasterLoadPending || !isCurrentRasterRequest({ lifecycle, raster: rasterGeneration }, request) || event.sourceId !== sourceId || event.tile === undefined || !event.isSourceLoaded) return;
      clearRasterLoadTimer();
      rasterLoadPending = false;
      emit('ready', `NASA ${frame.product} imagery loaded for ${frame.date}.`, frame);
    };
    rasterListener = onSourceData;
    rasterLoadingListener = onSourceLoading;
    rasterListenerMap = activeMap;
    activeMap.on('sourcedata', onSourceData);
    activeMap.on('sourcedataloading', onSourceLoading);
    activeMap.addLayer({
      id: RASTER_LAYER,
      type: 'raster',
      source: sourceId,
      paint: { 'raster-opacity': frame.opacity, 'raster-resampling': 'nearest' }
    }, firstSymbolLayer(activeMap));
    beginRasterLoad(request, frame);
  }

  function start() {
    clearMap();
    if (destroyed) return;
    const token = ++lifecycle;
    emit('loading', 'Starting map…');
    try {
      const region = REGIONS.find((item) => item.id === currentRegion)!;
      const activeMap = map = new MapLibreMap({
        container,
        style: BASEMAP_STYLE,
        bounds: region.bounds,
        fitBoundsOptions: { padding: 28 },
        maxZoom: 9
      });
      activeMap.addControl(new NavigationControl(), 'top-right');
      resizeObserver = new ResizeObserver(() => activeMap.resize());
      resizeObserver.observe(container);
      loadTimer = setTimeout(() => {
        if (!destroyed && token === lifecycle) {
          lifecycle += 1;
          clearMap();
          emit('error', 'The map is taking too long to load. Check your connection and retry.');
        }
      }, LOAD_TIMEOUT_MS);
      activeMap.once('load', () => {
        if (destroyed || token !== lifecycle) return;
        basemapReady = true;
        mountRaster(activeMap, token);
      });
      activeMap.on('error', (event) => {
        if (destroyed || token !== lifecycle) return;
        const sourceId = (event as unknown as { sourceId?: string }).sourceId;
        if (sourceId === activeRasterSource) failRaster({ lifecycle: token, raster: rasterGeneration }, currentFrame, 'NASA imagery could not be loaded. Check your connection and retry.');
        else if (!basemapReady) {
          lifecycle += 1;
          clearMap();
          emit('error', 'The map could not be loaded. Check your connection and retry.');
        }
      });
    } catch {
      emit('error', 'The map could not start. Check that WebGL is enabled and retry.');
    }
  }

  function setFrame(frame: ObservationFrame) {
    if (destroyed) return;
    try {
      const nextFrame = normalizeFrame(frame);
      const sameImage = currentFrame.date === nextFrame.date && currentFrame.product === nextFrame.product;
      currentFrame = nextFrame;
      if (map && basemapReady) {
        if (sameImage && map.getLayer(RASTER_LAYER)) {
          map.setPaintProperty(RASTER_LAYER, 'raster-opacity', currentFrame.opacity);
          emit(currentStatus.phase, currentStatus.message);
        }
        else mountRaster(map, lifecycle);
      }
      else emit('loading', `Waiting to load NASA ${currentFrame.product} imagery for ${currentFrame.date}…`);
    } catch (reason) {
      emit('error', reason instanceof Error ? reason.message : 'The requested observation frame is invalid.');
    }
  }

  function fitRegion(region: RegionId) {
    if (destroyed) return;
    const definition = REGIONS.find((item) => item.id === region);
    if (!definition) return;
    currentRegion = region;
    map?.fitBounds(definition.bounds, { padding: 28, duration: 450 });
  }

  start();

  return {
    setFrame,
    fitRegion,
    retry: start,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      lifecycle += 1;
      rasterGeneration += 1;
      clearMap();
    }
  };
}
