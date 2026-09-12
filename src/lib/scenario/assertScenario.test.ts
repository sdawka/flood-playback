import { describe, expect, it } from 'vitest';

import { assertScenario } from './assertScenario';

const validManifest = {
  schemaVersion: 1,
  id: 'assam-synthetic-v1',
  version: '1.0.0',
  title: 'Assam flood playback',
  status: 'synthetic',
  disclosure: 'Synthetic scenario—not observed or forecast',
  attribution: ['Example attribution'],
  depth: { unit: 'm', scale: 0.01, noData: -1, wetThreshold: 0.01 },
  timestamps: [
    { time: '2026-09-11T00:00:00Z', frame: '000', exact: true },
    { time: '2026-09-11T01:00:00Z', frame: '001', exact: true }
  ],
  regions: [{
    id: 'assam',
    label: 'Assam',
    bounds: [91, 26, 92, 27],
    minZoom: 7,
    maxZoom: 12,
    depthTiles: '/scenarios/assam-synthetic-v1/tiles/depth/{frame}/{z}/{x}/{y}.png'
    ,displayTiles: '/scenarios/assam-synthetic-v1/tiles/display/{frame}/{z}/{x}/{y}.png'
  }],
  gaps: []
};

describe('assertScenario', () => {
  it('accepts a valid manifest', () => {
    expect(() => assertScenario(validManifest)).not.toThrow();
  });

  it('rejects timestamps that are not ordered', () => {
    expect(() => assertScenario({
      ...validManifest,
      timestamps: [...validManifest.timestamps].reverse()
    })).toThrow(/ordered/);
  });

  it('rejects a synthetic manifest without its disclosure', () => {
    expect(() => assertScenario({ ...validManifest, disclosure: '' })).toThrow(/disclosure/);
  });

  it('rejects zero as the no-data value', () => {
    expect(() => assertScenario({
      ...validManifest,
      depth: { ...validManifest.depth, noData: 0 }
    })).toThrow(/no-data/);
  });

  it('rejects gaps that are unordered, overlapping, or outside the scenario range', () => {
    const gap = (start: string, end: string) => ({ start, end });
    expect(() => assertScenario({ ...validManifest, gaps: [
      gap('2026-09-11T00:40:00Z', '2026-09-11T00:50:00Z'),
      gap('2026-09-11T00:10:00Z', '2026-09-11T00:20:00Z')
    ] })).toThrow(/ordered/);
    expect(() => assertScenario({ ...validManifest, gaps: [
      gap('2026-09-11T00:10:00Z', '2026-09-11T00:40:00Z'),
      gap('2026-09-11T00:30:00Z', '2026-09-11T00:50:00Z')
    ] })).toThrow(/overlap/);
    expect(() => assertScenario({ ...validManifest, gaps: [
      gap('2026-09-10T23:50:00Z', '2026-09-11T00:10:00Z')
    ] })).toThrow(/range/);
  });
});
