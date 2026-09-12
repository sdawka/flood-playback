import { expect, test } from '@playwright/test';

async function mockImagery(page: import('@playwright/test').Page) {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await page.route('https://gibs.earthdata.nasa.gov/wmts/**', route => route.fulfill({
    contentType: 'image/png', path: 'public/scenarios/assam-synthetic-v1/tiles/display/004/7/96/54.png'
  }));
}

async function openLayers(page: import('@playwright/test').Page) {
  const expand = page.getByRole('button', { name: /Layers.*legend/i });
  if (await expand.count() && await expand.getAttribute('aria-expanded') === 'false') await expand.click();
}

test('default view uses dated NASA observations and categorical legend', async ({ page }) => {
  await mockImagery(page);
  const firstTile = page.waitForResponse(response => response.url().includes('/MODIS_Combined_Flood_3-Day/default/2022-06-24/') && response.ok());
  await page.goto('/');
  await firstTile;
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  await openLayers(page);
  await expect(page.getByLabel('Flood extent legend')).toContainText('Insufficient data');
  await expect(page.getByText('Synthetic demonstration', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('12');
  const nextTile = page.waitForResponse(response => response.url().includes('/default/2022-06-25/') && response.ok());
  await page.getByRole('button', { name: 'Next observation' }).click();
  await nextTile;
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('13');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('satellite selection loads the selected date and changes the legend', async ({ page }) => {
  await mockImagery(page);
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  const tile = page.waitForResponse(response => response.url().includes('/MODIS_Terra_CorrectedReflectance_Bands721/default/2022-06-24/') && response.ok());
  // Controls can be collapsed to preserve map space on phones.
  await openLayers(page);
  await page.getByRole('button', { name: 'Satellite imagery', exact: true }).click();
  await tile;
  await expect(page.getByLabel('Satellite imagery explanation')).toContainText('7-2-1');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
});

test('opacity changes preserve the loaded observation', async ({ page }) => {
  await mockImagery(page);
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  await openLayers(page);
  await page.getByRole('slider', { name: 'Layer opacity' }).fill('0.5');
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  await expect(page.locator('.map-status.loading')).toHaveCount(0);
});

test('daily playback advances observations and pauses', async ({ page }) => {
  await mockImagery(page);
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  await page.getByRole('button', { name: 'Play daily observations' }).click();
  await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Observation date' }).inputValue())).toBeGreaterThan(12);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await expect(page.getByRole('button', { name: 'Play daily observations' })).toBeVisible();
});

test('a slow old date cannot replace a newer selected observation', async ({ page }) => {
  await mockImagery(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/default/2022-06-25/**', async route => {
    await held;
    await route.fulfill({ contentType: 'image/png', path: 'public/scenarios/assam-synthetic-v1/tiles/display/004/7/96/54.png' }).catch(() => {});
  });
  await page.goto('/');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  const delayedRequest = page.waitForRequest('**/default/2022-06-25/**');
  await page.getByRole('button', { name: 'Next observation' }).click();
  await delayedRequest;
  await expect(page.locator('.timeline-readout')).not.toContainText('Observed');
  await page.getByRole('slider', { name: 'Observation date' }).fill('15');
  await expect(page.locator('.timeline-readout')).toContainText('Jun 27, 2022');
  await expect(page.locator('.timeline-readout')).toContainText('Observed');
  release();
  await expect(page.getByRole('slider', { name: 'Observation date' })).toHaveValue('15');
  await expect(page.locator('.timeline-readout')).toContainText('Jun 27, 2022');
});

test('failed NASA tiles remain unavailable rather than becoming observed', async ({ page }) => {
  await mockImagery(page);
  await page.route('https://gibs.earthdata.nasa.gov/wmts/**', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Observation unavailable');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('.timeline-readout')).not.toContainText('Observed');
});
