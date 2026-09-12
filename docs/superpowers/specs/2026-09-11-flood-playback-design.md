# Northeast India flood playback design

## Goal

Build a browser-based, weather-map-style viewer that shows flood depth spreading and receding across real Northeast India geography. The first release is a synthetic demonstration. It consumes depth snapshots at discrete timestamps and interpolates their display; it does not calculate flood physics or claim to be an observation, forecast, or calibrated hydraulic model.

Success means a user can open the map, choose a region, play or scrub a scenario, understand water depth from the legend, inspect a point, and switch between a clear 2D map and optional pitched 3D terrain.

## Scope boundaries

- Cover Northeast India through independently loadable regional chunks. A scenario may cover one or many chunks.
- Use real terrain, rivers, borders, and place names, subject to source rights and attribution.
- Generate a terrain-informed synthetic fixture for the first playable scenario.
- Preserve a versioned data contract so later observed or modelled rasters can replace the fixture.
- Keep the browser as a renderer. Numerical simulation, calibration, forecasting, warnings, and operational decision support are out of scope.
- Never derive flood depth directly from gauge stage without datum-resolved terrain and a defensible hydraulic transformation.

## Technical approach

Use Svelte, TypeScript, and Vite for the application and MapLibre GL JS for map rendering. MapLibre is the source of truth for camera, basemap, raster layers, terrain, and pointer coordinates.

Prepare immutable datasets offline with GDAL/Rasterio. Each scenario build validates inputs, divides them into stable regional chunks, encodes multiresolution depth tiles, and emits JSON manifests. The first release serves these as static assets; it has no runtime tiling backend.

Represent flood depth as a MapLibre-compatible encoded numeric raster. Render it with a `color-relief` layer so the color ramp is independent of the source values and the same layer can drape over terrain. Keep two adjacent snapshot layers loaded. Their complementary opacity produces the visual transition, while point inspection interpolates the two numeric depth values directly.

TiTiler is deferred until dynamic COG styling or a large scenario catalogue justifies a service. deck.gl is deferred because its MapLibre overlays are not automatically terrain-draped. CesiumJS is not used in the first release because the primary experience is a flat weather map rather than a 3D globe.

Primary library references:

- MapLibre GL JS: <https://maplibre.org/maplibre-gl-js/docs/>
- MapLibre color relief: <https://maplibre.org/maplibre-style-spec/layers/>
- TiTiler static versus dynamic tiling: <https://developmentseed.org/titiler/user_guide/dynamic_tiling/>
- deck.gl MapLibre integration limits: <https://deck.gl/docs/api-reference/maplibre/overview>

## Data contract

A catalogue lists scenarios. Each versioned scenario manifest contains:

- stable ID, title, description, and schema version;
- status enum: `synthetic`, `observed`, `simulated`, or `forecast`;
- mandatory disclosure text and attribution;
- timezone-qualified timestamps in chronological order;
- depth unit, scale, encoding precision, no-data value, and wet threshold;
- regions, bounds, supported zooms, and tile URL templates;
- source snapshot markers and gaps that must not be interpolated;
- terrain version and optional confidence or unknown-mask layers;
- build ID and hashes for source metadata and generated indexes.

Each region uses a fixed grid and alignment for all timestamps in a scenario. Depth values are non-negative. No-data is distinct from zero depth. Neighboring chunks overlap or share an asserted seam so their boundaries do not expose gaps.

The initial synthetic fixture should contain a complete hydrograph-shaped sequence—dry or baseline conditions, rise, peak, recession, and residual ponding—over at least one representative Assam chunk. Other chunks may initially use coarser fixtures, but the interface must disclose their resolution and availability.

## Playback and interpolation

The timeline owns a display timestamp. For that timestamp, the playback engine locates the bracketing source snapshots and computes a normalized interpolation fraction. At an exact source time, only that snapshot is shown and the UI marks it as exact. Between snapshots, the earlier and later layers use complementary opacity.

Point inspection samples both numeric tiles and linearly interpolates depth. Dry-to-wet and wet-to-dry transitions use zero depth as a valid endpoint. No-data in either required sample yields unavailable, not dry. A manifest-declared gap is never crossed silently: playback stops at its edge and explains the unavailable interval.

Playback supports play, pause, scrubbing, restart, and a small set of speeds. It prefetches the next snapshot for the current viewport and cancels obsolete work after region, scenario, or time changes. Frame animation uses `requestAnimationFrame`; scientific timestamps remain independent of display frame rate.

## Interface

The map fills the viewport. A restrained depth ramp runs from transparent/dry through light blue to deep blue-purple, with labeled numeric stops and a non-color cue for unavailable data.

The bottom timeline contains play/pause, scrubber, current date and time, speed, source-snapshot marks, and gap marks. A compact panel selects scenario, region, layers, and 2D/3D mode. Region changes preserve time when that time exists in both regions.

Clicking or keyboard-selecting a point shows coordinates, interpolated depth, bracketing snapshot times, and whether the result is exact or display-interpolated. A persistent banner reads “Synthetic scenario—not observed or forecast” for the fixture. Status disclosure cannot be dismissed or obscured by mobile controls.

The default view is north-up 2D. The optional 3D mode pitches the same map and enables terrain without vertical exaggeration. Both modes use the same time state, depth legend, and point values.

## Failure handling

- Invalid manifests fail before map initialization with a concise diagnostic.
- Missing or corrupt flood tiles show an unavailable hatch and retain the last valid state; they never become zero depth.
- Tile and prefetch failures are bounded and retryable. Obsolete requests are aborted.
- Unsupported WebGL or terrain falls back to 2D when possible and explains the limitation.
- Attribution, status disclosure, and data availability remain visible during degraded operation.

## Validation strategy

Keep tests basic and place most protection at data and state boundaries.

Pipeline assertions verify manifest schema, ordered qualified timestamps, consistent grids, non-negative depth, explicit no-data, fixed encoding, chunk seams, tile counts, and checksums. Build-time sanity summaries report wet area and min/max depth per region and timestamp so implausible discontinuities are visible.

Small unit tests cover bracketing timestamps, interpolation fractions, exact-frame behavior, wet/dry/no-data semantics, and gap handling. A small browser suite covers load, play/pause/scrub, region switching, one failed tile, and consistent point values after the 2D/3D toggle. Performance is checked with a representative fixture rather than a large benchmark harness.

## Acquired inputs and rights gates

The bounded acquisition pass produced:

- Copernicus GLO-30 N26E091 DSM COG, four provider masks, and XML metadata under `data/raw/copernicus_glo30_n26e091/`;
- NWDP Assam hourly water-level CSV for resource `51640870-5961-4696-b986-b744231f1c9f` under `data/raw/nwdp_assam/`;
- hashes, coverage, profiles, source URLs, and caveats in `data/manifests/acquisition-2026-09-11.json`.

The terrain tile covers 91–92 E and 26–27 N at one arc-second spacing with an EGM2008 vertical reference recorded in its metadata. The gauge file contains 78,212 rows across three stations, but its timestamps have no established timezone and its levels have no established display datum. It is contextual evidence only in the first fixture.

Before public distribution, confirm Copernicus reuse terms, NWDP raw and derivative-data rights, basemap and boundary attribution, and any restrictions on derived tiles. OPERA DSWx-S1 remains catalogue-only because the science assets found require authenticated access.

## Delivery slices

1. Create the Svelte/MapLibre shell, typed scenario contract, and one static synthetic Assam fixture.
2. Add timeline playback, layer cross-fade, legend, and exact/interpolated status.
3. Add regional chunk navigation, point sampling, unavailable handling, and prefetch limits.
4. Add 3D terrain mode and confirm parity with 2D.
5. Run the lean checks, review attribution and status language, and package the static build.

The first slice must prove the end-to-end data contract with a small fixture before generating broader Northeast India coverage.
