import { expect, test } from '@playwright/test';

test('loads vector geography through the worker and advances actual flood frames', async ({ page }) => {
  // A local vector feature still requires the real MapLibre worker. The old
  // empty-style fixture never exercised worker startup in Vite development.
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: {
    version: 8,
    sources: { geography: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[91, 26], [92, 27]] } } } },
    layers: [{ id: 'geography', type: 'line', source: 'geography', paint: { 'line-color': '#345c6e', 'line-width': 3 } }]
  } }));
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => failures.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Inspect map center' })).toBeEnabled();
  const nextTile = page.waitForResponse(response => response.url().includes('/display/001/') && response.ok());
  await page.getByRole('button', { name: 'Play playback' }).click();
  await nextTile;
  await expect.poll(async () => Number(await page.getByRole('slider').inputValue())).toBeGreaterThan(3_600_000);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await page.getByRole('button', { name: 'Restart' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('slider')).toHaveValue('0');
  await expect(page.getByRole('button', { name: 'Play playback' })).toBeVisible();
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  expect(failures).toEqual([]);
});

test('offers retry when the basemap fails before map load', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.getByText('Map unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry map' })).toBeVisible();
});
