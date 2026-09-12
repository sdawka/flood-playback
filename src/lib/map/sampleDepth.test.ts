import { describe, expect, it } from 'vitest';
import { decodeDepthTile, sampleDepth, type DepthTile } from './sampleDepth';
import type { ScenarioManifest } from '../scenario/types';

const tile = (values: number[]): DepthTile => ({ width: 2, height: 2, values: Float32Array.from(values), noData: -1 });

describe('sampleDepth', () => {
  it('returns the numeric depth at an exact snapshot', () => {
    expect(sampleDepth({ x: 1, y: 0 }, tile([0, 1.25, 2, 3]), tile([0, 9, 2, 3]), 0)).toEqual({
      kind: 'depth', meters: 1.25, exact: true
    });
  });

  it('interpolates numeric depths at the midpoint', () => {
    const result = sampleDepth({ x: 0, y: 1 }, tile([0, 0, 0.4, 0]), tile([0, 0, 1.6, 0]), 0.5);
    expect(result).toMatchObject({ kind: 'depth', exact: false });
    if (result.kind === 'depth') expect(result.meters).toBeCloseTo(1);
  });

  it('interpolates a dry sample into a wet sample', () => {
    const result = sampleDepth({ x: 0, y: 0 }, tile([0, 0, 0, 0]), tile([0.8, 0, 0, 0]), 0.25);
    expect(result).toMatchObject({ kind: 'depth', exact: false });
    if (result.kind === 'depth') expect(result.meters).toBeCloseTo(0.2);
  });

  it('is unavailable when either required sample is no-data or missing', () => {
    expect(sampleDepth({ x: 0, y: 0 }, tile([-1, 0, 0, 0]), tile([1, 0, 0, 0]), 0.5)).toEqual({
      kind: 'unavailable', reason: 'Depth data is unavailable at this point.'
    });
    expect(sampleDepth({ x: 3, y: 0 }, tile([0, 0, 0, 0]), tile([1, 0, 0, 0]), 0.5)).toEqual({
      kind: 'unavailable', reason: 'Depth data is unavailable at this point.'
    });
  });

  it('decodes the reserved RGB zero code as unavailable while dry remains zero', () => {
    const manifest = { depth: { scale: 0.01, noData: -1 } } as ScenarioManifest;
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 100, 255]) } as ImageData;
    const decoded = decodeDepthTile(image, manifest);
    expect(sampleDepth({ x: 0, y: 0 }, decoded, decoded, 0)).toEqual({
      kind: 'unavailable', reason: 'Depth data is unavailable at this point.'
    });
    expect(sampleDepth({ x: 1, y: 0 }, decoded, decoded, 0)).toEqual({ kind: 'depth', meters: 0, exact: true });
  });
});
