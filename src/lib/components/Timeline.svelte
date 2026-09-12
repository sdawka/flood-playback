<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let timestamps: string[] = [];
  export let gaps: Array<{ start: string; end: string }> = [];
  export let timeMs = 0;
  export let durationMs = 0;
  export let playing = false;
  export let speed: 0.5 | 1 | 2 | 4 = 1;
  const dispatch = createEventDispatcher<{ seek: { timeMs: number }; toggle: void; speed: { multiplier: 0.5 | 1 | 2 | 4 } }>();
  $: current = new Date(new Date(timestamps[0] ?? 0).getTime() + timeMs).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  $: origin = Date.parse(timestamps[0] ?? '') || 0;
  const gapStyle = (gap: { start: string; end: string }) => `left:${Math.max(0, (Date.parse(gap.start) - origin) / durationMs * 100)}%;width:${Math.max(0, (Date.parse(gap.end) - Date.parse(gap.start)) / durationMs * 100)}%`;
  const seek = (event: Event) => dispatch('seek', { timeMs: Number((event.currentTarget as HTMLInputElement).value) });
</script>

<section class="timeline" aria-label="Flood playback timeline">
  <button type="button" on:click={() => dispatch('toggle')} aria-label={playing ? 'Pause playback' : 'Play playback'}>{playing ? 'Pause' : 'Play'}</button>
  <button type="button" on:click={() => dispatch('seek', { timeMs: 0 })}>Restart</button>
  <input type="range" min="0" max={durationMs} value={timeMs} on:input={seek} aria-label="Playback position" />
  <time>{current}</time>
  <span class="ticks" aria-label="Snapshot ticks">{#each timestamps as stamp, i}<span title={stamp} style={`left:${durationMs ? (i / Math.max(1, timestamps.length - 1)) * 100 : 0}%`}>│</span>{/each}{#each gaps as gap}<b title={`${gap.start}–${gap.end}`} aria-label="Unavailable interval" style={gapStyle(gap)}>▰</b>{/each}</span>
  <div class="speeds" aria-label="Playback speed">{#each [0.5, 1, 2, 4] as multiplier}<button class:active={speed === multiplier} type="button" on:click={() => dispatch('speed', { multiplier: multiplier as 0.5 | 1 | 2 | 4 })}>{multiplier}×</button>{/each}</div>
</section>

<svelte:window on:keydown={(event) => { if (event.code === 'Space') { event.preventDefault(); dispatch('toggle'); } else if (event.code === 'ArrowLeft') dispatch('seek', { timeMs: Math.max(0, timeMs - 3_600_000) }); else if (event.code === 'ArrowRight') dispatch('seek', { timeMs: Math.min(durationMs, timeMs + 3_600_000) }); }} />

<style>.timeline{display:grid;gap:.5rem;position:relative}.ticks{position:relative;height:1rem}.ticks span,.ticks b{position:absolute}.ticks b{color:#b45309}.speeds{display:flex;gap:.25rem}.active{font-weight:bold}@media (prefers-reduced-motion: reduce){.timeline *{transition:none!important}}</style>
