<script lang="ts">
  import type { DepthSample } from '../map/sampleDepth';
  export let longitude: number;
  export let latitude: number;
  export let sample: DepthSample | undefined;
  export let beforeTime: string;
  export let afterTime: string;
</script>

<aside class="depth-popup" aria-live="polite" aria-label="Depth inspection">
  <strong>Point inspection</strong>
  <div>{latitude.toFixed(5)}, {longitude.toFixed(5)}</div>
  {#if sample?.kind === 'depth'}<div>{sample.meters.toFixed(2)} m {sample.exact ? '(exact snapshot)' : '(interpolated)'}</div>
  {:else}<div>{sample?.reason ?? 'Loading depth data…'}</div>{/if}
  <small>Between {new Date(beforeTime).toLocaleString()} and {new Date(afterTime).toLocaleString()}</small>
</aside>

<style>.depth-popup{position:absolute;z-index:2;left:.75rem;bottom:.75rem;max-width:20rem;padding:.6rem .75rem;background:#fffffff2;border:1px solid #335;color:#10233b;box-shadow:0 2px 8px #0003}.depth-popup small{display:block;margin-top:.35rem}</style>
