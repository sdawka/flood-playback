<script lang="ts">export let unit = 'm';</script>
<div class="legend" aria-label="Flood depth legend">
  <span>Flood depth ({unit})</span>
  <div class="ramp" aria-hidden="true"></div>
  <div class="stops"><small>dry<br>0 m</small><small>0.01 m</small><small>0.5 m</small><small>1.5 m+</small></div>
  <p class="unavailable"><span class="hatch" aria-hidden="true"></span>Unavailable — no depth data, not dry</p>
</div>
<style>.legend{display:grid;gap:.25rem}.ramp{height:.5rem;background:linear-gradient(90deg,#45d6e8,#1796d2,#174f9b)}.stops{display:flex;justify-content:space-between;gap:.5rem}.stops small:last-child{text-align:right}.unavailable{display:flex;align-items:center;gap:.35rem;margin:0;font-size:.8rem}.hatch{width:1rem;height:.75rem;border:1px solid #252525;background:repeating-linear-gradient(-45deg,#fff 0 2px,#252525 2px 4px)}</style>
