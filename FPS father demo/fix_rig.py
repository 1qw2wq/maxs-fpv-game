import pathlib
import shutil

src = pathlib.Path(r"d:\FPS web game demo\public\js\rig.js")
bak = pathlib.Path(r"d:\FPS web game demo\FPS father demo\rig.js.bak")

raw = src.read_bytes()
assert raw.count(b"\x00") == 31, "unexpected NUL count"
shutil.copy2(src, bak)

# strip trailing NUL padding
clean = raw.rstrip(b"\x00")
assert clean.endswith(b"};"), repr(clean[-10:])
src.write_bytes(clean + b"\n")

print("backup ->", bak)
print("fixed size:", len(raw), "->", len(clean) + 1)
print("remaining NUL:", src.read_bytes().count(b"\x00"))
