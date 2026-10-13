import json
import pathlib
import struct
import zlib

GLB_PATH = pathlib.Path(r"d:\FPS web game demo\public\models\genshin\furina.glb")
OUT = pathlib.Path(r"d:\FPS web game demo\FPS father demo\furina_imgs")
OUT.mkdir(exist_ok=True)

data = GLB_PATH.read_bytes()
offset = 12
json_chunk = bin_chunk = None
while offset < len(data):
    clen, ctype = struct.unpack_from("<II", data, offset)
    offset += 8
    chunk = data[offset:offset + clen]
    offset += clen
    if ctype == 0x4E4F534A:
        json_chunk = chunk
    elif ctype == 0x004E4942:  # 'BIN\0'
        bin_chunk = chunk

g = json.loads(json_chunk.decode("utf-8"))
print("extensionsUsed:", g.get("extensionsUsed"))
print("extensionsRequired:", g.get("extensionsRequired"))

print("\n== nodes with meshes ==")
for i, n in enumerate(g.get("nodes", [])):
    if "mesh" in n:
        m = g["meshes"][n["mesh"]]
        prims = m.get("primitives", [])
        mats = []
        for pr in prims:
            mi = pr.get("material")
            tex = None
            if mi is not None:
                pbr = g["materials"][mi].get("pbrMetallicRoughness", {})
                bct = pbr.get("baseColorTexture", {}).get("index")
                if bct is not None:
                    tex = g["textures"][bct]["source"]
            mats.append(f"mat{mi}->img{tex}")
        print(f"  node[{i}] name={n.get('name')!r} mesh={n['mesh']}({m.get('name')!r}) {mats}")

print("\n== images detail ==")
for i, img in enumerate(g["images"]):
    bv = g["bufferViews"][img["bufferView"]]
    start = bv.get("byteOffset", 0)
    ln = bv["byteLength"]
    blob = bin_chunk[start:start + ln]
    sig = blob[:16]
    kind = "PNG" if blob[:8] == b"\x89PNG\r\n\x1a\n" else ("JPEG" if blob[:2] == b"\xff\xd8" else "??")
    w = h = ctype = bit = None
    if kind == "PNG":
        # IHDR
        w, h, bit, ctype = struct.unpack(">IIBB", blob[16:26])
    elif kind == "JPEG":
        pass
    print(f"  img[{i}] declMime={img.get('mimeType')} actual={kind} bytes={ln} dims={w}x{h} bit={bit} colortype={ctype} sig={sig[:8].hex()}")
    ext = ".png" if kind == "PNG" else ".jpg"
    (OUT / f"img{i}{ext}").write_bytes(blob)

print("\nextracted ->", OUT)
