// 用 F5-TTS + 個人聲音 reference 批次合成故事朗讀
// 用法: node tools/generate-clone-tts.mjs [batchSize]
//      預設 batchSize = 10 (10 則跑一批)
// 跳過已有 personal voice 檔的故事 (data/audio/personal/{id}.{wav,mp3,webm})
// 完成後可選跑 compress 把 wav → webm 縮檔
// 依賴: pip install f5-tts (含 torch CUDA)

import { readFile, mkdir, stat, rename, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import ffmpegPkg from "@ffmpeg-installer/ffmpeg";

const FFMPEG = ffmpegPkg.path;
const BATCH = parseInt(process.argv[2] || "10", 10);
const REF_AUDIO = "voice-clone/An-reference.wav";
const REF_TEXT_FILE = "voice-clone/An-reference.txt";
const OUT_DIR = "data/audio/personal";
const MODEL = "F5TTS_v1_Base";

function bodyText(body) {
  if (Array.isArray(body)) return body.join("\n");
  return String(body || "");
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function runF5({ refAudio, refText, genText, outDir, outName }) {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "python",
      [
        "-m",
        "f5_tts.infer.infer_cli",
        "--model",
        MODEL,
        "--ref_audio",
        refAudio,
        "--ref_text",
        refText,
        "--gen_text",
        genText,
        "--output_dir",
        outDir,
        "--output_file",
        outName,
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.stdout.on("data", () => {}); // discard chatty stdout
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`F5-TTS exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

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

const refText = (await readFile(REF_TEXT_FILE, "utf-8")).trim();
const stories = JSON.parse(await readFile("data/stories.json", "utf-8"));
await mkdir(OUT_DIR, { recursive: true });

// 找出還沒生成的故事
const todo = [];
for (const s of stories) {
  const have =
    (await exists(`${OUT_DIR}/${s.id}.webm`)) ||
    (await exists(`${OUT_DIR}/${s.id}.mp3`)) ||
    (await exists(`${OUT_DIR}/${s.id}.wav`));
  if (have) continue;
  todo.push(s);
  if (todo.length >= BATCH) break;
}

console.log(`參考音: ${REF_AUDIO}`);
console.log(`參考文字: 「${refText}」`);
console.log(`本批要生成: ${todo.length} 則 (剩餘需處理: ${
  stories.length -
  (
    await Promise.all(
      stories.map(
        async (s) =>
          (await exists(`${OUT_DIR}/${s.id}.webm`)) ||
          (await exists(`${OUT_DIR}/${s.id}.mp3`)) ||
          (await exists(`${OUT_DIR}/${s.id}.wav`))
      )
    )
  ).filter(Boolean).length
})`);
console.log(`輸出目錄: ${OUT_DIR}/\n`);

if (todo.length === 0) {
  console.log("沒有要生成的故事，全部都已有 personal voice 檔。");
  process.exit(0);
}

let okCount = 0,
  failCount = 0;
const failed = [];
const t0 = Date.now();

for (let i = 0; i < todo.length; i++) {
  const s = todo[i];
  const text = [bodyText(s.body), s.afterword].filter(Boolean).join("\n");
  const tag = `[${String(i + 1).padStart(2, "0")}/${todo.length}]`;
  const outName = `${s.id}.wav`;
  const finalWebm = `${OUT_DIR}/${s.id}.webm`;
  const tmpWav = `${OUT_DIR}/${outName}`;
  process.stdout.write(`${tag} ${s.id} (${text.length}字)... `);
  const tStart = Date.now();
  try {
    await runF5({
      refAudio: REF_AUDIO,
      refText,
      genText: text,
      outDir: OUT_DIR,
      outName,
    });
    // 壓縮 wav → webm opus 32k
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      tmpWav,
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-ac",
      "1",
      finalWebm,
    ]);
    // 刪掉 wav (留 webm)
    await unlink(tmpWav).catch(() => {});
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);
    okCount++;
    console.log(`ok (${dt}s)`);
  } catch (e) {
    failCount++;
    failed.push({ id: s.id, error: e.message });
    console.log(`fail`);
    console.error(`  ${e.message.split("\n").pop()}`);
  }
}

const totalMin = ((Date.now() - t0) / 60000).toFixed(1);
console.log(`\n完成: ok=${okCount}, fail=${failCount}, 耗時=${totalMin}分鐘`);
if (failed.length) {
  console.log(`\n失敗:`);
  failed.forEach((f) => console.log(`  ${f.id}: ${f.error.slice(0, 120)}`));
}
