// 把 data/audio/*.mp3 重新編碼成 opus 24kbps webm (約 1/2 大小, 音質幾乎無差)
// 用法: node tools/compress-audio.mjs [--keep-mp3]
// 依賴: @ffmpeg-installer/ffmpeg (已安裝)

import { readdir, stat, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import ffmpegPkg from "@ffmpeg-installer/ffmpeg";

const FFMPEG = ffmpegPkg.path;
const AUDIO_DIR = "data/audio";
const KEEP_MP3 = process.argv.includes("--keep-mp3");

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`));
    });
  });
}

const entries = await readdir(AUDIO_DIR, { withFileTypes: true });
const mp3s = entries
  .filter((e) => e.isFile() && e.name.endsWith(".mp3"))
  .map((e) => e.name);

console.log(`待壓縮: ${mp3s.length} 個 mp3`);
console.log(`目標格式: opus 24kbps mono webm`);
console.log(`保留原 mp3: ${KEEP_MP3}\n`);

let okCount = 0, failCount = 0;
let beforeBytes = 0, afterBytes = 0;
const t0 = Date.now();

for (let i = 0; i < mp3s.length; i++) {
  const name = mp3s[i];
  const inPath = join(AUDIO_DIR, name);
  const outPath = inPath.replace(/\.mp3$/, ".webm");
  const tag = `[${String(i + 1).padStart(3, "0")}/${mp3s.length}]`;

  const inSize = (await stat(inPath)).size;
  beforeBytes += inSize;

  process.stdout.write(`${tag} ${name} (${(inSize / 1024).toFixed(0)}KB) ... `);
  try {
    await runFfmpeg([
      "-y",
      "-i", inPath,
      "-c:a", "libopus",
      "-b:a", "24k",
      "-vbr", "on",
      "-ac", "1",
      "-application", "voip",
      outPath,
    ]);
    const outSize = (await stat(outPath)).size;
    afterBytes += outSize;
    okCount++;
    process.stdout.write(`→ ${(outSize / 1024).toFixed(0)}KB (${((outSize / inSize) * 100).toFixed(0)}%)\n`);
    if (!KEEP_MP3) await unlink(inPath);
  } catch (e) {
    failCount++;
    process.stdout.write(`FAIL ${e.message}\n`);
  }
}

console.log(`\n===========================================`);
console.log(`完成: 成功 ${okCount}, 失敗 ${failCount}`);
console.log(`大小: ${(beforeBytes / 1024 / 1024).toFixed(1)}MB → ${(afterBytes / 1024 / 1024).toFixed(1)}MB`);
console.log(`壓縮比: ${((afterBytes / beforeBytes) * 100).toFixed(1)}%`);
console.log(`耗時: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (!KEEP_MP3) console.log(`原 mp3 已刪除 (要保留下次加 --keep-mp3)`);
