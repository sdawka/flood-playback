<script lang="ts">
  import { onMount } from 'svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { DATES, REGIONS, createObservationMap, type MapStatus, type Product, type RegionId } from './gibs';
  import './observations.css';

  const speeds = [
    { label: 'Slow', value: 2400 },
    { label: 'Normal', value: 1300 },
    { label: 'Fast', value: 650 }
  ] as const;

  let mapElement: HTMLDivElement;
  let product: Product = 'flood';
  let regionId: RegionId = 'brahmaputra';
  let requestedIndex = DATES.indexOf('2022-06-24');
  let shownDate = '';
  let opacity = 0.8;
  let playing = false;
  let intervalMs: (typeof speeds)[number]['value'] = speeds[1].value;
  let status: MapStatus = { phase: 'loading', message: 'Preparing daily observations…', date: DATES[requestedIndex], product };
  let sourceOpen = true;
  let layersOpen = true;
  let observationMap: ReturnType<typeof createObservationMap> | undefined;
  let playTimer: ReturnType<typeof setTimeout> | undefined;

  $: requestedDate = DATES[requestedIndex];
  $: frameKey = `${requestedDate}/${product}/${opacity}`;
  $: if (observationMap && frameKey) requestFrame();
  $: currentFrameReady = status.phase === 'ready' && status.date === requestedDate && status.product === product;
  $: if (status.phase === 'error' && playing) stopPlayback();

  function formatDate(date: string) {
    return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  }

  function requestFrame() {
    if (!observationMap) return;
    status = { phase: 'loading', message: 'Loading daily observation…', date: requestedDate, product };
    observationMap.setFrame({ date: requestedDate, product, opacity });
  }

  function setDate(index: number, pause = true) {
    requestedIndex = Math.max(0, Math.min(DATES.length - 1, index));
    if (pause) stopPlayback();
  }

  function selectRegion(next: RegionId) {
    regionId = next;
    observationMap?.fitRegion(next);
  }

  function stopPlayback() {
    playing = false;
    if (playTimer) clearTimeout(playTimer);
    playTimer = undefined;
  }

  function scheduleNext() {
    if (playTimer) clearTimeout(playTimer);
    if (!playing || status.phase !== 'ready') return;
    playTimer = setTimeout(() => {
      if (!playing || status.phase !== 'ready') return;
      if (requestedIndex >= DATES.length - 1) {
        stopPlayback();
        return;
      }
      setDate(requestedIndex + 1, false);
    }, intervalMs);
  }

  function togglePlayback() {
    if (playing) {
      stopPlayback();
      return;
    }
    if (status.phase === 'error') return;
    if (requestedIndex >= DATES.length - 1) requestedIndex = 0;
    playing = true;
    if (status.phase === 'ready') scheduleNext();
  }

  function resetView() {
    stopPlayback();
    regionId = 'brahmaputra';
    product = 'flood';
    opacity = 0.8;
    requestedIndex = DATES.indexOf('2022-06-24');
    observationMap?.fitRegion('brahmaputra');
  }

  function onMapStatus(next: MapStatus) {
    status = next;
    if (next.phase === 'ready' && next.date === requestedDate && next.product === product) {
      shownDate = next.date;
      scheduleNext();
    }
  }

  onMount(() => {
    sourceOpen = window.innerWidth > 700;
    layersOpen = window.innerWidth > 700;
    observationMap = createObservationMap(mapElement, onMapStatus);
    observationMap.fitRegion(regionId);
    return () => {
      stopPlayback();
      observationMap?.destroy();
    };
  });
</script>

<svelte:head>
  <title>NASA flood observations</title>
  <meta name="description" content="Daily MODIS flood extent observations from NASA Terra and Aqua." />
</svelte:head>

<main class="observation-viewer">
  <header class="observation-header">
    <div class="atlas-brand">
      <span>Flood atlas</span>
      <span>NASA / MODIS observations</span>
    </div>
    <p>{#if product === 'flood'}Terra + Aqua <span aria-hidden="true">·</span> daily 250 m classifications{:else}Terra / MODIS <span aria-hidden="true">·</span> false-color reflectance{/if}</p>
    <button class="reset-button" type="button" on:click={resetView}>Reset view</button>
  </header>

  <section class="map-stage" aria-label="NASA daily flood extent map">
    <div class="observation-map" bind:this={mapElement} aria-label="Interactive map of observed flood extent"></div>

    <aside class="map-panel" aria-label="Observation controls">
      <div class="panel-intro">
        <p class="panel-kicker">Northeast India</p>
        <h1>Daily flood extent</h1>
        <p>{product === 'flood' ? 'Observed surface classifications, 12–30 June 2022.' : 'Terra MODIS false-color imagery, 12–30 June 2022.'}</p>
      </div>

      <label class="control-label" for="region">Area</label>
      <select id="region" value={regionId} on:change={(event) => selectRegion((event.currentTarget as HTMLSelectElement).value as RegionId)}>
        {#each REGIONS as item}
          <option value={item.id}>{item.label}</option>
        {/each}
      </select>

      <button class="layers-toggle" type="button" aria-expanded={layersOpen} on:click={() => layersOpen = !layersOpen}>Layers &amp; legend <span aria-hidden="true">{layersOpen ? '−' : '+'}</span></button>
      {#if product === 'flood'}<p class="coverage-cue"><i aria-hidden="true"></i>Gray map areas: insufficient observations</p>{/if}

        <div class:collapsed={!layersOpen} class="layer-controls">
          <fieldset class="product-switch">
            <legend>Layer</legend>
            <div class="product-buttons">
              <button class:active={product === 'flood'} type="button" aria-pressed={product === 'flood'} on:click={() => product = 'flood'}>Flood extent</button>
              <button class:active={product === 'satellite'} type="button" aria-pressed={product === 'satellite'} on:click={() => product = 'satellite'}>Satellite imagery</button>
            </div>
          </fieldset>

          <label class="opacity-control" for="opacity">
            <span>Layer opacity</span>
            <output>{Math.round(opacity * 100)}%</output>
          </label>
          <input id="opacity" type="range" min="0.2" max="1" step="0.1" bind:value={opacity} aria-label="Layer opacity" />

          <div class="legend" aria-label={product === 'flood' ? 'Flood extent legend' : 'Satellite imagery explanation'}>
            {#if product === 'flood'}
              <p>3-day observation window</p>
              <ul>
                <li><i class="flood" aria-hidden="true"></i>Flood</li>
                <li><i class="recurring" aria-hidden="true"></i>Recurring flood</li>
                <li><i class="water" aria-hidden="true"></i>Surface water</li>
                <li><i class="data-gap" aria-hidden="true"></i>Insufficient data</li>
              </ul>
            {:else}
              <p>False color 7-2-1</p>
              <span>Shortwave infrared, near infrared, and red bands help separate water, vegetation, and cloud.</span>
            {/if}
          </div>

          <details class="source-note" bind:open={sourceOpen}>
            <summary>Source and coverage</summary>
            <div>
              {#if product === 'flood'}
                <p>Cloud and incomplete swaths can leave areas unclassified. Dates show daily map layers; flood classes use a 3-day MODIS observation window.</p>
              {:else}
                <p>Cloud and incomplete swaths can obscure the surface. Dates show daily Terra MODIS false-color imagery.</p>
              {/if}
              <a href="https://gibs.earthdata.nasa.gov/" target="_blank" rel="noreferrer">NASA GIBS imagery</a>
              <a href="https://gibs.earthdata.nasa.gov/layer-metadata/v1.0/MODIS_Combined_Flood_3-Day.json" target="_blank" rel="noreferrer">MODIS flood metadata</a>
              <a href="https://science.nasa.gov/earth/earth-observatory/floods-swamp-bangladesh-150014/" target="_blank" rel="noreferrer">June 2022 event context</a>
            </div>
          </details>
        </div>
    </aside>

    {#if status.phase === 'loading'}
      <div class="map-status loading" role="status" aria-live="polite">
        <span class="status-orbit" aria-hidden="true"></span>
        <span>Requesting {formatDate(requestedDate)}</span>
        {#if shownDate}<small>Last loaded {formatDate(shownDate)}</small>{/if}
      </div>
    {:else if status.phase === 'error'}
      <div class="map-status error" role="alert">
        <strong>Observation unavailable</strong>
        <span>{status.message}</span>
        <button type="button" on:click={() => observationMap?.retry()}>Try again</button>
      </div>
    {/if}

    <footer class="timeline-footer" aria-label="Observation timeline">
      <div class="timeline-readout">
        <span>Requested</span>
        <strong>{formatDate(requestedDate)}</strong>
        {#if currentFrameReady}<small>Observed</small>{:else if shownDate}<small>Last loaded {formatDate(shownDate)}</small>{/if}
      </div>
      <div class="timeline-track">
        <input type="range" min="0" max={DATES.length - 1} step="1" value={requestedIndex} on:input={(event) => setDate(Number((event.currentTarget as HTMLInputElement).value))} aria-label="Observation date" />
        <div class="timeline-labels" aria-hidden="true"><span>Jun 12</span><span>Jun 18</span><span>Jun 24</span><span>Jun 30</span></div>
      </div>
      <div class="timeline-actions">
        <button type="button" on:click={() => setDate(requestedIndex - 1)} disabled={requestedIndex === 0} aria-label="Previous observation">←</button>
        <button class="play-button" type="button" on:click={togglePlayback} disabled={status.phase === 'error'} aria-label={playing ? 'Pause playback' : 'Play daily observations'}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" on:click={() => setDate(requestedIndex + 1)} disabled={requestedIndex === DATES.length - 1} aria-label="Next observation">→</button>
        <label class="speed-select"><span class="visually-hidden">Playback speed</span><select value={intervalMs} on:change={(event) => { intervalMs = Number((event.currentTarget as HTMLSelectElement).value) as typeof intervalMs; scheduleNext(); }}>
          {#each speeds as speed}<option value={speed.value}>{speed.label}</option>{/each}
        </select></label>
      </div>
    </footer>
  </section>

  <footer class="attribution">NASA GIBS / ESDIS acknowledgement. MODIS combined flood product is an observation classification, not a water-depth measurement.</footer>
</main>
