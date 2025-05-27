#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json, csv, sys, pathlib, shutil, re
from subprocess import run, PIPE
import gzip
from typing import Union

try:
    from PIL import Image
    import numpy as np

    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("⚠️  PIL/numpy not available. Alpha channel extraction will be skipped.")
    print("   Install with: pip install Pillow numpy")

# UUID pattern for NovelAI images
uuid_pat = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
    r"[0-9a-f]{4}-[0-9a-f]{12}\.png$",
    re.I,
)


def byteize(alpha):
    """Convert alpha channel to bytes (from NovelAI official code)"""
    alpha = alpha.T.reshape((-1,))
    alpha = alpha[: (alpha.shape[0] // 8) * 8]
    alpha = np.bitwise_and(alpha, 1)
    alpha = alpha.reshape((-1, 8))
    alpha = np.packbits(alpha, axis=1)
    return alpha


class LSBExtractor:
    """LSB (Least Significant Bit) extractor for alpha channel (from NovelAI official code)"""

    def __init__(self, data):
        self.data = byteize(data[..., -1])
        self.pos = 0

    def get_one_byte(self):
        byte = self.data[self.pos]
        self.pos += 1
        return byte

    def get_next_n_bytes(self, n):
        n_bytes = self.data[self.pos : self.pos + n]
        self.pos += n
        return bytearray(n_bytes)

    def read_32bit_integer(self):
        bytes_list = self.get_next_n_bytes(4)
        if len(bytes_list) == 4:
            integer_value = int.from_bytes(bytes_list, byteorder="big")
            return integer_value
        else:
            return None


def extract_from_alpha_channel(image_path: pathlib.Path) -> dict | None:
    """Extract metadata from alpha channel using NovelAI's stealth method"""
    if not PIL_AVAILABLE:
        return None

    try:
        image = Image.open(image_path).convert("RGBA")
        image_array = np.array(image)

        if image_array.shape[-1] != 4 or len(image_array.shape) != 3:
            return None

        reader = LSBExtractor(image_array)
        magic = "stealth_pngcomp"

        try:
            read_magic = reader.get_next_n_bytes(len(magic)).decode("utf-8")
        except:
            return None

        if magic != read_magic:
            return None

        read_len = reader.read_32bit_integer()
        if read_len is None:
            return None

        read_len = read_len // 8
        json_data = reader.get_next_n_bytes(read_len)

        try:
            json_data = json.loads(gzip.decompress(json_data).decode("utf-8"))
        except:
            return None

        # Handle nested Comment JSON
        if "Comment" in json_data and isinstance(json_data["Comment"], str):
            try:
                json_data["Comment"] = json.loads(json_data["Comment"])
            except:
                pass

        return json_data

    except Exception as e:
        print(f"⚠️  Alpha channel extraction failed for {image_path.name}: {e}")
        return None


# デフォルトでimagesフォルダを対象に
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
alpha_attempts = 0
alpha_successes = 0


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
    extraction_method = "exiftool"

    # --- 内側 JSON を取得（3 段フォールバック）
    inner_txt = first(o.get("Comment"), o.get("Description"), o.get("Parameters"))
    try:
        inner = json.loads(inner_txt) if inner_txt else {}
    except json.JSONDecodeError:
        inner = {}
        misses.append(fn)  # ログ用

    # 基本列
    base_prompt = first(
        inner.get("v4_prompt", {}).get("caption", {}).get("base_caption"),
        inner.get("prompt"),
    )
    uc_prompt = first(
        inner.get("uc"),
        inner.get("v4_negative_prompt", {}).get("caption", {}).get("base_caption"),
    )

    # ExifTool で base_prompt が取れなかったらアルファチャンネル抽出を試行
    if (not base_prompt and not uc_prompt) and uuid_pat.match(fn) and PIL_AVAILABLE:
        print(f"⏳ Trying alpha channel extraction for {fn}...")
        alpha_attempts += 1
        alpha_data = extract_from_alpha_channel(folder / fn)
        if alpha_data:
            # Comment フィールドを優先的に使用
            if "Comment" in alpha_data:
                inner = alpha_data["Comment"]
            else:
                inner = alpha_data

            base_prompt = first(
                inner.get("v4_prompt", {}).get("caption", {}).get("base_caption"),
                inner.get("prompt"),
            )
            uc_prompt = first(
                inner.get("uc"),
                inner.get("v4_negative_prompt", {})
                .get("caption", {})
                .get("base_caption"),
            )
            extraction_method = "alpha_channel"
            alpha_successes += 1
            print(f"✅ Alpha channel extraction successful for {fn}")
        else:
            print(f"❌ Alpha channel extraction failed for {fn}")

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
        "base_prompt": base_prompt,
        "UC": uc_prompt,
        "extraction_method": extraction_method,
    }

    # キャラ配列（あれば）
    pos = inner.get("v4_prompt", {}).get("caption", {}).get("char_captions", [])
    neg = (
        inner.get("v4_negative_prompt", {}).get("caption", {}).get("char_captions", [])
    )

    for i in range(6):
        char_prompt = first(pos[i]["char_caption"] if i < len(pos) else "")
        char_uc = first(neg[i]["char_caption"] if i < len(neg) else "")

        row[f"char{i + 1}_prompt"] = char_prompt
        row[f"char{i + 1}_UC"] = char_uc

    rows.append(row)

# --- CSV 出力
out = folder.parent / "nai_meta.csv"  # ルートディレクトリに保存
fields = [
    "filename",
    "image_w",
    "image_h",
    "model",
    "base_prompt",
    "UC",
    "extraction_method",
] + sum([[f"char{i}_prompt", f"char{i}_UC"] for i in range(1, 7)], [])
with out.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)

print(f"🎉  {len(rows)} images → {out}")
if alpha_attempts > 0:
    print(f"🔍  アルファチャンネル抽出: {alpha_successes}/{alpha_attempts} 件成功")
if misses:
    print("⚠️  JSON parse failed on:", ", ".join(misses[:5]), "…")
