export function terrainEnabledForRegion(regionId: string, hasTerrainTiles: boolean, failedRegionIds: ReadonlySet<string>) {
  return hasTerrainTiles && !failedRegionIds.has(regionId);
}
