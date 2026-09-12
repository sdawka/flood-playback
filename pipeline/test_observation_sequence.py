import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline.build_observation_sequence import (
    CLASS_DRY,
    CLASS_FLOOD,
    CLASS_MISSING,
    blend_premultiplied_rgba,
    classify_nasa_rgba,
    complete_observations,
    mosaic_coordinates,
    tile_range_for_bounds,
    _write_png,
)


class ObservationSequenceTests(unittest.TestCase):
    def test_exact_nasa_dry_pixel_stays_a_valid_observation(self):
        # This fails if a transparent NASA dry marker is treated as unavailable
        # or transparent black nodata is treated as valid dry.
        pixels = np.array([[[0, 0, 1, 0], [250, 30, 36, 255], [0, 0, 0, 0], [250, 30, 36, 0]]], dtype=np.uint8)
        classes, valid = classify_nasa_rgba(pixels)
        self.assertEqual(int(classes[0, 0]), CLASS_DRY)
        self.assertTrue(bool(valid[0, 0]))
        self.assertEqual(int(classes[0, 1]), CLASS_FLOOD)
        self.assertFalse(bool(valid[0, 2]))
        self.assertFalse(bool(valid[0, 3]))

    def test_missing_pixels_can_only_use_a_recent_original_past_observation(self):
        # This fails if the completion pass uses a future day or recursively
        # carries a prior fill beyond the two-day original-observation limit.
        dry = np.array([[CLASS_DRY]], dtype=np.uint8)
        missing = np.array([[CLASS_MISSING]], dtype=np.uint8)
        output, age = complete_observations([dry, missing, missing, missing])
        self.assertEqual(int(output[1][0, 0]), CLASS_DRY)
        self.assertEqual(int(age[1][0, 0]), 1)
        self.assertEqual(int(age[2][0, 0]), 2)
        self.assertEqual(int(output[3][0, 0]), CLASS_MISSING)
        self.assertEqual(int(age[3][0, 0]), 255)

    def test_interpolation_preserves_both_endpoint_pixels_exactly(self):
        # This fails if alpha compositing darkens either exact source frame.
        first = np.array([[[250, 30, 36, 255], [0, 0, 0, 0]]], dtype=np.uint8)
        second = np.array([[[50, 210, 245, 255], [255, 255, 255, 128]]], dtype=np.uint8)
        self.assertTrue(np.array_equal(blend_premultiplied_rgba(first, second, 0.0), first))
        self.assertTrue(np.array_equal(blend_premultiplied_rgba(first, second, 1.0), second))

    def test_png_write_round_trips_transparent_source_markers_and_blended_alpha(self):
        # This fails if palette encoding collapses transparent (0,0,1) valid
        # dry into transparent-black nodata or changes visual crossfade bytes.
        source = np.array([[[0, 0, 0, 0], [0, 0, 1, 0], [250, 30, 36, 255]]], dtype=np.uint8)
        blended = blend_premultiplied_rgba(
            np.array([[[250, 30, 36, 255]]], dtype=np.uint8),
            np.array([[[210, 210, 210, 120]]], dtype=np.uint8),
            0.25,
        )
        pixels = np.concatenate((source, blended), axis=1)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'round-trip.png'
            _write_png(output, pixels)
            with Image.open(output) as image:
                decoded = np.asarray(image.convert('RGBA'), dtype=np.uint8)
        self.assertTrue(np.array_equal(decoded, pixels))

    def test_web_mercator_coordinate_ring_matches_whole_tile_grid(self):
        bounds = (88.8, 23.5, 96.8, 29.5)
        x0, x1, y0, y1 = tile_range_for_bounds(bounds, 8)
        coordinates = mosaic_coordinates(8, x0, x1, y0, y1)
        self.assertEqual(len(coordinates), 4)
        west, north = coordinates[0]
        east, south = coordinates[2]
        self.assertLessEqual(west, bounds[0])
        self.assertGreaterEqual(east, bounds[2])
        self.assertGreaterEqual(north, bounds[3])
        self.assertLessEqual(south, bounds[1])
        self.assertEqual(coordinates, [[west, north], [east, north], [east, south], [west, south]])


if __name__ == '__main__':
    unittest.main()
