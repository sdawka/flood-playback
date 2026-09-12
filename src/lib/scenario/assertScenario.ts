import type { ScenarioManifest, ScenarioStatus } from './types';

export const SYNTHETIC_DISCLOSURE = 'Synthetic scenario—not observed or forecast';

const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const statuses = new Set<ScenarioStatus>(['synthetic', 'observed', 'simulated', 'forecast']);

function fail(message: string): never {
  throw new Error(`Invalid scenario manifest: ${message}`);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }

  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} must be a non-empty string`);
  }

  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${name} must be a finite number`);
  }

  return value;
}

function timestamp(value: unknown, name: string): number {
  const time = string(value, name);
  const match = timestampPattern.exec(time);
  if (!match) {
    fail(`${name} must be an ISO timestamp with a timezone offset`);
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
    || Number(hour) > 23
    || Number(minute) > 59
    || Number(second) > 59
    || Number.isNaN(Date.parse(time))
  ) {
    fail(`${name} must be a valid date`);
  }

  return Date.parse(time);
}

function bounds(value: unknown, name: string): void {
  if (!Array.isArray(value) || value.length !== 4) {
    fail(`${name} must contain west, south, east, and north`);
  }

  const [west, south, east, north] = value.map((coordinate, index) =>
    finiteNumber(coordinate, `${name}[${index}]`)
  );
  if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) {
    fail(`${name} must be valid geographic bounds`);
  }
}

export function assertScenario(value: unknown): asserts value is ScenarioManifest {
  const manifest = record(value, 'manifest');

  if (manifest.schemaVersion !== 1) fail('schemaVersion must be 1');
  string(manifest.id, 'id');
  string(manifest.version, 'version');
  string(manifest.title, 'title');
  if (typeof manifest.status !== 'string' || !statuses.has(manifest.status as ScenarioStatus)) {
    fail('status must be supported');
  }

  const disclosure = string(manifest.disclosure, 'disclosure');
  if (manifest.status === 'synthetic' && disclosure !== SYNTHETIC_DISCLOSURE) {
    fail(`synthetic disclosure must be exactly "${SYNTHETIC_DISCLOSURE}"`);
  }

  if (!Array.isArray(manifest.attribution) || manifest.attribution.some((item) => typeof item !== 'string' || item.trim() === '')) {
    fail('attribution must be an array of non-empty strings');
  }

  const depth = record(manifest.depth, 'depth');
  if (depth.unit !== 'm') fail('depth unit must be m');
  if (finiteNumber(depth.scale, 'depth scale') <= 0) fail('depth scale must be positive');
  if (finiteNumber(depth.noData, 'depth no-data') === 0) fail('depth no-data must not be 0');
  if (finiteNumber(depth.wetThreshold, 'depth wetThreshold') < 0) fail('depth wetThreshold must not be negative');

  if (!Array.isArray(manifest.timestamps) || manifest.timestamps.length === 0) {
    fail('timestamps must be a non-empty array');
  }
  let previousTime = -Infinity;
  for (const [index, item] of manifest.timestamps.entries()) {
    const entry = record(item, `timestamps[${index}]`);
    const currentTime = timestamp(entry.time, `timestamps[${index}].time`);
    string(entry.frame, `timestamps[${index}].frame`);
    if (entry.exact !== true) fail(`timestamps[${index}].exact must be true`);
    if (currentTime <= previousTime) fail('timestamps must be strictly ordered without duplicates');
    previousTime = currentTime;
  }

  if (!Array.isArray(manifest.regions) || manifest.regions.length === 0) {
    fail('regions must be a non-empty array');
  }
  const regionIds = new Set<string>();
  for (const [index, item] of manifest.regions.entries()) {
    const region = record(item, `regions[${index}]`);
    const id = string(region.id, `regions[${index}].id`);
    if (regionIds.has(id)) fail('region IDs must be unique');
    regionIds.add(id);
    string(region.label, `regions[${index}].label`);
    bounds(region.bounds, `regions[${index}].bounds`);
    const minZoom = finiteNumber(region.minZoom, `regions[${index}].minZoom`);
    const maxZoom = finiteNumber(region.maxZoom, `regions[${index}].maxZoom`);
    if (!Number.isInteger(minZoom) || !Number.isInteger(maxZoom) || minZoom < 0 || maxZoom < minZoom) {
      fail(`regions[${index}] must have a valid zoom range`);
    }
    string(region.depthTiles, `regions[${index}].depthTiles`);
    string(region.displayTiles, `regions[${index}].displayTiles`);
    if (region.terrainTiles !== undefined) string(region.terrainTiles, `regions[${index}].terrainTiles`);
  }

  if (!Array.isArray(manifest.gaps)) fail('gaps must be an array');
  const rangeStart = previousTime === -Infinity ? 0 : timestamp(manifest.timestamps[0].time, 'timestamps[0].time');
  const rangeEnd = timestamp(manifest.timestamps[manifest.timestamps.length - 1].time, `timestamps[${manifest.timestamps.length - 1}].time`);
  let previousGapEnd = -Infinity;
  for (const [index, item] of manifest.gaps.entries()) {
    const gap = record(item, `gaps[${index}]`);
    const start = timestamp(gap.start, `gaps[${index}].start`);
    const end = timestamp(gap.end, `gaps[${index}].end`);
    if (end <= start) fail(`gaps[${index}] must end after it starts`);
    if (start < rangeStart || end > rangeEnd) fail(`gaps[${index}] must be within the scenario range`);
    if (start < previousGapEnd) fail(`gaps must be ordered and non-overlapping`);
    previousGapEnd = end;
  }
}
