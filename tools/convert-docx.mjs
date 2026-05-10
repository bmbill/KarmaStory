import mammoth from "mammoth";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC_DIR = "C:/Users/Bill&Jocelyn/Dropbox/廣論內容/書/業果故事/白話譯文";

const BOOKS = [
  {
    code: "zbz",
    name: "雜寶藏經",
    file: "雜寶藏經_白話譯文_全本.docx",
    hasVolumes: true,
  },
  {
    code: "zby",
    name: "雜譬喻經",
    file: "雜譬喻經_白話譯文.docx",
    hasVolumes: false,
  },
];

const STYLE_MAP = [
  "p[style-name='Volume Title'] => h1.volume:fresh",
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => h1.subtitle:fresh",
  "p[style-name='Heading 1'] => h2.story:fresh",
  "p[style-name='Heading 2'] => h3.section:fresh",
];

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x?\w+;/g, "")
    .trim();
}

function parseStoryNumber(title) {
  // 雜寶藏經:「（一）　十奢王緣」 / 雜譬喻經:「第一篇　雞卵說緣 — 飲乳獲果」
  const m1 = title.match(/^[（(]([零〇一二三四五六七八九十百]+)[）)]\s*(.+)$/);
  if (m1) return { no: chineseToNumber(m1[1]), cleanTitle: m1[2].trim() };
  const m2 = title.match(/^第([零〇一二三四五六七八九十百]+)[篇則回章]\s*(.+)$/);
  if (m2) return { no: chineseToNumber(m2[1]), cleanTitle: m2[2].trim() };
  return { no: 0, cleanTitle: title.trim() };
}

function parseVolumeNumber(title) {
  const m = title.match(/卷[\s　]*第?[\s　]*([零〇一二三四五六七八九十百]+)/);
  return m ? chineseToNumber(m[1]) : 0;
}

function chineseToNumber(s) {
  const digit = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  // Positional form (no 十/百): 一〇=10, 一一=11, 一二一=121
  if ([...s].every((c) => c in digit)) {
    return [...s].reduce((acc, c) => acc * 10 + digit[c], 0);
  }
  // Traditional form with 十/百
  if (s === "十") return 10;
  if (s.startsWith("十")) return 10 + (digit[s[1]] ?? 0);
  if (s.endsWith("十")) return (digit[s[0]] ?? 0) * 10;
  if (s.includes("百")) {
    const [a, rest] = s.split("百");
    const h = (digit[a] ?? 1) * 100;
    if (!rest) return h;
    if (rest.startsWith("十")) return h + 10 + (digit[rest[1]] ?? 0);
    if (rest.includes("十")) {
      const [c, d] = rest.split("十");
      return h + (digit[c] ?? 0) * 10 + (digit[d] ?? 0);
    }
    return h + (digit[rest] ?? 0);
  }
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    return (digit[a] ?? 0) * 10 + (digit[b] ?? 0);
  }
  return 0;
}

function classifySection(heading) {
  const h = heading.replace(/[\s　]/g, "");
  if (h.includes("故事大意")) return "summary";
  if (h.includes("白話譯文") || h.includes("試譯譯本") || h.includes("試譯本文")) return "body";
  if (h.includes("業果省思") || h.includes("業果還報")) return "afterword";
  return null;
}

async function parseBook(book) {
  const path = join(SRC_DIR, book.file);
  const { value: html } = await mammoth.convertToHtml({ path }, { styleMap: STYLE_MAP });

  // Tokenize HTML into a flat list of nodes by top-level tags
  const nodes = [];
  const re = /<(h1|h2|h3|p|ul|ol)([^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1];
    const attrs = m[2];
    const inner = m[3];
    const text = stripTags(inner);
    const cls = (attrs.match(/class="([^"]+)"/) || [, ""])[1];
    nodes.push({ tag, cls, text });
  }

  const stories = [];
  let currentVolume = book.hasVolumes ? 0 : 1;
  let currentStory = null;
  let currentSection = null;

  const flush = () => {
    if (currentStory) {
      currentStory.lengthChars = currentStory.body.length;
      stories.push(currentStory);
    }
  };

  for (const n of nodes) {
    if (!n.text) continue;

    if (n.tag === "h1" && n.cls === "volume") {
      currentVolume = parseVolumeNumber(n.text) || currentVolume + 1;
      continue;
    }

    if (n.tag === "h2" && n.cls === "story") {
      flush();
      const { no, cleanTitle } = parseStoryNumber(n.text);
      currentStory = {
        id: `${book.code}-${String(currentVolume).padStart(2, "0")}-${String(no).padStart(3, "0")}`,
        book: book.name,
        volume: currentVolume,
        no,
        title: cleanTitle,
        hook: "",
        summary: "",
        body: "",
        afterword: "",
        lengthChars: 0,
        kepan: [],
      };
      currentSection = null;
      continue;
    }

    if (n.tag === "h3" && n.cls === "section") {
      currentSection = classifySection(n.text);
      continue;
    }

    if (!currentStory || !currentSection) continue;

    const para = n.text.trim();
    if (!para) continue;
    if (currentStory[currentSection]) {
      currentStory[currentSection] += "\n\n" + para;
    } else {
      currentStory[currentSection] = para;
    }
  }
  flush();

  return stories;
}

function assert(cond, msg) {
  if (!cond) {
    console.error("ASSERT FAIL:", msg);
    process.exitCode = 1;
  }
}

async function main() {
  const all = [];
  for (const book of BOOKS) {
    console.log(`\nParsing ${book.name}...`);
    const stories = await parseBook(book);
    console.log(`  → ${stories.length} 篇`);
    let bad = 0;
    for (const s of stories) {
      if (s.body.length < 50) {
        bad++;
        console.warn(`  ⚠ ${s.id} ${s.title} body 太短 (${s.body.length} 字)`);
      }
      if (!s.summary) console.warn(`  ⚠ ${s.id} ${s.title} 無 summary`);
    }
    if (bad > 0) console.warn(`  ${bad} 篇 body 過短`);
    all.push(...stories);
  }

  // Sanity checks
  assert(all.length === 133, `預期 133 篇，實得 ${all.length}`);
  const ids = new Set(all.map((s) => s.id));
  assert(ids.size === all.length, "id 有重複");

  const outDir = join(ROOT, "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "stories.json");
  writeFileSync(outPath, JSON.stringify(all, null, 2), "utf-8");
  console.log(`\n✓ 寫入 ${outPath} (${all.length} 篇)`);

  // Stats
  const byBook = {};
  for (const s of all) byBook[s.book] = (byBook[s.book] || 0) + 1;
  console.log("分布:", byBook);
  const totalChars = all.reduce((a, s) => a + s.body.length, 0);
  console.log(`本文總字數: ${totalChars.toLocaleString()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
