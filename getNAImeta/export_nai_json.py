#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_nai_json.py
──────────────────
各 PNG から内部メタ JSON をそのまま取得して
<フォルダ>/nai_raw_json.tsv に保存する。

列は
    filename    meta_json
の 2 つだけ。区切りはタブ。

使い方:
    python3 export_nai_json.py               # カレントフォルダを走査
    python3 export_nai_json.py /path/to/imgs # フォルダを明示
"""

import json, csv, sys, pathlib, shutil
from subprocess import run, PIPE

# ---------- 1. 対象フォルダ ----------
folder = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "./images").expanduser()
if not folder.is_dir():
    sys.exit(f"❌ フォルダが見つかりません: {folder}")

# ---------- 2. PNG ファイル列挙 ----------
pngs = sorted(folder.glob("*.png"))
if not pngs:
    sys.exit("❌ .png ファイルが見当たりません")

# ---------- 3. ExifTool 呼び出し ----------
exiftool = shutil.which("exiftool")
if not exiftool:
    sys.exit("❌ exiftool が未インストールです。Homebrew なら `brew install exiftool`")

print(f"⏳ {len(pngs)} 枚から Comment/Description を抽出中…")
cmd = [exiftool, "-j", "-u", "-n"] + [str(p) for p in pngs]
proc = run(cmd, stdout=PIPE, stderr=PIPE, text=True)
if proc.returncode != 0:
    print(proc.stderr)
    sys.exit("❌ ExifTool 実行エラー")

outer_json = json.loads(proc.stdout)

# ---------- 4. 行データ作成 ----------
rows = []
for item in outer_json:
    fname = pathlib.Path(item["SourceFile"]).name
    inner_text = item.get("Comment") or item.get("Description") or ""
    # 文字列が JSON か判定（改行をそのまま保持）
    try:
        _ = json.loads(inner_text)
    except json.JSONDecodeError:
        # Discord で削除されている等で JSON でない場合はスキップ
        print(f"⚠️  {fname}: 内部 JSON が見つかりません")
        inner_text = ""
    rows.append([fname, inner_text])

print(f"✅  抽出完了: {len(rows)} 件")

# ---------- 5. TSV 書き出し ----------
tsv_path = folder / "nai_raw_json.tsv"
with tsv_path.open("w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, delimiter="\t", quoting=csv.QUOTE_MINIMAL)
    writer.writerow(["filename", "meta_json"])
    writer.writerows(rows)

print(f"🎉  {tsv_path} を作成しました（タブ区切り）")
