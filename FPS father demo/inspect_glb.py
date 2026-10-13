# Inspect a GLB: list materials, textures, images and which meshes use them
import json
import pathlib
import struct
import sys

GLB_PATH = pathlib.Path(r"d:\FPS web game demo\public\models\genshin\furina.glb")

data = GLB_PATH.read_bytes()
assert data[:4] == b"glTF", data[:4]
version, length = struct.unpack_from("<II", data, 4)
print(f"glTF version {version}, total {length} bytes")

offset = 12
json_chunk = None
bin_chunk = None
while offset < len(data):
    clen, ctype = struct.unpack_from("<II", data, offset)
    offset += 8
    chunk = data[offset:offset + clen]
    offset += clen
    if ctype == 0x4E4F534A:  # JSON
        json_chunk = chunk
    elif ctype == 0x0042494E:  # BIN
        bin_chunk = chunk

gltf = json.loads(json_chunk.decode("utf-8"))

print("\n== top-level keys ==")
print(sorted(gltf.keys()))

print(f"\nimages: {len(gltf.get('images', []))}")
for i, img in enumerate(gltf.get("images", [])):
    print(f"  [{i}] {img}")

print(f"\ntextures: {len(gltf.get('textures', []))}")
for i, tex in enumerate(gltf.get("textures", [])):
    print(f"  [{i}] {tex}")

print(f"\nmaterials: {len(gltf.get('materials', []))}")
for i, mat in enumerate(gltf.get("materials", [])):
    pbr = mat.get("pbrMetallicRoughness", {})
    print(f"  [{i}] name={mat.get('name')!r}")
    print(f"       pbr keys: {sorted(pbr.keys())}")
    print(f"       baseColorFactor={pbr.get('baseColorFactor')}")
    print(f"       baseColorTexture={pbr.get('baseColorTexture')}")
    print(f"       metallicRoughnessTexture={pbr.get('metallicRoughnessTexture')}")
    if "KHR_materials_specular" in mat.get("extensions", {}):
        print(f"       KHR_materials_specular: {mat['extensions']['KHR_materials_specular']}")
    other_ext = [k for k in mat.get("extensions", {})]
    if other_ext:
        print(f"       extensions: {other_ext}")
    if "normalTexture" in mat:
        print(f"       normalTexture: {mat['normalTexture']}")
    if "emissiveTexture" in mat:
        print(f"       emissiveTexture: {mat['emissiveTexture']}")

# map mesh primitives -> material names
print(f"\nmeshes: {len(gltf.get('meshes', []))}")
for mi, mesh in enumerate(gltf.get("meshes", [])):
    mats = []
    for prim in mesh.get("primitives", []):
        m = prim.get("material")
        name = gltf["materials"][m]["name"] if m is not None and "materials" in gltf else m
        mats.append(name)
    print(f"  [{mi}] {mesh.get('name')!r} -> materials {mats}")
