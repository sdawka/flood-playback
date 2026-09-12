import { decodeDepthCode } from './floodLayers';
import type { ScenarioManifest } from '../scenario/types';

export interface DepthTile {
  width: number;
  height: number;
  values: Float32Array;
  noData: number;
}

export type DepthSample =
  | { kind: 'depth'; meters: number; exact: boolean }
  | { kind: 'unavailable'; reason: string };

const UNAVAILABLE = 'Depth data is unavailable at this point.';

function valueAt(tile: DepthTile, point: { x: number; y: number }) {
  if (!Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0 || point.x >= tile.width || point.y >= tile.height) {
    return undefined;
  }
  const value = tile.values[point.y * tile.width + point.x];
  return Number.isFinite(value) && value !== tile.noData ? value : undefined;
}

/** Samples decoded numeric depths, never the display colour-relief ramp. */
export function sampleDepth(point: { x: number; y: number }, beforeTile: DepthTile, afterTile: DepthTile, fraction: number): DepthSample {
  const before = valueAt(beforeTile, point);
  const after = valueAt(afterTile, point);
  if (before === undefined || after === undefined) return { kind: 'unavailable', reason: UNAVAILABLE };

  const blend = Math.max(0, Math.min(1, fraction));
  return { kind: 'depth', meters: before + (after - before) * blend, exact: blend === 0 || blend === 1 };
}

/** Decodes the manifest's RGB numeric encoding from a fetched tile image. */
export function decodeDepthTile(image: ImageData, manifest: ScenarioManifest): DepthTile {
  const values = new Float32Array(image.width * image.height);
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    const code = image.data[offset] * 65536 + image.data[offset + 1] * 256 + image.data[offset + 2];
    values[index] = decodeDepthCode(manifest, code);
  }
  return { width: image.width, height: image.height, values, noData: manifest.depth.noData };
}
