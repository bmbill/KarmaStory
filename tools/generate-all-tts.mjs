// 批次生成所有故事的 mp3 (一次性, 之後新增故事再跑會略過已有的)
// 用法: node tools/generate-all-tts.mjs [voice]
// 預設音色: zh-CN-XiaoyiNeural (曉伊)
// 依賴: pip install --user edge-tts

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VOICE = process.argv[2] || "zh-CN-XiaoyiNeural";
const OUT_DIR = "data/audio";

function bodyText(body) {
  if (Array.isArray(body)) return body.join("\n");
  return String(body || "");
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

function pyTts({ text, voice, outFile }) {
  return new Promise(async (resolve, reject) => {
    const tmpFile = join(tmpdir(), `ks-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await writeFile(tmpFile, text, "utf-8");
    const p = spawn(
      "python",
      ["-m", "edge_tts", "--voice", voice, "--file", tmpFile, "--write-media", outFile],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`python exit ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

const stories = JSON.parse(await readFile("data/stories.json", "utf-8"));
await mkdir(OUT_DIR, { recursive: true });

console.log(`音色: ${VOICE}`);
console.log(`故事數: ${stories.length}`);
console.log(`輸出目錄: ${OUT_DIR}/\n`);

let okCount = 0, skipCount = 0, failCount = 0, totalBytes = 0;
const failed = [];
const t0 = Date.now();

for (let i = 0; i < stories.length; i++) {
  const s = stories[i];
  const out = `${OUT_DIR}/${s.id}.mp3`;
  const webmOut = `${OUT_DIR}/${s.id}.webm`;
  const tag = `[${String(i + 1).padStart(3, "0")}/${stories.length}]`;
  if (await exists(out) || await exists(webmOut)) {
    skipCount++;
    process.stdout.write(`${tag} ${s.id} skip (exists)\n`);
    continue;
  }
  const text = [bodyText(s.body), s.afterword].filter(Boolean).join("\n");
  if (!text.trim()) {
    process.stdout.write(`${tag} ${s.id} skip (empty text)\n`);
    skipCount++;
    continue;
  }
  process.stdout.write(`${tag} ${s.id} (${s.lengthChars}字) ... `);
  try {
    const ts = Date.now();
    await pyTts({ text, voice: VOICE, outFile: out });
    const sz = (await readFile(out)).length;
    totalBytes += sz;
    okCount++;
    process.stdout.write(`OK ${(sz / 1024).toFixed(0)}KB ${Date.now() - ts}ms\n`);
  } catch (e) {
    failCount++;
    failed.push(s.id);
    process.stdout.write(`FAIL ${e.message}\n`);
  }
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n===========================================`);
console.log(`完成: 成功 ${okCount}, 略過 ${skipCount}, 失敗 ${failCount}`);
console.log(`新增大小: ${(totalBytes / 1024 / 1024).toFixed(1)}MB`);
console.log(`耗時: ${elapsed}s`);
if (failed.length) {
  console.log(`失敗清單: ${failed.join(", ")}`);
  console.log(`再跑一次本腳本會自動補生失敗的部分`);
}
