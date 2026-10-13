import json, pathlib, struct

GLB_PATH = pathlib.Path(r"d:\FPS web game demo\public\models\genshin\furina.glb")
data = GLB_PATH.read_bytes()
off = 12
j = b = None
while off < len(data):
    ln, ct = struct.unpack_from("<II", data, off); off += 8
    chunk = data[off:off+ln]; off += ln
    if ct == 0x4E4F534A: j = chunk
    elif ct == 0x004E4942: b = chunk
g = json.loads(j.decode())

for i, img in enumerate(g["images"]):
    bv = g["bufferViews"][img["bufferView"]]
    s = bv.get("byteOffset", 0)
    blob = b[s:s+bv["byteLength"]]
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"
    # IHDR
    w, h, bit, ctype, comp, filt, interlace = struct.unpack(">IIBBBBB", blob[16:29])
    chunks = []
    p = 8
    while p < len(blob):
        ln2 = struct.unpack(">I", blob[p:p+4])[0]
        typ = blob[p+4:p+8].decode("latin1")
        chunks.append((typ, ln2))
        p += 12 + ln2
    names = [c[0] for c in chunks]
    idat = sum(n for t, n in chunks if t == "IDAT")
    print(f"img{i} bytes={len(blob)} {w}x{h} bit={bit} ct={ctype} interlace={interlace} "
          f"chunks={names} IDATtotal={idat}")
