export interface FloodPair {
  generation: number;
  beforeFrame: string;
  afterFrame: string;
  fraction: number;
  sourceIds: string[];
}

export interface TileLocation { z: number; x: number; y: number; }

export interface GeographicBounds { west: number; south: number; east: number; north: number; }

/** Starts one abortable request per input identity and preserves it across display-only updates. */
export class KeyedAbortableRequest {
  private active: { key: string; controller: AbortController } | undefined;

  begin(key: string) {
    if (this.active?.key === key) return undefined;
    this.active?.controller.abort();
    const controller = new AbortController();
    this.active = { key, controller };
    return this.active;
  }

  reset() {
    this.active?.controller.abort();
    this.active = undefined;
  }
}

function tileSetKey(locations: TileLocation[]) {
  return locations.map(({ z, x, y }) => `${z}/${x}/${y}`).sort().join(',');
}

export function probeRequestKey(regionId: string, beforeFrame: string, afterFrame: string, locations: TileLocation[]) {
  return `${regionId}|${beforeFrame}|${afterFrame}|${tileSetKey(locations)}`;
}

export function prefetchRequestKey(regionId: string, frame: string, center: TileLocation) {
  return `${regionId}|${frame}|${center.z}/${center.x}/${center.y}`;
}

export function depthTileUrl(template: string, frame: string, location: TileLocation) {
  return template.replace('{frame}', frame).replace('{z}', String(location.z)).replace('{x}', String(location.x)).replace('{y}', String(location.y));
}

export function nextFrame(timestamps: Array<{ frame: string }>, currentFrame: string) {
  const index = timestamps.findIndex((timestamp) => timestamp.frame === currentFrame);
  return index >= 0 ? timestamps[index + 1]?.frame : undefined;
}

function tileY(latitude: number, tiles: number) {
  const radians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * tiles;
}

/** Enumerates the finite tile set intersecting the current viewport. */
export function visibleTiles(bounds: GeographicBounds, z: number): TileLocation[] {
  const tiles = 2 ** z;
  const minX = Math.max(0, Math.min(tiles - 1, Math.floor((bounds.west + 180) / 360 * tiles)));
  const maxX = Math.max(0, Math.min(tiles - 1, Math.floor((bounds.east + 180) / 360 * tiles)));
  const minY = Math.max(0, Math.min(tiles - 1, Math.floor(tileY(bounds.north, tiles))));
  const maxY = Math.max(0, Math.min(tiles - 1, Math.floor(tileY(bounds.south, tiles))));
  const result: TileLocation[] = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) result.push({ z, x, y });
  return result;
}

/** Probes one known visible tile per required frame so non-OK tiles are not hidden by map rendering. */
export async function probeFloodPair(pair: FloodPair, template: string, locations: TileLocation[], signal: AbortSignal, request: typeof fetch = fetch, concurrency = 4) {
  const frames = pair.beforeFrame === pair.afterFrame ? [pair.beforeFrame] : [pair.beforeFrame, pair.afterFrame];
  const urls = frames.flatMap((frame) => locations.map((location) => depthTileUrl(template, frame, location)));
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const url = urls[next++];
      const response = await request(url, { signal });
      if (!response.ok) throw new Error(`Depth tile request failed: ${response.status}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
}
