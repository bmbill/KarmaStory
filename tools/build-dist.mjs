// 把要部署的檔案同步到 dist/, 之後上傳 dist/ 即可
// 用法: node tools/build-dist.mjs

import { readdir, mkdir, copyFile, stat, rm } from "node:fs/promises";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");

// 要同步的檔案 / 目錄 (相對 ROOT)
const ITEMS = [
  "index.html",
  "app.js",
  "sw.js",
  "manifest.json",
  "icons",
  "data/stories.json",
  "data/quotes.json",
  "data/kepan.json",
  "data/audio", // 全部 .webm
];

async function isDir(p) {
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}
async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function copyRecursive(src, dst) {
  if (await isDir(src)) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const e of entries) {
      await copyRecursive(join(src, e.name), join(dst, e.name));
    }
  } else {
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
  }
}

// 先清除 dist/data/audio 避免留下舊的 mp3 / 失效檔
const audioDist = join(DIST, "data/audio");
if (await exists(audioDist)) {
  await rm(audioDist, { recursive: true, force: true });
}

let count = 0;
for (const item of ITEMS) {
  const src = join(ROOT, item);
  const dst = join(DIST, item);
  if (!(await exists(src))) {
    console.warn(`略過 (不存在): ${item}`);
    continue;
  }
  // audio 目錄: 複製頂層 .webm，以及 personal/ 子目錄的 .webm
  if (item === "data/audio") {
    await mkdir(dst, { recursive: true });
    const files = (await readdir(src)).filter((f) => f.endsWith(".webm"));
    for (const f of files) {
      await copyFile(join(src, f), join(dst, f));
      count++;
    }
    let personalCount = 0;
    const personalSrc = join(src, "personal");
    if (await isDir(personalSrc)) {
      const pdst = join(dst, "personal");
      await mkdir(pdst, { recursive: true });
      const pfiles = (await readdir(personalSrc)).filter((f) => f.endsWith(".webm"));
      for (const f of pfiles) {
        await copyFile(join(personalSrc, f), join(pdst, f));
        count++;
        personalCount++;
      }
    }
    console.log(
      `同步 data/audio/ (${files.length} 個 .webm` +
        (personalCount ? ` + personal/ ${personalCount} 個` : "") +
        `)`
    );
    continue;
  }
  await copyRecursive(src, dst);
  console.log(`同步 ${item}`);
  count++;
}

// 統計大小
async function dirSize(p) {
  if (!(await isDir(p))) return (await stat(p)).size;
  const entries = await readdir(p, { withFileTypes: true });
  let n = 0;
  for (const e of entries) n += await dirSize(join(p, e.name));
  return n;
}
const sz = await dirSize(DIST);
console.log(`\n完成: ${count} 個項目, dist/ 共 ${(sz / 1024 / 1024).toFixed(1)}MB`);
