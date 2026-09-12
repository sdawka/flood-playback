import { describe, expect, it } from 'vitest';
import { COMBINED_DATES, DATES, crossFadeOpacities, gibsTileUrl, isCurrentRasterRequest, normalizeFrame } from './gibs';

describe('NASA GIBS observation frames', () => {
  it('lists every available daily June 2022 observation exactly once', () => {
    expect(DATES).toHaveLength(19);
    expect(DATES[0]).toBe('2022-06-12');
    expect(DATES.at(-1)).toBe('2022-06-30');
    expect(new Set(DATES).size).toBe(DATES.length);
  });

  it('lists every six-hour combined playback frame as UTC timestamps', () => {
    expect(COMBINED_DATES).toHaveLength(73);
    expect(COMBINED_DATES[0]).toBe('2022-06-12T00:00:00Z');
    expect(COMBINED_DATES[1]).toBe('2022-06-12T06:00:00Z');
    expect(COMBINED_DATES.at(-1)).toBe('2022-06-30T00:00:00Z');
    expect(new Set(COMBINED_DATES).size).toBe(COMBINED_DATES.length);
  });

  it('builds an EPSG:3857 GIBS URL with an encoded date and PNG flood tiles', () => {
    expect(gibsTileUrl('MODIS_Combined_Flood_3-Day', '2022-06-22', 7, 102, 52)).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Combined_Flood_3-Day/default/2022-06-22/GoogleMapsCompatible_Level9/7/52/102.png'
    );
  });

  it('uses the satellite JPEG extension and rejects unsafe tile parameters', () => {
    expect(gibsTileUrl('MODIS_Terra_CorrectedReflectance_Bands721', '2022-06-22', 8, 204, 104)).toMatch(/\.jpeg$/);
    expect(() => gibsTileUrl('bad/layer', '2022-06-22', 7, 1, 1)).toThrow('Unknown GIBS layer');
    expect(() => gibsTileUrl('MODIS_Combined_Flood_3-Day', '2022-06-22/../../x', 7, 1, 1)).toThrow('Unknown observation date');
    expect(() => gibsTileUrl('MODIS_Combined_Flood_3-Day', '2022-06-22', 10, 1, 1)).toThrow('Invalid GIBS tile coordinates');
  });

  it('preserves valid frames while clamping opacity to a safe raster range', () => {
    expect(normalizeFrame({ date: '2022-06-22', product: 'flood', opacity: 0.8 })).toEqual({ date: '2022-06-22', product: 'flood', opacity: 0.8 });
    expect(normalizeFrame({ date: '2022-06-22', product: 'satellite', opacity: 4 })).toEqual({ date: '2022-06-22', product: 'satellite', opacity: 1 });
    expect(normalizeFrame({ date: '2022-06-22', product: 'flood', opacity: -1 })).toEqual({ date: '2022-06-22', product: 'flood', opacity: 0 });
    expect(normalizeFrame({ date: '2022-06-24T00:00:00Z', product: 'combined', opacity: 0.8 })).toEqual({ date: '2022-06-24T00:00:00Z', product: 'combined', opacity: 0.8 });
    expect(() => normalizeFrame({ date: '2022-06-24', product: 'combined', opacity: 0.8 })).toThrow('Unknown combined observation date');
    expect(() => normalizeFrame({ date: '2022-06-24T00:00:00Z', product: 'flood', opacity: 0.8 })).toThrow('Unknown observation date');
  });

  it('rejects stale raster events after a newer frame or map lifecycle starts', () => {
    expect(isCurrentRasterRequest({ lifecycle: 3, raster: 5 }, { lifecycle: 3, raster: 5 })).toBe(true);
    expect(isCurrentRasterRequest({ lifecycle: 3, raster: 5 }, { lifecycle: 3, raster: 4 })).toBe(false);
    expect(isCurrentRasterRequest({ lifecycle: 3, raster: 5 }, { lifecycle: 2, raster: 5 })).toBe(false);
  });

  it('keeps the composed frame opacity steady while two raster layers cross-fade', () => {
    const { previous, next } = crossFadeOpacities(0.8, 0.8, 0.5);
    expect(previous).toBeCloseTo(0.4);
    expect(next).toBeCloseTo(2 / 3);
    expect(previous + (1 - previous) * next).toBeCloseTo(0.8);
  });
});
