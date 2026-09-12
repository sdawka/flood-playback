import { expect, it } from 'vitest';
import { terrainEnabledForRegion } from './terrainAvailability';

it('keeps terrain disabled after returning to a failed region', () => {
  expect(terrainEnabledForRegion('assam', true, new Set(['assam']))).toBe(false);
  expect(terrainEnabledForRegion('other', true, new Set(['assam']))).toBe(true);
});
