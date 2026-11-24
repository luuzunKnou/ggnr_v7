"""
도로영상(360° equirectangular) 위치 맞춤.

영상 0.5초 간격 프레임 쌍에서 차량 회전(정면·정후면 특징점 가로 이동)과
전진 거리(도로면 특징점, 카메라 높이 단위)를 재고, 2초 묶음으로 노선 5m 표본의
방위 변화·거리에 DTW로 맞춘다. 묶음 사이 속도 변화에 벌점을 줘 가감속을 매끄럽게 한다.
전진 거리는 장소(도로면 무늬)마다 크기가 들쭉날쭉해 약하게만 쓰고, 굽이가 주 단서다.
40초 안에 270° 넘게 도는 구간(교차로 한 바퀴)은 교차시설 면이 노선과 겹치는 곳에서만
제자리 회전으로 두고, 교차시설 구간 안에서는 방위 비교를 하지 않는다(로터리 S자 통과).
출발 전 정차(창 평균 회전이 낮음)는 DTW에서 빼고 노선 시작에 제자리로 둔다.
분기(도로중심선교점) m 목록이 있으면 영상 큰 회전과 맞춰 위치를 보정한다.
수동 기준점(시각·노선 m)이 있으면 DTW 뒤 그 시각에 그 거리로 강제 보정한다.
노선 정방향/역방향은 비용이 낮은 쪽.

입력 JSON(--input): {"video": 경로 | "videos": [경로,...], "route": [[x,y],...] (미터 좌표, 노선 시작→끝),
                     "zones": [[[x,y],...], ...] (교차·분기 외곽선, 같은 좌표계),
                     "landmarks": [노선시작기준 m,...] (분기 기준점, 생략 가능),
                     "manualLandmarksByPart": [[{"t":초,"m":노선m},...], ...] (분할별 수동점, 생략 가능),
                     "preferDirection": "forward"|"reverse"|생략}
  videos 가 있으면 순서대로 이어 붙여 한 번 맞춘다(상행1+상행2 등).
출력 JSON(--output): {"ok", "direction": "forward"|"reverse", "durationSec", "routeLengthM", "cost",
                      "anchors": [[초, 노선 시작 기준 m, 영상 속 차 정면(도)], ...],
                      "loops": [[시작초, 끝초], ...],
                      "partDurations": [초,...] (videos 일 때 각 파일 길이)}
표준출력: PROGRESS:<0~100>
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time

import numpy as np

ANALYZER_VERSION = 15

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
# 출발 전 정차: 창 평균 |회전|이 이 값(도) 미만이면 아직 출발 전
# (정차 중에도 도로면 전진 추정값이 나와 전진만으로는 못 잡음)
IDLE_YAW_DEPART_DEG = 0.12
IDLE_ROLL_SEC = 3.0
# 도착 후 정차: 창 평균 전진이 (75분위×비율) 미만
IDLE_DS_ROLL_FRAC = 0.2
# 정차 구간이 이보다 짧으면(초) 무시
IDLE_MIN_SEC = 3.0
# 분기 기준점(도로중심선교점) ↔ 영상 회전 맞춤
LANDMARK_YAW_MIN_DEG = 8.0
LANDMARK_SKIP_ENTRY_SEC = 12.0
LANDMARK_MIN_SEP_SEC = 20.0
LANDMARK_SNAP_SEC = 18.0
LANDMARK_MAX = 10


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


def _moving_span(ds: np.ndarray, yaw: np.ndarray) -> tuple[int, int]:
    """출발 전·도착 후 정차를 제외한 표본 구간 [i0, i1].

    출발: 창 평균 |회전|이 IDLE_YAW_DEPART_DEG 이상이 되는 첫 시점
    (정차 중 전진 추정 노이즈가 있어도 회전이 없으면 출발 전으로 본다).
    도착: 창 평균 전진이 낮아지는 마지막 시점.
    """
    n = len(ds)
    if n < 2:
        return 0, max(0, n - 1)
    win = max(1, int(round(IDLE_ROLL_SEC / STEP_SEC)))
    kern = np.ones(win) / win
    roll_yaw = np.convolve(np.abs(yaw.astype(float)), kern, mode="same")
    roll_ds = np.convolve(np.maximum(ds.astype(float), 0.0), kern, mode="same")

    yaw_on = np.nonzero(roll_yaw >= IDLE_YAW_DEPART_DEG)[0]
    i0 = int(yaw_on[0]) if len(yaw_on) else 0

    p75 = float(np.percentile(roll_ds, 75))
    ds_thr = max(p75 * IDLE_DS_ROLL_FRAC, 1e-6)
    ds_on = np.nonzero(roll_ds >= ds_thr)[0]
    i1 = int(ds_on[-1]) if len(ds_on) else n - 1
    if len(yaw_on):
        i1 = max(i1, int(yaw_on[-1]))

    min_idle = int(round(IDLE_MIN_SEC / STEP_SEC))
    if i0 < min_idle:
        i0 = 0
    if (n - 1 - i1) < min_idle:
        i1 = n - 1
    i0 = max(0, min(i0, n - 1))
    i1 = max(i0, min(i1, n - 1))
    if i1 - i0 + 1 < BLOCK * 4 + 1:
        return 0, n - 1
    return i0, i1


def _landmark_turn_times(t: np.ndarray, yaw: np.ndarray) -> list[float]:
    """영상에서 큰 회전 시점(초) — 분기·삼거리 후보."""
    if len(t) < 5:
        return []
    win = max(1, int(round(2.0 / STEP_SEC)))
    roll = np.convolve(np.abs(yaw.astype(float)), np.ones(win), mode="same")
    thr = LANDMARK_YAW_MIN_DEG
    cand = []
    for i in range(1, len(roll) - 1):
        if roll[i] < thr:
            continue
        if roll[i] < roll[i - 1] or roll[i] < roll[i + 1]:
            continue
        ti = float(t[i])
        if ti < LANDMARK_SKIP_ENTRY_SEC:
            continue
        if cand and ti - cand[-1] < LANDMARK_MIN_SEP_SEC:
            cand[-1] = ti  # 같은 구간이면 나중(더 큰 회전쪽)으로
            continue
        cand.append(ti)
        if len(cand) >= LANDMARK_MAX * 3:
            break
    return cand


def _align_by_landmarks(
    t_m: np.ndarray,
    s_m: np.ndarray,
    yaw_m: np.ndarray,
    landmarks: list,
    length: float,
    direction: str,
) -> np.ndarray:
    """분기 m 과 영상 큰 회전을 맞춰 DTW 위치를 보정한다. landmarks 는 노선 시작 기준 m."""
    if not landmarks or length < 60:
        return s_m
    travel: list[float] = []
    for raw in landmarks:
        try:
            m = float(raw)
        except (TypeError, ValueError):
            continue
        sm = m if direction == "forward" else length - m
        if 40.0 < sm < length - 40.0:
            travel.append(sm)
    travel = sorted({round(x, 1) for x in travel})[:LANDMARK_MAX]
    if not travel:
        return s_m

    turns = _landmark_turn_times(t_m, yaw_m)
    if not turns:
        return s_m

    matches: list[tuple[float, float]] = []
    used: set[int] = set()
    for sm in travel:
        idx = int(np.searchsorted(s_m, sm))
        idx = min(max(idx, 0), len(t_m) - 1)
        t_pred = float(t_m[idx])
        best_i = None
        best_dt = LANDMARK_SNAP_SEC + 1.0
        for i, tv in enumerate(turns):
            if i in used:
                continue
            dt = abs(tv - t_pred)
            if dt < best_dt:
                best_dt = dt
                best_i = i
        if best_i is None or best_dt > LANDMARK_SNAP_SEC:
            continue
        used.add(best_i)
        matches.append((turns[best_i], sm))

    if not matches:
        return s_m

    matches.sort(key=lambda p: p[0])
    anchors_t = [float(t_m[0])]
    anchors_s = [float(s_m[0])]
    for tv, sm in matches:
        if tv <= anchors_t[-1] + 2.0:
            continue
        if sm <= anchors_s[-1] + 10.0:
            continue
        anchors_t.append(tv)
        anchors_s.append(sm)
    anchors_t.append(float(t_m[-1]))
    anchors_s.append(float(s_m[-1]))
    for i in range(1, len(anchors_s)):
        anchors_s[i] = max(anchors_s[i], anchors_s[i - 1] + 1.0)
        anchors_s[i] = min(anchors_s[i], length)

    # 구간마다 기존 s 상대 모양을 유지하며 목표 m 으로 선형 재매핑
    out = s_m.copy()
    for i in range(len(anchors_t) - 1):
        t0, t1 = anchors_t[i], anchors_t[i + 1]
        if t1 <= t0 + 1e-6:
            continue
        mask = (t_m >= t0) & (t_m <= t1) if i == len(anchors_t) - 2 else (t_m >= t0) & (t_m < t1)
        if not mask.any():
            continue
        s_seg = s_m[mask]
        s0_old, s1_old = float(s_seg[0]), float(s_seg[-1])
        s0_new, s1_new = anchors_s[i], anchors_s[i + 1]
        if abs(s1_old - s0_old) < 1e-3:
            out[mask] = np.linspace(s0_new, s1_new, mask.sum())
        else:
            out[mask] = s0_new + (s_seg - s0_old) * (s1_new - s0_new) / (s1_old - s0_old)
    return np.clip(np.maximum.accumulate(out), 0.0, length)


def measure_motions(video_paths: list[str]) -> dict:
    """여러 영상을 시간 순으로 이어 붙인 motion. partDurations 에 각 파일 길이."""
    if not video_paths:
        raise RuntimeError("영상 경로가 없습니다.")
    if len(video_paths) == 1:
        m = measure_motion(video_paths[0])
        m["partDurations"] = [round(float(m["duration"]), 2)]
        return m
    rows: list[list] = []
    part_durs: list[float] = []
    t_off = 0.0
    fps = 29.97
    n = len(video_paths)
    for i, p in enumerate(video_paths):
        # 이어붙이기 진행률 — 프레임 측정이 0~90 이므로 구간만 나눔
        print(f"PROGRESS:{int(i * 88 / n)}", flush=True)
        m = measure_motion(p)
        fps = float(m.get("fps") or fps)
        dur = float(m["duration"])
        part_durs.append(round(dur, 2))
        for r in m["rows"]:
            front = r[3] if len(r) > 3 else None
            rows.append([float(r[0]) + t_off, r[1], r[2], front])
        t_off += dur
    if len(rows) < 20:
        raise RuntimeError("영상 프레임을 충분히 읽지 못했습니다.")
    return {"fps": fps, "rows": rows, "duration": t_off, "partDurations": part_durs}


def _flatten_manual_landmarks(motion: dict, by_part: list | None) -> list[dict]:
    """분할별 수동점 → 이어붙인 타임라인 {t,m}. m 은 노선 시작 기준."""
    if not isinstance(by_part, list) or not by_part:
        return []
    parts = motion.get("partDurations")
    offsets = [0.0]
    if isinstance(parts, list) and parts:
        for d in parts:
            offsets.append(offsets[-1] + float(d or 0))
    out: list[dict] = []
    for i, items in enumerate(by_part):
        if not isinstance(items, list):
            continue
        off = offsets[i] if i < len(offsets) else 0.0
        for it in items:
            if not isinstance(it, dict):
                continue
            try:
                t = float(it.get("t"))
                m = float(it.get("m"))
            except (TypeError, ValueError):
                continue
            if not math.isfinite(t) or not math.isfinite(m) or t < 0 or m < 0:
                continue
            out.append({"t": t + off, "m": m})
    out.sort(key=lambda x: x["t"])
    return out


def _align_by_manual_times(
    t: np.ndarray,
    m_forward: np.ndarray,
    manuals: list[dict],
    length: float,
) -> np.ndarray:
    """알려진 (시각, 노선시작 m) 으로 위치 곡선을 강제 보정."""
    if not manuals or length < 1:
        return m_forward
    matches: list[tuple[float, float]] = []
    for it in manuals:
        try:
            tv = float(it["t"])
            sm = float(it["m"])
        except (KeyError, TypeError, ValueError):
            continue
        if tv < float(t[0]) - 0.5 or tv > float(t[-1]) + 0.5:
            continue
        sm = float(np.clip(sm, 0.0, length))
        matches.append((tv, sm))
    if not matches:
        return m_forward
    matches.sort(key=lambda p: p[0])

    anchors_t = [float(t[0])]
    anchors_m = [float(m_forward[0])]
    for tv, sm in matches:
        if tv <= anchors_t[-1] + 0.5:
            continue
        anchors_t.append(tv)
        anchors_m.append(sm)
    anchors_t.append(float(t[-1]))
    anchors_m.append(float(m_forward[-1]))
    for i in range(1, len(anchors_m)):
        # 방향은 강제하지 않되 끝은 길이 안으로
        anchors_m[i] = float(np.clip(anchors_m[i], 0.0, length))

    out = m_forward.copy()
    for i in range(len(anchors_t) - 1):
        t0, t1 = anchors_t[i], anchors_t[i + 1]
        if t1 <= t0 + 1e-6:
            continue
        mask = (t >= t0) & (t <= t1) if i == len(anchors_t) - 2 else (t >= t0) & (t < t1)
        if not mask.any():
            continue
        seg = m_forward[mask]
        m0_old, m1_old = float(seg[0]), float(seg[-1])
        m0_new, m1_new = anchors_m[i], anchors_m[i + 1]
        if abs(m1_old - m0_old) < 1e-3:
            out[mask] = np.linspace(m0_new, m1_new, int(mask.sum()))
        else:
            out[mask] = m0_new + (seg - m0_old) * (m1_new - m0_new) / (m1_old - m0_old)
    return np.clip(out, 0.0, length)


def fit_to_route(
    motion: dict,
    route: list,
    zones: list,
    prefer_direction: str | None = None,
    landmarks: list | None = None,
    manual_landmarks: list | None = None,
) -> dict:
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

    # 출발 전·도착 후 정차 구간은 DTW에서 빼고, 앵커는 시작/끝 제자리로 둔다
    i0, i1 = _moving_span(ds, yaw)
    t_m = t[i0 : i1 + 1]
    yaw_m = yaw[i0 : i1 + 1]
    ds_m = ds[i0 : i1 + 1]
    loop_m = loop[i0 : i1 + 1]
    n_m = len(t_m)

    # 묶음 i(1..nb): 이동 구간 표본 (i-1)*BLOCK+1 .. i*BLOCK
    nb = (n_m - 1) // BLOCK
    if nb < 4:
        raise RuntimeError("영상이 너무 짧습니다.")
    byaw = np.zeros(nb + 1)
    bds = np.zeros(nb + 1)
    bloop = np.zeros(nb + 1, bool)
    for i in range(1, nb + 1):
        sl = slice((i - 1) * BLOCK + 1, i * BLOCK + 1)
        byaw[i] = yaw_m[sl].sum()
        bds[i] = ds_m[sl].sum()
        bloop[i] = loop_m[sl].mean() >= 0.5
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

    # 파일명 힌트(상행/하행)가 있으면 그 방향만 — 직선 구간에서 상·하행이 뒤집히는 것 방지
    if prefer_direction in ("forward", "reverse"):
        directions: tuple[str, ...] = (prefer_direction,)
    else:
        directions = ("forward", "reverse")

    best = None
    for direction in directions:
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
    # 묶음 경계 위치 → 이동 구간 0.5초 표본
    s_m = np.full(n_m, sb[nb])
    s_m[0] = sb[0]
    for i in range(1, nb + 1):
        lo, hi = (i - 1) * BLOCK, i * BLOCK
        w = np.cumsum(ds_m[lo + 1 : hi + 1])
        w = w / w[-1] if w[-1] > 0 else np.linspace(1 / BLOCK, 1, BLOCK)
        s_m[lo + 1 : hi + 1] = sb[i - 1] + (sb[i] - sb[i - 1]) * w
    # 3초 이동평균 + 되돌아가지 않게
    k = 7
    s_m = np.convolve(np.pad(s_m, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    s_m = np.clip(np.maximum.accumulate(s_m), 0, length)
    # 분기 기준점 ↔ 영상 큰 회전 맞춤
    s_m = _align_by_landmarks(t_m, s_m, yaw_m, landmarks or [], length, best["direction"])
    s_m = np.clip(np.maximum.accumulate(s_m), 0, length)

    # 전체 타임라인: 정차 구간은 시작(0)·끝(length)에 고정
    s = np.empty(n)
    s[:i0] = 0.0
    s[i0 : i0 + n_m] = s_m
    s[i0 + n_m :] = length

    m_forward = s if best["direction"] == "forward" else length - s
    # 수동 기준점(노선 시작 m) — DTW·분기 보정 뒤 강제
    if manual_landmarks:
        m_forward = _align_by_manual_times(t, m_forward, manual_landmarks, length)
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

    out = {
        "ok": True,
        "analyzerVersion": ANALYZER_VERSION,
        "direction": best["direction"],
        "durationSec": end_t,
        "routeLengthM": round(length, 1),
        "cost": round(best["cost"] / max(1, nb), 4),
        "anchors": anchors,
        "loops": loops,
        "idleHoldSec": [round(float(t[i0]), 2), round(float(t[min(i1, n - 1)]), 2)],
    }
    parts = motion.get("partDurations")
    if isinstance(parts, list) and parts:
        out["partDurations"] = [round(float(x), 2) for x in parts]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()
    started = time.time()
    try:
        with open(args.input, encoding="utf-8") as f:
            spec = json.load(f)
        videos = spec.get("videos")
        if isinstance(videos, list) and videos:
            paths = [str(p) for p in videos if str(p).strip()]
        else:
            paths = [str(spec["video"])]
        prefer = spec.get("preferDirection")
        prefer_s = prefer if prefer in ("forward", "reverse") else None
        landmarks = spec.get("landmarks")
        lm = landmarks if isinstance(landmarks, list) else []
        motion = measure_motions(paths)
        manuals = _flatten_manual_landmarks(motion, spec.get("manualLandmarksByPart"))
        print("PROGRESS:92", flush=True)
        result = fit_to_route(motion, spec["route"], spec.get("zones") or [], prefer_s, lm, manuals)
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
