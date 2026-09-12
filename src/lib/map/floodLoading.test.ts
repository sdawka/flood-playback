import { describe, expect, it } from 'vitest';
import { KeyedAbortableRequest, depthTileUrl, nextFrame, prefetchRequestKey, probeFloodPair, probeRequestKey, visibleTiles, type FloodPair } from './floodLoading';

const pair: FloodPair = { generation: 3, beforeFrame: '001', afterFrame: '002', fraction: 0.5, sourceIds: ['flood-depth-before', 'flood-depth-after'] };

describe('flood loading helpers', () => {
  it('derives the next manifest frame and a concrete probe URL', () => {
    expect(nextFrame([{ frame: '001' }, { frame: '002' }, { frame: '003' }], '001')).toBe('002');
    expect(depthTileUrl('/depth/{frame}/{z}/{x}/{y}.png', '002', { z: 4, x: 8, y: 9 })).toBe('/depth/002/4/8/9.png');
  });

  it('enumerates every visible tile, not only map center', () => {
    expect(visibleTiles({ west: -10, south: -10, east: 10, north: 10 }, 2)).toEqual([
      { z: 2, x: 1, y: 1 }, { z: 2, x: 2, y: 1 }, { z: 2, x: 1, y: 2 }, { z: 2, x: 2, y: 2 }
    ]);
  });

  it('rejects a frame pair when a non-center required tile probe is non-OK', async () => {
    const request: typeof fetch = async (input) => new Response(null, { status: String(input).includes('/1/1/1.png') ? 404 : 200 });
    await expect(probeFloodPair(pair, '/depth/{frame}/{z}/{x}/{y}.png', [{ z: 1, x: 0, y: 0 }, { z: 1, x: 1, y: 1 }], new AbortController().signal, request)).rejects.toThrow('Depth tile request failed: 404');
  });

  it('does not relaunch current probes or next-frame prefetches for fractional updates within one frame pair', () => {
    const visible = [{ z: 4, x: 8, y: 9 }, { z: 4, x: 9, y: 9 }];
    const center = { z: 4, x: 8, y: 9 };
    const probes = new KeyedAbortableRequest();
    const prefetches = new KeyedAbortableRequest();
    let probeLaunches = 0;
    let prefetchLaunches = 0;

    for (const fraction of [0.1, 0.5, 0.9]) {
      const currentPair = { ...pair, fraction };
      const probe = probes.begin(probeRequestKey('assam', currentPair.beforeFrame, currentPair.afterFrame, visible));
      if (probe) probeLaunches += 1;
      const prefetch = prefetches.begin(prefetchRequestKey('assam', '003', center));
      if (prefetch) prefetchLaunches += 1;
    }

    expect(probeLaunches).toBe(1);
    expect(prefetchLaunches).toBe(1);
    expect(probes.begin(probeRequestKey('assam', '002', '003', visible))).toBeDefined();
    expect(probes.begin(probeRequestKey('assam', '002', '003', [{ z: 4, x: 9, y: 9 }]))).toBeDefined();
    expect(prefetches.begin(prefetchRequestKey('assam', '004', center))).toBeDefined();
    expect(prefetches.begin(prefetchRequestKey('assam', '004', { z: 4, x: 9, y: 9 }))).toBeDefined();
  });
});
