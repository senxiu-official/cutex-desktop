"""Regenerate the pinned CJK table; no font files or running app are accessed.

Unicode data: https://www.unicode.org/Public/17.0.0/ucd/
Copyright Unicode, Inc. https://www.unicode.org/license.txt
Use --ucd-dir with previously downloaded inputs for an offline regeneration.
"""
import argparse
import hashlib
from pathlib import Path
import urllib.request

VERSION = "17.0.0"
INPUTS = {
    "Scripts.txt": ("9f5e50d3abaee7d6ce09480f325c706f485ae3240912527e651954d2d6b035bf", {"Han", "Hiragana", "Katakana", "Hangul", "Bopomofo"}),
    "ScriptExtensions.txt": ("ec2107e58825a1586acee8e0911ce18260394ac8b87e535ca325f1ccbeb06bc6", {"Hani", "Hira", "Kana", "Hang", "Bopo"}),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ucd-dir", type=Path)
    args = parser.parse_args()
    points = set()
    for name, (digest, scripts) in INPUTS.items():
        data = (args.ucd_dir / name).read_bytes() if args.ucd_dir else urllib.request.urlopen(
            f"https://www.unicode.org/Public/{VERSION}/ucd/{name}", timeout=30
        ).read()
        if hashlib.sha256(data).hexdigest() != digest:
            raise ValueError(f"Unexpected Unicode {VERSION} input: {name}")
        for line in data.decode("utf-8").splitlines():
            line = line.split("#")[0].strip()
            if not line:
                continue
            interval, values = map(str.strip, line.split(";"))
            codes = set(values.split())
            if not codes.intersection(scripts) or "Latn" in codes:
                continue
            lo, _, hi = interval.partition("..")
            points.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    for lo, hi in [(0x3000, 0x303F), (0xFE10, 0xFE1F), (0xFE30, 0xFE4F), (0xFF01, 0xFF60), (0xFFE0, 0xFFE6)]:
        points.update(range(lo, hi + 1))
    ranges = []
    for cp in sorted(points):
        if ranges and ranges[-1][1] + 1 == cp:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    table = "export const CJK_RANGES: readonly CodePointRange[] = [\n"
    table += "".join(f"  [0x{lo:X}, 0x{hi:X}],\n" for lo, hi in ranges) + "];\n"
    path = Path(__file__).resolve().parents[1] / "apps/desktop/src/renderer/src/lib/fontRanges.ts"
    text = path.read_text(encoding="utf-8")
    before, rest = text.split("// BEGIN GENERATED CJK RANGES\n", 1)
    _, after = rest.split("// END GENERATED CJK RANGES", 1)
    path.write_text(before + "// BEGIN GENERATED CJK RANGES\n" + table + "// END GENERATED CJK RANGES" + after, encoding="utf-8", newline="\n")
    print(f"Generated {len(ranges)} Unicode {VERSION} ranges")


if __name__ == "__main__":
    main()
