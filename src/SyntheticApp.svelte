<svelte:head>
  <title>Northeast India Flood Playback</title>
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte';
  import FloodMap from './lib/components/FloodMap.svelte';
  import type { ScenarioManifest } from './lib/scenario/types';
  import type { DepthSample } from './lib/map/sampleDepth';
  import { loadScenario } from './lib/scenario/loadScenario';
  import Timeline from './lib/components/Timeline.svelte';
  import DepthLegend from './lib/components/DepthLegend.svelte';
  import MapControls from './lib/components/MapControls.svelte';
  import DepthPopup from './lib/components/DepthPopup.svelte';
  import StatusNotice from './lib/components/StatusNotice.svelte';
  import { bracketTime, createPlayback } from './lib/playback/playback';
  import { terrainEnabledForRegion } from './lib/map/terrainAvailability';
  import './app.css';

  let manifest: ScenarioManifest | undefined;
  let error = '';
  let displayTimeMs = 0;
  let playing = false;
  let speed: 0.5 | 1 | 2 | 4 = 1;
  let regionId = '';
  let terrain = false;
  let notice = '';
  let retryNotice: (() => void) | undefined;
  let terrainAvailable = false;
  let failedTerrainRegions = new Set<string>();
  let inspection: { longitude: number; latitude: number; sample: DepthSample; beforeTime: string; afterTime: string } | undefined;
  let activeRequest: AbortController | undefined;
  $: durationMs = manifest ? Date.parse(manifest.timestamps.at(-1)!.time) - Date.parse(manifest.timestamps[0].time) : 0;
  $: bracket = manifest ? bracketTime(manifest.timestamps.map((item) => item.time), displayTimeMs, manifest.gaps) : undefined;
  $: beforeFrame = manifest && bracket ? manifest.timestamps[bracket.kind === 'exact' ? bracket.index : bracket.kind === 'between' ? bracket.before : 0].frame : '004';
  $: afterFrame = manifest && bracket?.kind === 'between' ? manifest.timestamps[bracket.after].frame : beforeFrame;
  $: fraction = bracket?.kind === 'between' ? bracket.fraction : 0;
  $: nextVisibleFrame = manifest ? manifest.timestamps[manifest.timestamps.findIndex((item) => item.frame === afterFrame) + 1]?.frame : undefined;
  let controller: ReturnType<typeof createPlayback> | undefined;
  function startController(value: ScenarioManifest, duration: number) {
    const origin = Date.parse(value.timestamps[0].time);
    return createPlayback((time) => displayTimeMs = time, duration, value.gaps.map((gap) => ({ start: Date.parse(gap.start) - origin, end: Date.parse(gap.end) - origin })), (value) => playing = value);
  }
  function frameBeforeGap(value: ScenarioManifest, start: number) {
    const origin = Date.parse(value.timestamps[0].time);
    const index = value.timestamps.map((item, i) => ({ i, t: Date.parse(item.time) - origin })).filter((item) => item.t < start).at(-1)?.i ?? 0;
    return value.timestamps[index].frame;
  }
  $: if (manifest && !controller) controller = startController(manifest, durationMs);
  $: if (bracket?.kind === 'gap' && manifest) { beforeFrame = frameBeforeGap(manifest, bracket.start); afterFrame = beforeFrame; }

  async function load() {
    activeRequest?.abort();
    const request = activeRequest = new AbortController();
    try {
      error = '';
      manifest = await loadScenario('/scenarios/assam-synthetic-v1/manifest.json', request.signal);
      regionId = manifest.regions[0].id;
      terrainAvailable = terrainEnabledForRegion(regionId, Boolean(manifest.regions[0].terrainTiles), failedTerrainRegions);
    } catch (reason) {
      if (!request.signal.aborted) error = reason instanceof Error ? reason.message : 'Scenario manifest could not be loaded';
    }
  }
  onMount(() => { void load(); return () => { activeRequest?.abort(); controller?.dispose(); }; });
</script>

<main>
  <header class="app-header">
    <div class="brand"><svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M3 10c5-7 9 7 14 0s9 7 12 0M3 17c5-7 9 7 14 0s9 7 12 0M3 24c5-7 9 7 14 0s9 7 12 0" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg><div><h1>Flood playback</h1><span>Northeast India / Assam</span></div></div>
    <span class="scenario-badge">Synthetic demonstration</span>
  </header>
  {#if manifest}
    <section class="workspace" aria-label="Explore flood scenario">
    <div class="toolbar">
    <MapControls regions={manifest.regions} {regionId} {terrain} {terrainAvailable} onRegionChange={(next) => { regionId = next; terrain = false; terrainAvailable = terrainEnabledForRegion(next, Boolean(manifest?.regions.find((region) => region.id === next)?.terrainTiles), failedTerrainRegions); notice = ''; retryNotice = undefined; inspection = undefined; }} onTerrainChange={(enabled) => terrain = enabled} />
    <span class="map-hint">Click the map to inspect depth</span>
    </div>
    {#key regionId}
      <div class="map-wrap">
        <FloodMap {manifest} {regionId} {beforeFrame} {afterFrame} {fraction} {nextVisibleFrame} {terrain} onInspect={(detail: typeof inspection extends infer T ? Exclude<T, undefined> : never) => { inspection = detail; notice = ''; retryNotice = undefined; }} onTileError={(detail) => { notice = detail.message; retryNotice = detail.retry; }} onTerrainUnavailable={() => { terrain = false; terrainAvailable = false; failedTerrainRegions = new Set([...failedTerrainRegions, regionId]); notice = '3D terrain is unavailable; 2D map remains active.'; retryNotice = undefined; }} onFrameReady={() => { notice = ''; retryNotice = undefined; }} />
        {#if inspection}<DepthPopup {...inspection} />{/if}
      </div>
    {/key}
    {#if notice}<StatusNotice message={notice} retry={retryNotice} />{/if}
    <div class="playback-panel">
    <div class="playback-heading"><div><h2>Watch the water change</h2><p>1–2 June 2026 · 8 snapshots · 30-second playback</p></div><DepthLegend unit={manifest.depth.unit} /></div>
    <Timeline timestamps={manifest.timestamps.map((item) => item.time)} gaps={manifest.gaps} {durationMs} timeMs={displayTimeMs} {playing} {speed}
      on:seek={(event) => { displayTimeMs = event.detail.timeMs; controller?.seek(displayTimeMs); }}
      on:toggle={() => controller?.toggle()}
      on:speed={(event) => { speed = event.detail.multiplier; controller?.setSpeed(speed); }} />
    {#if bracket?.kind === 'gap'}<p role="status">Flood layers unavailable for this interval.</p>{/if}
    </div>
    </section>
    <footer><p role="status">{manifest.disclosure}</p><details><summary>About this scenario</summary><p>{manifest.attribution.join(' ')} Flood depths and terrain are illustrative. The basemap shows real geography.</p></details></footer>
  {:else if error}
    <StatusNotice message={error} retry={() => { void load(); }} />
  {:else}
    <p role="status">Loading scenario…</p>
  {/if}
</main>
