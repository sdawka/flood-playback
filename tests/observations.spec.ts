import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const sequence = JSON.parse(readFileSync('public/observations/assam-june-2022/manifest.json', 'utf8')) as {
  frames: Array<{ time: string; url: string }>;
};
const frameUrl = (index: number) => sequence.frames[index].url;
const imageHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
// Element screenshots include overlapping controls; compare only the rendered map.
const mapScreenshot = { style: '.map-panel, .map-status, .timeline-footer { visibility: hidden !important; }' };

async function mockExternalImagery(page: import('@playwright/test').Page) {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('https://gibs.earthdata.nasa.gov/wmts/**', route => route.fulfill({
    contentType: 'image/png', path: 'public/scenarios/assam-synthetic-v1/tiles/display/004/7/96/54.png'
  }));
}

async function openLayers(page: import('@playwright/test').Page) {
  const expand = page.getByRole('button', { name: /Layers.*legend/i });
  if (await expand.isVisible() && await expand.getAttribute('aria-expanded') === 'false') await expand.click();
}

test('local combined sequence is the default and intermediate frames are labeled derived', async ({ page }) => {
  await mockExternalImagery(page);
  const nasaRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('gibs.earthdata.nasa.gov')) nasaRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Derived · combined observations');
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('48');
  await page.getByRole('button', { name: 'Next observation' }).click();
  await expect(page.locator('.timeline-readout')).toContainText('Derived · interpolated frame');
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('49');
  expect(nasaRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('original observations remain available and satellite selection uses the same day', async ({ page }) => {
  await mockExternalImagery(page);
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  await openLayers(page);
  await page.getByRole('button', { name: 'Original observations', exact: true }).click();
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('12');
  await expect(page.getByLabel('Flood extent legend')).toContainText('Insufficient data');
  const satellite = page.waitForResponse(response => response.url().includes('/MODIS_Terra_CorrectedReflectance_Bands721/default/2022-06-24/') && response.ok());
  await page.getByRole('button', { name: 'Satellite imagery', exact: true }).click();
  await satellite;
  await expect(page.getByLabel('Satellite imagery explanation')).toContainText('7-2-1');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
});

test('opacity changes preserve the displayed combined frame', async ({ page }) => {
  await mockExternalImagery(page);
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  await openLayers(page);
  await page.getByRole('slider', { name: 'Layer opacity' }).fill('0.5');
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  await expect(page.locator('.map-status.loading')).toHaveCount(0);
});

test('buffered playback advances generated frames and pauses', async ({ page }) => {
  await mockExternalImagery(page);
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  await page.getByRole('button', { name: 'Play daily observations' }).click();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Observation date' }).inputValue())).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await expect(page.getByRole('button', { name: 'Play daily observations' })).toBeVisible();
});

test('keeps the complete current frame while buffering and ignores an outdated request', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockExternalImagery(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**${frameUrl(60)}`, async route => { await held; await route.continue().catch(() => {}); });
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  const canvas = page.locator('.observation-map canvas');
  const before = await canvas.screenshot(mapScreenshot);
  const delayed = page.waitForRequest(`**${frameUrl(60)}`);
  await page.getByRole('slider', { name: 'Observation date' }).fill('60');
  await delayed;
  await expect(page.locator('.timeline-readout')).not.toContainText('Derived');
  expect(imageHash(await canvas.screenshot(mapScreenshot))).toEqual(imageHash(before));
  await page.getByRole('slider', { name: 'Observation date' }).fill('64');
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  release();
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('64');
});

test('a failed requested frame keeps the last image and reports unavailable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockExternalImagery(page);
  await page.route(`**${frameUrl(60)}`, route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Derived');
  const before = await page.locator('.observation-map canvas').screenshot(mapScreenshot);
  await page.getByRole('slider', { name: 'Observation date' }).fill('60');
  await expect(page.getByRole('alert')).toContainText('Observation unavailable');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(imageHash(await page.locator('.observation-map canvas').screenshot(mapScreenshot))).toEqual(imageHash(before));
});
