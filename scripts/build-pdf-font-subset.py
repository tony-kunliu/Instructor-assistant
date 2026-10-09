#!/usr/bin/env python3
"""Rebuilds public/fonts/NotoSansSC-Subset.otf, the compact font the CBT&A PDF export embeds.

DEV-ONLY tool (needs `pip install fonttools`; it is NOT an app dependency and never runs in
the app, tests or CI). Re-run only if the character set below changes; commit the output.

Why a static subset instead of letting pdf-lib/fontkit subset per document: fontkit's CFF
subsetter is broken for this font (it writes an invalid CFF header, and mangles local subrs, so
CJK glyphs vanish in PDFium and others while text extraction still looks fine). The subset built
here is DESUBROUTINIZED (no subrs), which is what makes fontkit's per-document subsetting safe;
lib/pdf-export.ts refuses to subset any font that still has subroutines, and repairs the CFF header.

Coverage: Basic Latin, Latin-1, Latin Extended-A, general punctuation, CJK symbols/punctuation,
fullwidth forms, a few arrows/shapes/ticks, and every hanzi of GB2312 (6763 simplified characters).
Licence: the subset is a Modified Version of Noto Sans SC (Adobe/Google, SIL Open Font License 1.1),
so it is distributed under the same OFL; the name table (copyright, licence, licence URL) is kept with
--name-IDs='*'. See public/fonts/NotoSansSC-LICENSE.txt.

Characters outside this set make lib/pdf-export.ts fall back to the full font
(public/fonts/NotoSansSC-Regular.otf, embedded whole as before), so nothing is ever dropped.
"""
import subprocess, sys, tempfile, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = root / "public/fonts/NotoSansSC-Regular.otf"
out = root / "public/fonts/NotoSansSC-Subset.otf"

hanzi = set()
for hi in range(0xB0, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            hanzi.add(bytes([hi, lo]).decode("gb2312"))
        except UnicodeDecodeError:
            pass
assert len(hanzi) == 6763, len(hanzi)

unicodes = ("U+0020-007E,U+00A0-00FF,U+0100-017F,U+2010-2027,U+2030-203A,U+20AC,U+2190-2193,"
            "U+2212,U+2022,U+3000-303F,U+FF00-FFEF,U+2460-2473,U+25A0-25CF,U+2713,U+2714")

with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as f:
    f.write("".join(sorted(hanzi)))
    text_file = f.name

subprocess.run([
    sys.executable, "-m", "fontTools.subset", str(src),
    f"--unicodes={unicodes}", f"--text-file={text_file}",
    "--layout-features=*",       # keep kern/locl/etc: layout (and thus advance widths) must match the full font
    "--glyph-names", "--notdef-outline",
    "--name-IDs=*",              # keep copyright, licence and licence-URL name records (OFL)
    "--desubroutinize",          # required: see module docstring
    f"--output-file={out}",
], check=True)
print(f"wrote {out} ({out.stat().st_size} bytes)")
