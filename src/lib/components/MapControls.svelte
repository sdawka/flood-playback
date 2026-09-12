<script lang="ts">
  import type { RegionManifest } from '../scenario/types';

  export let regions: RegionManifest[] = [];
  export let regionId = '';
  export let terrain = false;
  export let terrainAvailable = false;
  export let onRegionChange: (regionId: string) => void = () => {};
  export let onTerrainChange: (enabled: boolean) => void = () => {};
</script>

<section class="map-controls" aria-label="Map controls">
  <label>Region
    <select value={regionId} on:change={(event) => onRegionChange((event.currentTarget as HTMLSelectElement).value)}>
      {#each regions as region}<option value={region.id}>{region.label}</option>{/each}
    </select>
  </label>
  <button type="button" aria-pressed={terrain} disabled={!terrainAvailable} on:click={() => onTerrainChange(!terrain)}>3D terrain</button>
  {#if !terrainAvailable}<small>3D terrain is unavailable; 2D map remains active.</small>{/if}
</section>

<style>.map-controls{display:flex;flex-wrap:wrap;gap:.75rem;align-items:center}.map-controls label{display:flex;gap:.35rem;align-items:center}.map-controls button[aria-pressed="true"]{background:#0d4d75;color:#fff}.map-controls small{color:#555}</style>
