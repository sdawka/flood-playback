import { describe, expect, it } from 'vitest';
import { decodeDepthCode, mapLibreDepthEncoding, setFloodFrames, setTerrainMode } from './floodLayers';
import type { ScenarioManifest } from '../scenario/types';

const manifest: ScenarioManifest = {
  schemaVersion: 1,
  id: 'assam-synthetic-v1',
  version: '1.0.0',
  title: 'Assam synthetic flood playback',
  status: 'synthetic',
  disclosure: 'Synthetic scenario—not observed or forecast',
  attribution: ['Synthetic fixture'],
  depth: { unit: 'm', scale: 0.01, noData: -1, wetThreshold: 0.01 },
  timestamps: [
    { time: '2026-06-01T00:00:00Z', frame: '000', exact: true },
    { time: '2026-06-01T06:00:00Z', frame: '001', exact: true }
  ],
  regions: [
    {
      id: 'assam', label: 'Assam demo area', bounds: [91, 26, 92, 27], minZoom: 0, maxZoom: 0,
      depthTiles: '/scenarios/assam-synthetic-v1/tiles/depth/{frame}/{z}/{x}/{y}.png',
      displayTiles: '/scenarios/assam-synthetic-v1/tiles/display/{frame}/{z}/{x}/{y}.png',
      terrainTiles: '/scenarios/assam-synthetic-v1/tiles/terrain/{z}/{x}/{y}.png'
    },
    {
      id: 'other', label: 'Other demo area', bounds: [92, 26, 93, 27], minZoom: 0, maxZoom: 0,
      depthTiles: '/scenarios/other/tiles/depth/{frame}/{z}/{x}/{y}.png'
      ,displayTiles: '/scenarios/other/tiles/display/{frame}/{z}/{x}/{y}.png'
    }
  ],
  gaps: []
};

class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  layers = new Map<string, Record<string, unknown>>();
  addSourceCalls = 0;
  removeSourceCalls = 0;
  terrain: unknown;

  addSource(id: string, source: Record<string, unknown>) { this.addSourceCalls += 1; this.sources.set(id, source); }
  getSource(id: string) { return this.sources.get(id); }
  removeSource(id: string) { this.removeSourceCalls += 1; this.sources.delete(id); }
  addLayer(layer: Record<string, unknown>) { this.layers.set(layer.id as string, layer); }
  getLayer(id: string) { return this.layers.get(id); }
  removeLayer(id: string) { this.layers.delete(id); }
  setPaintProperty(id: string, property: string, value: unknown) {
    const layer = this.layers.get(id)!;
    const paint = (layer.paint ??= {}) as Record<string, unknown>;
    paint[property] = value;
  }
  setTerrain(value: unknown) { this.terrain = value; }
}

describe('setFloodFrames', () => {
  it('uses the exact custom MapLibre formula for wet pixels and the reserved no-data sentinel', () => {
    const map = new FakeMap();
    const source = mapLibreDepthEncoding(manifest);
    const elevation = (code: number) => {
      const red = (code >> 16) & 255;
      const green = (code >> 8) & 255;
      const blue = code & 255;
      return red * Number(source.redFactor) + green * Number(source.greenFactor) + blue * Number(source.blueFactor) - Number(source.baseShift);
    };
    const wetCode = 225; // (1.25m - -1m) / 0.01m

    expect(elevation(wetCode)).toBeCloseTo(1.25);
    expect(decodeDepthCode(manifest, wetCode)).toBeCloseTo(1.25);
    expect(elevation(0)).toBe(manifest.depth.noData);
    expect(decodeDepthCode(manifest, 0)).toBe(manifest.depth.noData);
  });

  it('renders an exact timestamp as one opaque depth layer with manifest no-data decoding', () => {
    const map = new FakeMap();

    setFloodFrames(map, manifest, 'assam', '003', '003', 0);

    expect(map.layers.get('flood-depth-before')?.paint).toMatchObject({ 'raster-opacity': 1 });
    expect(map.layers.has('flood-depth-after')).toBe(false);
    expect(map.sources.get('flood-depth-before')).toMatchObject({
      type: 'raster', tiles: ['/scenarios/assam-synthetic-v1/tiles/display/003/{z}/{x}/{y}.png']
    });
    const paint = map.layers.get('flood-depth-before')?.paint as Record<string, unknown> | undefined;
    expect(paint?.['raster-opacity']).toBe(1);
  });

  it('blends the earlier and later depth layers at the midpoint', () => {
    const map = new FakeMap();

    setFloodFrames(map, manifest, 'assam', '003', '004', 0.5);

    expect(map.layers.get('flood-depth-before')?.paint).toMatchObject({ 'raster-opacity': 0.5 });
    expect(map.layers.get('flood-depth-after')?.paint).toMatchObject({ 'raster-opacity': 0.5 });
  });

  it('keeps a frame pair mounted while fraction-only changes update opacity', () => {
    const map = new FakeMap();
    setFloodFrames(map, manifest, 'assam', '003', '004', 0.25);
    const initialSourceAdds = map.addSourceCalls;
    const initialSourceRemovals = map.removeSourceCalls;

    setFloodFrames(map, manifest, 'assam', '003', '004', 0.75);

    expect(map.addSourceCalls).toBe(initialSourceAdds);
    expect(map.removeSourceCalls).toBe(initialSourceRemovals);
    expect(map.layers.get('flood-depth-before')?.paint).toMatchObject({ 'raster-opacity': 0.25 });
    expect(map.layers.get('flood-depth-after')?.paint).toMatchObject({ 'raster-opacity': 0.75 });
  });

  it('renders the later frame alone when interpolation reaches its exact endpoint', () => {
    const map = new FakeMap();

    setFloodFrames(map, manifest, 'assam', '003', '004', 1);

    expect(map.sources.get('flood-depth-before')?.tiles).toEqual(['/scenarios/assam-synthetic-v1/tiles/display/004/{z}/{x}/{y}.png']);
    expect(map.layers.get('flood-depth-before')?.paint).toMatchObject({ 'raster-opacity': 1 });
    expect(map.layers.has('flood-depth-after')).toBe(false);
  });

  it('replaces obsolete sources when the region changes', () => {
    const map = new FakeMap();
    setFloodFrames(map, manifest, 'assam', '003', '004', 0.5);

    setFloodFrames(map, manifest, 'other', '003', '003', 0);

    expect(map.sources.get('flood-depth-before')?.tiles).toEqual(['/scenarios/other/tiles/display/003/{z}/{x}/{y}.png']);
    expect(map.sources.has('flood-depth-after')).toBe(false);
  });
});

describe('setTerrainMode', () => {
  it('enables and disables the registered terrain source', () => {
    const map = new FakeMap();
    map.addSource('terrain', { type: 'raster-dem' });

    setTerrainMode(map, true);
    expect(map.terrain).toEqual({ source: 'terrain', exaggeration: 1 });

    setTerrainMode(map, false);
    expect(map.terrain).toBeNull();
  });
});
