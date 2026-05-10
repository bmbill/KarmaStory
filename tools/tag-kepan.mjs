// 為 stories.json 的每篇加上廣論科判 tag (1-3 個)
// 流程：
//   1) 讀 kepan.json 拿到完整科判樹
//   2) 對每篇故事，請 Claude 從科判清單裡挑 1-3 個最相關的 id
//   3) 寫回 stories.json 的 kepan 欄位
//   4) 同步重建 kepan.json 的 byId 反向索引
//
// 用法:
//   ANTHROPIC_API_KEY=... node tools/tag-kepan.mjs            未標的全跑
//   node tools/tag-kepan.mjs --force                          重新標所有
//   node tools/tag-kepan.mjs --limit=10                       測試用
//   node tools/tag-kepan.mjs --id=zbz-01-001                  指定一篇

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORIES_PATH = join(__dirname, "..", "data", "stories.json");
const KEPAN_PATH = join(__dirname, "..", "data", "kepan.json");

function flattenKepan(tree) {
  const list = [];
  for (const g of tree) {
    list.push({ id: g.id, label: g.label, parent: null });
    if (g.children) {
      for (const c of g.children) {
        list.push({ id: c.id, label: c.label, parent: g.label });
      }
    }
  }
  return list;
}

function buildSystemPrompt(kepanList) {
  const listing = kepanList
    .map((k) => `- ${k.id} | ${k.parent ? k.parent + " > " : ""}${k.label}`)
    .join("\n");

  return `你是一位精通《菩提道次第廣論》與漢譯經藏的學者，特別熟悉宗大師對業果與三士道的科判分判。

任務：給定一則白話業果故事，從下面提供的廣論科判清單中，挑出 1~3 個與此故事最相關的科判 id。

【科判清單】
${listing}

【判斷準則】
1. 故事中有具體的「殺生 → 短命/惡道」等果報？→ 對應 yg.bie.hei.kill 等十惡業中的一項
2. 故事呈現「微小善因 → 巨大果報」？→ yg.zong.2 (業增長廣大)
3. 故事呈現「業力決定一切」？→ yg.zong.1 (業決定理)
4. 主角恪守業果信仰、戒慎不犯？→ yg.zong (思總業果) 或 yg.bie.bai
5. 故事描寫地獄、惡道之苦？→ xs.equsuffer (下士道·三惡趣苦)
6. 故事在勸發布施/持戒/忍辱等？→ ss.dana / ss.sila / ss.ksanti 等六度
7. 故事示「業不失壞」(隔世受報)？→ yg.zong.4 (已造業不失壞)
8. 故事呈現定業/不定業？→ yg.cha.dingbu

【回應格式】
只回一行純 JSON 陣列，僅含 id 字串，不超過 3 個，由相關度高到低排序。
不要回 markdown、不要解釋、不要額外文字。

範例：
["yg.bie.hei.kill", "yg.zong.4", "xs.equsuffer"]
["yg.zong.2", "ss.dana"]
["yg.zong.1"]

如果這則故事和清單都不太對得上，回 [].`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes("--force"),
    limit: (args.find((a) => a.startsWith("--limit=")) || "").split("=")[1] || Infinity,
    id: (args.find((a) => a.startsWith("--id=")) || "").split("=")[1] || null,
  };
}

function buildUserMessage(s) {
  return [
    `書名：${s.book}　篇名：${s.title}`,
    "",
    "【故事大意】",
    s.summary,
    "",
    "【業果省思】",
    s.afterword || "(無)",
  ].join("\n");
}

function parseTags(text, validIds) {
  // 容錯：可能回傳 ```json ... ``` 或多餘文字
  const m = text.match(/\[([^\]]*)\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse("[" + m[1] + "]");
    return arr.filter((x) => typeof x === "string" && validIds.has(x)).slice(0, 3);
  } catch {
    return [];
  }
}

async function main() {
  const { force, limit, id } = parseArgs();
  const stories = JSON.parse(readFileSync(STORIES_PATH, "utf-8"));
  const kepan = JSON.parse(readFileSync(KEPAN_PATH, "utf-8"));
  const flat = flattenKepan(kepan.tree);
  const validIds = new Set(flat.map((k) => k.id));

  let targets;
  if (id) {
    const found = stories.find((s) => s.id === id);
    if (!found) throw new Error(`找不到 id=${id}`);
    targets = [found];
  } else {
    targets = stories.filter((s) => force || !s.kepan?.length);
  }
  const work = targets.slice(0, +limit);

  console.log(`總共 ${stories.length} 篇 / 待標 ${targets.length} 篇 / 本次處理 ${work.length} 篇`);
  if (!work.length) {
    console.log("無工作可做");
    return;
  }

  const SYSTEM = buildSystemPrompt(flat);
  const client = new Anthropic();
  const stats = { input: 0, output: 0, cache_read: 0, cache_write: 0, empty: 0 };

  for (let i = 0; i < work.length; i++) {
    const s = work[i];
    let attempts = 0;
    while (attempts < 3) {
      try {
        const resp = await client.messages.create({
          model: "claude-opus-4-7",
          max_tokens: 200,
          thinking: { type: "adaptive" },
          system: [
            { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: buildUserMessage(s) }],
        });

        const text = resp.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        const tags = parseTags(text, validIds);
        s.kepan = tags;

        if (!tags.length) stats.empty++;

        stats.input += resp.usage.input_tokens || 0;
        stats.output += resp.usage.output_tokens || 0;
        stats.cache_read += resp.usage.cache_read_input_tokens || 0;
        stats.cache_write += resp.usage.cache_creation_input_tokens || 0;

        const labels = tags.map((t) => flat.find((f) => f.id === t)?.label).filter(Boolean);
        const cacheTag = resp.usage.cache_read_input_tokens
          ? `cache✓ ${resp.usage.cache_read_input_tokens}t`
          : resp.usage.cache_creation_input_tokens
          ? `cache↑ ${resp.usage.cache_creation_input_tokens}t`
          : "cache✗";
        console.log(
          `[${i + 1}/${work.length}] ${s.id} ${s.title} | ${cacheTag}\n           ${
            labels.length ? labels.join(", ") : "(無對應)"
          }`
        );
        break;
      } catch (e) {
        attempts++;
        if (e instanceof Anthropic.RateLimitError) {
          await new Promise((r) => setTimeout(r, 30 * attempts * 1000));
        } else if (e instanceof Anthropic.APIError && e.status >= 500) {
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          console.error(`  ✗ ${s.id}:`, e.message);
          break;
        }
      }
    }

    if ((i + 1) % 10 === 0 || i === work.length - 1) {
      writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2), "utf-8");
    }
  }

  // 重建 byId 反向索引
  const byId = {};
  for (const k of flat) byId[k.id] = [];
  for (const s of stories) {
    for (const k of s.kepan || []) {
      if (byId[k]) byId[k].push(s.id);
    }
  }
  kepan.byId = byId;
  writeFileSync(KEPAN_PATH, JSON.stringify(kepan, null, 2), "utf-8");
  writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2), "utf-8");

  console.log("\n=== 統計 ===");
  console.log(`Input (uncached) : ${stats.input.toLocaleString()}`);
  console.log(`Cache write      : ${stats.cache_write.toLocaleString()}`);
  console.log(`Cache read       : ${stats.cache_read.toLocaleString()}`);
  console.log(`Output           : ${stats.output.toLocaleString()}`);
  console.log(`無對應科判       : ${stats.empty} 篇`);
  const cost =
    (stats.cache_write * 5 * 1.25 + stats.cache_read * 5 * 0.1 + stats.input * 5) / 1e6 +
    (stats.output * 25) / 1e6;
  console.log(`估算成本         : $${cost.toFixed(3)} USD`);

  // 反向索引摘要
  console.log("\n=== 各科判故事數 ===");
  for (const k of flat) {
    if (byId[k.id].length) {
      console.log(`  ${k.label} : ${byId[k.id].length} 篇`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
