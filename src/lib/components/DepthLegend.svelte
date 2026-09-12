<script lang="ts">export let unit = 'm';</script>
<div class="legend" aria-label="Flood depth legend">
  <span>Flood depth <small>({unit})</small></span>
  <div class="ramp" aria-hidden="true"></div>
  <div class="stops"><small>0.01</small><small>0.5</small><small>1.5+</small></div>
  <p class="unavailable"><span class="hatch" aria-hidden="true"></span>Unavailable — no depth data, not dry</p>
</div>
<style>.legend{display:grid;gap:4px;width:250px;font-size:11px}.ramp{height:5px;border-radius:2px;background:linear-gradient(90deg,#45d6e8,#1796d2,#174f9b)}.stops{display:flex;justify-content:space-between;color:#546b75}.stops small:last-child{text-align:right}.unavailable{display:flex;align-items:center;gap:5px;margin:0;font-size:10px;color:#546b75}.hatch{width:10px;height:8px;border:1px solid #879da6;background:repeating-linear-gradient(-45deg,#fff 0 2px,#879da6 2px 3px)}@media(max-width:650px){.legend{width:100%;grid-template-columns:85px 1fr;gap:4px 12px}.ramp{align-self:center}.stops{grid-column:2}.unavailable{grid-column:1/-1}}</style>
