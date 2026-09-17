"""Open + sample-read all ortho TIFs under a folder. Report real failures."""
from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ.setdefault("PROJ_LIB", r"D:\workspace\ggnr_v7\python\env\Library\share\proj")
os.environ.setdefault("GDAL_DATA", r"D:\workspace\ggnr_v7\python\env\Library\share\gdal")

from osgeo import gdal

gdal.UseExceptions()
gdal.PushErrorHandler("CPLQuietErrorHandler")

root = Path(r"G:\ggnr_data_dir\build_uj\tiles_tif\satellite_2025_5187")
files = sorted(root.rglob("*.tif")) + sorted(root.rglob("*.tiff"))
# unique
files = sorted(set(files), key=lambda p: p.name.lower())
print(f"total={len(files)}", flush=True)

bad: list[tuple[str, str]] = []
warn: list[tuple[str, str]] = []
ok = 0

for i, path in enumerate(files, 1):
    size = path.stat().st_size
    if size < 1_000_000:
        bad.append((path.name, f"too_small size={size}"))
        continue
    if size < 50_000_000:
        warn.append((path.name, f"unusually_small size={size}"))
    try:
        ds = gdal.Open(str(path))
        if ds is None:
            bad.append((path.name, "open_returned_none"))
            continue
        w, h, bands = ds.RasterXSize, ds.RasterYSize, ds.RasterCount
        if w < 1 or h < 1 or bands < 1:
            bad.append((path.name, f"bad_dims {w}x{h}x{bands}"))
            continue
        band = ds.GetRasterBand(1)
        samples = [
            (0, 0),
            (max(0, w // 2 - 64), max(0, h // 2 - 64)),
            (max(0, w - 128), max(0, h - 128)),
        ]
        # error hotspot coords from log (only meaningful for that file, safe clamp elsewhere)
        samples.append((min(19328, max(0, w - 128)), min(23168, max(0, h - 128))))
        for x, y in samples:
            arr = band.ReadAsArray(x, y, min(128, w - x), min(128, h - y))
            if arr is None:
                raise RuntimeError(f"ReadAsArray None at {x},{y}")
        ds = None
        ok += 1
    except Exception as e:
        bad.append((path.name, str(e).replace("\n", " ")[:200]))
    if i % 20 == 0:
        print(f"checked {i}/{len(files)} ok={ok} bad={len(bad)} warn={len(warn)}", flush=True)

print(f"DONE total={len(files)} ok={ok} bad={len(bad)} warn={len(warn)}", flush=True)
if bad:
    print("--- BAD ---", flush=True)
    for name, reason in bad:
        print(f"{name}\t{reason}", flush=True)
if warn:
    print("--- WARN (small but opened) ---", flush=True)
    for name, reason in warn:
        print(f"{name}\t{reason}", flush=True)
if not bad:
    print("no open/read failures", flush=True)

sys.exit(1 if bad else 0)
