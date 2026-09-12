"""Build a bounded, cache-resumable sequence from NASA GIBS flood composites.

Network access is deliberately opt-in: run with ``--download`` to populate the
tile cache, then future builds work from the verified cache alone.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
import math
import os
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable
from urllib.error import URLError
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image


TILE_SIZE = 256
DEFAULT_ZOOM = 8
DEFAULT_BOUNDS = (88.8, 23.5, 96.8, 29.5)  # west, south, east, north
DATE_START = dt.date(2022, 6, 12)
DATE_END = dt.date(2022, 6, 30)
MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
URL_TEMPLATE = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
    "MODIS_Combined_Flood_3-Day/default/{date}/"
    "GoogleMapsCompatible_Level9/{z}/{y}/{x}.png"
)

CLASS_DRY = np.uint8(0)
CLASS_FLOOD = np.uint8(1)
CLASS_RECURRING = np.uint8(2)
CLASS_WATER = np.uint8(3)
CLASS_MISSING = np.uint8(255)
MISSING_AGE = np.uint8(255)

NASA_COLORS = {
    CLASS_FLOOD: (250, 30, 36, 255),
    CLASS_RECURRING: (255, 255, 0, 255),
    CLASS_WATER: (50, 210, 245, 255),
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _validate_png(path: Path) -> None:
    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            if image.size != (TILE_SIZE, TILE_SIZE) or image.format != "PNG":
                raise ValueError(f"expected a {TILE_SIZE}px PNG")
    except Exception as error:
        raise ValueError(f"invalid cached NASA tile {path}: {error}") from error


def _tile_x(longitude: float, zoom: int) -> int:
    return int(math.floor((longitude + 180.0) / 360.0 * (1 << zoom)))


def _tile_y(latitude: float, zoom: int) -> int:
    latitude = max(min(latitude, 85.05112878), -85.05112878)
    radians = math.radians(latitude)
    return int(math.floor((1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * (1 << zoom)))


def tile_range_for_bounds(bounds: tuple[float, float, float, float], zoom: int) -> tuple[int, int, int, int]:
    """Return inclusive x/y tile bounds that contain a WGS84 rectangle."""
    west, south, east, north = bounds
    if not (-180 <= west < east <= 180 and -85.05112878 < south < north < 85.05112878):
        raise ValueError("invalid WGS84 bounds")
    # Put east/south infinitesimally inside the rectangle so an exact grid edge
    # does not add a tile with zero area of intersection.
    return _tile_x(west, zoom), _tile_x(math.nextafter(east, west), zoom), _tile_y(north, zoom), _tile_y(math.nextafter(south, north), zoom)


def _tile_longitude(x: int, zoom: int) -> float:
    return x / (1 << zoom) * 360.0 - 180.0


def _tile_latitude(y: int, zoom: int) -> float:
    return math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y / (1 << zoom)))))


def mosaic_coordinates(zoom: int, x0: int, x1: int, y0: int, y1: int) -> list[list[float]]:
    """Return the precise WGS84 ring of a north-up whole-tile mosaic."""
    west, east = _tile_longitude(x0, zoom), _tile_longitude(x1 + 1, zoom)
    north, south = _tile_latitude(y0, zoom), _tile_latitude(y1 + 1, zoom)
    return [[west, north], [east, north], [east, south], [west, south]]


def classify_nasa_rgba(pixels: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Decode documented GIBS classes, including transparent valid dry pixels."""
    if pixels.ndim != 3 or pixels.shape[2] != 4:
        raise ValueError("NASA pixels must be RGBA")
    pixels = pixels.astype(np.uint8, copy=False)
    rgb = pixels[..., :3]
    alpha = pixels[..., 3]
    classes = np.full(pixels.shape[:2], CLASS_MISSING, dtype=np.uint8)
    # GIBS uses transparent black for nodata; its one-bit blue marker is the
    # valid-dry class even when alpha is zero. Do not collapse those values.
    dry = (rgb == (0, 0, 1)).all(axis=-1) & (alpha == 0)
    classes[dry] = CLASS_DRY
    for class_code, color in NASA_COLORS.items():
        matches = (rgb == color[:3]).all(axis=-1) & (alpha == 255)
        classes[matches] = class_code
    return classes, classes != CLASS_MISSING


def complete_observations(originals: Iterable[np.ndarray], maximum_age: int = 2) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Fill only unavailable pixels from an original observation in the past.

    Completed frames are never used as fill inputs: a carried pixel expires
    relative to the last actual composite, not relative to another carry.
    """
    source = [frame.astype(np.uint8, copy=False) for frame in originals]
    if not source:
        raise ValueError("at least one observation is required")
    shape = source[0].shape
    if any(frame.shape != shape for frame in source):
        raise ValueError("observations must share a grid")
    completed: list[np.ndarray] = []
    ages: list[np.ndarray] = []
    for index, original in enumerate(source):
        frame = original.copy()
        age = np.full(shape, MISSING_AGE, dtype=np.uint8)
        present = original != CLASS_MISSING
        age[present] = 0
        for prior_age in range(1, maximum_age + 1):
            if index < prior_age:
                break
            prior = source[index - prior_age]
            can_fill = (frame == CLASS_MISSING) & (prior != CLASS_MISSING)
            frame[can_fill] = prior[can_fill]
            age[can_fill] = prior_age
        completed.append(frame)
        ages.append(age)
    return completed, ages


def _complete_one(original: np.ndarray, prior_originals: list[np.ndarray], maximum_age: int = 2) -> tuple[np.ndarray, np.ndarray]:
    """Complete one frame from at most two earlier *original* composites."""
    frame = original.astype(np.uint8, copy=True)
    age = np.full(original.shape, MISSING_AGE, dtype=np.uint8)
    age[original != CLASS_MISSING] = 0
    for prior_age, prior in enumerate(reversed(prior_originals[-maximum_age:]), start=1):
        can_fill = (frame == CLASS_MISSING) & (prior != CLASS_MISSING)
        frame[can_fill] = prior[can_fill]
        age[can_fill] = prior_age
    return frame, age


def render_derived(classes: np.ndarray) -> np.ndarray:
    """Render wet NASA colors, transparent valid dry, and a light missing hatch."""
    rgba = np.zeros((*classes.shape, 4), dtype=np.uint8)
    for class_code, color in NASA_COLORS.items():
        rgba[classes == class_code] = color
    rows, columns = np.indices(classes.shape)
    hatch = ((rows + columns) % 8) == 0
    rgba[(classes == CLASS_MISSING) & hatch] = (210, 210, 210, 120)
    return rgba


def blend_premultiplied_rgba(first: np.ndarray, second: np.ndarray, fraction: float) -> np.ndarray:
    """Visually crossfade RGBA frames without interpreting flood geometry."""
    if first.shape != second.shape or first.ndim != 3 or first.shape[2] != 4:
        raise ValueError("frames must be matching RGBA arrays")
    if not 0.0 <= fraction <= 1.0:
        raise ValueError("fraction must be between zero and one")
    if fraction == 0.0:
        return first.copy()
    if fraction == 1.0:
        return second.copy()
    first_float = first.astype(np.float32) / 255.0
    second_float = second.astype(np.float32) / 255.0
    first_premultiplied = first_float[..., :3] * first_float[..., 3:4]
    second_premultiplied = second_float[..., :3] * second_float[..., 3:4]
    alpha = (1.0 - fraction) * first_float[..., 3:4] + fraction * second_float[..., 3:4]
    color = (1.0 - fraction) * first_premultiplied + fraction * second_premultiplied
    result = np.zeros_like(first_float)
    result[..., 3:4] = alpha
    np.divide(color, alpha, out=result[..., :3], where=alpha > 0)
    return np.rint(np.clip(result * 255.0, 0, 255)).astype(np.uint8)


def _write_png(path: Path, pixels: np.ndarray, allow_palette: bool = True) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.fromarray(pixels)
    # Every generated frame has a small finite set of class/crossfade colors.
    # A palette keeps static offline assets compact only when its decoded RGBA
    # values are byte-for-byte identical. This protects transparent NASA dry
    # markers from palette transparency normalization.
    if allow_palette and image.getcolors(maxcolors=257) is not None:
        candidate = image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        if np.array_equal(np.asarray(candidate.convert("RGBA"), dtype=np.uint8), pixels):
            image = candidate
    image.save(path, format="PNG", optimize=True, compress_level=9)
    return _sha256(path)


def _write_age_png(path: Path, ages: np.ndarray) -> str:
    """Write raw provenance bytes: 0 original, 1/2 carry, 255 missing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(ages, "L").save(path, format="PNG", optimize=True, compress_level=9)
    return _sha256(path)


@dataclass
class DownloadBudget:
    remaining: int = MAX_DOWNLOAD_BYTES
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def consume(self, amount: int) -> None:
        with self._lock:
            if amount > self.remaining:
                raise RuntimeError(f"download limit of {MAX_DOWNLOAD_BYTES} bytes exceeded")
            self.remaining -= amount


def _cache_path(cache_root: Path, date: str, zoom: int, x: int, y: int) -> Path:
    return cache_root / date / str(zoom) / str(x) / f"{y}.png"


def _download_tile(url: str, path: Path, budget: DownloadBudget, retries: int = 2, timeout: int = 20) -> None:
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.part")
        try:
            request = Request(url, headers={"User-Agent": "flood-playback-observation-builder/1"})
            temporary.parent.mkdir(parents=True, exist_ok=True)
            with urlopen(request, timeout=timeout) as response, temporary.open("wb") as output:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > budget.remaining:
                    raise RuntimeError(f"download limit of {MAX_DOWNLOAD_BYTES} bytes would be exceeded")
                while True:
                    chunk = response.read(64 * 1024)
                    if not chunk:
                        break
                    budget.consume(len(chunk))
                    output.write(chunk)
            _validate_png(temporary)
            os.replace(temporary, path)
            return
        except (OSError, URLError, ValueError, RuntimeError) as error:
            last_error = error
            temporary.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(0.25 * (attempt + 1))
    raise RuntimeError(f"could not download {url}: {last_error}")


def _load_tile(cache_root: Path, date: str, zoom: int, x: int, y: int, download: bool, budget: DownloadBudget) -> tuple[np.ndarray, dict]:
    path = _cache_path(cache_root, date, zoom, x, y)
    url = URL_TEMPLATE.format(date=date, z=zoom, x=x, y=y)
    if not path.exists():
        if not download:
            raise FileNotFoundError(f"missing cached tile {path}; rerun with --download to acquire it")
        _download_tile(url, path, budget)
    _validate_png(path)
    with Image.open(path) as image:
        pixels = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    return pixels, {"x": x, "y": y, "cachePath": str(path), "sha256": _sha256(path), "url": url}


def _load_mosaic(cache_root: Path, date: str, zoom: int, tile_range: tuple[int, int, int, int], download: bool, budget: DownloadBudget) -> tuple[np.ndarray, list[dict]]:
    x0, x1, y0, y1 = tile_range
    requests = [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
    pixels_by_tile: dict[tuple[int, int], np.ndarray] = {}
    metadata: list[dict] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        future_map = {executor.submit(_load_tile, cache_root, date, zoom, x, y, download, budget): (x, y) for x, y in requests}
        for future in concurrent.futures.as_completed(future_map):
            x, y = future_map[future]
            pixels, tile_metadata = future.result()
            pixels_by_tile[(x, y)] = pixels
            metadata.append(tile_metadata)
    mosaic = np.zeros(((y1 - y0 + 1) * TILE_SIZE, (x1 - x0 + 1) * TILE_SIZE, 4), dtype=np.uint8)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            row, column = (y - y0) * TILE_SIZE, (x - x0) * TILE_SIZE
            mosaic[row:row + TILE_SIZE, column:column + TILE_SIZE] = pixels_by_tile[(x, y)]
    return mosaic, sorted(metadata, key=lambda item: (item["y"], item["x"]))


def _dates() -> list[dt.date]:
    return [DATE_START + dt.timedelta(days=offset) for offset in range((DATE_END - DATE_START).days + 1)]


def _url(path: Path) -> str:
    return "/observations/assam-june-2022/" + path.as_posix()


def _is_replaceable_output(output: Path) -> bool:
    if output == Path("public/observations/assam-june-2022"):
        return True
    manifest_path = output / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    return manifest.get("version") == 1 and manifest.get("source", {}).get("name") == "NASA GIBS MODIS Combined Flood 3-Day"


def build_sequence(output: Path, cache_root: Path, download: bool = False, bounds: tuple[float, float, float, float] = DEFAULT_BOUNDS, zoom: int = DEFAULT_ZOOM) -> dict:
    """Build all raw and derived frames, then atomically publish their manifest."""
    dates = _dates()
    tiles = tile_range_for_bounds(bounds, zoom)
    if output.exists() and not _is_replaceable_output(output):
        raise FileExistsError(f"refusing to replace non-observation output directory {output}")
    staging = output.parent / f".{output.name}.building-{uuid.uuid4().hex}"
    staging.mkdir(parents=True)
    budget = DownloadBudget()
    try:
        sources: list[dict] = []
        originals: list[dict] = []
        frames: list[dict] = []
        days_statistics: list[dict] = []
        prior_originals: list[np.ndarray] = []
        previous_display: np.ndarray | None = None
        previous_source_dates: list[str] | None = None
        previous_date: str | None = None
        for day in dates:
            date = day.isoformat()
            mosaic, tile_metadata = _load_mosaic(cache_root, date, zoom, tiles, download, budget)
            classes, _ = classify_nasa_rgba(mosaic)
            filename = Path("originals") / f"{date}.png"
            # Offline comparison assets are source pixels exactly as GIBS
            # supplied them: do not turn transparent nodata into a display
            # convention or discard the transparent (0,0,1) dry marker.
            png_hash = _write_png(staging / filename, mosaic, allow_palette=False)
            originals.append({"date": date, "url": _url(filename)})
            sources.append({"date": date, "tiles": tile_metadata, "originalPath": filename.as_posix(), "originalSha256": png_hash})
            combined, age = _complete_one(classes, prior_originals)
            source_dates = sorted(dates[len(sources) - 1 - int(observation_age)].isoformat() for observation_age in range(3) if np.any(age == observation_age))
            days_statistics.append({
                "date": day.isoformat(),
                "originalValidPixels": int(np.count_nonzero(classes != CLASS_MISSING)),
                "filledPixels": int(np.count_nonzero((age > 0) & (age != MISSING_AGE))),
                "missingPixels": int(np.count_nonzero(age == MISSING_AGE)),
                "provenancePath": _url(Path("provenance") / f"{day.isoformat()}-age.png"),
                "sourceDates": source_dates,
            })
            _write_age_png(staging / "provenance" / f"{day.isoformat()}-age.png", age)
            display = render_derived(combined)
            if previous_display is not None and previous_source_dates is not None and previous_date is not None:
                interpolation_sources = sorted(set(previous_source_dates + source_dates))
                for hour, fraction in ((6, 0.25), (12, 0.5), (18, 0.75)):
                    interpolation_filename = Path("frames") / f"{previous_date}T{hour:02d}.png"
                    _write_png(staging / interpolation_filename, blend_premultiplied_rgba(previous_display, display, fraction))
                    frames.append({"time": f"{previous_date}T{hour:02d}:00:00Z", "url": _url(interpolation_filename), "kind": "interpolated", "sourceDates": interpolation_sources})
            filename = Path("frames") / f"{date}T00.png"
            _write_png(staging / filename, display)
            frames.append({"time": f"{date}T00:00:00Z", "url": _url(filename), "kind": "combined", "sourceDates": source_dates})
            prior_originals.append(classes)
            prior_originals = prior_originals[-2:]
            previous_display, previous_source_dates, previous_date = display, source_dates, date

        manifest = {
            "version": 1,
            "coordinates": mosaic_coordinates(zoom, *tiles),
            "maxZoom": zoom,
            "source": {
                "name": "NASA GIBS MODIS Combined Flood 3-Day",
                "urlTemplate": URL_TEMPLATE,
                "layer": "MODIS_Combined_Flood_3-Day",
                "zoom": zoom,
                "tileSize": TILE_SIZE,
                "cacheRoot": str(cache_root),
                "tiles": sources,
            },
            "method": {
                "observation": "NASA classes preserved; valid dry remains transparent",
                "gapFill": "unavailable pixels only, from original prior observations no more than two days old",
                "interpolation": "premultiplied-alpha visual crossfade only; no hydrological inference",
                "unavailable": "light sparse hatch",
            },
            "dates": [day.isoformat() for day in dates],
            "originalFrames": originals,
            "frames": frames,
            "statistics": {
                "mosaicPixels": int((tiles[1] - tiles[0] + 1) * (tiles[3] - tiles[2] + 1) * TILE_SIZE * TILE_SIZE),
                "rawFrameCount": len(originals),
                "frameCount": len(frames),
                "days": days_statistics,
            },
        }
        # This is deliberately last: an existing manifest always describes a
        # complete data set, never a partially failed fetch/build.
        (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        if output.exists():
            shutil.rmtree(output)
        os.replace(staging, output)
        return manifest
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="allow NASA GIBS network downloads for cache misses")
    parser.add_argument("--output", type=Path, default=Path("public/observations/assam-june-2022"))
    parser.add_argument("--cache-root", type=Path, default=Path("data/cache/nasa-gibs"))
    args = parser.parse_args()
    manifest = build_sequence(args.output, args.cache_root, download=args.download)
    print(f"wrote {len(manifest['frames'])} frames and {len(manifest['originalFrames'])} raw frames to {args.output}")


if __name__ == "__main__":
    main()
