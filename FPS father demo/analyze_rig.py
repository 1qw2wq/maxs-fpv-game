import pathlib

p = pathlib.Path(r"d:\FPS web game demo\public\js\rig.js")
raw = p.read_bytes()
print("size:", len(raw))

positions = [i for i, b in enumerate(raw) if b == 0]
print("NUL positions:", positions)

# group consecutive runs
runs = []
for pos in positions:
    if runs and pos == runs[-1][-1] + 1:
        runs[-1].append(pos)
    else:
        runs.append([pos])
print("NUL runs:", [(r[0], len(r)) for r in runs])

# context around each run
for start, length in [(r[0], len(r)) for r in runs]:
    s = max(0, start - 40)
    e = min(len(raw), start + length + 40)
    chunk = raw[s:e]
    print("---- run at", start, "len", length)
    print(repr(chunk))

# check if whole file is valid utf-16le (common corruption: saved as UTF-16)
try:
    t16 = raw.decode("utf-16")
    print("file decodes as UTF-16, length:", len(t16))
    print("preview:", repr(t16[:200]))
except UnicodeDecodeError as ex:
    print("not valid UTF-16:", ex)

# count non-zero ascii-ish structure
print("CR count:", raw.count(b"\r"), "LF count:", raw.count(b"\n"))
