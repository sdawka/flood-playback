<script lang="ts">
  import ObservationViewer from './lib/observations/ObservationViewer.svelte';

  const syntheticDemo = new URLSearchParams(window.location.search).get('demo') === 'synthetic';
</script>

{#if syntheticDemo}
  {#await import('./SyntheticApp.svelte') then legacy}
    <legacy.default />
  {/await}
{:else}
  <ObservationViewer />
{/if}
