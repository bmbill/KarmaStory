// 試聽腳本: 挑一篇故事, 用多種音色各生成一份 mp3 讓使用者比較
// 用法: node tools/sample-voices.mjs [storyId]
// 依賴: python -m edge_tts (pip install --user edge-tts)

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VOICES = [
  { id: "zh-TW-HsiaoChenNeural", label: "曉臻 (台灣女)" },
  { id: "zh-TW-HsiaoYuNeural", label: "曉雨 (台灣女)" },
  { id: "zh-TW-YunJheNeural", label: "雲哲 (台灣男)" },
  { id: "zh-CN-XiaoxiaoNeural", label: "曉曉 (普通話女)" },
  { id: "zh-CN-YunxiNeural", label: "雲希 (普通話男)" },
  { id: "zh-CN-XiaoyiNeural", label: "曉伊 (普通話女)" },
  { id: "zh-HK-HiuMaanNeural", label: "曉曼 (粵語女)" },
];

function bodyText(body) {
  if (Array.isArray(body)) return body.join("\n");
  return String(body || "");
}

// 把文字寫到暫存檔, 用 python -m edge_tts --file 讀, 避開 Windows cmd 的中文/特殊字元問題
function pyTts({ text, voice, outFile }) {
  return new Promise(async (resolve, reject) => {
    const tmpFile = join(tmpdir(), `ks-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await writeFile(tmpFile, text, "utf-8");
    const p = spawn("python", ["-m", "edge_tts", "--voice", voice, "--file", tmpFile, "--write-media", outFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`python exit ${code}: ${stderr.slice(0, 200)}`));
    });
  });
}

const wantId = process.argv[2] || "zbz-04-042";
const stories = JSON.parse(await readFile("data/stories.json", "utf-8"));
const story = stories.find((s) => s.id === wantId);
if (!story) {
  console.error(`找不到故事 id=${wantId}`);
  process.exit(1);
}

const text = [bodyText(story.body), story.afterword].filter(Boolean).join("\n");
const outDir = "data/audio/samples";
await mkdir(outDir, { recursive: true });

console.log(`\n[範本] ${story.title}  (${story.book}, ${story.lengthChars} 字)`);
console.log(`輸出目錄: ${outDir}\n`);

for (const v of VOICES) {
  process.stdout.write(`  ${v.label.padEnd(16, " ")} ... `);
  try {
    const t0 = Date.now();
    const fname = `${outDir}/${v.id}.mp3`;
    await pyTts({ text, voice: v.id, outFile: fname });
    const stat = await readFile(fname).then((b) => b.length);
    console.log(`OK ${(stat / 1024).toFixed(0)}KB ${Date.now() - t0}ms`);
  } catch (e) {
    console.log(`失敗: ${e.message}`);
  }
}

console.log(`\n聽完後告訴我喜歡哪個 voice id，我就用那個生成全部 147 篇。`);
