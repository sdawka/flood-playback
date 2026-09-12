# Flood Playback

Explore satellite-observed flooding in Assam and nearby northeast India during June 2022. The default viewer loads NASA GIBS MODIS flood classifications and false-color satellite imagery, with daily playback, region navigation, and layer opacity controls.

Flood imagery uses a rolling three-day observation window. These are categorical observations, not water-depth measurements or a forecast. Clouds and insufficient observations can hide water; transparent imagery must not be interpreted as dry land. Playback steps through dated imagery without interpolating classes.

The older synthetic depth demonstration remains available at `/?demo=synthetic` for testing the depth-raster pipeline. It is not the default viewer.

## Imagery

- [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/): MODIS Terra + Aqua three-day flood product and Terra corrected reflectance bands 7-2-1, delivered as Web Mercator WMTS tiles.
- [NASA flood classifications](https://gibs.earthdata.nasa.gov/colormaps/v1.3/output/MODIS_Flood.html) and [June 2022 event context](https://science.nasa.gov/earth/earth-observatory/floods-swamp-bangladesh-150014/).
- Geographic basemap: OpenFreeMap, OpenMapTiles, and OpenStreetMap contributors.

We acknowledge imagery provided by NASA's Global Imagery Browse Services (GIBS), part of its Earth Science Data and Information System (ESDIS). An internet connection is required to load imagery and basemap tiles.

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
