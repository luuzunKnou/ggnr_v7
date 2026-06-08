import argparse
import json
import os
import sys

import bpy
from mathutils import Matrix


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--input-manifest")
    parser.add_argument("--output", required=True)
    parser.add_argument("--shift-x", type=float, default=0.0)
    parser.add_argument("--shift-y", type=float, default=0.0)
    parser.add_argument("--shift-z", type=float, default=0.0)
    return parser.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)
    for block in bpy.data.images:
        bpy.data.images.remove(block)


def import_obj(input_path: str):
    before_names = {obj.name for obj in bpy.data.objects}
    if hasattr(bpy.ops.wm, "obj_import"):
        result = bpy.ops.wm.obj_import(filepath=input_path)
    else:
        result = bpy.ops.import_scene.obj(filepath=input_path)
    if "FINISHED" not in result:
        raise RuntimeError(f"OBJ import failed: {result}")
    return [obj for obj in bpy.data.objects if obj.name not in before_names]


def apply_shift(imported_objects, shift_x: float, shift_y: float, shift_z: float):
    if shift_x == 0.0 and shift_y == 0.0 and shift_z == 0.0:
        return
    targets = imported_objects or [obj for obj in bpy.data.objects if obj.type not in {"CAMERA", "LIGHT"}]
    translation = Matrix.Translation((-shift_x, -shift_y, -shift_z))
    for obj in targets:
        if obj.type == "MESH" and obj.data is not None:
            obj.data.transform(translation)
            obj.data.update()
        else:
            obj.location.x -= shift_x
            obj.location.y -= shift_y
            obj.location.z -= shift_z
    bpy.context.view_layer.update()


def clear_object_transforms(imported_objects):
    targets = imported_objects or [obj for obj in bpy.data.objects if obj.type not in {"CAMERA", "LIGHT"}]
    for obj in targets:
        obj.parent = None
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)
    bpy.context.view_layer.update()


def export_glb(output_path: str):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    result = bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_yup=False,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"GLB export failed: {result}")


def import_manifest_entries(entries):
    for entry in entries:
        input_path = os.path.abspath(entry["path"])
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"Input OBJ not found: {input_path}")
        imported_objects = import_obj(input_path)
        apply_shift(
            imported_objects,
            float(entry.get("shift_x", 0.0)),
            float(entry.get("shift_y", 0.0)),
            float(entry.get("shift_z", 0.0)),
        )
        clear_object_transforms(imported_objects)


def main():
    args = parse_args()
    output_path = os.path.abspath(args.output)
    clear_scene()
    if args.input_manifest:
        manifest_path = os.path.abspath(args.input_manifest)
        if not os.path.isfile(manifest_path):
            raise FileNotFoundError(f"Input manifest not found: {manifest_path}")
        with open(manifest_path, "r", encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        entries = manifest.get("inputs") or []
        if not entries:
            raise RuntimeError("Input manifest has no entries")
        import_manifest_entries(entries)
    else:
        if not args.input:
            raise RuntimeError("Either --input or --input-manifest is required")
        input_path = os.path.abspath(args.input)
        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"Input OBJ not found: {input_path}")
        imported_objects = import_obj(input_path)
        apply_shift(imported_objects, args.shift_x, args.shift_y, args.shift_z)
        clear_object_transforms(imported_objects)
    export_glb(output_path)
    print(f"RESULT:OK:{output_path}")


if __name__ == "__main__":
    main()
