<script lang="ts">
  import { onMount } from 'svelte';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import type { ScenarioManifest } from '../scenario/types';
  import { createMap } from '../map/createMap';
  import { setFloodFrames, type FloodMapAdapter } from '../map/floodLayers';
  import { decodeDepthTile, type DepthSample, type DepthTile, sampleDepth } from '../map/sampleDepth';
  import { KeyedAbortableRequest, depthTileUrl, nextFrame, prefetchRequestKey, probeFloodPair, probeRequestKey, visibleTiles, type FloodPair, type TileLocation } from '../map/floodLoading';
  import '../map/map.css';

  export let manifest: ScenarioManifest;
  export let regionId: string;
  export let beforeFrame: string;
  export let afterFrame: string;
  export let fraction = 0;
  export let nextVisibleFrame: string | undefined;
  export let terrain = false;
  export let onInspect: (detail: { longitude: number; latitude: number; sample: DepthSample; beforeTime: string; afterTime: string }) => void = () => {};
  export let onTileError: (detail: { message: string; retry: () => void }) => void = () => {};
  export let onTerrainUnavailable: () => void = () => {};
  export let onFrameReady: () => void = () => {};

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let loaded = false;
  let mapError = '';
  let cachedTiles = new Map<string, DepthTile>();
  let lastValidFrame: { before: string; after: string; fraction: number } | undefined;
  let restoring = false;
  let inspectionRequest: AbortController | undefined;
  const prefetchRequests = new KeyedAbortableRequest();
  let lastInspection: { longitude: number; latitude: number } | undefined;
  let unavailable = false;
  let requiredSources = new Set<string>();
  let loadedSources = new Set<string>();
  let frameGeneration = 0;
  let probedGeneration = -1;
  let pendingPair: FloodPair | undefined;
  let appliedTerrain: boolean | undefined;
  const frameProbeRequests = new KeyedAbortableRequest();

  function tileLocation(longitude: number, latitude: number) {
    const zoom = Math.max(0, Math.min(manifest.regions.find((region) => region.id === regionId)?.maxZoom ?? 0, Math.floor(map?.getZoom() ?? 0)));
    const tiles = 2 ** zoom;
    const x = (longitude + 180) / 360 * tiles;
    const radians = latitude * Math.PI / 180;
    const y = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * tiles;
    return { z: zoom, x: Math.floor(x), y: Math.floor(y), pixel: { x: Math.floor((x - Math.floor(x)) * 256), y: Math.floor((y - Math.floor(y)) * 256) } };
  }

  function tileTemplate() {
    const region = manifest.regions.find((item) => item.id === regionId);
    if (!region) throw new Error('Selected region is unavailable.');
    return region.depthTiles;
  }

  async function fetchTile(frame: string, location: TileLocation, signal: AbortSignal) {
    const key = `${frame}/${location.z}/${location.x}/${location.y}`;
    const cached = cachedTiles.get(key);
    if (cached) return cached;
    const response = await fetch(depthTileUrl(tileTemplate(), frame, location), { signal });
    if (!response.ok) throw new Error(`Depth tile request failed: ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Depth tile could not be decoded.');
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const tile = decodeDepthTile(context.getImageData(0, 0, canvas.width, canvas.height), manifest);
    cachedTiles.set(key, tile);
    while (cachedTiles.size > 2) cachedTiles.delete(cachedTiles.keys().next().value!);
    return tile;
  }

  async function inspect(longitude: number, latitude: number) {
    inspectionRequest?.abort();
    const request = inspectionRequest = new AbortController();
    lastInspection = { longitude, latitude };
    const location = tileLocation(longitude, latitude);
    try {
      const [before, after] = await Promise.all([fetchTile(beforeFrame, location, request.signal), fetchTile(afterFrame, location, request.signal)]);
      unavailable = false;
      onInspect({ longitude, latitude, sample: sampleDepth(location.pixel, before, after, fraction), beforeTime: manifest.timestamps.find((item) => item.frame === beforeFrame)?.time ?? '', afterTime: manifest.timestamps.find((item) => item.frame === afterFrame)?.time ?? '' });
    } catch (reason) {
      if (!request.signal.aborted) showUnavailable(reason instanceof Error ? reason.message : 'Depth tile could not be loaded.', () => { if (lastInspection) void inspect(lastInspection.longitude, lastInspection.latitude); });
    }
  }

  function isFloodSource(sourceId: string | undefined) {
    return sourceId === 'flood-depth-before' || sourceId === 'flood-depth-after';
  }

  function pairIsLoaded(pair: FloodPair) {
    return probedGeneration === pair.generation && pair.sourceIds.every((source) => loadedSources.has(source));
  }

  function confirmPair(pair: FloodPair) {
    if (!pendingPair || pendingPair.generation !== pair.generation || !pairIsLoaded(pair)) return;
    lastValidFrame = { before: pair.beforeFrame, after: pair.afterFrame, fraction: pair.fraction };
    unavailable = false;
    onFrameReady();
  }

  function restoreLastValidFrame() {
    if (!map || !lastValidFrame) return;
    pendingPair = undefined;
    requiredSources = new Set();
    loadedSources = new Set();
    setFloodFrames(map as unknown as FloodMapAdapter, manifest, regionId, lastValidFrame.before, lastValidFrame.after, lastValidFrame.fraction);
  }

  function failPair(generation: number, message: string) {
    if (!pendingPair || pendingPair.generation !== generation) return;
    frameProbeRequests.reset();
    pendingPair = undefined;
    probedGeneration = -1;
    frameGeneration += 1;
    restoreLastValidFrame();
    showUnavailable(lastValidFrame ? `${message} The last valid frame remains visible.` : message, retryFrame);
  }

  function applyFrames(before = beforeFrame, after = afterFrame, blend = fraction) {
    if (!map) return;
    const sourceIds = ['flood-depth-before'];
    if (before !== after && blend > 0 && blend < 1) sourceIds.push('flood-depth-after');
    setFloodFrames(map as unknown as FloodMapAdapter, manifest, regionId, before, after, blend);
    const center = map.getCenter();
    const z = tileLocation(center.lng, center.lat).z;
    const bounds = map.getBounds();
    const locations = visibleTiles({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() }, z);
    const request = frameProbeRequests.begin(probeRequestKey(regionId, before, after, locations));
    if (!request) {
      if (pendingPair) {
        pendingPair = { ...pendingPair, fraction: blend, sourceIds };
        requiredSources = new Set(sourceIds);
        confirmPair(pendingPair);
      }
      return;
    }
    const generation = ++frameGeneration;
    pendingPair = { generation, beforeFrame: before, afterFrame: after, fraction: blend, sourceIds };
    requiredSources = new Set(sourceIds);
    loadedSources = new Set();
    void probeFloodPair(pendingPair, tileTemplate(), locations, request.controller.signal).then(() => {
      if (!request.controller.signal.aborted && pendingPair?.generation === generation) {
        probedGeneration = generation;
        confirmPair(pendingPair);
      }
    }).catch((reason) => {
      if (!request.controller.signal.aborted) failPair(generation, reason instanceof Error ? reason.message : 'A depth tile is unavailable.');
    });
  }

  function showUnavailable(message: string, retry: () => void) {
    unavailable = true;
    onTileError({ message, retry });
  }

  function retryFrame() {
    unavailable = false;
    applyFrames();
  }

  function applyTerrain(enabled: boolean) {
    if (!map || appliedTerrain === enabled) return;
    appliedTerrain = enabled;
    if (enabled && map.getSource('terrain')) {
      map.setTerrain({ source: 'terrain', exaggeration: 1 });
      map.jumpTo({ pitch: 45, bearing: 0 });
    } else if (enabled) {
      map.setTerrain(null);
      onTerrainUnavailable();
    } else {
      map.setTerrain(null);
      map.jumpTo({ pitch: 0, bearing: 0 });
    }
  }

  function prefetchNextVisibleFrame(next = nextVisibleFrame ?? nextFrame(manifest.timestamps, afterFrame)) {
    const frame = next;
    if (!map || !frame) return;
    const center = map.getCenter();
    const location = tileLocation(center.lng, center.lat);
    const request = prefetchRequests.begin(prefetchRequestKey(regionId, frame, location));
    if (!request) return;
    void fetchTile(frame, location, request.controller.signal).catch(() => undefined);
  }

  onMount(() => {
    try { map = createMap(container, manifest, regionId); }
    catch { mapError = 'The map could not start. Check that WebGL is enabled in your browser.'; return; }
    const loadingTimeout = window.setTimeout(() => {
      if (!loaded) mapError = 'The basemap is taking too long to load. Check your connection and retry.';
    }, 15_000);
    map.on('error', () => {
      if (!loaded) mapError = 'The basemap could not load. Check your connection and retry.';
    });
    const resize = new ResizeObserver(() => map?.resize());
    resize.observe(container);
    map.once('load', () => {
      clearTimeout(loadingTimeout);
      mapError = '';
      map!.on('click', (event) => inspect(event.lngLat.lng, event.lngLat.lat));
      map!.on('moveend', () => {
        applyFrames();
        prefetchNextVisibleFrame();
      });
      map!.on('sourcedata', (event) => {
        if (isFloodSource(event.sourceId) && event.isSourceLoaded) {
          loadedSources.add(event.sourceId);
          if (pendingPair) confirmPair(pendingPair);
        }
      });
      map!.on('error', (event) => {
        const sourceId = (event as unknown as { sourceId?: string }).sourceId;
        if (!event.error) return;
        if (sourceId === 'terrain') {
          map!.setTerrain(null);
          onTerrainUnavailable();
          return;
        }
        if (!isFloodSource(sourceId) || restoring) return;
        restoring = true;
        const generation = pendingPair?.generation ?? frameGeneration;
        failPair(generation, 'A depth tile is unavailable.');
        restoring = false;
      });
      loaded = true;
    });
    return () => { clearTimeout(loadingTimeout); resize.disconnect(); inspectionRequest?.abort(); prefetchRequests.reset(); frameProbeRequests.reset(); map?.remove(); };
  });

  $: if (map && loaded) {
    const floodMap = map;
    applyFrames(beforeFrame, afterFrame, fraction);
    applyTerrain(terrain);
    prefetchNextVisibleFrame(nextVisibleFrame);
  }
</script>

<div class="map-shell">
  <div class="flood-map" bind:this={container} aria-label="Flood depth map"></div>
  {#if !loaded}<div class="map-loading" role="status"><strong>{mapError ? 'Map unavailable' : 'Loading Assam map…'}</strong><p>{mapError || 'Loading geography and flood snapshots'}</p>{#if mapError}<button type="button" on:click={() => window.location.reload()}>Retry map</button>{/if}</div>{/if}
  <button class="inspect-center" type="button" disabled={!loaded} on:click={() => { const center = map?.getCenter(); if (center) void inspect(center.lng, center.lat); }}>Inspect map center</button>
  {#if unavailable}<div class="unavailable-overlay" role="status">Flood depth unavailable for this frame. <button type="button" on:click={retryFrame}>Retry frame</button></div>{/if}
</div>

<style>.map-shell{position:relative}.map-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:30px;text-align:center;background:#edf3f4;z-index:5}.map-loading p{max-width:350px;font-size:13px;line-height:1.6;color:#546b75}.inspect-center{position:absolute;z-index:4;left:14px;top:14px;font-size:12px;box-shadow:0 2px 8px #173b4915}.unavailable-overlay{position:absolute;inset:0;z-index:3;display:grid;place-content:center;gap:.6rem;text-align:center;color:#2d2200;background:repeating-linear-gradient(-45deg,#fff5c4cc,#fff5c4cc 8px,#f8e3a1cc 8px,#f8e3a1cc 16px)}</style>
