import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type Map as MapLibreMapType } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export type Product = 'combined' | 'flood' | 'satellite';
export type RegionId = 'brahmaputra' | 'barak';

export const REGIONS: Array<{ id: RegionId; label: string; bounds: [number, number, number, number] }> = [
  { id: 'brahmaputra', label: 'Brahmaputra / Assam', bounds: [88.8, 24.5, 96.8, 29.5] },
  { id: 'barak', label: 'Barak / Sylhet', bounds: [90.3, 23.5, 93, 25.6] }
];

export const DATES = Array.from({ length: 19 }, (_, index) => `2022-06-${String(index + 12).padStart(2, '0')}`);
export const COMBINED_DATES = Array.from({ length: 73 }, (_, index) => new Date(Date.UTC(2022, 5, 12, index * 6)).toISOString().replace('.000', ''));

export interface MapStatus {
  phase: 'loading' | 'ready' | 'error';
  message: string;
  /** The requested frame, never a stale frame promoted by an earlier request. */
  date: string;
  product: Product;
}

export interface ObservationFrame { date: string; product: Product; opacity: number; }
export interface RasterRequest { lifecycle: number; raster: number; }

interface FrameAsset { time: string; url: string; }
interface ObservationManifest {
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
  originalFrames: FrameAsset[];
  frames: FrameAsset[];
}
interface CachedImage { key: string; url: string; touched: number; }
interface MountedRaster { sourceId: string; layerId: string; opacity: number; cacheKey?: string; }
interface ImageLoad { promise: Promise<CachedImage>; controller: AbortController; }

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const GIBS_ROOT = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const MATRIX_SET = 'GoogleMapsCompatible_Level9';
const OBSERVATION_MANIFEST = '/observations/assam-june-2022/manifest.json';
const LOAD_TIMEOUT_MS = 20_000;
const FADE_MS = 190;
const CACHE_LIMIT = 5;
const PRODUCTS: Record<Exclude<Product, 'combined'>, { layer: string; extension: 'png' | 'jpeg' }> = {
  flood: { layer: 'MODIS_Combined_Flood_3-Day', extension: 'png' },
  satellite: { layer: 'MODIS_Terra_CorrectedReflectance_Bands721', extension: 'jpeg' }
};
const LAYERS = new Set(Object.values(PRODUCTS).map(({ layer }) => layer));

setWorkerUrl(workerUrl);

function isProduct(value: unknown): value is Product { return value === 'combined' || value === 'flood' || value === 'satellite'; }
function assertDate(date: string, product: Product) {
  const dates = product === 'combined' ? COMBINED_DATES : DATES;
  if (!dates.includes(date)) throw new Error(product === 'combined' ? `Unknown combined observation date: ${date}` : `Unknown observation date: ${date}`);
}
function clampOpacity(opacity: number) { return Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.8; }

/** Validates one frame before it reaches a MapLibre source. */
export function normalizeFrame(frame: ObservationFrame): ObservationFrame {
  if (!isProduct(frame.product)) throw new Error(`Unknown observation product: ${String(frame.product)}`);
  assertDate(frame.date, frame.product);
  return { date: frame.date, product: frame.product, opacity: clampOpacity(frame.opacity) };
}

/** A raster callback may only update the currently mounted map and frame. */
export function isCurrentRasterRequest(current: RasterRequest, candidate: RasterRequest) { return current.lifecycle === candidate.lifecycle && current.raster === candidate.raster; }

/** Calculates alpha values whose normal layer compositing preserves the desired opacity for opaque image pixels. */
export function crossFadeOpacities(previousOpacity: number, nextOpacity: number, progress: number) {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const previous = previousOpacity * (1 - safeProgress);
  const composed = previousOpacity + (nextOpacity - previousOpacity) * safeProgress;
  const next = previous >= 1 ? 0 : Math.max(0, Math.min(1, (composed - previous) / (1 - previous)));
  return { previous, next };
}

/** Builds a finite, known NASA GIBS EPSG:3857 tile URL. */
export function gibsTileUrl(layer: string, date: string, z: number, x: number, y: number) {
  if (!LAYERS.has(layer)) throw new Error(`Unknown GIBS layer: ${layer}`);
  assertDate(date, 'flood');
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 9 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('Invalid GIBS tile coordinates');
  const extension = Object.values(PRODUCTS).find((product) => product.layer === layer)!.extension;
  return `${GIBS_ROOT}/${layer}/default/${date}/${MATRIX_SET}/${z}/${y}/${x}.${extension}`;
}
function tileTemplate(frame: ObservationFrame) {
  const product = PRODUCTS[frame.product as Exclude<Product, 'combined'>];
  return `${GIBS_ROOT}/${product.layer}/default/${frame.date}/${MATRIX_SET}/{z}/{y}/{x}.${product.extension}`;
}
function statusFor(phase: MapStatus['phase'], message: string, frame: ObservationFrame): MapStatus { return { phase, message, date: frame.date, product: frame.product }; }
function firstSymbolLayer(map: MapLibreMapType) { return map.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id; }

function requiredRecord(value: unknown, name: string) {
  if (!value || typeof value !== 'object') throw new Error(`Observation manifest ${name} is invalid.`);
  return value as Record<string, unknown>;
}
function originalFrameAssets(value: unknown): FrameAsset[] {
  if (!Array.isArray(value)) throw new Error('Observation manifest originalFrames must be an array.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Observation manifest originalFrames[${index}] is invalid.`);
    const record = item as Record<string, unknown>;
    if (typeof record.date !== 'string' || typeof record.url !== 'string' || !record.url.startsWith('/')) throw new Error(`Observation manifest originalFrames[${index}] must contain a local date and URL.`);
    return { time: record.date, url: record.url };
  });
}
function combinedFrameAssets(value: unknown): FrameAsset[] {
  if (!Array.isArray(value)) throw new Error('Observation manifest frames must be an array.');
  return value.map((item, index) => {
    const record = requiredRecord(item, `frames[${index}]`);
    if (typeof record.time !== 'string' || typeof record.url !== 'string' || !record.url.startsWith('/') || (record.kind !== 'combined' && record.kind !== 'interpolated') || !Array.isArray(record.sourceDates) || record.sourceDates.some((date) => typeof date !== 'string')) {
      throw new Error(`Observation manifest frames[${index}] must contain a local combined frame.`);
    }
    return { time: record.time, url: record.url };
  });
}
function parseManifest(value: unknown): ObservationManifest {
  const record = requiredRecord(value, 'root');
  if (record.version !== 1 || record.maxZoom !== 8 || !Array.isArray(record.coordinates) || record.coordinates.length !== 4 || !Array.isArray(record.dates) || record.dates.some((date) => typeof date !== 'string') || !record.dates.every((date) => DATES.includes(date)) || !record.source || !record.method || !record.statistics) throw new Error('Observation manifest has an unsupported format.');
  const coordinates = record.coordinates.map((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length !== 2 || coordinate.some((part) => typeof part !== 'number' || !Number.isFinite(part))) throw new Error('Observation manifest has invalid image coordinates.');
    return [coordinate[0], coordinate[1]] as [number, number];
  }) as ObservationManifest['coordinates'];
  if (coordinates[0][0] >= coordinates[1][0] || coordinates[0][1] <= coordinates[2][1] || coordinates[0][1] !== coordinates[1][1] || coordinates[1][0] !== coordinates[2][0] || coordinates[2][1] !== coordinates[3][1] || coordinates[3][0] !== coordinates[0][0]) throw new Error('Observation manifest image coordinates are not geographic bounds.');
  const originalFrames = originalFrameAssets(record.originalFrames);
  const frames = combinedFrameAssets(record.frames);
  if (!DATES.every((date) => originalFrames.some((frame) => frame.time === date)) || !COMBINED_DATES.every((date) => frames.some((frame) => frame.time === date))) throw new Error('Observation manifest does not cover the available playback dates.');
  return { coordinates, originalFrames, frames };
}

export function createObservationMap(container: HTMLElement, onStatus: (status: MapStatus) => void) {
  let currentFrame = normalizeFrame({ date: '2022-06-24T00:00:00Z', product: 'combined', opacity: 0.8 });
  let currentRegion: RegionId = 'brahmaputra';
  let map: MapLibreMapType | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let bootstrapTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let animationFrame: number | undefined;
  let completeTransition: (() => void) | undefined;
  let lifecycle = 0;
  let rasterGeneration = 0;
  let destroyed = false;
  let basemapReady = false;
  let activeRaster: MountedRaster | undefined;
  let pendingRaster: MountedRaster | undefined;
  let detachPendingSourceListener: (() => void) | undefined;
  let manifestPromise: Promise<ObservationManifest> | undefined;
  let manifestController: AbortController | undefined;
  const reducedMotion: MediaQueryList | undefined = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : undefined;
  let currentStatus = statusFor('loading', 'Starting map…', currentFrame);
  const imageCache = new Map<string, CachedImage>();
  const imageLoads = new Map<string, ImageLoad>();
  let prefetchCount = 0;
  const emit = (phase: MapStatus['phase'], message: string, frame = currentFrame) => { currentStatus = statusFor(phase, message, frame); onStatus(currentStatus); };
  const requestIsCurrent = (request: RasterRequest) => !destroyed && isCurrentRasterRequest({ lifecycle, raster: rasterGeneration }, request);

  function clearTimers() {
    if (bootstrapTimer) clearTimeout(bootstrapTimer);
    if (pendingTimer) clearTimeout(pendingTimer);
    bootstrapTimer = undefined;
    pendingTimer = undefined;
  }
  function setLayerOpacity(layerId: string, opacity: number) { if (map?.getLayer(layerId)) map.setPaintProperty(layerId, 'raster-opacity', opacity); }
  function detachPendingListener() { detachPendingSourceListener?.(); detachPendingSourceListener = undefined; }
  function removeRaster(raster: MountedRaster | undefined) {
    if (!map || !raster) return;
    if (map.getLayer(raster.layerId)) map.removeLayer(raster.layerId);
    if (map.getSource(raster.sourceId)) map.removeSource(raster.sourceId);
  }
  function discardPendingRaster(restoreActive = true) {
    detachPendingListener();
    if (pendingRaster) removeRaster(pendingRaster);
    pendingRaster = undefined;
    if (restoreActive && activeRaster) setLayerOpacity(activeRaster.layerId, activeRaster.opacity);
  }
  function protectedCacheKeys() { return new Set([activeRaster?.cacheKey, pendingRaster?.cacheKey].filter((key): key is string => Boolean(key))); }
  function trimCache() {
    const protectedKeys = protectedCacheKeys();
    while (imageCache.size > CACHE_LIMIT) {
      const candidate = [...imageCache.values()].filter((entry) => !protectedKeys.has(entry.key)).sort((left, right) => left.touched - right.touched)[0];
      if (!candidate) return;
      imageCache.delete(candidate.key);
      URL.revokeObjectURL(candidate.url);
    }
  }
  async function cachedImage(url: string) {
    const cached = imageCache.get(url);
    if (cached) { cached.touched = Date.now(); return cached; }
    const existing = imageLoads.get(url);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const load = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      let blobUrl: string | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('Observation image load timed out.')); }, LOAD_TIMEOUT_MS);
        });
        const response = await Promise.race([fetch(url, { signal: controller.signal }), deadline]);
        if (!response.ok) throw new Error(`Observation image request failed: ${response.status}`);
        blobUrl = URL.createObjectURL(await Promise.race([response.blob(), deadline]));
        const image = new Image();
        image.src = blobUrl;
        await Promise.race([image.decode(), deadline]);
        if (destroyed) throw new Error('Observation image load was cancelled.');
        const entry = { key: url, url: blobUrl, touched: Date.now() };
        imageCache.set(url, entry);
        trimCache();
        return entry;
      } catch (reason) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        if (timedOut) throw new Error('Observation image load timed out.');
        throw reason;
      } finally { if (timeout) clearTimeout(timeout); }
    })();
    imageLoads.set(url, { promise: load, controller });
    try { return await load; } finally { if (imageLoads.get(url)?.promise === load) imageLoads.delete(url); }
  }
  function observationManifest() {
    if (!manifestPromise) {
      const controller = manifestController = new AbortController();
      const load = new Promise<Response>((resolve, reject) => {
        const timeout = setTimeout(() => { controller.abort(); reject(new Error('Observation manifest request timed out.')); }, LOAD_TIMEOUT_MS);
        void fetch(OBSERVATION_MANIFEST, { signal: controller.signal }).then(resolve, reject).finally(() => clearTimeout(timeout));
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Observation manifest request failed: ${response.status}`);
        const value = await new Promise<unknown>((resolve, reject) => {
          const timeout = setTimeout(() => { controller.abort(); reject(new Error('Observation manifest request timed out.')); }, LOAD_TIMEOUT_MS);
          void response.json().then(resolve, reject).finally(() => clearTimeout(timeout));
        });
        return parseManifest(value);
      });
      const retryableLoad = load.catch((reason) => {
        if (manifestPromise === retryableLoad) {
          manifestPromise = undefined;
          manifestController = undefined;
        }
        throw reason;
      });
      manifestPromise = retryableLoad;
    }
    return manifestPromise;
  }
  function localFrame(manifest: ObservationManifest, frame: ObservationFrame) { return (frame.product === 'combined' ? manifest.frames : manifest.originalFrames).find((item) => item.time === frame.date); }
  function prefetchCombinedFrames(manifest: ObservationManifest, frame: ObservationFrame) {
    if (frame.product !== 'combined') return;
    const index = COMBINED_DATES.indexOf(frame.date);
    for (const date of COMBINED_DATES.slice(index + 1, index + 3)) {
      const next = manifest.frames.find((item) => item.time === date);
      if (next && !imageCache.has(next.url) && !imageLoads.has(next.url) && prefetchCount < 2) {
        prefetchCount += 1;
        void cachedImage(next.url).catch(() => undefined).finally(() => { prefetchCount -= 1; });
      }
    }
  }
  function promote(request: RasterRequest, frame: ObservationFrame, next: MountedRaster, manifest?: ObservationManifest) {
    if (!requestIsCurrent(request) || pendingRaster?.sourceId !== next.sourceId) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    const previous = activeRaster;
    const finish = () => {
      if (!requestIsCurrent(request) || pendingRaster?.sourceId !== next.sourceId) return;
      const shownFrame = currentFrame;
      setLayerOpacity(next.layerId, next.opacity);
      removeRaster(previous);
      activeRaster = next;
      pendingRaster = undefined;
      completeTransition = undefined;
      emit('ready', shownFrame.product === 'satellite' ? `NASA satellite imagery loaded for ${shownFrame.date}.` : `Observation imagery loaded for ${shownFrame.date}.`, shownFrame);
      if (manifest) prefetchCombinedFrames(manifest, shownFrame);
      trimCache();
    };
    if (!previous || reducedMotion?.matches) { finish(); return; }
    completeTransition = finish;
    const started = performance.now();
    const fade = (now: number) => {
      if (!requestIsCurrent(request) || pendingRaster?.sourceId !== next.sourceId) return;
      const progress = Math.min(1, (now - started) / FADE_MS);
      const opacities = crossFadeOpacities(previous.opacity, next.opacity, progress);
      setLayerOpacity(next.layerId, opacities.next);
      setLayerOpacity(previous.layerId, opacities.previous);
      if (progress < 1) animationFrame = requestAnimationFrame(fade); else finish();
    };
    animationFrame = requestAnimationFrame(fade);
  }
  function failRaster(request: RasterRequest, frame: ObservationFrame, message: string) {
    if (!requestIsCurrent(request)) return;
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    discardPendingRaster();
    emit('error', message, frame);
  }
  function mountLocal(activeMap: MapLibreMapType, request: RasterRequest, frame: ObservationFrame, manifest: ObservationManifest, image: CachedImage) {
    if (!requestIsCurrent(request)) return;
    const sourceId = `observation-image-${request.lifecycle}-${request.raster}`;
    const layerId = `${sourceId}-layer`;
    const next = pendingRaster = { sourceId, layerId, opacity: frame.opacity, cacheKey: image.key };
    const onData = (event: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (event.sourceId === sourceId && event.isSourceLoaded) { detachPendingListener(); promote(request, frame, next, manifest); }
    };
    activeMap.on('sourcedata', onData);
    detachPendingSourceListener = () => activeMap.off('sourcedata', onData);
    activeMap.addSource(sourceId, { type: 'image', url: image.url, coordinates: manifest.coordinates });
    activeMap.addLayer({ id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': 0.001, 'raster-opacity-transition': { duration: 0, delay: 0 }, 'raster-resampling': 'nearest' } }, firstSymbolLayer(activeMap));
    pendingTimer = setTimeout(() => { detachPendingListener(); failRaster(request, frame, 'Observation imagery is taking too long to load. Check your connection and retry.'); }, LOAD_TIMEOUT_MS);
  }
  function mountSatellite(activeMap: MapLibreMapType, request: RasterRequest, frame: ObservationFrame) {
    if (!requestIsCurrent(request)) return;
    const sourceId = `nasa-gibs-observation-${request.lifecycle}-${request.raster}`;
    const layerId = `${sourceId}-layer`;
    const next = pendingRaster = { sourceId, layerId, opacity: frame.opacity };
    const onData = (event: { sourceId?: string; isSourceLoaded?: boolean; tile?: unknown }) => {
      if (event.sourceId === sourceId && event.isSourceLoaded && event.tile !== undefined) { detachPendingListener(); promote(request, frame, next); }
    };
    activeMap.on('sourcedata', onData);
    detachPendingSourceListener = () => activeMap.off('sourcedata', onData);
    activeMap.addSource(sourceId, { type: 'raster', tiles: [tileTemplate(frame)], tileSize: 256, minzoom: 0, maxzoom: 9, attribution: 'NASA GIBS / MODIS' });
    activeMap.addLayer({ id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': 0.001, 'raster-opacity-transition': { duration: 0, delay: 0 }, 'raster-resampling': 'nearest' } }, firstSymbolLayer(activeMap));
    pendingTimer = setTimeout(() => { detachPendingListener(); failRaster(request, frame, 'NASA imagery is taking too long to load. Check your connection and retry.'); }, LOAD_TIMEOUT_MS);
  }
  async function mountFrame(activeMap: MapLibreMapType, token: number) {
    const request = { lifecycle: token, raster: ++rasterGeneration };
    const frame = currentFrame;
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    completeTransition = undefined;
    discardPendingRaster();
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    emit('loading', frame.product === 'satellite' ? `Loading NASA satellite imagery for ${frame.date}…` : `Loading observation imagery for ${frame.date}…`, frame);
    try {
      if (frame.product === 'satellite') { mountSatellite(activeMap, request, frame); return; }
      const manifest = await observationManifest();
      if (!requestIsCurrent(request)) return;
      activeMap.setMaxBounds([[manifest.coordinates[0][0], manifest.coordinates[2][1]], [manifest.coordinates[1][0], manifest.coordinates[0][1]]]);
      const asset = localFrame(manifest, frame);
      if (!asset) throw new Error(`Observation manifest has no image for ${frame.date}.`);
      const image = await cachedImage(asset.url);
      if (!requestIsCurrent(request)) return;
      // An opacity-only update can arrive while the local image is decoding.
      // The request remains current, so mount using its latest normalized value.
      mountLocal(activeMap, request, currentFrame, manifest, image);
    } catch (reason) { failRaster(request, frame, reason instanceof Error ? reason.message : 'Observation imagery could not be loaded.'); }
  }
  function clearMap() {
    clearTimers();
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    completeTransition = undefined;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    detachPendingListener();
    removeRaster(pendingRaster);
    removeRaster(activeRaster);
    pendingRaster = undefined;
    activeRaster = undefined;
    if (map) { map.remove(); map = undefined; }
    basemapReady = false;
  }
  function start() {
    clearMap();
    if (destroyed) return;
    const token = ++lifecycle;
    emit('loading', 'Starting map…');
    try {
      const region = REGIONS.find((item) => item.id === currentRegion)!;
      const activeMap = map = new MapLibreMap({ container, style: BASEMAP_STYLE, bounds: region.bounds, fitBoundsOptions: { padding: 28 }, maxZoom: 9 });
      activeMap.addControl(new NavigationControl(), 'top-right');
      resizeObserver = new ResizeObserver(() => activeMap.resize());
      resizeObserver.observe(container);
      bootstrapTimer = setTimeout(() => {
        if (!destroyed && token === lifecycle) { lifecycle += 1; clearMap(); emit('error', 'The map is taking too long to load. Check your connection and retry.'); }
      }, LOAD_TIMEOUT_MS);
      activeMap.once('load', () => {
        if (destroyed || token !== lifecycle) return;
        if (bootstrapTimer) clearTimeout(bootstrapTimer);
        bootstrapTimer = undefined;
        basemapReady = true;
        void mountFrame(activeMap, token);
      });
      activeMap.on('error', (event) => {
        if (destroyed || token !== lifecycle) return;
        const sourceId = (event as unknown as { sourceId?: string }).sourceId;
        if (sourceId && sourceId === pendingRaster?.sourceId) failRaster({ lifecycle: token, raster: rasterGeneration }, currentFrame, currentFrame.product === 'satellite' ? 'NASA imagery could not be loaded. Check your connection and retry.' : 'Observation imagery could not be loaded. Check your connection and retry.');
        else if (!basemapReady) { lifecycle += 1; clearMap(); emit('error', 'The map could not be loaded. Check your connection and retry.'); }
      });
    } catch { emit('error', 'The map could not start. Check that WebGL is enabled and retry.'); }
  }
  function setFrame(frame: ObservationFrame) {
    if (destroyed) return;
    try {
      const nextFrame = normalizeFrame(frame);
      const sameImage = currentFrame.date === nextFrame.date && currentFrame.product === nextFrame.product;
      currentFrame = nextFrame;
      if (map && basemapReady) {
        if (sameImage) {
          if (pendingRaster) pendingRaster.opacity = nextFrame.opacity;
          if (activeRaster) { activeRaster.opacity = nextFrame.opacity; setLayerOpacity(activeRaster.layerId, nextFrame.opacity); }
          emit(currentStatus.phase, currentStatus.message, nextFrame);
        }
        else void mountFrame(map, lifecycle);
      } else emit('loading', `Waiting to load ${currentFrame.product === 'satellite' ? 'NASA' : 'observation'} imagery for ${currentFrame.date}…`);
    } catch (reason) { emit('error', reason instanceof Error ? reason.message : 'The requested observation frame is invalid.'); }
  }
  function fitRegion(region: RegionId) {
    if (destroyed) return;
    const definition = REGIONS.find((item) => item.id === region);
    if (!definition) return;
    currentRegion = region;
    map?.fitBounds(definition.bounds, { padding: 28, duration: reducedMotion?.matches ? 0 : 450 });
  }
  const onMotionChange = () => {
    if (reducedMotion?.matches && animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
      completeTransition?.();
    }
  };
  reducedMotion?.addEventListener('change', onMotionChange);
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
      reducedMotion?.removeEventListener('change', onMotionChange);
      clearMap();
      manifestController?.abort();
      manifestController = undefined;
      for (const load of imageLoads.values()) load.controller.abort();
      imageLoads.clear();
      for (const image of imageCache.values()) URL.revokeObjectURL(image.url);
      imageCache.clear();
    }
  };
}
