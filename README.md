# Flood Playback

An early flood-depth playback viewer for Northeast India. It renders timestamped raster snapshots over real geography, interpolates between frames, supports point inspection, and offers optional 3D terrain.

The included Assam scenario is a deterministic synthetic fixture. It is not an observation, forecast, or calibrated hydraulic simulation.

## Run locally

```sh
npm install
npm run dev
```

## Verify

```sh
npm test
npm run check
npm run build
npm run test:e2e
python3 -m unittest pipeline.test_build_fixture
```

See [the design specification](docs/superpowers/specs/2026-09-11-flood-playback-design.md) for the scenario and tile contracts.
