import { assertScenario } from './assertScenario';
import type { ScenarioManifest } from './types';

/** Fetches and validates a manifest before any caller can apply it to UI state. */
export async function loadScenario(url: string, signal: AbortSignal): Promise<ScenarioManifest> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Scenario manifest request failed: ${response.status}`);
  const value: unknown = await response.json();
  assertScenario(value);
  return value;
}
