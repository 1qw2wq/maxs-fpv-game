import json, struct, pathlib

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

CTYPE = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}
print("samplers:", json.dumps(g.get("samplers"), indent=1))

for mi, mesh in enumerate(g["meshes"]):
    for pi, pr in enumerate(mesh["primitives"]):
        attrs = pr.get("attributes", {})
        info = {}
        for an, ai in attrs.items():
            acc = g["accessors"][ai]
            info[an] = f"acc{ai}:{acc['type']}{acc.get('componentType')} n={acc['count']}"
        ii = pr.get("indices")
        idxinfo = ""
        if ii is not None:
            acc = g["accessors"][ii]
            idxinfo = f"indices=acc{ii}:{CTYPE.get(acc['componentType'])} n={acc['count']}"
        print(f"mesh{mi}({mesh['name']}) prim{pi}: mode={pr.get('mode',4)} mat={pr.get('material')} {idxinfo}")
        for k, v in info.items():
            print(f"    {k}: {v}")
        if "extras" in pr: print("    extras:", pr["extras"])
    if "extras" in mesh: print("  mesh extras:", mesh["extras"])

# skins: which skeleton each node uses; hair node 249 vs others
print("\nskins:", len(g.get("skins", [])))
for i, s in enumerate(g.get("skins", [])):
    print(f"  skin[{i}] joints={len(s['joints'])} skeletonRoot={s.get('skeleton')}")

for i, n in enumerate(g["nodes"]):
    if "mesh" in n or "skin" in n:
        print(f"node {i} {n.get('name')}: mesh={n.get('mesh')} skin={n.get('skin')}")
