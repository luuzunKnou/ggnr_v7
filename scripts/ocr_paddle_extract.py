#!/usr/bin/env python3
"""
PaddleOCR → JSON (stdout)
Usage: python scripts/ocr_paddle_extract.py --image {path} [--model-dir {dir}]

stdout: { fullText, lines[{text, score, box}], imageWidth, imageHeight }
"""
from __future__ import annotations

import argparse
import json
import os
import sys


def get_image_size(image_path: str) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(image_path) as im:
            w, h = im.size
            return int(w), int(h)
    except Exception:
        pass
    try:
        import cv2

        img = cv2.imread(image_path)
        if img is not None:
            h, w = img.shape[:2]
            return int(w), int(h)
    except Exception:
        pass
    return 0, 0


def resolve_model_dir(explicit: str | None) -> str:
    if explicit:
        return os.path.abspath(explicit)
    env = os.environ.get("PADDLEOCR_MODEL_DIR", "").strip()
    if env:
        return os.path.abspath(env)
    root = os.environ.get("GGNR_PROJECT_ROOT", os.getcwd())
    return os.path.join(os.path.abspath(root), "python", "models", "paddleocr")


def configure_paddle_env() -> None:
    """Windows CPU oneDNN/PIR 충돌 회피 (PaddleOCR #18119)"""
    os.environ.setdefault("FLAGS_enable_pir_api", "0")
    os.environ.setdefault("FLAGS_use_mkldnn", "0")
    os.environ.setdefault("PADDLE_PDX_ENABLE_MKLDNN_BYDEFAULT", "0")


def build_ocr(model_dir: str):
    configure_paddle_env()
    from paddleocr import PaddleOCR

    det_dir = os.path.join(model_dir, "det")
    rec_dir = os.path.join(model_dir, "rec")
    orient_dir = os.path.join(model_dir, "cls")

    # PaddleOCR 3.x
    kwargs_v3: dict = {
        "lang": "korean",
        "use_doc_orientation_classify": False,
        "use_doc_unwarping": False,
        "use_textline_orientation": False,
        "enable_mkldnn": False,
    }
    if os.path.isdir(det_dir):
        kwargs_v3["text_detection_model_dir"] = det_dir
    if os.path.isdir(rec_dir):
        kwargs_v3["text_recognition_model_dir"] = rec_dir
    if os.path.isdir(orient_dir):
        kwargs_v3["textline_orientation_model_dir"] = orient_dir
        kwargs_v3["use_textline_orientation"] = True

    try:
        return PaddleOCR(**kwargs_v3)
    except TypeError:
        pass

    # PaddleOCR 2.x fallback
    kwargs_v2: dict = {
        "use_angle_cls": True,
        "lang": "korean",
    }
    if os.path.isdir(det_dir) and os.path.isdir(rec_dir):
        kwargs_v2["det_model_dir"] = det_dir
        kwargs_v2["rec_model_dir"] = rec_dir
        if os.path.isdir(orient_dir):
            kwargs_v2["cls_model_dir"] = orient_dir
    return PaddleOCR(**kwargs_v2)


def extract_page_dict(page) -> dict:
    if isinstance(page, dict):
        return page.get("res", page) if "res" in page else page
    if hasattr(page, "json"):
        j = page.json
        j = j() if callable(j) else j
        if isinstance(j, dict):
            return j.get("res", j) if "res" in j else j
    return {}


def parse_v3_result(raw) -> list[dict]:
    lines: list[dict] = []
    if not raw:
        return lines
    pages = raw if isinstance(raw, list) else [raw]
    for page in pages:
        data = extract_page_dict(page)
        texts = data.get("rec_texts") or data.get("texts") or []
        scores = data.get("rec_scores") or data.get("scores") or []
        polys = data.get("dt_polys") or data.get("rec_polys") or data.get("boxes") or []
        for i, text in enumerate(texts):
            t = str(text or "").strip()
            if not t:
                continue
            score = float(scores[i]) if i < len(scores) else 0.0
            poly = polys[i] if i < len(polys) else []
            box_list: list[list[float]] = []
            if poly is not None and len(poly) > 0:
                try:
                    box_list = [[float(p[0]), float(p[1])] for p in poly]
                except (TypeError, IndexError):
                    box_list = []
            ys = [p[1] for p in box_list]
            xs = [p[0] for p in box_list]
            lines.append(
                {
                    "text": t,
                    "score": score,
                    "box": box_list,
                    "centerY": sum(ys) / len(ys) if ys else 0,
                    "centerX": sum(xs) / len(xs) if xs else 0,
                }
            )
    return lines


def parse_v2_result(raw) -> list[dict]:
    lines: list[dict] = []
    if not raw:
        return lines
    page = raw[0] if isinstance(raw, list) and raw else raw
    if not page:
        return lines
    for item in page:
        if not item or len(item) < 2:
            continue
        box = item[0]
        text_part = item[1]
        if isinstance(text_part, (list, tuple)) and len(text_part) >= 2:
            text, score = text_part[0], text_part[1]
        else:
            text, score = str(text_part), 0.0
        text = str(text or "").strip()
        if not text:
            continue
        box_list = [[float(p[0]), float(p[1])] for p in box]
        ys = [p[1] for p in box_list]
        xs = [p[0] for p in box_list]
        lines.append(
            {
                "text": text,
                "score": float(score),
                "box": box_list,
                "centerY": sum(ys) / len(ys) if ys else 0,
                "centerX": sum(xs) / len(xs) if xs else 0,
            }
        )
    return lines


def sort_lines(lines: list[dict]) -> list[dict]:
    return sorted(lines, key=lambda line: (line.get("centerY", 0), line.get("centerX", 0)))


def merge_row(row: list[dict]) -> dict:
    row = sorted(row, key=lambda line: line.get("centerX", 0))
    texts = [str(line.get("text") or "").strip() for line in row if str(line.get("text") or "").strip()]
    scores = [float(line.get("score") or 0) for line in row]
    ys = [float(line.get("centerY") or 0) for line in row]
    xs = [float(line.get("centerX") or 0) for line in row]
    return {
        "text": " ".join(texts),
        "score": sum(scores) / len(scores) if scores else 0.0,
        "centerY": sum(ys) / len(ys) if ys else 0,
        "centerX": min(xs) if xs else 0,
    }


def merge_lines_by_row(lines: list[dict], y_threshold: float = 18.0) -> list[dict]:
    if not lines:
        return []
    sorted_lines = sort_lines(lines)
    rows: list[list[dict]] = [[sorted_lines[0]]]
    for line in sorted_lines[1:]:
        if abs(float(line.get("centerY") or 0) - float(rows[-1][0].get("centerY") or 0)) <= y_threshold:
            rows[-1].append(line)
        else:
            rows.append([line])
    return [merge_row(row) for row in rows if merge_row(row).get("text")]


def run_ocr(ocr, image_path: str) -> list[dict]:
    if hasattr(ocr, "predict"):
        raw = ocr.predict(image_path)
        lines = parse_v3_result(raw)
        if lines:
            return lines

    if hasattr(ocr, "ocr"):
        raw = ocr.ocr(image_path, cls=True)
        return parse_v2_result(raw)

    raise RuntimeError("지원하지 않는 PaddleOCR API입니다.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--model-dir", default=None)
    args = parser.parse_args()

    image_path = os.path.abspath(args.image)
    if not os.path.isfile(image_path):
        sys.stdout.write(json.dumps({"error": f"파일 없음: {image_path}"}, ensure_ascii=False))
        return 1

    model_dir = resolve_model_dir(args.model_dir)
    width, height = get_image_size(image_path)

    try:
        ocr = build_ocr(model_dir)
        lines = run_ocr(ocr, image_path)
        lines = sort_lines(lines)
        merged_rows = merge_lines_by_row(lines)
    except Exception as exc:
        sys.stdout.write(
            json.dumps({"error": str(exc)}, ensure_ascii=False)
        )
        return 1

    full_text = "\n".join(row["text"] for row in merged_rows) if merged_rows else "\n".join(
        line["text"] for line in lines
    )
    payload = {
        "fullText": full_text,
        "lines": lines,
        "mergedRows": merged_rows,
        "imageWidth": width,
        "imageHeight": height,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
