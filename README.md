# Flood Playback

Explore flooding in Assam and nearby northeast India during June 2022. The default viewer plays a locally generated sequence combining NASA GIBS MODIS observations, with original flood imagery and online false-color satellite imagery available for comparison.

NASA flood imagery uses a rolling three-day observation window. These are categorical observations, not water-depth measurements or a forecast. Clouds and insufficient observations can hide water; transparent imagery must not be interpreted as dry land.

Combined playback preserves each day's valid observations and fills missing pixels only from the latest original observation in the preceding two days. Unresolved gaps use a faint hatch. Generated six-hour frames visually blend adjacent combined maps using premultiplied alpha; they do not estimate hydraulic motion or water depth. Combined and interpolated frames are explicitly labeled **derived**. Original mosaics, source hashes, and per-pixel age maps remain in the sequence bundle for comparison and provenance.

The local bundle covers northeast India at GIBS Web Mercator zoom 8, an overview representation of the MODIS product. Playback preloads nearby images and keeps the current frame visible until its replacement is ready. The geographic basemap and satellite mode still require an internet connection.

The older synthetic depth demonstration remains available at `/?demo=synthetic` for testing the depth-raster pipeline. It is not the default viewer.

## Imagery

- [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/): MODIS Terra + Aqua three-day flood product and Terra corrected reflectance bands 7-2-1, delivered as Web Mercator WMTS tiles.
- [NASA flood classifications](https://gibs.earthdata.nasa.gov/colormaps/v1.3/output/MODIS_Flood.html) and [June 2022 event context](https://science.nasa.gov/earth/earth-observatory/floods-swamp-bangladesh-150014/).
- Geographic basemap: OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors.

We acknowledge imagery provided by NASA's Global Imagery Browse Services (GIBS), part of its Earth Science Data and Information System (ESDIS).

To rebuild the sequence, install `numpy` and `Pillow`, then run `python3 pipeline/build_observation_sequence.py --download`. Downloads are restricted to the June 12–30, 2022 area, cached under ignored `data/cache/nasa-gibs`, and capped at 64 MiB per run. Subsequent builds can omit `--download` and reuse the cache. The published sequence and its method are described by `public/observations/assam-june-2022/manifest.json`.

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
python3 -m unittest pipeline.test_build_fixture pipeline.test_observation_sequence
```

See [the design specification](docs/superpowers/specs/2026-09-11-flood-playback-design.md) for the scenario and tile contracts.
