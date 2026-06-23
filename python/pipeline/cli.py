r"""
LAS 파이프라인 CLI: --base-dir, --input-file
  3D Tiles: 들어오는 LAS를 ECEF(EPSG:4978)로 고정 후 py3dtiles convert → 3dtiles_pnts/{dataset}/tileset.json + .pnts

=============================================================================
구동 방법 (Conda 환경 = 프로젝트 내 python/env)
=============================================================================
  - pdal, gdal: conda-forge
  - py3dtiles[las]: pip (LAS 지원 필수)

1) Conda 환경 생성 (python/env 에 생성, .gitignore 대상)
   cd <프로젝트경로>/python
   conda create --prefix ./env python=3.11 -y
   conda activate ./env
   conda install -c conda-forge pdal gdal proj -y
   pip install "py3dtiles[las]"
   (proj: 재투영 시 PDAL이 사용하는 proj.db. 없으면 PostgreSQL/PostGIS 구버전 proj.db와 충돌 가능)

2) 실행 (python 폴더에서, env 활성화 후)
   cd <프로젝트경로>/python
   conda activate ./env
  python -m pipeline.cli --base-dir "d:\ggnr_data_dir" --input-file "3dtiles_las/레이어명/파일명.las"

3) Node에서 호출 시 (npm run dev)
   .env.local 에 GGNR_PIPELINE_PYTHON 을 python/env 의 python.exe 로 설정.

   예 (.env.local):
   GGNR_PIPELINE_PYTHON=<프로젝트경로>/python/env/python.exe
   Windows: GGNR_PIPELINE_PYTHON=D:\ggnr_v7\python\env\python.exe
=============================================================================
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

# PROJ가 conda와 호환되는 proj.db만 사용 (PostgreSQL/PostGIS·pip pyproj 구버전 proj.db 충돌 방지)
# PDAL은 conda PROJ(proj.db layout >= 6)를 쓰므로, pip pyproj의 proj_dir은 사용하지 않음.
if getattr(sys, "prefix", None):
    for rel in ("share/proj", "Library/share/proj"):
        _proj_data = os.path.join(sys.prefix, *rel.split("/"))
        if os.path.isdir(_proj_data):
            os.environ["PROJ_DATA"] = _proj_data
            break


def _notify_step(callback_url: str | None, path: str, step: str, status: str) -> None:
    """파이프라인 단계 알림 (API POST). path는 슬래시 기준 상대경로."""
    if not callback_url or not path:
        return
    try:
        url = callback_url.rstrip("/") + "/api/pipeline-step"
        body = json.dumps({"path": path.replace("\\", "/"), "step": step, "status": status}).encode("utf-8")
        req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as _:
            pass
    except Exception:
        pass  # 알림 실패해도 파이프라인은 계속 진행


def _py3dtiles_exe() -> list:
    """Conda/venv에서 py3dtiles CLI 경로 반환. 반환값은 subprocess용 리스트 (실행파일 또는 python -m)."""
    if os.name == "nt":
        for subdir in ("Scripts", os.path.join("Library", "bin")):
            cand = os.path.join(sys.prefix, subdir, "py3dtiles.exe")
            if os.path.isfile(cand):
                return [cand]
    else:
        cand = os.path.join(sys.prefix, "bin", "py3dtiles")
        if os.path.isfile(cand):
            return [cand]
    return [sys.executable, "-m", "py3dtiles"]


def _gdaldem_exe() -> str:
    """Conda 환경에서 gdaldem 경로 반환 (Node spawn 시 PATH에 없을 수 있음)."""
    if os.name == "nt":
        for subdir in ("Scripts", os.path.join("Library", "bin")):
            cand = os.path.join(sys.prefix, subdir, "gdaldem.exe")
            if os.path.isfile(cand):
                return cand
    else:
        cand = os.path.join(sys.prefix, "bin", "gdaldem")
        if os.path.isfile(cand):
            return cand
    return "gdaldem"


def main():
    # Windows 코드 페이지 오류 방지: stdout/stderr를 UTF-8로 (한글 경로/메시지)
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, AttributeError):
            pass

    parser = argparse.ArgumentParser()
    parser.add_argument("--base-dir", required=True, help="데이터 베이스 디렉터리 (예: d:\\ggnr_data_dir)")
    parser.add_argument("--input-file", help="LAS 상대 경로 (예: 3dtiles_las/sample/sample.las)")
    parser.add_argument("--repair-tileset", dest="repair_tileset", metavar="PATH", help="NaN 보정할 tileset.json 경로")
    parser.add_argument("--las", dest="repair_las", metavar="PATH", help="repair-tileset 사용 시 LAS 파일 경로 (미지정 시 base-dir/3dtiles_las/<폴더명>/<폴더명>.las 사용)")
    parser.add_argument("--fix-las-to-4326", dest="fix_las_to_4326", action="store_true", help="LAS를 WKT/현재 좌표계에서 EPSG:4326으로 변환해 같은 폴더에 _4326.las로 저장")
    parser.add_argument("--fix-las-to-5181", dest="fix_las_to_5181", action="store_true", help="LAS를 WKT/현재 좌표계에서 EPSG:5181(Korea 2000 / Unified)으로 변환해 같은 폴더에 _5181.las로 저장")
    parser.add_argument("--fix-las-to-ecef", dest="fix_las_to_ecef", action="store_true", help="LAS를 현재 좌표계에서 EPSG:4978(ECEF)으로 변환해 _ecef.las로 저장 (3D Tiles/Cesium용)")
    parser.add_argument("--only", choices=["ecef", "pnts"], help="해당 단계만 실행 (전체 파이프라인 대신)")
    parser.add_argument("--callback-url", dest="callback_url", metavar="URL", help="단계 시작/완료 시 POST 알림 URL (예: http://127.0.0.1:3000)")
    args = parser.parse_args()
    base_dir = os.path.abspath(args.base_dir)

    if getattr(args, "fix_las_to_4326", False):
        if not args.input_file:
            parser.error("--input-file required when using --fix-las-to-4326")
        input_rel = args.input_file.replace("\\", "/")
        input_path = os.path.join(base_dir, input_rel)
        if not os.path.isfile(input_path):
            print(f"RESULT:FIX_LAS:FAIL:Input file not found: {input_path}", flush=True)
            sys.exit(1)
        srs = _get_las_srs(input_path)
        if _is_wgs84(srs):
            print("RESULT:FIX_LAS:SKIP:Already WGS84 (EPSG:4326).", flush=True)
            sys.exit(0)
        if not srs:
            print("RESULT:FIX_LAS:FAIL:Could not read CRS from LAS metadata.", flush=True)
            sys.exit(1)
        dirname = os.path.dirname(input_path)
        basename = os.path.splitext(os.path.basename(input_path))[0]
        output_path = os.path.join(dirname, f"{basename}_4326.las")
        try:
            _reproject_las_to_4326(input_path, output_path, srs)
            out_rel = os.path.join(os.path.dirname(input_rel), f"{basename}_4326.las").replace("\\", "/")
            print(f"RESULT:FIX_LAS:OK:{out_rel}", flush=True)
        except Exception as e:
            print(f"RESULT:FIX_LAS:FAIL:{str(e)[:300]}", flush=True)
            sys.exit(1)
        return

    if getattr(args, "fix_las_to_5181", False):
        if not args.input_file:
            parser.error("--input-file required when using --fix-las-to-5181")
        input_rel = args.input_file.replace("\\", "/")
        input_path = os.path.join(base_dir, input_rel)
        if not os.path.isfile(input_path):
            print(f"RESULT:FIX_LAS:FAIL:Input file not found: {input_path}", flush=True)
            sys.exit(1)
        srs = _get_las_srs(input_path)
        if _is_epsg5181(srs):
            print("RESULT:FIX_LAS:SKIP:Already EPSG:5181 (Korea 2000 / Unified).", flush=True)
            sys.exit(0)
        if not srs:
            print("RESULT:FIX_LAS:FAIL:Could not read CRS from LAS metadata.", flush=True)
            sys.exit(1)
        dirname = os.path.dirname(input_path)
        basename = os.path.splitext(os.path.basename(input_path))[0]
        output_path = os.path.join(dirname, f"{basename}_5181.las")
        try:
            _reproject_las_to_5181(input_path, output_path, srs)
            out_rel = os.path.join(os.path.dirname(input_rel), f"{basename}_5181.las").replace("\\", "/")
            print(f"RESULT:FIX_LAS:OK:{out_rel}", flush=True)
        except Exception as e:
            print(f"RESULT:FIX_LAS:FAIL:{str(e)[:300]}", flush=True)
            sys.exit(1)
        return

    if getattr(args, "fix_las_to_ecef", False):
        if not args.input_file:
            parser.error("--input-file required when using --fix-las-to-ecef")
        input_rel = args.input_file.replace("\\", "/")
        input_path = os.path.join(base_dir, input_rel)
        if not os.path.isfile(input_path):
            print(f"RESULT:FIX_LAS:FAIL:Input file not found: {input_path}", flush=True)
            sys.exit(1)
        srs = _get_las_srs(input_path)
        if _is_epsg4978(srs):
            print("RESULT:FIX_LAS:SKIP:Already EPSG:4978 (ECEF).", flush=True)
            sys.exit(0)
        if not srs:
            print("RESULT:FIX_LAS:FAIL:Could not read CRS from LAS metadata.", flush=True)
            sys.exit(1)
        dirname = os.path.dirname(input_path)
        basename = os.path.splitext(os.path.basename(input_path))[0]
        output_path = os.path.join(dirname, f"{basename}_ecef.las")
        try:
            _reproject_las_to_ecef(input_path, output_path, srs)
            out_rel = os.path.join(os.path.dirname(input_rel), f"{basename}_ecef.las").replace("\\", "/")
            print(f"RESULT:FIX_LAS:OK:{out_rel}", flush=True)
        except Exception as e:
            print(f"RESULT:FIX_LAS:FAIL:{str(e)[:300]}", flush=True)
            sys.exit(1)
        return

    if args.repair_tileset:
        tileset_path = os.path.abspath(args.repair_tileset)
        las_path = getattr(args, "repair_las", None)
        if las_path:
            las_path = os.path.abspath(las_path)
        else:
            folder_name = os.path.basename(os.path.dirname(tileset_path))
            las_path = os.path.join(base_dir, "3dtiles_las", folder_name, folder_name + ".las")
        if not os.path.isfile(las_path):
            print(f"LAS not found: {las_path}", file=sys.stderr)
            print("Use --las <path> to specify the LAS file.", file=sys.stderr)
            sys.exit(1)
        _repair_tileset_nan_from_las(tileset_path, las_path)
        print("Repair done.", flush=True)
        return

    if not args.input_file:
        parser.error("--input-file required when not using --repair-tileset")
    input_rel = args.input_file.replace("\\", "/")
    input_path = os.path.join(base_dir, input_rel)
    if not os.path.isfile(input_path):
        print(f"Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    basename = os.path.splitext(os.path.basename(input_path))[0]
    dataset_name = os.path.basename(os.path.dirname(input_path)) or basename
    only_step = getattr(args, "only", None)
    callback_url = getattr(args, "callback_url", None) or None
    path_key = (args.input_file or "").replace("\\", "/")

    dtiles_pnts_dir = os.path.join(base_dir, "3dtiles_pnts", dataset_name)
    dtiles_ecef_dir = os.path.dirname(input_path)
    os.makedirs(dtiles_pnts_dir, exist_ok=True)
    os.makedirs(dtiles_ecef_dir, exist_ok=True)

    if only_step == "ecef":
        print("STEP_START:ECEF", flush=True)
        _notify_step(callback_url, path_key, "ecef", "start")
        try:
            run_ecef_only(input_path, dtiles_ecef_dir)
            print("RESULT:ECEF:OK", flush=True)
            _notify_step(callback_url, path_key, "ecef", "ok")
        except Exception as e:
            msg = str(e).replace("\n", " ").strip()[:200]
            print(f"RESULT:ECEF:FAIL:{msg}", flush=True)
            _notify_step(callback_url, path_key, "ecef", "fail")
            sys.exit(1)
        sys.exit(0)
    if only_step == "pnts":
        ecef_las = os.path.join(dtiles_ecef_dir, f"{basename}_ecef.las")
        if not os.path.isfile(ecef_las):
            print("RESULT:PNTS:FAIL:ECEF 단계를 먼저 완료해주세요.", flush=True)
            _notify_step(callback_url, path_key, "pnts", "fail")
            sys.exit(1)
        print("STEP_START:PNTS", flush=True)
        _notify_step(callback_url, path_key, "pnts", "start")
        try:
            run_pnts_only(ecef_las, dtiles_pnts_dir)
            print("RESULT:PNTS:OK", flush=True)
            _notify_step(callback_url, path_key, "pnts", "ok")
        except Exception as e:
            msg = str(e).replace("\n", " ").strip()[:200]
            print(f"RESULT:PNTS:FAIL:{msg}", flush=True)
            _notify_step(callback_url, path_key, "pnts", "fail")
            sys.exit(1)
        sys.exit(0)

    pnts_ok = False
    try:
        run_b3dm(input_path, dtiles_pnts_dir, ecef_output_dir=dtiles_ecef_dir, callback_url=callback_url, path_key=path_key)
        pnts_ok = True
        print("RESULT:PNTS:OK", flush=True)
        _notify_step(callback_url, path_key, "pnts", "ok")
    except Exception as e:
        msg = str(e).replace("\n", " ").strip()[:200]
        print(f"RESULT:PNTS:FAIL:{msg}", flush=True)
        _notify_step(callback_url, path_key, "pnts", "fail")
    sys.exit(0 if pnts_ok else 1)


def run_capture_geotiff(
    input_las: str,
    output_tif: str,
    resolution: float = 0.5,
) -> None:
    """LAS 포인트를 위에서 본 캡쳐형 GeoTIFF로 래스터화. RGB 있으면 3밴드, 없으면 Intensity 1밴드."""
    import pdal
    import numpy as np

    pipeline = {"pipeline": [{"type": "readers.las", "filename": input_las}]}
    p = pdal.Pipeline(json.dumps(pipeline))
    p.execute()
    if len(p.arrays) == 0:
        raise RuntimeError("PDAL produced no output (empty point cloud?).")
    arr = p.arrays[0]
    names = arr.dtype.names or ()
    name_set = set(names)
    # PDAL dimension names may be Red/Green/Blue or red/green/blue
    has_red = "Red" in name_set or "red" in name_set
    has_green = "Green" in name_set or "green" in name_set
    has_blue = "Blue" in name_set or "blue" in name_set
    use_rgb = has_red and has_green and has_blue
    def _dim(name: str) -> str:
        return name if name in names else name.lower() if name.lower() in names else name
    r_dim = _dim("Red")
    g_dim = _dim("Green")
    b_dim = _dim("Blue")
    i_dim = _dim("Intensity")

    x_min, x_max = float(arr["X"].min()), float(arr["X"].max())
    y_min, y_max = float(arr["Y"].min()), float(arr["Y"].max())
    nx = max(1, int(round((x_max - x_min) / resolution)) + 1)
    ny = max(1, int(round((y_max - y_min) / resolution)) + 1)

    if use_rgb:
        R = np.asarray(arr[r_dim], dtype=np.float64)
        G = np.asarray(arr[g_dim], dtype=np.float64)
        B = np.asarray(arr[b_dim], dtype=np.float64)
        # LAS RGB 보통 16비트 → 8비트로 스케일
        R, G, B = R / 256.0, G / 256.0, B / 256.0
    else:
        I = np.asarray(arr[i_dim], dtype=np.float64) if i_dim in name_set else np.ones(len(arr), dtype=np.float64)

    rows = np.clip((ny - 1) - np.floor((np.asarray(arr["Y"], dtype=np.float64) - y_min) / resolution).astype(int), 0, ny - 1)
    cols = np.clip(np.floor((np.asarray(arr["X"], dtype=np.float64) - x_min) / resolution).astype(int), 0, nx - 1)

    if use_rgb:
        r_sum = np.zeros((ny, nx), dtype=np.float64)
        g_sum = np.zeros((ny, nx), dtype=np.float64)
        b_sum = np.zeros((ny, nx), dtype=np.float64)
        cnt = np.zeros((ny, nx), dtype=np.float64)
        np.add.at(r_sum, (rows, cols), R)
        np.add.at(g_sum, (rows, cols), G)
        np.add.at(b_sum, (rows, cols), B)
        np.add.at(cnt, (rows, cols), 1.0)
        with np.errstate(divide="ignore", invalid="ignore"):
            r_avg = np.where(cnt > 0, r_sum / cnt, 0)
            g_avg = np.where(cnt > 0, g_sum / cnt, 0)
            b_avg = np.where(cnt > 0, b_sum / cnt, 0)
        bands_data = [
            np.clip(r_avg, 0, 255).astype(np.uint8),
            np.clip(g_avg, 0, 255).astype(np.uint8),
            np.clip(b_avg, 0, 255).astype(np.uint8),
        ]
        nbands = 3
    else:
        i_sum = np.zeros((ny, nx), dtype=np.float64)
        cnt = np.zeros((ny, nx), dtype=np.float64)
        np.add.at(i_sum, (rows, cols), I)
        np.add.at(cnt, (rows, cols), 1.0)
        with np.errstate(divide="ignore", invalid="ignore"):
            i_avg = np.where(cnt > 0, i_sum / cnt, 0)
        imax = float(np.nanmax(I)) if I.size else 1.0
        if imax <= 0:
            imax = 1.0
        bands_data = [np.clip(i_avg * (255.0 / imax), 0, 255).astype(np.uint8)]
        nbands = 1

    wkt = _get_las_srs(input_las)
    try:
        from osgeo import gdal
        gdal.DontUseExceptions()  # GDAL 4.0 FutureWarning 제거
    except ImportError:
        raise RuntimeError("GDAL Python bindings not found (install gdal, e.g. conda install -c conda-forge gdal).")

    drv = gdal.GetDriverByName("GTiff")
    ds = drv.Create(output_tif, nx, ny, nbands, gdal.GDT_Byte, options=["COMPRESS=LZW"])
    if ds is None:
        raise RuntimeError("GDAL failed to create GeoTIFF.")
    ds.SetGeoTransform([x_min, resolution, 0.0, y_max, 0.0, -resolution])
    if wkt:
        ds.SetProjection(wkt)
    for i, data in enumerate(bands_data):
        band = ds.GetRasterBand(i + 1)
        band.WriteArray(data)
        band.SetNoDataValue(0)
    ds.FlushCache()
    ds = None
    print(f"Capture GeoTIFF written: {output_tif}")


def _get_las_srs(input_las: str) -> str | None:
    """LAS 메타데이터에서 수평 SRS(WKT) 반환. 없으면 None.
    PDAL은 readers.las 결과를 comp_spatialreference(WKT 문자열) 또는 srs/spatialreference 중첩 객체로 준다.
    """
    import pdal
    pipeline = {"pipeline": [{"type": "readers.las", "filename": input_las}]}
    try:
        p = pdal.Pipeline(json.dumps(pipeline))
        p.execute()
        if len(p.arrays) == 0:
            return None
        raw_meta = getattr(p, "metadata", None)
        if isinstance(raw_meta, str):
            try:
                raw_meta = json.loads(raw_meta)
            except json.JSONDecodeError:
                return None
        if not isinstance(raw_meta, dict):
            return None
        stages = raw_meta.get("metadata") or raw_meta
        if not isinstance(stages, dict):
            return None
        # PDAL readers.las: WKT가 comp_spatialreference 키로 바로 문자열로 올 수 있음
        wkt = stages.get("comp_spatialreference")
        if isinstance(wkt, str) and wkt.strip():
            return wkt.strip()
        for stage in stages.values():
            if not isinstance(stage, dict):
                continue
            wkt = stage.get("comp_spatialreference")
            if isinstance(wkt, str) and wkt.strip():
                return wkt.strip()
            srs = stage.get("srs") or stage.get("spatialreference")
            if srs and isinstance(srs, dict):
                wkt = srs.get("wkt") or srs.get("horizontal")
                if isinstance(wkt, str) and wkt.strip():
                    return wkt.strip()
        return None
    except Exception:
        return None


def _is_wgs84(srs: str | None) -> bool:
    """SRS가 지리좌표계 WGS84(EPSG:4326)이면 True. KOREA TM_M_WGS84 등 투영좌표계는 False."""
    if not srs or not isinstance(srs, str):
        return False
    u = srs.upper()
    if "PROJCS" in u:
        return False
    return "WGS 84" in u or "WGS84" in u or "4326" in u


def _is_epsg5181(srs: str | None) -> bool:
    """SRS가 EPSG:5181(Korea 2000 / Unified CS)이면 True."""
    if not srs or not isinstance(srs, str):
        return False
    return "5181" in srs


def _is_epsg4978(srs: str | None) -> bool:
    """EPSG:4978 (ECEF) 여부."""
    if not srs or not isinstance(srs, str):
        return False
    return "4978" in srs


def _reproject_las_to_4326(input_las: str, output_las: str, in_srs: str) -> None:
    """LAS를 in_srs에서 EPSG:4326(WGS84)으로 변환해 output_las에 저장."""
    import pdal
    pipeline = {
        "pipeline": [
            {"type": "readers.las", "filename": input_las},
            {"type": "filters.reprojection", "in_srs": in_srs, "out_srs": "EPSG:4326"},
            {
                "type": "writers.las",
                "filename": output_las,
                "a_srs": "EPSG:4326",
                "scale_x": 0.0000001,
                "scale_y": 0.0000001,
                "scale_z": 0.001,
            },
        ]
    }
    p = pdal.Pipeline(json.dumps(pipeline))
    p.execute()
    if len(p.arrays) == 0:
        raise RuntimeError("PDAL reprojection produced no output.")


def _reproject_las_to_5181(input_las: str, output_las: str, in_srs: str) -> None:
    """LAS를 in_srs에서 EPSG:5181(Korea 2000 / Unified CS)으로 변환해 output_las에 저장."""
    import pdal
    pipeline = {
        "pipeline": [
            {"type": "readers.las", "filename": input_las},
            {"type": "filters.reprojection", "in_srs": in_srs, "out_srs": "EPSG:5181"},
            {
                "type": "writers.las",
                "filename": output_las,
                "a_srs": "EPSG:5181",
                "scale_x": 0.001,
                "scale_y": 0.001,
                "scale_z": 0.001,
            },
        ]
    }
    p = pdal.Pipeline(json.dumps(pipeline))
    p.execute()
    if len(p.arrays) == 0:
        raise RuntimeError("PDAL reprojection produced no output.")


def _reproject_las_to_ecef(input_las: str, output_las: str, in_srs: str) -> None:
    """LAS를 in_srs에서 EPSG:4978(ECEF, 지구 중심 직교 좌표)으로 변환해 output_las에 저장. 3D Tiles/Cesium용."""
    import pdal
    pipeline = {
        "pipeline": [
            {"type": "readers.las", "filename": input_las},
            {"type": "filters.reprojection", "in_srs": in_srs, "out_srs": "EPSG:4978"},
            {
                "type": "writers.las",
                "filename": output_las,
                "a_srs": "EPSG:4978",
                "scale_x": 0.01,
                "scale_y": 0.01,
                "scale_z": 0.01,
            },
        ]
    }
    p = pdal.Pipeline(json.dumps(pipeline))
    p.execute()
    if len(p.arrays) == 0:
        raise RuntimeError("PDAL reprojection to ECEF produced no output.")


def _las_bounds_to_region(input_las: str) -> list[float] | None:
    """LAS 파일에서 bounds를 읽어 3D Tiles region [west, south, east, north, minHeight, maxHeight] (라디안·미터) 반환. 실패 시 None."""
    import math
    import pdal
    pipeline = {
        "pipeline": [{"type": "readers.las", "filename": input_las}],
    }
    try:
        p = pdal.Pipeline(json.dumps(pipeline))
        p.execute()
        if len(p.arrays) == 0:
            return None
        arr = p.arrays[0]
        x, y, z = arr["X"], arr["Y"], arr["Z"]
        minx, maxx = float(x.min()), float(x.max())
        miny, maxy = float(y.min()), float(y.max())
        minz, maxz = float(z.min()), float(z.max())
        srs = None
        raw_meta = getattr(p, "metadata", None)
        if isinstance(raw_meta, str):
            try:
                raw_meta = json.loads(raw_meta)
            except json.JSONDecodeError:
                raw_meta = {}
        if isinstance(raw_meta, dict):
            stages = raw_meta.get("metadata") or raw_meta
            if isinstance(stages, dict):
                srs = stages.get("comp_spatialreference")
                if isinstance(srs, str) and srs.strip():
                    srs = srs.strip()
                else:
                    srs = None
                if not srs:
                    for stage in stages.values():
                        if isinstance(stage, dict):
                            srs = stage.get("comp_spatialreference")
                            if isinstance(srs, str) and srs.strip():
                                srs = srs.strip()
                                break
                            srs = stage.get("srs") or stage.get("spatialreference")
                            if srs and isinstance(srs, dict):
                                srs = srs.get("wkt") or srs.get("horizontal")
                            if srs:
                                break
        try:
            import pyproj
            if srs and "WGS 84" not in str(srs).upper() and "4326" not in str(srs):
                trans = pyproj.Transformer.from_crs(srs, "EPSG:4326", always_xy=True)
                west, south, east, north = trans.transform_bounds(minx, miny, maxx, maxy)
                minx, maxx, miny, maxy = west, east, south, north
        except Exception:
            pass
        west = math.radians(minx)
        east = math.radians(maxx)
        south = math.radians(miny)
        north = math.radians(maxy)
        return [west, south, east, north, minz, maxz]
    except Exception:
        return None


def _lon_lat_height_to_ecef(lon_deg: float, lat_deg: float, height_m: float) -> tuple[float, float, float]:
    """WGS84 경위도·고도(도, 도, m) -> ECEF (x,y,z 미터)."""
    import math
    a = 6378137.0
    f = 1.0 / 298.257223563
    e2 = 2 * f - f * f
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    sin_lon = math.sin(lon)
    cos_lon = math.cos(lon)
    N = a / math.sqrt(1.0 - e2 * sin_lat * sin_lat)
    x = (N + height_m) * cos_lat * cos_lon
    y = (N + height_m) * cos_lat * sin_lon
    z = (N * (1.0 - e2) + height_m) * sin_lat
    return (x, y, z)


def _enu_to_ecef_rotation(lon_deg: float, lat_deg: float) -> list[list[float]]:
    """해당 경위도에서 ENU 축 단위벡터를 ECEF로 (3x3, column-major에 넣을 때는 열이 E,N,U)."""
    import math
    lon = math.radians(lon_deg)
    lat = math.radians(lat_deg)
    sl, cl = math.sin(lon), math.cos(lon)
    sp, cp = math.sin(lat), math.cos(lat)
    east = (-sl, cl, 0.0)
    north = (-sp * cl, -sp * sl, cp)
    up = (cp * cl, cp * sl, sp)
    return [list(east), list(north), list(up)]


def _has_nan_in_list(lst: list) -> bool:
    """리스트에 NaN이 하나라도 있으면 True."""
    for x in lst:
        if isinstance(x, (int, float)) and x != x:  # NaN != NaN
            return True
        if isinstance(x, list) and _has_nan_in_list(x):
            return True
    return False


def _ensure_tileset_bounding_volume(tileset_path: str, input_las: str) -> None:
    """tileset.json에 root.boundingVolume이 없거나 NaN이 있으면 LAS bounds(region)로 채워 저장."""
    try:
        with open(tileset_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return
    root = data.get("root")
    if not isinstance(root, dict):
        return
    bv = root.get("boundingVolume")
    if bv and isinstance(bv, dict):
        box = bv.get("box")
        if isinstance(box, list) and _has_nan_in_list(box):
            bv = None
        elif bv.get("region") is not None and isinstance(bv.get("region"), list) and _has_nan_in_list(bv["region"]):
            bv = None
    if bv:
        return
    region = _las_bounds_to_region(input_las)
    if region is None:
        import math
        region = [2.0, 0.6, 2.5, 0.8, 0.0, 1000.0]
    root["boundingVolume"] = {"region": region}
    with open(tileset_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print(f"tileset.json: root.boundingVolume added (region from LAS or default)")


def _repair_node_nan(node: dict, default_region: list[float] | None, identity_transform: list[float]) -> None:
    """노드의 transform/boundingVolume/geometricError NaN을 기본값으로 치환. 자식 재귀."""
    if node.get("transform") is not None and _has_nan_in_list(node["transform"]):
        node["transform"] = identity_transform[:]
    ge = node.get("geometricError")
    if isinstance(ge, float) and ge != ge:
        node["geometricError"] = 500.0 if node.get("children") else 0.0
    bv = node.get("boundingVolume")
    if default_region and (not bv or (isinstance(bv, dict) and ((bv.get("box") and _has_nan_in_list(bv["box"])) or (bv.get("region") and _has_nan_in_list(bv.get("region") or []))))):
        node["boundingVolume"] = {"region": default_region}
    for ch in node.get("children") or []:
        if isinstance(ch, dict):
            _repair_node_nan(ch, default_region, identity_transform)


def _repair_tileset_nan_from_las(tileset_path: str, input_las: str) -> None:
    """root.transform 또는 root.geometricError에 NaN이 있으면 LAS bounds 기준으로 ECEF transform·region·geometricError 보정. 자식 노드 NaN도 보정."""
    import math
    try:
        with open(tileset_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return
    root = data.get("root")
    if not isinstance(root, dict):
        return
    t = root.get("transform")
    has_nan_transform = isinstance(t, list) and len(t) == 16 and _has_nan_in_list(t)
    ge = root.get("geometricError")
    has_nan_ge = isinstance(ge, float) and ge != ge
    bv = root.get("boundingVolume")
    has_nan_bv = isinstance(bv, dict) and (
        (bv.get("box") and _has_nan_in_list(bv["box"]))
        or (bv.get("region") and _has_nan_in_list(bv.get("region") or []))
    )
    if not (has_nan_transform or has_nan_ge or has_nan_bv):
        return
    region = _las_bounds_to_region(input_las)
    if region is None:
        region = [math.radians(128.0), math.radians(35.0), math.radians(128.5), math.radians(35.5), 0.0, 500.0]
    identity_transform = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]
    if has_nan_transform:
        west, south, east, north, min_h, max_h = region
        lon_deg = math.degrees((west + east) / 2.0)
        lat_deg = math.degrees((south + north) / 2.0)
        height_m = (min_h + max_h) / 2.0
        ex, ey, ez = _lon_lat_height_to_ecef(lon_deg, lat_deg, height_m)
        R = _enu_to_ecef_rotation(lon_deg, lat_deg)
        root["transform"] = [
            R[0][0], R[0][1], R[0][2], 0.0,
            R[1][0], R[1][1], R[1][2], 0.0,
            R[2][0], R[2][1], R[2][2], 0.0,
            ex, ey, ez, 1.0,
        ]
    if has_nan_ge:
        root["geometricError"] = 500.0
    if "geometricError" in data and isinstance(data["geometricError"], float) and data["geometricError"] != data["geometricError"]:
        data["geometricError"] = 500.0
    root["boundingVolume"] = {"region": region}
    _repair_node_nan(root, region, identity_transform)
    with open(tileset_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    print("tileset.json: NaN repaired from LAS (ECEF transform, region, geometricError).", flush=True)


def run_ecef_only(input_las: str, ecef_output_dir: str) -> None:
    """LAS를 ECEF(EPSG:4978)로 변환해 ecef_output_dir에 {basename}_ecef.las 로 저장."""
    import shutil
    basename = os.path.splitext(os.path.basename(input_las))[0]
    srs = _get_las_srs(input_las)
    if _is_epsg4978(srs):
        ecef_path = os.path.join(ecef_output_dir, f"{basename}_ecef.las")
        shutil.copy2(input_las, ecef_path)
        print(f"ECEF LAS saved (already 4978): {ecef_path}", flush=True)
        return
    ecef_path = os.path.join(ecef_output_dir, f"{basename}_ecef.las")
    _reproject_las_to_ecef(input_las, ecef_path, srs)
    print(f"ECEF LAS saved: {ecef_path}", flush=True)


def run_pnts_only(las_path: str, output_dir: str) -> None:
    """이미 ECEF인 LAS를 3D Tiles(.pnts)로 변환. output_dir은 비운 뒤 생성."""
    import shutil
    if os.path.isdir(output_dir):
        try:
            shutil.rmtree(output_dir)
        except OSError:
            pass
    os.makedirs(output_dir, exist_ok=True)
    cmd = _py3dtiles_exe() + [
        "convert", las_path, "--out", output_dir, "--srs_out", "4978",
        "--disable-processpool",  # Windows 등에서 process pool 레이스로 .pnts FileNotFoundError 방지
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=3600,
        encoding="utf-8",
        errors="replace",
        env={**os.environ},
    )
    if result.returncode != 0:
        err = (result.stderr or "").strip() or (result.stdout or "").strip()
        print(err, file=sys.stderr, flush=True)
        raise RuntimeError(f"py3dtiles convert failed: {err[:500]}")
    if result.stdout:
        print(result.stdout.rstrip())
    tileset_json = os.path.join(output_dir, "tileset.json")
    if os.path.isfile(tileset_json):
        _ensure_tileset_bounding_volume(tileset_json, las_path)
        _repair_tileset_nan_from_las(tileset_json, las_path)
    print(f"PNTS written: {output_dir}")


def run_b3dm(
    input_las: str,
    output_dir: str,
    ecef_output_dir: str | None = None,
    callback_url: str | None = None,
    path_key: str = "",
) -> None:
    """LAS -> 3D Tiles (tileset.json + .pnts) via py3dtiles convert.
    들어오는 LAS 좌표계를 ECEF(EPSG:4978)로 고정: 이미 4978이면 그대로, 아니면 PDAL로 ECEF 변환 후 변환.
    ecef_output_dir 이 있으면 ECEF LAS를 해당 폴더에 {basename}_ecef.las 로 저장.
    결과물은 포인트클라우드용 .pnts. NaN 발생 시 LAS 기준 보정."""
    import shutil
    print("STEP_START:ECEF", flush=True)
    _notify_step(callback_url, path_key, "ecef", "start")
    las_for_convert = input_las
    temp_las = None
    basename = os.path.splitext(os.path.basename(input_las))[0]
    srs = _get_las_srs(input_las)
    if not _is_epsg4978(srs):
        fd, temp_las = tempfile.mkstemp(suffix=".las")
        os.close(fd)
        try:
            _reproject_las_to_ecef(input_las, temp_las, srs)
            las_for_convert = temp_las
            print("LAS reprojected to EPSG:4978 (ECEF) for 3D Tiles.", flush=True)
            print("RESULT:ECEF:OK", flush=True)
            _notify_step(callback_url, path_key, "ecef", "ok")
            if ecef_output_dir:
                ecef_path = os.path.join(ecef_output_dir, f"{basename}_ecef.las")
                shutil.copy2(temp_las, ecef_path)
                print(f"ECEF LAS saved: {ecef_path}", flush=True)
        except Exception as e:
            try:
                if temp_las and os.path.isfile(temp_las):
                    os.unlink(temp_las)
            except OSError:
                pass
            print(f"RESULT:ECEF:FAIL:{str(e).replace(chr(10), ' ').strip()[:200]}", flush=True)
            _notify_step(callback_url, path_key, "ecef", "fail")
            raise RuntimeError(f"Reproject LAS to ECEF failed: {e}") from e
    else:
        print("RESULT:ECEF:OK", flush=True)
        _notify_step(callback_url, path_key, "ecef", "ok")
        if ecef_output_dir:
            ecef_path = os.path.join(ecef_output_dir, f"{basename}_ecef.las")
            shutil.copy2(input_las, ecef_path)
            print(f"ECEF LAS saved: {ecef_path}", flush=True)

    print("STEP_START:PNTS", flush=True)
    _notify_step(callback_url, path_key, "pnts", "start")
    try:
        # 기존 출력 폴더가 있으면 비우기 (py3dtiles가 비어있지 않은 폴더에서 FileExistsError 내는 경우 대비)
        if os.path.isdir(output_dir):
            try:
                shutil.rmtree(output_dir)
            except OSError:
                pass
        os.makedirs(output_dir, exist_ok=True)
        cmd = _py3dtiles_exe() + [
            "convert", las_for_convert, "--out", output_dir, "--srs_out", "4978",
            "--disable-processpool",  # Windows 등에서 process pool 레이스로 .pnts FileNotFoundError 방지
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,
            encoding="utf-8",
            errors="replace",
            env={**os.environ},
        )
        if result.returncode != 0:
            err = (result.stderr or "").strip() or (result.stdout or "").strip()
            print(err, file=sys.stderr, flush=True)  # 전체 트레이스백 확인용
            raise RuntimeError(f"py3dtiles convert failed: {err[:500]}")
        if result.stdout:
            print(result.stdout.rstrip())
        tileset_json = os.path.join(output_dir, "tileset.json")
        if os.path.isfile(tileset_json):
            _ensure_tileset_bounding_volume(tileset_json, las_for_convert)
            _repair_tileset_nan_from_las(tileset_json, las_for_convert)
        print(f"PNTS written: {output_dir}")
    finally:
        if temp_las and os.path.isfile(temp_las):
            try:
                os.unlink(temp_las)
            except OSError:
                pass


if __name__ == "__main__":
    main()
