#!/usr/bin/env python3
"""Regenerates scripts/pdf-font-hanzi.txt, the hanzi list that build-pdf-font-subset.py subsets.

DEV-ONLY, run by hand when the list must change. Not part of the app, tests or CI.

Inputs (not committed; both are free and pinned):
  1. jieba 0.42.1 word list. Fetch it with:
       pip download --no-deps --no-binary :all: jieba==0.42.1 -d /tmp/jieba
       tar xzf /tmp/jieba/jieba-0.42.1.tar.gz -C /tmp/jieba
     then pass /tmp/jieba/jieba-0.42.1/jieba/dict.txt as the first argument.
  2. pip packages: fonttools, opencc-python-reimplemented.

Steps (all deterministic; running it reproduces the committed list byte for byte):
  a. Sum jieba word frequencies per CJK ideograph (U+4E00-U+9FFF).
  b. Keep the characters the Regular font has, most frequent first; take the top 8,105. This stands
     in for 通用规范汉字表 (8,105 characters). It is a frequency approximation: the official table
     was not available offline when this was built, so it is NOT the official list.
  c. Add every GB2312 hanzi (6,763).
  d. Add the 1,600 most common traditional variants of (b), via OpenCC s2t, so names such as 陳 and 鄭
     are covered. (The variants list has 2,233 entries; the cut keeps the budget at ~5.8 MB.)
Usage: build-pdf-font-hanzi-list.py <path/to/jieba/dict.txt>
"""
import collections
import pathlib
import sys

import opencc
from fontTools.ttLib import TTFont

root = pathlib.Path(__file__).resolve().parent.parent
font_path = root / "public/fonts/NotoSansSC-Regular.otf"
out_path = root / "scripts/pdf-font-hanzi.txt"
TOP_SIMPLIFIED = 8105
TRADITIONAL_VARIANTS = 1600

if len(sys.argv) != 2:
    sys.exit(__doc__)

freq = collections.Counter()
for line in open(sys.argv[1], encoding="utf-8"):
    parts = line.split()
    if len(parts) < 2:
        continue
    word, count = parts[0], int(parts[1])
    for ch in word:
        if "一" <= ch <= "鿿":
            freq[ch] += count

cmap = TTFont(font_path).getBestCmap()
ranked = [c for c, _ in freq.most_common() if ord(c) in cmap]
top = ranked[:TOP_SIMPLIFIED]

gb2312 = set()
for hi in range(0xB0, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            gb2312.add(bytes([hi, lo]).decode("gb2312"))
        except UnicodeDecodeError:
            pass

s2t = opencc.OpenCC("s2t")
trad = []
for c in top:
    t = s2t.convert(c)
    if len(t) == 1 and t != c and ord(t) in cmap and t not in trad:
        trad.append(t)

chars = set(top) | gb2312 | set(trad[:TRADITIONAL_VARIANTS])
out_path.write_text("".join(sorted(chars)) + "\n", encoding="utf-8")
print(f"wrote {out_path} ({len(chars)} characters)")
