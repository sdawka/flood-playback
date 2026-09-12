<script lang="ts">
  import { onMount } from 'svelte';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { COMBINED_DATES, DATES, REGIONS, createObservationMap, type MapStatus, type Product, type RegionId } from './gibs';
  import './observations.css';

  const speeds = [
    { label: 'Slow', value: 2400 },
    { label: 'Normal', value: 1300 },
    { label: 'Fast', value: 650 }
  ] as const;

  let mapElement: HTMLDivElement;
  let product: Product = 'combined';
  let regionId: RegionId = 'brahmaputra';
  let requestedIndex = COMBINED_DATES.indexOf('2022-06-24T00:00:00Z');
  let shownDate = '';
  let opacity = 0.8;
  let playing = false;
  let intervalMs: (typeof speeds)[number]['value'] = speeds[1].value;
  let status: MapStatus = { phase: 'loading', message: 'Preparing combined sequence…', date: COMBINED_DATES[requestedIndex], product };
  let sourceOpen = true;
  let layersOpen = true;
  let observationMap: ReturnType<typeof createObservationMap> | undefined;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let lastAdvanceAt = 0;

  $: activeDates = product === 'combined' ? COMBINED_DATES : DATES;
  $: requestedDate = activeDates[requestedIndex];
  $: frameKey = `${requestedDate}/${product}/${opacity}`;
  $: if (observationMap && frameKey) requestFrame();
  $: currentFrameReady = status.phase === 'ready' && status.date === requestedDate && status.product === product;
  $: if (status.phase === 'error' && playing) stopPlayback();

  function formatDate(date: string) {
    return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', ...(date.includes('T') ? { hour: '2-digit' as const, minute: '2-digit' as const } : { year: 'numeric' as const }), timeZone: 'UTC' }).format(new Date(date.includes('T') ? date : `${date}T00:00:00Z`));
  }

  function selectProduct(next: Product) {
    const day = requestedDate.slice(0, 10);
    stopPlayback();
    product = next;
    requestedIndex = (next === 'combined' ? COMBINED_DATES : DATES).findIndex(date => date.startsWith(day));
  }

  function requestFrame() {
    if (!observationMap) return;
    status = { phase: 'loading', message: 'Loading daily observation…', date: requestedDate, product };
    observationMap.setFrame({ date: requestedDate, product, opacity });
  }

  function setDate(index: number, pause = true) {
    requestedIndex = Math.max(0, Math.min(activeDates.length - 1, index));
    lastAdvanceAt = performance.now();
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
      if (requestedIndex >= activeDates.length - 1) {
        stopPlayback();
        return;
      }
      setDate(requestedIndex + 1, false);
    }, Math.max(0, intervalMs / (product === 'combined' ? 4 : 1) - (performance.now() - lastAdvanceAt)));
  }

  function togglePlayback() {
    if (playing) {
      stopPlayback();
      return;
    }
    if (status.phase === 'error') return;
    if (requestedIndex >= activeDates.length - 1) requestedIndex = 0;
    lastAdvanceAt = performance.now();
    playing = true;
    if (status.phase === 'ready') scheduleNext();
  }

  function resetView() {
    stopPlayback();
    regionId = 'brahmaputra';
    product = 'combined';
    opacity = 0.8;
    requestedIndex = COMBINED_DATES.indexOf('2022-06-24T00:00:00Z');
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
    <p>{#if product === 'combined'}NASA observations <span aria-hidden="true">·</span> derived visual sequence{:else if product === 'flood'}Terra + Aqua <span aria-hidden="true">·</span> original flood observations{:else}Terra / MODIS <span aria-hidden="true">·</span> false-color reflectance{/if}</p>
    <button class="reset-button" type="button" on:click={resetView}>Reset view</button>
  </header>

  <section class="map-stage" aria-label="NASA daily flood extent map">
    <div class="observation-map" bind:this={mapElement} aria-label="Interactive map of observed flood extent"></div>

    <aside class="map-panel" aria-label="Observation controls">
      <div class="panel-intro">
        <p class="panel-kicker">Northeast India</p>
        <h1>{product === 'combined' ? 'Flood playback' : product === 'flood' ? 'Daily flood extent' : 'Satellite imagery'}</h1>
        <p>{product === 'combined' ? 'Combined observations with generated transitions, 12–30 June 2022.' : product === 'flood' ? 'Observed surface classifications, 12–30 June 2022.' : 'Terra MODIS false-color imagery, 12–30 June 2022.'}</p>
      </div>

      <label class="control-label" for="region">Area</label>
      <select id="region" value={regionId} on:change={(event) => selectRegion((event.currentTarget as HTMLSelectElement).value as RegionId)}>
        {#each REGIONS as item}
          <option value={item.id}>{item.label}</option>
        {/each}
      </select>

      <button class="layers-toggle" type="button" aria-expanded={layersOpen} on:click={() => layersOpen = !layersOpen}>Layers &amp; legend <span aria-hidden="true">{layersOpen ? '−' : '+'}</span></button>
      {#if product === 'flood'}<p class="coverage-cue"><i aria-hidden="true"></i>Gray map areas: insufficient observations</p>{/if}
      {#if product === 'combined'}<p class="derived-cue">Derived imagery · gaps filled up to 2 days</p>{/if}

        <div class:collapsed={!layersOpen} class="layer-controls">
          <fieldset class="product-switch">
            <legend>Layer</legend>
            <div class="product-buttons">
              <button class="combined-button" class:active={product === 'combined'} type="button" aria-pressed={product === 'combined'} on:click={() => selectProduct('combined')}>Combined playback</button>
              <button class:active={product === 'flood'} type="button" aria-pressed={product === 'flood'} on:click={() => selectProduct('flood')}>Original observations</button>
              <button class:active={product === 'satellite'} type="button" aria-pressed={product === 'satellite'} on:click={() => selectProduct('satellite')}>Satellite imagery</button>
            </div>
          </fieldset>

          <label class="opacity-control" for="opacity">
            <span>Layer opacity</span>
            <output>{Math.round(opacity * 100)}%</output>
          </label>
          <input id="opacity" type="range" min="0.2" max="1" step="0.1" bind:value={opacity} aria-label="Layer opacity" />

          <div class="legend" aria-label={product !== 'satellite' ? 'Flood extent legend' : 'Satellite imagery explanation'}>
            {#if product !== 'satellite'}
              <p>{product === 'combined' ? 'Colors blend during generated transitions' : '3-day observation window'}</p>
              <ul>
                <li><i class="flood" aria-hidden="true"></i>Flood</li>
                <li><i class="recurring" aria-hidden="true"></i>Recurring flood</li>
                <li><i class="water" aria-hidden="true"></i>Surface water</li>
                <li><i class="data-gap" class:hatched={product === 'combined'} aria-hidden="true"></i>{product === 'combined' ? 'Unresolved gap' : 'Insufficient data'}</li>
              </ul>
            {:else}
              <p>False color 7-2-1</p>
              <span>Shortwave infrared, near infrared, and red bands help separate water, vegetation, and cloud.</span>
            {/if}
          </div>

          <details class="source-note" bind:open={sourceOpen}>
            <summary>Source and coverage</summary>
            <div>
              {#if product === 'combined'}
                <p>Each day preserves valid NASA observations and fills missing pixels from the latest valid observation within the preceding two days. Generated 6-hour frames blend adjacent combined images. These transitions show visual continuity, not measured flood motion or water depth. Source age is preserved in the downloadable sequence manifest.</p>
                <a href="/observations/assam-june-2022/manifest.json" target="_blank" rel="noreferrer">Sequence and provenance</a>
              {:else if product === 'flood'}
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
        <span>{shownDate ? 'Buffering' : 'Loading'} {formatDate(requestedDate)}</span>
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
        {#if currentFrameReady}<small>{product === 'combined' ? (requestedIndex % 4 === 0 ? 'Derived · combined observations' : 'Derived · interpolated frame') : 'Observed'}</small>{:else if shownDate}<small>Last loaded {formatDate(shownDate)}</small>{/if}
      </div>
      <div class="timeline-track">
        <input type="range" min="0" max={activeDates.length - 1} step="1" value={requestedIndex} on:input={(event) => setDate(Number((event.currentTarget as HTMLInputElement).value))} aria-label="Observation date" />
        <div class="timeline-labels" aria-hidden="true"><span>Jun 12</span><span>Jun 18</span><span>Jun 24</span><span>Jun 30</span></div>
      </div>
      <div class="timeline-actions">
        <button type="button" on:click={() => setDate(requestedIndex - 1)} disabled={requestedIndex === 0} aria-label="Previous observation">←</button>
        <button class="play-button" type="button" on:click={togglePlayback} disabled={status.phase === 'error'} aria-label={playing ? 'Pause playback' : 'Play daily observations'}>{playing ? 'Pause' : 'Play'}</button>
        <button type="button" on:click={() => setDate(requestedIndex + 1)} disabled={requestedIndex === activeDates.length - 1} aria-label="Next observation">→</button>
        <label class="speed-select"><span class="visually-hidden">Playback speed</span><select value={intervalMs} on:change={(event) => { intervalMs = Number((event.currentTarget as HTMLSelectElement).value) as typeof intervalMs; scheduleNext(); }}>
          {#each speeds as speed}<option value={speed.value}>{speed.label}</option>{/each}
        </select></label>
      </div>
    </footer>
  </section>

  <footer class="attribution">NASA GIBS / ESDIS acknowledgement. MODIS combined flood product is an observation classification, not a water-depth measurement.</footer>
</main>
