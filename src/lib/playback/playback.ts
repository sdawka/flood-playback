export type Gap = { start: string | number; end: string | number };
export type Bracket =
  | { kind: 'exact'; index: number }
  | { kind: 'between'; before: number; after: number; fraction: number }
  | { kind: 'gap'; start: number; end: number };

const ms = (value: string | number) => typeof value === 'number' ? value : Date.parse(value);

/** Finds the two scientific snapshots surrounding a display time. Times are relative to the first snapshot. */
export function bracketTime(timestamps: string[], displayMs: number, gaps: Gap[]): Bracket {
  if (!timestamps.length) throw new Error('At least one timestamp is required');
  const origin = ms(timestamps[0]);
  const values = timestamps.map((time) => ms(time) - origin);
  const gap = gaps.map((item) => ({ start: ms(item.start) - origin, end: ms(item.end) - origin }))
    .find((item) => displayMs >= item.start && displayMs < item.end);
  if (gap) return { kind: 'gap', ...gap };
  if (displayMs <= values[0]) return { kind: 'exact', index: 0 };
  const last = values.length - 1;
  if (displayMs >= values[last]) return { kind: 'exact', index: last };
  const after = values.findIndex((value) => value >= displayMs);
  if (values[after] === displayMs) return { kind: 'exact', index: after };
  const before = after - 1;
  return { kind: 'between', before, after, fraction: (displayMs - values[before]) / (values[after] - values[before]) };
}

export function interpolateDepth(before: number, after: number, fraction: number) {
  return before + (after - before) * Math.max(0, Math.min(1, fraction));
}
export function frameBeforeGap(times: string[], frames: string[], gapStart: string) {
  const origin = ms(times[0]);
  const index = times.map((time, i) => ({ i, t: ms(time) - origin })).filter((item) => item.t < ms(gapStart) - origin).at(-1)?.i ?? 0;
  return frames[index];
}

export function createPlayback(onTime: (displayTimeMs: number) => void, durationMs: number, gaps: Array<{ start: number; end: number }> = [], onPlaying: (value: boolean) => void = () => {}) {
  let displayTimeMs = 0;
  let speed: 0.5 | 1 | 2 | 4 = 1;
  let playing = false;
  let raf = 0;
  let previous: number | undefined;
  let generation = 0;
  const tick = (now: number, token = generation) => {
    if (!playing) return;
    if (token !== generation) return;
    const priorTime = displayTimeMs;
    if (previous !== undefined) displayTimeMs += (now - previous) * speed;
    previous = now;
    const gap = gaps.find((item) => (priorTime < item.start && displayTimeMs >= item.start) || (displayTimeMs >= item.start && displayTimeMs < item.end));
    if (gap) { displayTimeMs = gap.start; playing = false; onPlaying(false); }
    if (displayTimeMs >= durationMs) { displayTimeMs = durationMs; playing = false; onPlaying(false); }
    onTime(displayTimeMs);
    if (playing) raf = requestAnimationFrame((next) => { if (token === generation) tick(next, token); });
  };
  return {
    get time() { return displayTimeMs; }, get isPlaying() { return playing; },
    seek(time: number) { displayTimeMs = Math.max(0, Math.min(durationMs, time)); onTime(displayTimeMs); },
    toggle() { playing = !playing; previous = undefined; generation += 1; onPlaying(playing); if (playing) { const token = generation; raf = requestAnimationFrame((now) => { if (token === generation) tick(now); }); } },
    setSpeed(value: 0.5 | 1 | 2 | 4) { speed = value; },
    dispose() { cancelAnimationFrame(raf); }
  };
}
