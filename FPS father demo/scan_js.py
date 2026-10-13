# Temporary diagnostic: scan JS files for encoding / illegal-char issues
import pathlib

root = pathlib.Path(r"d:\FPS web game demo\public")
bad_chars = [
    (0x2028, "U+2028 LINE SEPARATOR"),
    (0x2029, "U+2029 PARA SEPARATOR"),
    (0x200B, "U+200B ZERO WIDTH SPACE"),
    (0x200C, "U+200C ZWNJ"),
    (0x200D, "U+200D ZWJ"),
    (0xFEFF, "U+FEFF BOM/ZWNBSP"),
    (0xA0, "U+00A0 NO-BREAK SPACE"),
    (0x3000, "U+3000 IDEOGRAPHIC SPACE"),
]

for p in sorted(root.rglob("*.js")):
    raw = p.read_bytes()
    issues = []
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        issues.append("UTF-16 BOM")
    if b"\x00" in raw:
        issues.append("NUL bytes x%d" % raw.count(b"\x00"))
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        print(f"{p.relative_to(root)}: UTF-8 decode error: {e}")
        continue
    if text.startswith(chr(0xFEFF)):
        issues.append("starts with BOM (harmless)")
    for cp, name in bad_chars:
        c = text.count(chr(cp))
        if cp == 0xFEFF and text.startswith(chr(0xFEFF)):
            c -= 1
        if c:
            issues.append(f"{name} x{c}")
    if issues:
        print(f"{p.relative_to(root)}: {'; '.join(issues)}")
print("scan done")
