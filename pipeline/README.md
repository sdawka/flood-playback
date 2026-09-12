# Synthetic fixture pipeline

`build_fixture.py` turns a supplied DEM and water-body mask into an ignored,
terrain-informed synthetic depth-tile set. It uses only fixed synthetic stage
offsets and UTC timestamps; it does not read NWDP gauges or treat gauge levels
as depth.

```sh
python3 pipeline/build_fixture.py \
  --dem /path/to/DEM.tif \
  --water-mask /path/to/WBM.tif \
  --output /tmp/assam-production-fixture
```

Production-derived tiles remain ignored pending rights review. The committed
tracked zoom-7 assets under `public/scenarios/assam-synthetic-v1/tiles/`
instead come from `write_fallback_demo()`: tiny hand-authored numeric, display,
and terrain fixtures that do not read or derive values from acquired inputs.
