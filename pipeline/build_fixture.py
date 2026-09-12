"""Build a bounded, terrain-informed synthetic flood-depth fixture.

Gauge data is deliberately not an input.  Stage offsets and timestamps below
are synthetic demonstration parameters, not observed water levels.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

try:  # The NumPy fallback keeps the small array tests runnable without wheels.
    from scipy import ndimage
except ImportError:  # pragma: no cover - exercised only where SciPy is absent
    ndimage = None


NODATA_CODE = 0
DEPTH_SCALE = 0.01
NODATA_METERS = -1.0
DISPLAY_DRY = (0, 0, 0, 0)
DISPLAY_NODATA = (37, 37, 37, 255)
FIXTURE_TIMESTAMPS = (
    ('2026-06-01T00:00:00Z', '000'),
    ('2026-06-01T06:00:00Z', '001'),
    ('2026-06-01T12:00:00Z', '002'),
    ('2026-06-01T18:00:00Z', '003'),
    ('2026-06-02T00:00:00Z', '004'),
    ('2026-06-02T06:00:00Z', '005'),
    ('2026-06-02T12:00:00Z', '006'),
    ('2026-06-02T18:00:00Z', '007'),
)
DEFAULT_OFFSETS = (0.10, 0.25, 0.55, 0.90, 1.10, 0.85, 0.50, 0.18)


@dataclass(frozen=True)
class FixtureResult:
    depth: np.ndarray
    encoded_depth: tuple[np.ndarray, ...]
    water: np.ndarray
    wet_area: tuple[int, ...]

    def every_wet_component_touches_seed(self, frame: np.ndarray) -> bool:
        wet = np.isfinite(frame) & (frame > 0)
        return _components_touch_seed(wet, self.water > 0)


def downsample_arrays(elevation: np.ndarray, water: np.ndarray, height: int, width: int) -> tuple[np.ndarray, np.ndarray]:
    """Downsample without allowing source nodata to become dry terrain."""
    if elevation.ndim != 2 or water.shape != elevation.shape:
        raise ValueError('elevation and water must be same-shaped 2D arrays')
    row_edges = np.linspace(0, elevation.shape[0], height + 1, dtype=int)
    col_edges = np.linspace(0, elevation.shape[1], width + 1, dtype=int)
    reduced_elevation = np.empty((height, width), dtype=np.float32)
    reduced_water = np.zeros((height, width), dtype=np.uint8)
    for row in range(height):
        for col in range(width):
            source_elevation = elevation[row_edges[row]:row_edges[row + 1], col_edges[col]:col_edges[col + 1]]
            source_water = water[row_edges[row]:row_edges[row + 1], col_edges[col]:col_edges[col + 1]]
            reduced_elevation[row, col] = np.nan if np.isnan(source_elevation).any() else np.mean(source_elevation)
            reduced_water[row, col] = int(np.any(source_water > 0))
    return reduced_elevation, reduced_water


def _nearest_seed(elevation: np.ndarray, seed: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if not seed.any():
        raise ValueError('water mask contains no seed water')
    if ndimage is not None:
        distance, indices = ndimage.distance_transform_edt(~seed, return_indices=True)
        return distance.astype(np.float32), elevation[tuple(indices)]
    # A deterministic small-grid fallback for unit tests where SciPy is absent.
    locations = np.argwhere(seed)
    distance = np.empty(elevation.shape, dtype=np.float32)
    nearest_elevation = np.empty(elevation.shape, dtype=np.float32)
    for row, col in np.ndindex(elevation.shape):
        nearest = min(locations, key=lambda point: (point[0] - row) ** 2 + (point[1] - col) ** 2)
        distance[row, col] = float(np.hypot(nearest[0] - row, nearest[1] - col))
        nearest_elevation[row, col] = elevation[tuple(nearest)]
    return distance, nearest_elevation


def _components_touch_seed(wet: np.ndarray, seed: np.ndarray) -> bool:
    pending = set(map(tuple, np.argwhere(wet)))
    while pending:
        start = pending.pop()
        queue = deque([start])
        touches_seed = bool(seed[start])
        while queue:
            row, col = queue.popleft()
            for neighbor in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
                if neighbor in pending:
                    pending.remove(neighbor)
                    touches_seed = touches_seed or bool(seed[neighbor])
                    queue.append(neighbor)
        if not touches_seed:
            return False
    return True


def _keep_seed_connected(depth: np.ndarray, seed: np.ndarray) -> np.ndarray:
    wet = np.isfinite(depth) & (depth > 0)
    retained = np.zeros(wet.shape, dtype=bool)
    pending = set(map(tuple, np.argwhere(wet)))
    while pending:
        start = pending.pop()
        component = [start]
        queue = deque([start])
        touches_seed = bool(seed[start])
        while queue:
            row, col = queue.popleft()
            for neighbor in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
                if neighbor in pending:
                    pending.remove(neighbor)
                    component.append(neighbor)
                    touches_seed = touches_seed or bool(seed[neighbor])
                    queue.append(neighbor)
        if touches_seed:
            retained[tuple(np.array(component).T)] = True
    output = depth.copy()
    output[wet & ~retained] = 0
    return output


def encode_depth_rgb(depth: np.ndarray) -> np.ndarray:
    # Matches MapLibre custom raster-dem: elevation = code * scale - baseShift.
    # Zero code is reserved for no-data, so dry 0m encodes as code 100.
    code = np.clip(np.rint((np.nan_to_num(depth, nan=NODATA_METERS) - NODATA_METERS) / DEPTH_SCALE), NODATA_CODE, (1 << 24) - 1).astype(np.uint32)
    output = np.stack(((code >> 16) & 255, (code >> 8) & 255, code & 255), axis=-1).astype(np.uint8)
    return output


def decode_depth_rgb(rgb: np.ndarray) -> np.ndarray:
    code = (rgb[..., 0].astype(np.uint32) << 16) | (rgb[..., 1].astype(np.uint32) << 8) | rgb[..., 2].astype(np.uint32)
    return np.where(code == NODATA_CODE, np.nan, code.astype(np.float32) * DEPTH_SCALE + NODATA_METERS)


def display_depth_rgba(depth: np.ndarray) -> np.ndarray:
    """Bake the display ramp from decoded numeric depth; dry stays transparent."""
    rgba = np.zeros((*depth.shape, 4), dtype=np.uint8)
    missing = ~np.isfinite(depth)
    rows, cols = np.indices(depth.shape)
    hatch = ((rows + cols) % 4) < 2
    rgba[missing] = DISPLAY_NODATA
    rgba[missing & hatch] = (255, 255, 255, 255)
    wet = np.isfinite(depth) & (depth > 0)
    amount = np.clip(depth[wet] / 1.5, 0, 1)
    rgba[wet, 0] = np.rint(69 - 46 * amount).astype(np.uint8)
    rgba[wet, 1] = np.rint(214 - 135 * amount).astype(np.uint8)
    rgba[wet, 2] = np.rint(232 - 77 * amount).astype(np.uint8)
    rgba[wet, 3] = 255
    return rgba


def build_fixture_from_arrays(elevation: np.ndarray, water: np.ndarray, offsets: Iterable[float] = DEFAULT_OFFSETS) -> FixtureResult:
    elevation = elevation.astype(np.float32, copy=True)
    water = water.astype(np.uint8, copy=False)
    seed = (water > 0) & np.isfinite(elevation)
    distance, nearest_seed_elevation = _nearest_seed(elevation, seed)
    source_nodata = ~np.isfinite(elevation)
    frames: list[np.ndarray] = []
    for offset in offsets:
        relative_ground = elevation - nearest_seed_elevation
        depth = np.maximum(0.0, float(offset) - relative_ground)
        max_distance_for_stage = 2.0 + max(0.0, float(offset)) * 4.0
        depth[distance > max_distance_for_stage] = 0.0
        depth[source_nodata] = np.nan
        frames.append(_keep_seed_connected(depth, seed))
    stack = np.stack(frames)
    if np.nanmin(stack) < 0 or not all(_components_touch_seed(np.isfinite(frame) & (frame > 0), seed) for frame in stack):
        raise ValueError('synthetic flood invariant failed')
    return FixtureResult(stack, tuple(encode_depth_rgb(frame) for frame in stack), water, tuple(int(np.count_nonzero(frame > 0)) for frame in stack))


def _write_png(path: Path, pixels: np.ndarray) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(pixels).resize((256, 256), Image.Resampling.NEAREST).save(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _terrain_rgb(elevation: np.ndarray) -> np.ndarray:
    valid = elevation[np.isfinite(elevation)]
    low, high = np.percentile(valid, (2, 98)) if valid.size else (0, 1)
    normalized = np.clip((np.nan_to_num(elevation, nan=low) - low) / max(high - low, 0.01), 0, 1)
    return np.dstack((normalized * 255, normalized * 255, normalized * 255)).astype(np.uint8)


def _n26e091_tiles(zoom: int) -> list[tuple[int, int]]:
    """The Web Mercator tiles intersecting the acquired N26E091 extent."""
    def tile_x(longitude: float) -> int:
        return int((longitude + 180.0) / 360.0 * (1 << zoom))

    def tile_y(latitude: float) -> int:
        radians = math.radians(latitude)
        return int((1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * (1 << zoom))

    west, south, east, north = 91.0, 26.0, 92.0, 27.0
    return [(x, y) for x in range(tile_x(west), tile_x(east) + 1) for y in range(tile_y(north), tile_y(south) + 1)]


def sample_web_mercator_tile(grid: np.ndarray, bounds: tuple[float, float, float, float], zoom: int, x: int, y: int, size: int = 256) -> np.ndarray:
    """Resample a north-up geographic grid onto one correctly located map tile."""
    west, south, east, north = bounds
    pixel = (np.arange(size, dtype=np.float64) + 0.5) / size
    world_x = (x + pixel) / (1 << zoom)
    world_y = (y + pixel) / (1 << zoom)
    longitude = world_x * 360.0 - 180.0
    latitude = np.degrees(np.arctan(np.sinh(math.pi * (1.0 - 2.0 * world_y))))
    grid_longitude, grid_latitude = np.meshgrid(longitude, latitude)
    in_bounds = (grid_longitude >= west) & (grid_longitude <= east) & (grid_latitude >= south) & (grid_latitude <= north)
    rows = np.rint((north - grid_latitude) / (north - south) * (grid.shape[0] - 1)).astype(int)
    cols = np.rint((grid_longitude - west) / (east - west) * (grid.shape[1] - 1)).astype(int)
    result = np.full((size, size), np.nan, dtype=np.float32)
    result[in_bounds] = grid[rows[in_bounds], cols[in_bounds]]
    return result


def assert_monotonic_hydrograph(areas: Iterable[int]) -> None:
    values = list(areas)
    peak = len(values) // 2
    if len(values) < 3 or any(left > right for left, right in zip(values[:peak], values[1:peak + 1])) or any(left < right for left, right in zip(values[peak:], values[peak + 1:])):
        raise ValueError('wet area must be monotonic through peak and recession')
    if values[0] >= values[peak] or values[-1] >= values[peak]:
        raise ValueError('wet area must rise then recede')


def build_sanity(result: FixtureResult, frame_tile_hashes: list[list[str]], terrain_tile_hashes: list[str]) -> dict:
    if len(frame_tile_hashes) != len(FIXTURE_TIMESTAMPS) or any(len(hashes) == 0 or any(not value for value in hashes) for hashes in frame_tile_hashes) or any(not value for value in terrain_tile_hashes):
        raise ValueError('missing tile hash')
    if len({frame.shape for frame in result.depth}) != 1:
        raise ValueError('frame grids differ')
    assert_monotonic_hydrograph(result.wet_area)
    return {
        'source': 'terrain-informed synthetic fixture; gauge values are not used',
        'frames': [
            {'frame': frame, 'time': time, 'minimum': float(np.nanmin(depth)), 'maximum': float(np.nanmax(depth)), 'wetCells': wet, 'wetArea': wet, 'tileCount': len(hashes)}
            for (time, frame), depth, wet, hashes in zip(FIXTURE_TIMESTAMPS, result.depth, result.wet_area, frame_tile_hashes)
        ],
        'tileHashes': [tile_hash for hashes in frame_tile_hashes for tile_hash in hashes] + terrain_tile_hashes,
    }


def build_fixture(dem_path: Path, water_mask_path: Path, output: Path) -> dict:
    """Generate ignored production-derived tiles.  It never reads gauge data."""
    import rasterio

    with rasterio.open(dem_path) as source:
        elevation = source.read(1, masked=True).filled(np.nan).astype(np.float32)
    with rasterio.open(water_mask_path) as source:
        water = source.read(1).astype(np.uint8)
    elevation, water = downsample_arrays(elevation, water, 128, 128)
    result = build_fixture_from_arrays(elevation, water)
    frame_tile_hashes = [[] for _ in result.depth]
    terrain_tile_hashes = []
    bounds = (91.0, 26.0, 92.0, 27.0)
    for x, y in _n26e091_tiles(7):
        for index, depth in enumerate(result.depth):
            pixels = encode_depth_rgb(sample_web_mercator_tile(depth, bounds, 7, x, y))
            frame_tile_hashes[index].append(_write_png(output / 'tiles' / 'depth' / f'{index:03d}' / '7' / str(x) / f'{y}.png', pixels))
            _write_png(output / 'tiles' / 'display' / f'{index:03d}' / '7' / str(x) / f'{y}.png', display_depth_rgba(sample_web_mercator_tile(depth, bounds, 7, x, y)))
        terrain = _terrain_rgb(sample_web_mercator_tile(elevation, bounds, 7, x, y))
        terrain_tile_hashes.append(_write_png(output / 'tiles' / 'terrain' / '7' / str(x) / f'{y}.png', terrain))
    sanity = build_sanity(result, frame_tile_hashes, terrain_tile_hashes)
    (output / 'sanity.json').write_text(json.dumps(sanity, indent=2) + '\n')
    return sanity


def write_fallback_demo(output: Path) -> dict:
    """Write a tiny hand-authored clone-safe demo; no acquired raster is read."""
    elevation = np.array([[2, 2, 2, 2], [2, 1, 1, 2], [2, 1, 0, 2], [2, 2, 2, 2]], dtype=np.float32)
    water = np.array([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]], dtype=np.uint8)
    result = build_fixture_from_arrays(elevation, water)
    hashes = [[] for _ in result.depth]
    bounds = (91.0, 26.0, 92.0, 27.0)
    terrain_hashes = []
    for x, y in _n26e091_tiles(7):
        for index, frame in enumerate(result.depth):
            depth = sample_web_mercator_tile(frame, bounds, 7, x, y)
            hashes[index].append(_write_png(output / 'tiles' / 'depth' / f'{index:03d}' / '7' / str(x) / f'{y}.png', encode_depth_rgb(depth)))
            _write_png(output / 'tiles' / 'display' / f'{index:03d}' / '7' / str(x) / f'{y}.png', display_depth_rgba(depth))
        terrain_hashes.append(_write_png(output / 'tiles' / 'terrain' / '7' / str(x) / f'{y}.png', _terrain_rgb(sample_web_mercator_tile(elevation, bounds, 7, x, y))))
    sanity = {'source': 'hand-authored deterministic fallback; no acquired DEM/WBM values', 'frames': [
        {'frame': frame, 'time': time, 'minimum': float(np.nanmin(depth)), 'maximum': float(np.nanmax(depth)), 'wetCells': wet, 'wetArea': wet, 'tileCount': len(hashes[index])}
        for index, ((time, frame), depth, wet) in enumerate(zip(FIXTURE_TIMESTAMPS, result.depth, result.wet_area))
    ], 'tileHashes': [tile_hash for frame_hashes in hashes for tile_hash in frame_hashes] + terrain_hashes}
    assert_monotonic_hydrograph([frame['wetArea'] for frame in sanity['frames']])
    (output / 'sanity.json').write_text(json.dumps(sanity, indent=2) + '\n')
    return sanity


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--dem', type=Path, required=True)
    parser.add_argument('--water-mask', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build_fixture(args.dem, args.water_mask, args.output)
