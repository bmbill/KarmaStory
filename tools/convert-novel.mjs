import mammoth from "mammoth";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 把《一夢漫言》白話小說版 docx 轉成 stories.json 的「book」條目並合併進去。
// 與 business 故事不同：這是連續敘事的小說，每「章」= 一則 (kind: "novel")，
// 沒有 摘要/業果省思，閱讀器只呈現本文。
//
// 用法：node tools/convert-novel.mjs ["docx 路徑"]

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BOOK = {
  code: "ymmy",
  name: "一夢漫言",
};

const SRC =
  process.argv[2] ||
  "C:/Users/User/Dropbox/廣論內容/_備覽/一夢漫言_白話小說版.docx";

const despace = (s) => s.replace(/[\s　]/g, "");

// 卷的歸屬：依《一夢漫言》原書 — 序+一～六＝卷一、七～十五＝卷二、十六～＝卷三、尾聲＝卷三
function volumeOf(no) {
  if (no <= 6) return 1;
  if (no <= 15) return 2;
  return 3;
}

const cnNum = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function chineseToNumber(s) {
  if (s === "十") return 10;
  if (s.startsWith("十")) return 10 + (cnNum[s[1]] ?? 0);
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    return (cnNum[a] ?? 0) * 10 + (cnNum[b] ?? 0);
  }
  return cnNum[s] ?? 0;
}

// 回傳 {no, name, title} 若這段是章節標題，否則 null
function parseHeading(text) {
  const d = despace(text);
  if (d.length > 24) return null; // 標題很短
  let m;
  if ((m = d.match(/^序章(.*)$/))) return { no: 0, name: "序章", title: m[1] };
  if ((m = d.match(/^尾聲(.*)$/))) return { no: 25, name: "尾聲", title: m[1] };
  if ((m = d.match(/^第([零〇一二三四五六七八九十]+)章(.*)$/)))
    return { no: chineseToNumber(m[1]), name: `第${m[1]}章`, title: m[2] };
  return null;
}

// 段落是否為原書的卷尾標記，如「【第六章終 卷一完】」— 不收進本文
const isEndMarker = (text) => /^【.*終/.test(despace(text));

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function excerpt(text, max = 54) {
  const t = text.replace(/\s+/g, "");
  return t.length > max ? t.slice(0, max) + "…" : t;
}

async function parseNovel() {
  const { value: html } = await mammoth.convertToHtml({ path: SRC });
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = stripTags(m[1]);
    if (t) paras.push(t);
  }

  const chapters = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const body = cur._paras.join("\n\n");
      chapters.push({
        id: `${BOOK.code}-${String(volumeOf(cur.no)).padStart(2, "0")}-${String(cur.no).padStart(3, "0")}`,
        book: BOOK.name,
        kind: "novel",
        volume: volumeOf(cur.no),
        no: cur.no,
        name: cur.name,
        title: cur.title || cur.name,
        hook: cur._paras.length ? excerpt(cur._paras[0]) : "",
        summary: "",
        body,
        afterword: "",
        lengthChars: body.length,
        kepan: [],
      });
    }
  };

  for (const text of paras) {
    const h = parseHeading(text);
    if (h) {
      flush();
      cur = { ...h, title: despace(h.title), _paras: [] };
      continue;
    }
    if (!cur) continue; // 書名/作者等前置內容，跳過直到序章
    if (isEndMarker(text)) continue;
    cur._paras.push(text);
  }
  flush();
  return chapters;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exitCode = 1;
  }
}

async function main() {
  console.log(`Parsing ${BOOK.name} ← ${SRC}`);
  const chapters = await parseNovel();
  console.log(`  → ${chapters.length} 章`);
  for (const c of chapters) {
    if (c.body.length < 50) console.warn(`  ⚠ ${c.id} ${c.title} 本文太短 (${c.body.length} 字)`);
  }

  // 章號連續性檢查 (序0、1..24、尾25)
  const nos = chapters.map((c) => c.no).sort((a, b) => a - b);
  assert(nos[0] === 0, "缺序章");
  assert(nos[nos.length - 1] === 25, "缺尾聲");
  assert(new Set(nos).size === nos.length, "章號重複");

  const outPath = join(ROOT, "data", "stories.json");
  const all = JSON.parse(readFileSync(outPath, "utf-8"));
  const kept = all.filter((s) => !s.id.startsWith(`${BOOK.code}-`));
  const merged = [...kept, ...chapters];
  writeFileSync(outPath, JSON.stringify(merged, null, 2), "utf-8");

  const totalChars = chapters.reduce((a, c) => a + c.body.length, 0);
  console.log(`✓ 合併寫入 ${outPath}`);
  console.log(`  ${BOOK.name}: ${chapters.length} 章、本文 ${totalChars.toLocaleString()} 字`);
  console.log(`  全書合計 ${merged.length} 則`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
