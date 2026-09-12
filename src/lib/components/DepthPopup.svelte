<script lang="ts">
  import type { DepthSample } from '../map/sampleDepth';
  export let longitude: number;
  export let latitude: number;
  export let sample: DepthSample | undefined;
  export let beforeTime: string;
  export let afterTime: string;
  const formatTime = (stamp: string) => new Date(stamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
</script>

<aside class="depth-popup" aria-live="polite" aria-label="Depth inspection">
  <strong>Point inspection</strong>
  <div>{latitude.toFixed(5)}, {longitude.toFixed(5)}</div>
  {#if sample?.kind === 'depth'}<div>{sample.meters.toFixed(2)} m {sample.exact ? '(exact snapshot)' : '(interpolated)'}</div>
  {:else}<div>{sample?.reason ?? 'Loading depth data…'}</div>{/if}
  <small>{beforeTime === afterTime ? formatTime(beforeTime) : `${formatTime(beforeTime)} – ${formatTime(afterTime)}`} (India time)</small>
</aside>

<style>.depth-popup{position:absolute;z-index:2;left:14px;bottom:38px;max-width:min(300px,calc(100% - 65px));padding:14px 16px;background:#fffffff5;border:1px solid #bdd5dc;border-radius:8px;color:#173b49;box-shadow:0 4px 16px #173b4920;font-size:13px;line-height:1.65}.depth-popup strong{display:block;margin-bottom:3px}.depth-popup small{display:block;margin-top:6px;font-size:10px;color:#546b75}</style>
