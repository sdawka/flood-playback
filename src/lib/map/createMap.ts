import { Map as MapLibreMap, NavigationControl, type Map } from 'maplibre-gl';
import type { ScenarioManifest } from '../scenario/types';
import { setTerrainMode, type FloodMapAdapter } from './floodLayers';

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function createMap(container: HTMLElement, manifest: ScenarioManifest, regionId: string): Map {
  const region = manifest.regions.find((item) => item.id === regionId);
  if (!region) throw new Error(`Unknown scenario region: ${regionId}`);

  const map = new MapLibreMap({
    container,
    style: BASEMAP_STYLE,
    bounds: region.bounds,
    maxBounds: region.bounds,
    minZoom: region.minZoom,
    maxZoom: Math.max(region.maxZoom, region.minZoom + 8)
  });
  map.addControl(new NavigationControl(), 'top-right');

  map.once('load', () => {
    if (region.terrainTiles) {
      map.addSource('terrain', {
        type: 'raster-dem',
        tiles: [region.terrainTiles],
        bounds: region.bounds,
        minzoom: region.minZoom,
        maxzoom: region.maxZoom,
        tileSize: 256,
        encoding: 'custom',
        redFactor: 1,
        greenFactor: 1,
        blueFactor: 1,
        baseShift: 0
      });
      setTerrainMode(map as unknown as FloodMapAdapter, false);
    }
  });

  return map;
}
