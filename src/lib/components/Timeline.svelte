<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let timestamps: string[] = [];
  export let gaps: Array<{ start: string; end: string }> = [];
  export let timeMs = 0;
  export let durationMs = 0;
  export let playing = false;
  export let speed: 0.5 | 1 | 2 | 4 = 1;
  const dispatch = createEventDispatcher<{ seek: { timeMs: number }; toggle: void; speed: { multiplier: 0.5 | 1 | 2 | 4 } }>();
  $: current = new Date(new Date(timestamps[0] ?? 0).getTime() + timeMs).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', timeZoneName: 'short' });
  $: origin = Date.parse(timestamps[0] ?? '') || 0;
  const gapStyle = (gap: { start: string; end: string }) => `left:${Math.max(0, (Date.parse(gap.start) - origin) / durationMs * 100)}%;width:${Math.max(0, (Date.parse(gap.end) - Date.parse(gap.start)) / durationMs * 100)}%`;
  const seek = (event: Event) => dispatch('seek', { timeMs: Number((event.currentTarget as HTMLInputElement).value) });
  const endpoint = (stamp: string) => new Date(stamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
</script>

<section class="timeline" aria-label="Flood playback timeline">
  <div class="transport"><button class="play" type="button" on:click={() => dispatch('toggle')} aria-label={playing ? 'Pause playback' : 'Play playback'}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span> {playing ? 'Pause' : 'Play'}</button><button class="restart" type="button" on:click={() => dispatch('seek', { timeMs: 0 })}>Restart</button></div>
  <div class="scrubber"><div class="time-row"><time>{current}</time><span>India time</span></div>
  <input type="range" min="0" max={durationMs} value={timeMs} on:input={seek} aria-label="Playback position" style={`--progress:${durationMs ? timeMs / durationMs * 100 : 0}%`} />
  <div class="ticks" aria-label="Snapshot ticks">{#each timestamps as stamp}<span title={stamp} style={`left:${durationMs ? (Date.parse(stamp) - origin) / durationMs * 100 : 0}%`}></span>{/each}{#each gaps as gap}<b title={`${gap.start}–${gap.end}`} aria-label="Unavailable interval" style={gapStyle(gap)}>▰</b>{/each}</div>
  <div class="endpoints"><span>{endpoint(timestamps[0])}</span><span>{endpoint(timestamps.at(-1)!)}</span></div></div>
  <div class="speed-control"><span>Speed</span><div class="speeds" aria-label="Playback speed">{#each [0.5, 1, 2, 4] as multiplier}<button class:active={speed === multiplier} aria-pressed={speed === multiplier} type="button" on:click={() => dispatch('speed', { multiplier: multiplier as 0.5 | 1 | 2 | 4 })}>{multiplier}×</button>{/each}</div></div>
</section>

<svelte:window on:keydown={(event) => { if (event.target instanceof HTMLElement && event.target.closest('input,select,button,textarea,[contenteditable="true"],.maplibregl-map')) return; if (event.code === 'Space') { event.preventDefault(); dispatch('toggle'); } else if (event.code === 'ArrowLeft') { event.preventDefault(); dispatch('seek', { timeMs: Math.max(0, timeMs - 3_600_000) }); } else if (event.code === 'ArrowRight') { event.preventDefault(); dispatch('seek', { timeMs: Math.min(durationMs, timeMs + 3_600_000) }); } }} />

<style>
.timeline{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:28px}.transport{display:flex;gap:8px}.play{background:#087e9b;color:#fff;border-color:#087e9b;min-width:96px;height:46px}.play:hover{background:#06677f!important;color:#fff}.play span{margin-right:5px}.restart{border-color:transparent;font-size:12px}.scrubber{min-width:0}.time-row{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#546b75}time{font-weight:600;color:#173b49;font-variant-numeric:tabular-nums;font-size:13px}input{display:block;width:100%;margin:9px 0 0;accent-color:#087e9b;height:20px;cursor:pointer}.ticks{position:relative;height:7px;margin:0 8px}.ticks span{position:absolute;width:1px;height:5px;background:#acc4cc}.ticks b{position:absolute;color:#b45309}.endpoints{display:flex;justify-content:space-between;font-size:10px;color:#546b75;margin-top:2px}.speed-control>span{display:block;font-size:11px;color:#546b75;margin-bottom:5px}.speeds{display:flex;border:1px solid #d6e2e6;border-radius:7px;padding:3px}.speeds button{border:0;padding:5px 9px;min-height:30px;font-size:12px}.active{background:#dceef2;color:#075e74}.speed-control{padding-bottom:8px}@media(max-width:800px){.timeline{grid-template-columns:1fr auto;gap:14px}.scrubber{grid-column:1/-1;grid-row:1}.speed-control{padding:0}.speed-control>span{display:none}.play{height:40px}.endpoints{font-size:10px}}
</style>
