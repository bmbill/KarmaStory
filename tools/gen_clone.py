# -*- coding: utf-8 -*-
# 個人聲音朗讀生成（模型只載入一次，逐句小段生成避免 F5-TTS 長文本參考音洩漏）
# 用法:
#   python tools/gen_clone.py --ref voice-clone/An-reference.wav \
#       --ref-text-file voice-clone/An-reference.txt \
#       --out-dir data/audio/personal --ids zby-01-001 --max-chars 60
#   或 --batch 10 自動挑還沒生成的前 N 篇
import sys, os, io, json, re, argparse, subprocess

# 讓 stdout 用 utf-8，避免 Windows 主控台編碼問題
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import numpy as np
import soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("--ref", required=True)
ap.add_argument("--ref-text-file", required=True)
ap.add_argument("--stories", default="data/stories.json")
ap.add_argument("--out-dir", default="data/audio/personal")
ap.add_argument("--ids", default="")           # 逗號分隔，指定要生成的 id
ap.add_argument("--batch", type=int, default=0)  # 自動挑前 N 篇還沒生成的
ap.add_argument("--max-chars", type=int, default=60)
ap.add_argument("--ffmpeg", default="")         # ffmpeg 路徑（轉 webm 用；空則只留 wav）
ap.add_argument("--model", default="F5TTS_v1_Base")
args = ap.parse_args()


def split_chunks(text, max_chars):
    # 先按「句末標點」切，保留標點
    parts = re.split(r"(?<=[。！？；!?\n])", text)
    parts = [p.strip() for p in parts if p and p.strip()]
    chunks, cur = [], ""
    for p in parts:
        # 單句就超長 → 再按逗頓號切
        if len(p) > max_chars:
            if cur:
                chunks.append(cur); cur = ""
            sub = re.split(r"(?<=[，、,])", p)
            c2 = ""
            for x in sub:
                if len(c2) + len(x) <= max_chars:
                    c2 += x
                else:
                    if c2:
                        chunks.append(c2)
                    c2 = x
            if c2:
                cur = c2
            continue
        if len(cur) + len(p) <= max_chars:
            cur += p
        else:
            if cur:
                chunks.append(cur)
            cur = p
    if cur:
        chunks.append(cur)
    return chunks


def trim_silence(wav, sr, thresh=0.012, pad=0.04):
    idx = np.where(np.abs(wav) > thresh)[0]
    if len(idx) == 0:
        return wav
    a = max(0, idx[0] - int(pad * sr))
    b = min(len(wav), idx[-1] + int(pad * sr))
    return wav[a:b]


def body_text(s):
    b = s.get("body", "")
    if isinstance(b, list):
        b = "\n".join(b)
    parts = [b]
    if s.get("afterword"):
        parts.append(s["afterword"])
    return "\n".join([p for p in parts if p])


ref_text = open(args.ref_text_file, encoding="utf-8").read().strip()
stories = json.load(open(args.stories, encoding="utf-8"))
os.makedirs(args.out_dir, exist_ok=True)


def already(sid):
    for ext in (".webm", ".wav", ".mp3"):
        if os.path.exists(os.path.join(args.out_dir, sid + ext)):
            return True
    return False


if args.ids:
    want = args.ids.split(",")
    todo = [s for s in stories if s["id"] in want]
else:
    todo = []
    for s in stories:
        if already(s["id"]):
            continue
        todo.append(s)
        if args.batch and len(todo) >= args.batch:
            break

print(f"參考音: {args.ref}")
print(f"參考文字: 「{ref_text}」")
print(f"本批要生成: {len(todo)} 則, 每段上限 {args.max_chars} 字")
sys.stdout.flush()

if not todo:
    print("沒有要生成的故事。")
    sys.exit(0)

# 載入模型（只一次）
print("載入 F5-TTS 模型中…")
sys.stdout.flush()
from f5_tts.api import F5TTS
f5 = F5TTS(model=args.model)
print("模型就緒。\n")
sys.stdout.flush()

import time
ok = fail = 0
for i, s in enumerate(todo, 1):
    sid = s["id"]
    text = body_text(s)
    chunks = split_chunks(text, args.max_chars)
    t0 = time.time()
    print(f"[{i:02d}/{len(todo)}] {sid} ({len(text)}字 / {len(chunks)}段)… ", end="")
    sys.stdout.flush()
    try:
        pieces, sr = [], None
        for ch in chunks:
            wav, sr, _ = f5.infer(
                args.ref, ref_text, ch,
                show_info=lambda *a, **k: None,
                nfe_step=32, cfg_strength=2, speed=1.0,
            )
            wav = trim_silence(np.asarray(wav, dtype=np.float32), sr)
            pieces.append(wav)
            pieces.append(np.zeros(int(sr * 0.14), dtype=np.float32))  # 句間停頓
        full = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
        wav_path = os.path.join(args.out_dir, sid + ".wav")
        sf.write(wav_path, full, sr)
        if args.ffmpeg:
            webm_path = os.path.join(args.out_dir, sid + ".webm")
            subprocess.run(
                [args.ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                 "-i", wav_path, "-c:a", "libopus", "-b:a", "32k", "-ac", "1", webm_path],
                check=True,
            )
            os.remove(wav_path)
        ok += 1
        print(f"ok ({time.time()-t0:.1f}s)")
    except Exception as e:
        fail += 1
        print(f"fail: {repr(e)[:200]}")
    sys.stdout.flush()

print(f"\n完成: ok={ok}, fail={fail}")
