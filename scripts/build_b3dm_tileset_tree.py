#!/usr/bin/env python3
"""
Rebuild a flat B3DM tileset.json into a spatial hierarchy.

Input:  {dataset}/tileset.json with root.children[] = one leaf per .b3dm
Output: same path (backs up to tileset.flat.json first)

B3DM files are not modified.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path
from typing import Any

DEFAULT_MAX_LEAF = 128
DEFAULT_MIN_SPLIT = 16


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert flat B3DM tileset.json into a spatial tree."
    )
    parser.add_argument(
        "tileset",
        type=Path,
        help="Path to tileset.json (e.g. .../3dtiles_b3dm/OBJ/tileset.json)",
    )
    parser.add_argument(
        "--max-leaf",
        type=int,
        default=DEFAULT_MAX_LEAF,
        help=f"Max buildings per leaf group (default: {DEFAULT_MAX_LEAF})",
    )
    parser.add_argument(
        "--min-split",
        type=int,
        default=DEFAULT_MIN_SPLIT,
        help=f"Do not split groups smaller than this (default: {DEFAULT_MIN_SPLIT})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Analyze only; do not write tileset.json",
    )
    return parser.parse_args()


def ecef_from_transform(transform: list[float]) -> tuple[float, float, float]:
    return transform[12], transform[13], transform[14]


def world_sphere(tile: dict[str, Any]) -> tuple[float, float, float, float]:
    transform = tile["transform"]
    cx, cy, cz = ecef_from_transform(transform)
    sphere = tile["boundingVolume"]["sphere"]
    radius = max(float(sphere[3]), 1.0)
    return cx, cy, cz, radius


def merge_spheres(
    spheres: list[tuple[float, float, float, float]],
) -> tuple[float, float, float, float]:
    min_x = min(x - r for x, _, _, r in spheres)
    max_x = max(x + r for x, _, _, r in spheres)
    min_y = min(y - r for _, y, _, r in spheres)
    max_y = max(y + r for _, y, _, r in spheres)
    min_z = min(z - r for _, _, z, r in spheres)
    max_z = max(z + r for _, _, z, r in spheres)

    cx = (min_x + max_x) / 2
    cy = (min_y + max_y) / 2
    cz = (min_z + max_z) / 2
    corners = (
        (min_x, min_y, min_z),
        (min_x, min_y, max_z),
        (min_x, max_y, min_z),
        (min_x, max_y, max_z),
        (max_x, min_y, min_z),
        (max_x, min_y, max_z),
        (max_x, max_y, min_z),
        (max_x, max_y, max_z),
    )
    radius = max(math.dist((cx, cy, cz), corner) for corner in corners)
    return cx, cy, cz, max(radius, 1.0)


def leaf_node(tile: dict[str, Any]) -> dict[str, Any]:
    return {
        "boundingVolume": tile["boundingVolume"],
        "geometricError": 0,
        "transform": tile["transform"],
        "content": tile["content"],
    }


def split_tiles(
    tiles: list[dict[str, Any]],
    spheres: list[tuple[float, float, float, float]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    min_x = min(s[0] for s in spheres)
    max_x = max(s[0] for s in spheres)
    min_y = min(s[1] for s in spheres)
    max_y = max(s[1] for s in spheres)
    span_x = max_x - min_x
    span_y = max_y - min_y
    axis = 0 if span_x >= span_y else 1

    indexed = sorted(range(len(tiles)), key=lambda i: spheres[i][axis])
    mid = len(indexed) // 2
    if mid <= 0 or mid >= len(indexed):
        mid = max(1, len(indexed) // 2)

    left = [tiles[i] for i in indexed[:mid]]
    right = [tiles[i] for i in indexed[mid:]]
    return left, right


def build_node(
    tiles: list[dict[str, Any]],
    max_leaf: int,
    min_split: int,
) -> dict[str, Any]:
    spheres = [world_sphere(tile) for tile in tiles]
    cx, cy, cz, radius = merge_spheres(spheres)
    geometric_error = max(radius * 2, 1.0)

    if len(tiles) == 1:
        return leaf_node(tiles[0])

    if len(tiles) <= max_leaf or len(tiles) <= min_split:
        return {
            "boundingVolume": {"sphere": [cx, cy, cz, radius]},
            "geometricError": geometric_error,
            "refine": "ADD",
            "children": [leaf_node(tile) for tile in tiles],
        }

    left, right = split_tiles(tiles, spheres)
    return {
        "boundingVolume": {"sphere": [cx, cy, cz, radius]},
        "geometricError": geometric_error,
        "refine": "ADD",
        "children": [
            build_node(left, max_leaf, min_split),
            build_node(right, max_leaf, min_split),
        ],
    }


def count_nodes(node: dict[str, Any]) -> tuple[int, int, int]:
    """Return (internal_count, leaf_count, max_depth)."""
    content = node.get("content")
    children = node.get("children") or []

    if content and not children:
        return 0, 1, 1

    internal = 1
    leaves = 0
    depth = 1
    for child in children:
        child_internal, child_leaves, child_depth = count_nodes(child)
        internal += child_internal
        leaves += child_leaves
        depth = max(depth, 1 + child_depth)
    return internal, leaves, depth


def main() -> int:
    args = parse_args()
    tileset_path = args.tileset.resolve()

    if not tileset_path.is_file():
        print(f"File not found: {tileset_path}", file=sys.stderr)
        return 1

    print(f"Reading {tileset_path} ...")
    data = json.loads(tileset_path.read_text(encoding="utf-8"))
    root = data.get("root") or {}
    leaves = root.get("children") or []

    if not leaves:
        print("No root.children found; nothing to do.", file=sys.stderr)
        return 1

    if any("content" not in leaf for leaf in leaves):
        print("Expected flat leaf tiles with content.uri", file=sys.stderr)
        return 1

    print(f"Leaves: {len(leaves):,}")
    tree_root = build_node(leaves, args.max_leaf, args.min_split)
    internal, leaf_count, max_depth = count_nodes(tree_root)
    root_ge = float(data.get("geometricError") or tree_root.get("geometricError") or 1)

    print(f"Tree: internal={internal:,}, leaves={leaf_count:,}, max_depth={max_depth}")
    print(f"Root geometricError: {root_ge:.3f}")

    if args.dry_run:
        print("Dry run complete.")
        return 0

    backup_path = tileset_path.with_name("tileset.flat.json")
    if not backup_path.exists():
        shutil.copy2(tileset_path, backup_path)
        print(f"Backup -> {backup_path}")
    else:
        print(f"Backup already exists: {backup_path}")

    result = {
        "asset": data.get("asset", {"version": "1.0", "gltfUpAxis": "Z"}),
        "geometricError": root_ge,
        "root": tree_root,
    }

    tmp_path = tileset_path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
    tmp_path.replace(tileset_path)
    print(f"Wrote hierarchical tileset -> {tileset_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
