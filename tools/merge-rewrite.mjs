// 把 data/PWA/stories_array.json (使用者重寫的 121 篇雜寶藏經) 合併進 data/stories.json
//
// 對應關係：
//   新檔欄位            → 系統欄位
//   index               → no
//   volume              → volume
//   title               → title
//   summary             → summary (已是鉤子品質，同時餵給 hook 顯示)
//   body (array)        → body (保留陣列，app.js 已更新支援)
//   reflection          → afterword
//
// 雜譬喻經 12 篇從現有 stories.json 保留，未動。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NEW_ZBZ = join(ROOT, "data/PWA/stories_array.json");
const STORIES = join(ROOT, "data/stories.json");

const newZbz = JSON.parse(readFileSync(NEW_ZBZ, "utf-8"));
const existing = JSON.parse(readFileSync(STORIES, "utf-8"));

// 保留 zby (雜譬喻經) 12 篇
const zby = existing.filter((s) => s.id.startsWith("zby-"));
console.log(`保留雜譬喻經 ${zby.length} 篇`);

// 為了沿用既有閱讀進度，建立舊 zbz id 的索引以便回查
const oldZbzById = new Map(
  existing.filter((s) => s.id.startsWith("zbz-")).map((s) => [s.id, s])
);

const merged = [];
for (const s of newZbz) {
  const id = `zbz-${String(s.volume).padStart(2, "0")}-${String(s.index).padStart(3, "0")}`;
  const body = Array.isArray(s.body) ? s.body : [s.body];
  const lengthChars = body.reduce((a, p) => a + p.length, 0);
  // 沿用舊 kepan tag (若已標過)
  const old = oldZbzById.get(id);
  merged.push({
    id,
    book: "雜寶藏經",
    volume: s.volume,
    no: s.index,
    title: s.title,
    hook: "", // 留空 — 讓 app.js 用 summary (已是鉤子品質) 直接顯示
    summary: s.summary,
    body, // 陣列；app.js 已支援
    afterword: s.reflection || "",
    lengthChars,
    kepan: old?.kepan || [],
  });
}

console.log(`轉換雜寶藏經 ${merged.length} 篇`);

// 合併並排序：先 zbz (依 id) 再 zby (依 id)
const all = [...merged, ...zby].sort((a, b) => a.id.localeCompare(b.id));
console.log(`總共 ${all.length} 篇`);

// Sanity checks
const ids = new Set(all.map((s) => s.id));
if (ids.size !== all.length) throw new Error("id 有重複");
for (const s of all) {
  if (!s.title || !s.body || (Array.isArray(s.body) && !s.body.length)) {
    console.warn("⚠ 內容不全:", s.id, s.title);
  }
}

writeFileSync(STORIES, JSON.stringify(all, null, 2), "utf-8");
console.log(`✓ 寫入 ${STORIES}`);

// 統計
const byBook = {};
for (const s of all) byBook[s.book] = (byBook[s.book] || 0) + 1;
console.log("分布:", byBook);
const totalChars = all.reduce((a, s) => a + s.lengthChars, 0);
console.log(`本文總字數: ${totalChars.toLocaleString()}`);
const avgSummary = (all.reduce((a, s) => a + s.summary.length, 0) / all.length).toFixed(0);
console.log(`summary 平均字數: ${avgSummary}`);
