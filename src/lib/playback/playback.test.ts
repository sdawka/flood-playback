import { describe, expect, it, vi } from 'vitest';
import { bracketTime, createPlayback, frameBeforeGap, interpolateDepth } from './playback';

const times = ['2024-06-01T00:00:00Z', '2024-06-01T01:00:00Z', '2024-06-01T02:00:00Z'];

describe('playback timeline math', () => {
  it('plays a 42-hour scenario in 30 seconds and can replay after the end', () => {
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callback = fn; return 1; });
    try {
      const duration = 42 * 3_600_000;
      const controller = createPlayback(() => {}, duration);
      controller.toggle(); callback?.(0); callback?.(15_000);
      expect(controller.time).toBe(duration / 2);
      callback?.(30_000);
      expect(controller.time).toBe(duration);
      expect(controller.isPlaying).toBe(false);
      controller.toggle(); callback?.(40_000);
      expect(controller.time).toBe(0);
      expect(controller.isPlaying).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('brackets exact first and last timestamps', () => {
    expect(bracketTime(times, 0, [])).toEqual({ kind: 'exact', index: 0 });
    expect(bracketTime(times, 7_200_000, [])).toEqual({ kind: 'exact', index: 2 });
  });
  it('returns midpoint fraction between snapshots', () => {
    expect(bracketTime(times, 1_800_000, [])).toEqual({ kind: 'between', before: 0, after: 1, fraction: 0.5 });
  });
  it('clamps outside the timestamp range', () => {
    expect(bracketTime(times, -1, [])).toEqual({ kind: 'exact', index: 0 });
    expect(bracketTime(times, 9_000_000, [])).toEqual({ kind: 'exact', index: 2 });
  });
  it('detects declared gaps', () => {
    expect(bracketTime(times, 5_400_000, [{ start: times[1], end: times[2] }])).toEqual({ kind: 'gap', start: 3_600_000, end: 7_200_000 });
  });
  it('interpolates depth values', () => expect(interpolateDepth(0, 1.2, 0.5)).toBe(0.6));
  it('advances by rAF elapsed time and resets baseline after pause', () => {
    let now = 0; let callback: FrameRequestCallback | undefined; const seen: number[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callback = fn; return 1; });
    const controller = createPlayback((time) => seen.push(time), 10_000);
    controller.toggle(); callback?.(0); now = 100; callback?.(now); controller.toggle(); now = 1_000; controller.toggle(); callback?.(now);
    expect(seen.at(-1)).toBe(100);
    vi.unstubAllGlobals();
  });
  it('stops and reports false at the end and gap boundary', () => {
    let callback: FrameRequestCallback | undefined; const states: boolean[] = [];
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callback = fn; return 1; });
    const end = createPlayback(() => {}, 100, [], (value) => states.push(value)); end.toggle(); callback?.(0); callback?.(150);
    const gap = createPlayback(() => {}, 200, [{ start: 50, end: 100 }], (value) => states.push(value)); gap.toggle(); callback?.(0); callback?.(60);
    expect(states).toEqual([true, false, true, false]); vi.unstubAllGlobals();
  });
  it('clamps an overshoot to a gap and retains the strictly preceding frame', () => {
    let callback: FrameRequestCallback | undefined; let value = -1;
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callback = fn; return 1; });
    const controller = createPlayback((time) => { value = time; }, 200, [{ start: 50, end: 100 }]); controller.toggle(); callback?.(0); callback?.(60);
    expect(value).toBe(50);
    expect(frameBeforeGap(times, ['a', 'b', 'c'], times[1])).toBe('a');
    vi.unstubAllGlobals();
  });
  it('invalidates the paused rAF callback', () => {
    const callbacks: FrameRequestCallback[] = []; vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.push(fn); return callbacks.length; });
    let value = 0; const controller = createPlayback((time) => { value = time; }, 1000); controller.toggle(); controller.toggle(); callbacks[0]?.(500); expect(value).toBe(0); vi.unstubAllGlobals();
  });
  it('invalidates successors from a paused playback generation', () => {
    const callbacks: FrameRequestCallback[] = []; vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { callbacks.push(fn); return callbacks.length; });
    let value = 0; const controller = createPlayback((time) => { value = time; }, 10_000); controller.toggle(); callbacks[0]?.(0); callbacks[1]?.(100); controller.toggle(); controller.toggle(); const count = callbacks.length; callbacks[2]?.(500); expect(value).toBe(100); expect(callbacks).toHaveLength(count); vi.unstubAllGlobals();
  });
});
