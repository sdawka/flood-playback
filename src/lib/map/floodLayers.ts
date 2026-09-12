import type { RegionManifest, ScenarioManifest } from '../scenario/types';

type SourceDefinition = Record<string, unknown>;
type LayerDefinition = Record<string, unknown>;

export interface FloodMapAdapter {
  addSource(id: string, source: SourceDefinition): void;
  getSource(id: string): unknown;
  removeSource(id: string): void;
  addLayer(layer: LayerDefinition, beforeId?: string): void;
  getLayer(id: string): unknown;
  removeLayer(id: string): void;
  setPaintProperty(id: string, property: string, value: unknown): void;
  setTerrain(terrain: { source: string; exaggeration: number } | null): void;
  getStyle?(): { layers?: Array<{ id: string; type: string }> };
}

const BEFORE_SOURCE = 'flood-depth-before';
const AFTER_SOURCE = 'flood-depth-after';
const BEFORE_LAYER = 'flood-depth-before';
const AFTER_LAYER = 'flood-depth-after';
const mountedPairs = new WeakMap<FloodMapAdapter, { regionId: string; beforeFrame: string; afterFrame: string; exact: boolean }>();

export function mapLibreDepthEncoding(manifest: ScenarioManifest) {
  const { noData, scale } = manifest.depth;
  return {
    encoding: 'custom',
    redFactor: 65536 * scale,
    greenFactor: 256 * scale,
    blueFactor: scale,
    // MapLibre subtracts baseShift. Code zero is therefore the
    // reserved no-data sentinel and code (-noData / scale) is dry zero.
    baseShift: -noData
  } as const;
}

/** Mirrors the custom raster-dem decoder used by MapLibre for fixture pixels. */
export function decodeDepthCode(manifest: ScenarioManifest, code: number) {
  const encoding = mapLibreDepthEncoding(manifest);
  const red = (code >> 16) & 255;
  const green = (code >> 8) & 255;
  const blue = code & 255;
  return red * encoding.redFactor + green * encoding.greenFactor + blue * encoding.blueFactor - encoding.baseShift;
}

function replace(template: string, frame: string) {
  return template.replace('{frame}', frame);
}

function removeFloodLayer(map: FloodMapAdapter, id: string) {
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

function addFloodLayer(map: FloodMapAdapter, manifest: ScenarioManifest, region: RegionManifest, sourceId: string, frame: string, opacity: number) {
  map.addSource(sourceId, {
    type: 'raster',
    tiles: [replace(region.displayTiles, frame)],
    bounds: region.bounds,
    minzoom: region.minZoom,
    maxzoom: region.maxZoom,
    tileSize: 256,
    attribution: 'Synthetic flood scenario',
    rasterResampling: 'nearest'
  });
  const firstLabel = map.getStyle?.().layers?.find((layer) => layer.type === 'symbol')?.id;
  map.addLayer({
    id: sourceId,
    type: 'raster',
    source: sourceId,
    paint: { 'raster-opacity': opacity }
  }, firstLabel);
}

/** Configures one exact flood timestamp or a crossfade between adjacent timestamps. */
export function setFloodFrames(map: FloodMapAdapter, manifest: ScenarioManifest, regionId: string, beforeFrame: string, afterFrame: string, fraction: number) {
  const region = manifest.regions.find((item) => item.id === regionId);
  if (!region) throw new Error(`Unknown scenario region: ${regionId}`);
  const blend = Math.max(0, Math.min(1, fraction));
  const exactFrame = beforeFrame === afterFrame || blend === 0 || blend === 1;
  const resolvedBeforeFrame = blend === 1 ? afterFrame : beforeFrame;

  const mounted = mountedPairs.get(map);
  if (mounted && mounted.regionId === regionId && mounted.beforeFrame === beforeFrame && mounted.afterFrame === afterFrame && !mounted.exact && !exactFrame) {
    map.setPaintProperty(BEFORE_LAYER, 'raster-opacity', 1 - blend);
    map.setPaintProperty(AFTER_LAYER, 'raster-opacity', blend);
    return;
  }

  removeFloodLayer(map, BEFORE_LAYER);
  removeFloodLayer(map, AFTER_LAYER);
  addFloodLayer(map, manifest, region, BEFORE_SOURCE, resolvedBeforeFrame, exactFrame ? 1 : 1 - blend);
  if (!exactFrame) addFloodLayer(map, manifest, region, AFTER_SOURCE, afterFrame, blend);
  mountedPairs.set(map, { regionId, beforeFrame, afterFrame, exact: exactFrame });
}

/** Toggles terrain only after the optional terrain source has been registered. */
export function setTerrainMode(map: FloodMapAdapter, enabled: boolean) {
  map.setTerrain(enabled && map.getSource('terrain') ? { source: 'terrain', exaggeration: 1 } : null);
}
