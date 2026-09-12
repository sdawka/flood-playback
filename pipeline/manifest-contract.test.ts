import manifest from '../public/scenarios/assam-synthetic-v1/manifest.json';
import { expect, test } from 'vitest';
import { assertScenario } from '../src/lib/scenario/assertScenario';

test('the clone-safe Assam manifest satisfies the scenario contract', () => {
  assertScenario(manifest);
  expect(manifest.regions[0].depthTiles).toBe('/scenarios/assam-synthetic-v1/tiles/depth/{frame}/{z}/{x}/{y}.png');
});
