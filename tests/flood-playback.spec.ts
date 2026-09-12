import { expect, test } from '@playwright/test';

// Code 225 decodes to 1.25m under the manifest's MapLibre custom encoding.
const WET_DEPTH_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAACvklEQVR4nO3TMQEAIAzAsIF/kzhBxo4mCvr0zLyBqrsdAJsMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYA0A5BmANIMQJoBSDMAaQYgzQCkGYAp+zQ1AuF4zSsLAAAAAElFTkSuQmCC', 'base64');

const DEPTH_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAABXklEQVR4nO3TsRGAQAzAsEDJ/rNSM8aTszSBG88AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAH1+kAntntnc3u0wFwkgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDkGYA0gxAmgFIMwBpBiDNAKQZgDQDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAzG4f1DABgMuYFh0AAAAASUVORK5CYII=', 'base64');
const TERRAIN_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAIAAADTED8xAAAC3ElEQVR4nO3VwQ3EIAADQXJKtRREyuXKQGhnKvBn5WfvPaDqd3oAnCQA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiDtPT2g7vu+cbO11riZByBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiDtPT2g7vu+cbO11riZByBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKS943JzztMT0tZa42YegDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiDtPT2g7vu+cbO11riZByBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIEwBpAiBNAKQJgDQBkCYA0gRAmgBIe/bepzfAMR6ANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCIE0ApAmANAGQJgDSBECaAEgTAGkCYJT9AbUnDoRvtblfAAAAAElFTkSuQmCC', 'base64');

async function fixtureMap(page: import('@playwright/test').Page) {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) }));
  await page.route('**/scenarios/assam-synthetic-v1/tiles/**', (route) => route.request().url().includes('/depth/')
    ? route.fulfill({ path: 'public/scenarios/assam-synthetic-v1/tiles/depth/004/7/96/54.png' })
    : route.request().url().includes('/display/')
      ? route.fulfill({ path: 'public/scenarios/assam-synthetic-v1/tiles/display/004/7/96/54.png' })
      : route.fulfill({ contentType: 'image/png', body: TERRAIN_PNG }));
}

async function fixtureMapWithTrackedTiles(page: import('@playwright/test').Page) {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: 8, sources: {}, layers: [] }) }));
}

test('renders the tracked wet-depth tile as a visible deterministic overlay', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => consoleErrors.push(`request failed: ${request.url()}`));
  await fixtureMapWithTrackedTiles(page);
  const visibleTile = page.waitForResponse('**/scenarios/assam-synthetic-v1/tiles/display/000/7/96/54.png');
  await page.goto('/');
  await visibleTile;
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(canvas).toHaveScreenshot('wet-depth-overlay.png');
  expect(consoleErrors).toEqual([]);
});

test('plays, scrubs, and preserves a sampled depth across 3D terrain', async ({ page }) => {
  await fixtureMap(page);
  const firstVisibleTile = page.waitForResponse('**/scenarios/assam-synthetic-v1/tiles/depth/000/7/96/54.png');
  await page.goto('/');

  await expect(page.getByText('Synthetic scenario—not observed or forecast')).toBeVisible();
  await firstVisibleTile;
  await expect(page.getByRole('button', { name: '3D terrain' })).toBeVisible();
  const displayTime = page.locator('time');
  const initialTime = await displayTime.innerText();
  await page.getByRole('button', { name: 'Play playback' }).click();
  await expect(displayTime).not.toHaveText(initialTime);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await page.getByRole('slider', { name: 'Playback position' }).fill('21600000');
  await expect(page.getByRole('slider', { name: 'Playback position' })).toHaveValue('21600000');
  await page.getByRole('button', { name: 'Inspect map center' }).click();
  const inspection = page.getByLabel('Depth inspection');
  await expect(inspection).toContainText(/-?\d+\.\d{2} m/);
  const sampledDepth = await inspection.innerText();
  await expect(page.getByLabel('Flood depth legend')).toBeVisible();
  await page.getByRole('button', { name: '3D terrain' }).click();
  await expect(page.getByRole('button', { name: '3D terrain' })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspection).toHaveText(sampledDepth);
});

test('discloses a visible missing flood tile without reporting dry depth', async ({ page }) => {
  await fixtureMap(page);
  await page.route('**/scenarios/assam-synthetic-v1/tiles/depth/**', (route) => route.fulfill({ status: 404 }));
  await page.route('**/scenarios/assam-synthetic-v1/tiles/display/**', (route) => route.fulfill({ status: 404 }));
  await page.goto('/');

  await expect(page.getByText('Synthetic scenario—not observed or forecast')).toBeVisible();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.getByText('Flood depth unavailable for this frame.')).toBeVisible();
  await expect(page.getByText(/0\.00 m/)).toHaveCount(0);
});
