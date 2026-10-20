"""
도로영상(360° equirectangular) 위치 맞춤.

영상 0.5초 간격 프레임 쌍에서 차량 회전(정면·정후면 특징점 가로 이동)과
전진 거리(도로면 특징점, 카메라 높이 단위)를 재고, 2초 묶음으로 노선 5m 표본의
방위 변화·거리에 DTW로 맞춘다. 묶음 사이 속도 변화에 벌점을 줘 가감속을 매끄럽게 한다.
전진 거리는 장소(도로면 무늬)마다 크기가 들쭉날쭉해 약하게만 쓰고, 굽이가 주 단서다.
40초 안에 270° 넘게 도는 구간(교차로 한 바퀴)은 교차시설 면이 노선과 겹치는 곳에서만
제자리 회전으로 두고, 교차시설 구간 안에서는 방위 비교를 하지 않는다(로터리 S자 통과).
노선 정방향/역방향은 비용이 낮은 쪽.

입력 JSON(--input): {"video": 경로, "route": [[x,y],...] (미터 좌표, 노선 시작→끝),
                     "zones": [[[x,y],...], ...] (교차시설 외곽선, 같은 좌표계)}
출력 JSON(--output): {"ok", "direction": "forward"|"reverse", "durationSec", "routeLengthM", "cost",
                      "anchors": [[초, 노선 시작 기준 m, 영상 속 차 정면(도)], ...],
                      "loops": [[시작초, 끝초], ...]}
표준출력: PROGRESS:<0~100>
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time

import numpy as np

ANALYZER_VERSION = 2

STEP_SEC = 0.5
W, H = 1280, 640
SKY_Y = int(H * 0.15)
HORIZON_Y = int(H * 0.50)
# 지붕 거치 카메라 — 이 아래는 차량 지붕
CAR_Y = int(H * 0.615)
ANCHOR_EVERY_SEC = 1.0

ROUTE_STEP_M = 5.0
# DTW 묶음(표본 4개 = 2초)
BLOCK = 4
MAX_SPEED_MS = 40.0
SIG_YAW_DEG = 5.0
SIG_DIST_M = 15.0
SIG_DIST_K = 0.5
ACCEL_PENALTY = 0.5
ZONE_PAD_M = 15.0
# DTW 역추적 표 크기 상한(int8 개수)
DTW_BUDGET = 2.0e8
FRONT_SMOOTH_SEC = 30.0


def _bearings(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lon = (pts[:, 0] / W - 0.5) * 2 * math.pi
    lat = (0.5 - pts[:, 1] / H) * math.pi
    return lon, lat


def _vec(lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    return np.stack([np.cos(lat) * np.sin(lon), -np.sin(lat), np.cos(lat) * np.cos(lon)], axis=1)


def measure_motion(video_path: str) -> dict:
    """0.5초마다 [시각, 회전(도), 전진(높이 단위), 영상 속 차 정면(도)] — 못 재면 None"""
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("영상을 열 수 없습니다.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 29.97
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, round(fps * STEP_SEC))
    orb = cv2.ORB_create(nfeatures=4000, fastThreshold=12)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    mask = np.zeros((H, W), np.uint8)
    mask[SKY_Y:CAR_Y, :] = 255
    foes = np.radians(np.arange(-180, 180, 2.0))

    rows: list[list] = []
    prev = None
    idx = 0
    last_pct = -1
    while True:
        if idx % step != 0:
            if not cap.grab():
                break
            idx += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        gray = cv2.cvtColor(cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        kp, des = orb.detectAndCompute(gray, mask)
        cur = (np.array([k.pt for k in kp], np.float32), des)
        t = idx / fps
        yaw_deg, ds, front_deg = 0.0, None, None
        if prev is not None and des is not None and prev[1] is not None and len(kp) > 50:
            pairs = bf.knnMatch(prev[1], des, k=2)
            good = [a for a, b in (p for p in pairs if len(p) == 2) if a.distance < 0.75 * b.distance]
            if len(good) >= 30:
                p1 = prev[0][[g.queryIdx for g in good]]
                p2 = cur[0][[g.trainIdx for g in good]]
                lon1, lat1 = _bearings(p1)
                lon2, lat2 = _bearings(p2)
                dlon = (lon2 - lon1 + math.pi) % (2 * math.pi) - math.pi
                steady = np.abs(lat2 - lat1) < 0.05
                # 정면 방향: 회전을 뺀 가로 흐름의 부호가 갈라지는 각(카메라 거치 방향이 서서히 틀어져도 따라감)
                foe = 0.0
                yaw = float(np.median(dlon))
                for _ in range(2):
                    dl = dlon - yaw
                    big = np.abs(dl) > 0.004
                    if big.sum() > 40:
                        agree = np.sign(dl[big])[None, :] == np.sign(np.sin(lon1[big][None, :] - foes[:, None]))
                        foe = float(foes[int(np.argmax(agree.mean(axis=1)))])
                    axial = (np.abs(np.sin(lon1 - foe)) < 0.26) & steady
                    if axial.sum() >= 10:
                        yaw = float(np.median(dlon[axial]))
                yaw_deg = math.degrees(yaw)
                front_deg = math.degrees(foe)
                ground = (p1[:, 1] > HORIZON_Y + 8) & (p2[:, 1] > HORIZON_Y + 8)
                if ground.sum() >= 8:
                    b1 = _vec(lon1[ground], lat1[ground])
                    b2 = _vec(lon2[ground] - yaw, lat2[ground])
                    moved = b1 / b1[:, 1:2] - b2 / b2[:, 1:2]
                    planar = np.hypot(moved[:, 0], moved[:, 2])
                    usable = planar < 3.0
                    if usable.sum() >= 6:
                        ds = float(np.median(planar[usable]))
            rows.append([t, yaw_deg, ds, front_deg])
        prev = cur
        idx += 1
        if total > 0:
            pct = int(idx * 90 / total)
            if pct != last_pct and pct % 5 == 0:
                last_pct = pct
                print(f"PROGRESS:{pct}", flush=True)
    cap.release()
    if len(rows) < 20:
        raise RuntimeError("영상 프레임을 충분히 읽지 못했습니다.")
    return {"fps": fps, "rows": rows, "duration": idx / fps}


def _resample_route(coords: np.ndarray, step_m: float) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    seg = np.hypot(*np.diff(coords, axis=0).T)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    length = float(cum[-1])
    sj = np.arange(0, length + 1e-6, step_m)
    if sj[-1] < length - 1e-6:
        sj = np.append(sj, length)
    rx = np.interp(sj, cum, coords[:, 0])
    ry = np.interp(sj, cum, coords[:, 1])
    return sj, rx, ry, length


def _heading(rx: np.ndarray, ry: np.ndarray, step_m: float) -> np.ndarray:
    n = len(rx)
    hw = max(1, int(round(15.0 / step_m)))
    i0 = np.clip(np.arange(n) - hw, 0, n - 1)
    i1 = np.clip(np.arange(n) + hw, 0, n - 1)
    return np.degrees(np.arctan2(rx[i1] - rx[i0], ry[i1] - ry[i0]))


def _inside(px: np.ndarray, py: np.ndarray, ring: np.ndarray) -> np.ndarray:
    x, y = ring[:, 0], ring[:, 1]
    res = np.zeros(len(px), bool)
    j = len(ring) - 1
    for i in range(len(ring)):
        cond = ((y[i] > py) != (y[j] > py)) & (px < (x[j] - x[i]) * (py - y[i]) / (y[j] - y[i] + 1e-12) + x[i])
        res ^= cond
        j = i
    return res


def _zone_mask(rx: np.ndarray, ry: np.ndarray, zones: list, step_m: float) -> np.ndarray:
    hit = np.zeros(len(rx), bool)
    for ring in zones:
        r = np.asarray(ring, float)
        if r.ndim != 2 or len(r) < 3:
            continue
        hit |= _inside(rx, ry, r[:, :2])
    if not hit.any():
        return hit
    pad = int(round(ZONE_PAD_M / step_m))
    out = hit.copy()
    for k in range(1, pad + 1):
        out[k:] |= hit[:-k]
        out[:-k] |= hit[k:]
    return out


def _wrap(a):
    return (a + 180) % 360 - 180


def _dtw(phi, byaw, bds_m, bloop, zone_ok, sign, step_m, max_adv):
    """D[a, j] = 직전 묶음에 a 칸 나아가 노선 표본 j 에 온 최소 비용. 반환: (비용, 묶음별 j)"""
    m = len(phi)
    n = len(byaw)
    inf = 1e18
    idx = np.arange(m)
    k1 = max_adv + 1
    d = np.full((k1, m), inf)
    d[0, 0] = 0.0
    back = np.zeros((n, k1, m), np.int8)
    zone_pen = np.where(zone_ok, 0.0, 1e6) if zone_ok.any() else np.zeros(m)
    head_w = np.where(zone_ok, 0.0, 1.0)
    acc = ACCEL_PENALTY * (np.arange(k1)[:, None] - np.arange(k1)[None, :]) ** 2
    for i in range(1, n):
        nd = np.full((k1, m), inf)
        sig_d = SIG_DIST_M + SIG_DIST_K * bds_m[i]
        for a in range(k1):
            tot = d + acc[a][:, None]
            ap = np.argmin(tot, axis=0)
            best = tot[ap, idx]
            prev = np.full(m, inf)
            apb = np.zeros(m, np.int8)
            if a:
                prev[a:] = best[: m - a]
                apb[a:] = ap[: m - a]
            else:
                prev[:] = best
                apb[:] = ap
            if bloop[i]:
                c = (a * step_m) ** 2 / 90.0 + zone_pen
            else:
                dphi = _wrap(phi - phi[np.clip(idx - a, 0, m - 1)])
                c = head_w * (sign * byaw[i] - dphi) ** 2 / (2 * SIG_YAW_DEG**2) + (a * step_m - bds_m[i]) ** 2 / (
                    2 * sig_d**2
                )
            nd[a] = prev + c
            back[i, a] = apb
        d = nd
    a = int(np.argmin(d[:, m - 1]))
    cost = float(d[a, m - 1])
    j = m - 1
    path = np.zeros(n, int)
    for i in range(n - 1, -1, -1):
        path[i] = j
        ap = int(back[i, a, j])
        j -= a
        a = ap
    return cost, path


def _detect_loops(yaw: np.ndarray) -> np.ndarray:
    """25초 창에서 회전합 > 270° 이고 회전이 빠른 표본"""
    n = len(yaw)
    cand = np.zeros(n, bool)
    win = int(25 / STEP_SEC)
    cy = np.cumsum(yaw)
    for i in range(n):
        hi = min(n, i + win)
        over = np.nonzero(np.abs(cy[i + 4 : hi] - cy[i]) > 270)[0] if i + 4 < hi else []
        if len(over):
            cand[i : i + 4 + int(over[0]) + 1] = True
    fast = np.convolve(np.abs(yaw), np.ones(5) / 5, mode="same") > 4.0
    loop = cand & fast
    if loop.any():
        on = np.nonzero(loop)[0]
        for a, b in zip(on[:-1], on[1:]):
            if b - a <= 6:
                loop[a:b] = True
    return loop


def _smooth_front(t: np.ndarray, front: np.ndarray) -> np.ndarray:
    """영상 속 차 정면(도) — 결측 보간 후 원형 이동평균"""
    ok = ~np.isnan(front)
    if not ok.any():
        return np.zeros(len(t))
    rad = np.radians(front)
    cx = np.interp(t, t[ok], np.cos(rad[ok]))
    cy = np.interp(t, t[ok], np.sin(rad[ok]))
    w = max(1, int(FRONT_SMOOTH_SEC / STEP_SEC)) | 1
    kern = np.ones(w) / w
    cx = np.convolve(np.pad(cx, w // 2, mode="edge"), kern, mode="valid")
    cy = np.convolve(np.pad(cy, w // 2, mode="edge"), kern, mode="valid")
    return np.degrees(np.arctan2(cy, cx))


def fit_to_route(motion: dict, route: list, zones: list) -> dict:
    rows = motion["rows"]
    t = np.array([0.0] + [r[0] for r in rows])
    yaw = np.array([0.0] + [r[1] for r in rows])
    ds = np.array([0.0] + [np.nan if r[2] is None else r[2] for r in rows])
    front = np.array([np.nan] + [np.nan if len(r) < 4 or r[3] is None else r[3] for r in rows])
    missing = np.isnan(ds)
    if missing.all():
        raise RuntimeError("도로면 이동을 잴 수 없습니다.")
    ds[missing] = np.interp(t[missing], t[~missing], ds[~missing])
    padded = np.pad(ds, 2, mode="edge")
    ds = np.array([np.median(padded[i : i + 5]) for i in range(len(ds))])
    n = len(t)
    loop = _detect_loops(yaw)

    coords = np.asarray(route, float)[:, :2]
    if len(coords) < 2:
        raise RuntimeError("노선 선형이 없습니다.")

    # 묶음 i(1..nb): 표본 (i-1)*BLOCK+1 .. i*BLOCK
    nb = (n - 1) // BLOCK
    if nb < 4:
        raise RuntimeError("영상이 너무 짧습니다.")
    byaw = np.zeros(nb + 1)
    bds = np.zeros(nb + 1)
    bloop = np.zeros(nb + 1, bool)
    for i in range(1, nb + 1):
        sl = slice((i - 1) * BLOCK + 1, i * BLOCK + 1)
        byaw[i] = yaw[sl].sum()
        bds[i] = ds[sl].sum()
        bloop[i] = loop[sl].mean() >= 0.5
    moving = bds[~bloop].sum()
    if moving <= 0:
        raise RuntimeError("영상에서 이동이 확인되지 않습니다.")

    seg_len = float(np.hypot(*np.diff(coords, axis=0).T).sum())
    step_m = ROUTE_STEP_M
    while True:
        max_adv = int(math.ceil(MAX_SPEED_MS * BLOCK * STEP_SEC / step_m))
        if (nb + 1) * (max_adv + 1) * (seg_len / step_m + 2) <= DTW_BUDGET or step_m >= 40:
            break
        step_m *= 1.5

    best = None
    for direction in ("forward", "reverse"):
        c = coords if direction == "forward" else coords[::-1]
        sj, rx, ry, length = _resample_route(c, step_m)
        if len(sj) < 4:
            raise RuntimeError("노선이 너무 짧습니다.")
        phi = _heading(rx, ry, step_m)
        zone_ok = _zone_mask(rx, ry, zones, step_m)
        bds_m = bds * (length / moving)
        for sign in (1, -1):
            cost, path = _dtw(phi, byaw, bds_m, bloop, zone_ok, sign, step_m, max_adv)
            if best is None or cost < best["cost"]:
                best = {"cost": cost, "direction": direction, "sb": sj[path], "length": length}

    sb = best["sb"]
    length = best["length"]
    # 묶음 경계 위치 → 0.5초 표본: 묶음 안은 측정 이동량 비율로 나눔
    s = np.full(n, sb[nb])
    s[0] = sb[0]
    for i in range(1, nb + 1):
        lo, hi = (i - 1) * BLOCK, i * BLOCK
        w = np.cumsum(ds[lo + 1 : hi + 1])
        w = w / w[-1] if w[-1] > 0 else np.linspace(1 / BLOCK, 1, BLOCK)
        s[lo + 1 : hi + 1] = sb[i - 1] + (sb[i] - sb[i - 1]) * w
    # 3초 이동평균 + 되돌아가지 않게
    k = 7
    s = np.convolve(np.pad(s, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    s = np.clip(np.maximum.accumulate(s), 0, length)
    m_forward = s if best["direction"] == "forward" else length - s
    front_s = _smooth_front(t, front)

    anchors = []
    next_t = 0.0
    for ti, mi, fi in zip(t, m_forward, front_s):
        if ti + 1e-6 >= next_t:
            anchors.append([round(float(ti), 2), round(float(mi), 1), round(float(fi), 1)])
            next_t += ANCHOR_EVERY_SEC
    end_t = round(float(motion["duration"]), 2)
    if anchors[-1][0] < end_t:
        anchors.append([end_t, round(float(m_forward[-1]), 1), round(float(front_s[-1]), 1)])

    loops = []
    if loop.any():
        on = np.nonzero(loop)[0]
        start = on[0]
        for a, b in zip(on[:-1], on[1:]):
            if b != a + 1:
                loops.append([round(float(t[start]), 2), round(float(t[a]), 2)])
                start = b
        loops.append([round(float(t[start]), 2), round(float(t[on[-1]]), 2)])

    return {
        "ok": True,
        "analyzerVersion": ANALYZER_VERSION,
        "direction": best["direction"],
        "durationSec": end_t,
        "routeLengthM": round(length, 1),
        "cost": round(best["cost"] / max(1, nb), 4),
        "anchors": anchors,
        "loops": loops,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    started = time.time()
    try:
        with open(args.input, encoding="utf-8") as f:
            spec = json.load(f)
        motion = measure_motion(spec["video"])
        print("PROGRESS:92", flush=True)
        result = fit_to_route(motion, spec["route"], spec.get("zones") or [])
        result["elapsedSec"] = round(time.time() - started, 1)
        code = 0
    except Exception as e:  # noqa: BLE001 — 실패 사유를 결과 파일로 남긴다
        result = {"ok": False, "error": str(e) or e.__class__.__name__}
        code = 1
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print("PROGRESS:100", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
