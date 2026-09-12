# Decision log

- 2026-09-11T15:46:09-04:00 — Build the first flood-map release as a clearly labeled synthetic demonstration, while keeping its playback data contract replaceable by real hydraulic outputs later. This proves the interactive experience before verified simulation datasets are available.
- 2026-09-11T15:49:40-04:00 — Use a flat 2D weather-map presentation by default, with an optional 3D terrain toggle backed by the same flood frames and legend. This keeps flood depth and extent readable while retaining an immersive terrain view.
- 2026-09-11T15:51:14-04:00 — Use real Northeast India geography and partition coverage into independently loadable regional chunks. All generated flood behavior remains prominently labeled as a synthetic scenario rather than an observation or forecast.
- 2026-09-11T15:53:42-04:00 — Drive playback from flood-depth data at discrete timestamps and interpolate visually between adjacent snapshots. Do not attempt a calibrated basin-scale hydraulic model or calculate flood physics in the browser.
- 2026-09-11T15:54:51-04:00 — Use versioned, multiresolution depth-raster tiles per timestamp, described by a scenario manifest and regional chunk metadata. A shared playback engine will drive the default 2D map, optional 3D terrain view, legend, and point inspection.
- 2026-09-11T15:58:43-04:00 — Approve the map-first interaction and interpolation design: full-screen map, timeline controls, regional navigation, shared 2D/3D layers, point inspection, exact-snapshot markers, explicit unavailable-data treatment, and persistent synthetic-scenario labeling.
- 2026-09-11T16:01:07-04:00 — Use MapLibre GL JS with a Svelte, TypeScript, and Vite application; preprocess immutable regional depth rasters with GDAL/Rasterio into static versioned tiles and manifests. Keep TiTiler and deck.gl as later extensions rather than first-release dependencies.
- 2026-09-11T16:02:36-04:00 — Keep first-release verification lightweight: favor runtime assertions and data-pipeline sanity checks, with only basic automated tests for critical playback behavior. Avoid an over-engineered test matrix.
- 2026-09-11T16:08:16-04:00 — Approve the Northeast India flood playback design specification as written and proceed to implementation planning.
- 2026-09-11T16:34:14-04:00 — Execute the implementation plan with subagent-driven development, using Luna agents for bounded deterministic work and Terra agents for integration and review work.
- 2026-09-12T07:49:39-04:00 — Run GitHub CLI commands directly without RTK wrapping. This keeps GitHub authentication and repository operations on their native CLI path.
- 2026-09-12T07:56:34-04:00 — Publish the public repository as a sanitized, squashed snapshot instead of exposing the complete development history. This keeps internal review and unresolved acquisition artifacts local.
- 2026-09-12T18:06:52-04:00 — Replace this checkout's old source-and-planning-only main branch with the merged public remote main, while retaining the prior local tip as a recovery branch. The merged repository contains the runnable flood viewer.
- 2026-09-12T18:26:30-04:00 — Use Terra coders for the next implementation pass and deliver a professional application.
- 2026-09-12T18:47:07-04:00 — Combine the available NASA observations for smoother playback; generating interpolated frames is acceptable.
