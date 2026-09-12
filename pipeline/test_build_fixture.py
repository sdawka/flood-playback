import unittest

import numpy as np

from pipeline.build_fixture import (
    FIXTURE_TIMESTAMPS,
    assert_monotonic_hydrograph,
    build_sanity,
    build_fixture_from_arrays,
    decode_depth_rgb,
    display_depth_rgba,
    encode_depth_rgb,
    downsample_arrays,
    sample_web_mercator_tile,
)


class FixtureBuilderTests(unittest.TestCase):
    def test_depth_is_nonnegative_connected_and_recedes_after_peak(self):
        # This fails if flood water is allowed to jump across dry terrain, or if
        # the synthetic stage curve stops representing recession.
        result = build_fixture_from_arrays(
            elevation=np.array([[9, 8, 7], [8, 7, 6], [9, 8, 7]], dtype=np.float32),
            water=np.array([[0, 0, 0], [0, 0, 1], [0, 0, 0]], dtype=np.uint8),
            offsets=[0.0, 1.0, 0.0],
        )

        self.assertGreaterEqual(np.nanmin(result.depth), 0)
        self.assertGreaterEqual(result.wet_area[1], result.wet_area[0])
        self.assertLessEqual(result.wet_area[2], result.wet_area[1])
        for frame in result.depth:
            self.assertTrue(result.every_wet_component_touches_seed(frame))

    def test_timeline_is_ordered_and_shallower_at_its_edges(self):
        # This fails if a frame is reordered or baseline/recession become peak depth.
        parsed = [timestamp for timestamp, _ in FIXTURE_TIMESTAMPS]
        self.assertEqual(len(parsed), 8)
        self.assertEqual(parsed, sorted(parsed))

        result = build_fixture_from_arrays(
            elevation=np.array([[3, 2, 2, 2, 3], [2, 1, .5, 1, 2], [2, .5, 0, .5, 2], [2, 1, .5, 1, 2], [3, 2, 2, 2, 3]], dtype=np.float32),
            water=np.array([[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], dtype=np.uint8),
        )
        self.assertLess(result.wet_area[0], result.wet_area[3])
        self.assertLess(result.wet_area[-1], result.wet_area[3])

    def test_nodata_survives_resampling_and_rgb_round_trip(self):
        # This fails if nodata turns into dry terrain during reduction or encoding.
        elevation = np.array([[1, np.nan], [3, 4]], dtype=np.float32)
        water = np.array([[1, 0], [0, 0]], dtype=np.uint8)
        reduced_elevation, reduced_water = downsample_arrays(elevation, water, 1, 1)
        self.assertTrue(np.isnan(reduced_elevation[0, 0]))

        result = build_fixture_from_arrays(elevation, water, offsets=[0.5])
        decoded = decode_depth_rgb(result.encoded_depth[0])
        self.assertTrue(np.isnan(decoded[0, 1]))

    def test_depth_encoding_reserves_zero_for_nodata_and_keeps_dry_at_zero_meters(self):
        encoded = encode_depth_rgb(np.array([[np.nan, 0.0, 1.25]], dtype=np.float32))
        self.assertTrue(np.array_equal(encoded[0, 0], [0, 0, 0]))
        self.assertTrue(np.array_equal(encoded[0, 1], [0, 0, 100]))
        self.assertAlmostEqual(float(decode_depth_rgb(encoded)[0, 2]), 1.25)

    def test_display_tiles_make_wet_depth_opaque_and_nodata_hatched(self):
        display = display_depth_rgba(np.array([[np.nan, 0.0, 0.5]], dtype=np.float32))
        self.assertTrue(np.array_equal(display[0, 1], [0, 0, 0, 0]))
        self.assertEqual(int(display[0, 2, 3]), 255)
        self.assertNotEqual(display[0, 0].tolist(), display[0, 1].tolist())

    def test_web_mercator_tiles_have_distinct_geographic_crops(self):
        # This fails if the whole fixture grid is duplicated into every tile.
        elevation = np.arange(16, dtype=np.float32).reshape(4, 4)
        bounds = (91.0, 26.0, 92.0, 27.0)
        northern = sample_web_mercator_tile(elevation, bounds, 7, 96, 53, 8)
        southern = sample_web_mercator_tile(elevation, bounds, 7, 96, 54, 8)

        self.assertFalse(np.array_equal(northern, southern, equal_nan=True))
        self.assertTrue(np.isnan(northern).any())
        self.assertTrue(np.isnan(southern).any())

    def test_hydrograph_requires_monotonic_rise_and_recession(self):
        # This fails if a dip before peak or rebound after peak reaches sanity.json.
        assert_monotonic_hydrograph([1, 2, 3, 4, 5, 4, 3, 2])
        with self.assertRaisesRegex(ValueError, 'monotonic'):
            assert_monotonic_hydrograph([1, 2, 1, 4, 5, 4, 3, 2])
        with self.assertRaisesRegex(ValueError, 'monotonic'):
            assert_monotonic_hydrograph([1, 2, 3, 4, 5, 4, 5, 2])

    def test_sanity_counts_each_generated_depth_tile(self):
        # This fails if sanity reports one tile while multiple tile hashes exist.
        result = build_fixture_from_arrays(
            np.array([[2, 1], [1, 0]], dtype=np.float32),
            np.array([[0, 0], [0, 1]], dtype=np.uint8),
        )
        hashes = [[f'depth-{frame}-a', f'depth-{frame}-b'] for frame in range(8)]
        sanity = build_sanity(result, hashes, ['terrain-a', 'terrain-b'])
        self.assertTrue(all(frame['tileCount'] == 2 for frame in sanity['frames']))


if __name__ == '__main__':
    unittest.main()
