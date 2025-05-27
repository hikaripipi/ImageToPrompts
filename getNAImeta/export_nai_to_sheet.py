#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json, csv, sys, pathlib, shutil
from subprocess import run, PIPE

folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "./images").expanduser()
pngs = sorted(folder.glob("*.png"))
if not pngs:
    sys.exit("❌ No .png files")

exiftool = shutil.which("exiftool")
if not exiftool:
    sys.exit("❌ exiftool not found")

cmd = [exiftool, "-j", "-u", "-n"] + [str(p) for p in pngs]
proc = run(cmd, stdout=PIPE, stderr=PIPE, text=True)
if proc.returncode:
    print(proc.stderr)
    sys.exit("❌ ExifTool error")

outer_all = json.loads(proc.stdout)
rows, misses = [], []


def first(*values):
    """最初に真値になるものを返す"""
    for v in values:
        if isinstance(v, str):
            v = v.strip()
        if v not in ("", None, []):
            return v
    return ""


for o in outer_all:
    fn = pathlib.Path(o["SourceFile"]).name
    # --- 内側 JSON を取得（3 段フォールバック）
    inner_txt = first(o.get("Comment"), o.get("Description"), o.get("Parameters"))
    try:
        inner = json.loads(inner_txt) if inner_txt else {}
    except json.JSONDecodeError:
        inner = {}
        misses.append(fn)  # ログ用

    # 基本列
    row = {
        "filename": fn,
        "image_w": first(inner.get("width"), o.get("ImageWidth")),
        "image_h": first(inner.get("height"), o.get("ImageHeight")),
        "model": first(
            o.get("Source"),
            o.get("Software"),
            inner.get("model"),
            inner.get("sampler"),
            f"v{inner.get('version')}" if inner.get("version") else "",
        ),
        "base_prompt": first(
            inner.get("v4_prompt", {}).get("caption", {}).get("base_caption"),
            inner.get("prompt"),
        ),
        "UC": first(
            inner.get("uc"),
            inner.get("v4_negative_prompt", {}).get("caption", {}).get("base_caption"),
        ),
    }

    # キャラ配列（あれば）
    pos = inner.get("v4_prompt", {}).get("caption", {}).get("char_captions", [])
    neg = (
        inner.get("v4_negative_prompt", {}).get("caption", {}).get("char_captions", [])
    )
    for i in range(6):
        row[f"char{i + 1}_prompt"] = first(
            pos[i]["char_caption"] if i < len(pos) else ""
        )
        row[f"char{i + 1}_UC"] = first(neg[i]["char_caption"] if i < len(neg) else "")
    rows.append(row)

# --- CSV 出力
out = folder / "nai_meta.csv"
fields = ["filename", "image_w", "image_h", "model", "base_prompt", "UC"] + sum(
    [[f"char{i}_prompt", f"char{i}_UC"] for i in range(1, 7)], []
)
with out.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)

print(f"🎉  {len(rows)} images → {out}")
if misses:
    print("⚠️  JSON parse failed on:", ", ".join(misses[:5]), "…")
