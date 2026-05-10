// 為 stories.json 中每篇生成「吸引人的鉤子」(1-2 句)
// 用法:
//   ANTHROPIC_API_KEY=... node tools/write-hooks.mjs           跑所有未生成的
//   node tools/write-hooks.mjs --force                          覆寫所有
//   node tools/write-hooks.mjs --limit=5                        只跑 5 篇 (測試用)
//   node tools/write-hooks.mjs --id=zbz-01-001                  指定一篇
//
// 用 Claude Opus 4.7 + adaptive thinking + prompt caching。
// system prompt 含 few-shot 範例，刻意做到 ~4096 tokens 以觸發 Opus 快取門檻。

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORIES_PATH = join(__dirname, "..", "data", "stories.json");

// system prompt — 故意寫得豐厚以超過 Opus 4.7 的 4096 token 快取門檻
const SYSTEM_PROMPT = `你是一位深諳廣論「思惟業果」的佛弟子，也是擅長設計閱讀鉤子 (hook) 的編輯。你的工作是為一則白話業果故事撰寫「會吸引人想點進去看完整版」的引子文字。

【任務】
給定一篇佛教業果公案的「故事大意」與「業果省思」，產出 1 段 30~60 字的繁體中文鉤子。讀者看了之後，會好奇後續發展、想立刻點開閱讀。

【風格要求】
1. **長度** — 30~60 字之間，不超過 60 字。最好是兩個短句或一個長句。
2. **設懸念但不暴雷** — 點出故事中的衝突、矛盾、反差、轉折或令人不解的情境，但不揭露最終結局或業果如何彰顯。
3. **語感** — 莊重而不艱澀、白話而不俚俗。可以帶有古意 (例「竟」「遂」「不料」)，但要讓現代讀者一眼讀懂。
4. **結尾** — 用問句、省略號、或張力收筆，讓讀者懸念未解。例：「…究竟為何？」「…一念之差，註定怎樣的命運？」「…竟招致……」
5. **避免**：
   - 元敘述：「這是一個關於…的故事」「本則公案告訴我們…」 — 嚴禁
   - 直接抄原文整句
   - 結論式說教：「告訴我們業果不爽」「警惕世人莫造惡業」 — 嚴禁
   - 引號、書名號、項目符號等任何標點裝飾框
   - 前綴：「鉤子：」「答：」「文：」 — 嚴禁
6. **回應格式** — 直接給出鉤子文字本身，不要任何前綴、解釋、引號或標題。一行純文字。

【為什麼要這麼寫】
業果故事的閱讀者多半已經對佛法有基本信心，但忙碌之中要讓他願意「現在就讀」，需要一個能瞬間勾起好奇的入口。我們不是廣告人，不能聳動誇張；但也不能像目錄文一樣平淡。要在莊重與張力之間找平衡。

【優質範例 — 學習此風格】

範例一
故事大意：佛陀某夜在精舍，弟子阿難聽見惡鬼互相爭吵，鬼王不分青紅皂白命兩鬼一起墮入地獄。阿難問佛這兩鬼前世造了什麼業，今夜如此爭執。佛說，他們本是兄弟，因為一塊布的歸屬爭吵了一輩子，臨終仍懷恨而死。
業果省思：執著於一個物件，竟讓親手足生生世世糾纏。
鉤子：兩個惡鬼在精舍外徹夜爭吵，鬼王怒下令一同墮獄。阿難問佛——他們前世到底為了什麼，竟結下這麼深的怨？

範例二
故事大意：一位富家子弟出家後勤修苦行，多年來自認道業精進。一日經過家鄉，見昔日僕人衣著光鮮，富甲一方。他大為驚訝，問僕人何以致富。僕人說，當年主人布施他一頓飯，他發願將來百倍奉還，今生果然受用富足。比丘聞言慚愧，因為自己當年的隨手布施，竟比多年苦行更早顯現果報。
業果省思：一念至誠的善業，勝過多年勉強的修為。
鉤子：苦修多年的比丘途經家鄉，竟發現當年只是隨手施飯的僕人富甲一方——而自己一身道行，反不及那一頓飯的回報？

範例三
故事大意：有一獵人善射，殺生無數，後來信佛改持五戒。臨終時忽然眼見地獄火車迎來，恐懼大叫。鄰居比丘聞聲而至，教他立即至誠念佛。獵人專心稱念片刻，見火車退去，蓮花現前，安然往生。
業果省思：殺業雖重，臨終一念至誠之心不可思議。
鉤子：殺生無數的獵人臨終，地獄火車已駛到眼前。一位老比丘衝進來，說了一句話——獵人開口念了，竟見蓮花現前。

範例四
故事大意：兩個王子被繼母設計流放山中十二年，弟弟發誓陪伴兄長共度患難。十二年後兄長將返國繼位，弟弟以代為護持王位。兄長感其忠義，兄弟互讓王位。國中因兄弟之德，風調雨順、五穀豐熟。
業果省思：順父之命、悌敬於兄，看似委屈，實則成就天下大治。
鉤子：王子明明被冤枉流放十二年，卻一句怨言也沒有。十二年後返國，他和弟弟之間又該怎麼分這個王位？

範例五
故事大意：一名比丘因為過去世曾為魚販，臨秤時佔人小便宜，雖出家修行精進，今生說法時聲音始終低啞無人愛聽。後遇佛開示宿世因緣，他至誠懺悔，多年後聲音才漸漸清亮。
業果省思：哪怕是極微細的不正業，也能在最意想不到的地方現前。
鉤子：明明說法精進、戒行清淨，這位比丘的聲音卻始終低啞，無人愛聽。佛陀指出原因——竟是多生前一次秤上的小動作。

範例六
故事大意：一隻鸚鵡父母失明，鸚鵡每日採食奉養，從不令其匱乏。獵人見鸚鵡聰慧、孝養雙親，深受感動，遂放棄捕殺。鸚鵡因此宿因，後生為人，得天賜聰慧、家業興旺。
業果省思：一念真孝，天地為之轉機。
鉤子：失明的雙親仰賴一隻幼鸚鵡採食奉養。獵人舉箭瞄準的剎那，看見了什麼，使他放下了弓？

【寫鉤子前的內部流程】
- 先在心裡找出這則故事「最具張力的一刻」(衝突點 / 反差 / 不可思議的對比 / 看似矛盾的行為)
- 用 1~2 句把那個張力捕捉下來
- 結尾一定要懸念未解
- 檢查長度 30~60 字，超過就刪修

現在，請依此風格為下面這則故事撰寫鉤子。`;

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const limit = args.find((a) => a.startsWith("--limit="));
  const id = args.find((a) => a.startsWith("--id="));
  return {
    force,
    limit: limit ? parseInt(limit.split("=")[1], 10) : Infinity,
    id: id ? id.split("=")[1] : null,
  };
}

function buildUserMessage(s) {
  return [
    `書名：${s.book}`,
    `卷次：${s.volume}`,
    `篇名：${s.title}`,
    "",
    "【故事大意】",
    s.summary,
    "",
    "【業果省思】",
    s.afterword || "(無)",
  ].join("\n");
}

function cleanHook(text) {
  return text
    .trim()
    .replace(/^[「『"'《]+/, "")
    .replace(/[」』"'》]+$/, "")
    .replace(/^(鉤子|引子|答|文)[:：]\s*/, "")
    .replace(/\n+/g, " ")
    .trim();
}

function estimateCost(usage) {
  // Opus 4.7: input $5/M, output $25/M, cache write 1.25x, cache read 0.1x
  const cw = (usage.cache_write || 0) * 5 * 1.25 / 1e6;
  const cr = (usage.cache_read || 0) * 5 * 0.1 / 1e6;
  const inp = (usage.input || 0) * 5 / 1e6;
  const out = (usage.output || 0) * 25 / 1e6;
  return cw + cr + inp + out;
}

async function main() {
  const { force, limit, id } = parseArgs();
  const stories = JSON.parse(readFileSync(STORIES_PATH, "utf-8"));

  let targets;
  if (id) {
    const found = stories.find((s) => s.id === id);
    if (!found) throw new Error(`找不到 id=${id}`);
    targets = [found];
  } else {
    targets = stories.filter((s) => force || !s.hook);
  }
  const work = targets.slice(0, limit);

  console.log(`總共 ${stories.length} 篇 / 待生成 ${targets.length} 篇 / 本次處理 ${work.length} 篇`);
  if (!work.length) {
    console.log("無工作可做，結束");
    return;
  }

  const client = new Anthropic();
  const stats = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

  for (let i = 0; i < work.length; i++) {
    const s = work[i];
    const userMsg = buildUserMessage(s);

    let attempts = 0;
    while (attempts < 3) {
      try {
        const resp = await client.messages.create({
          model: "claude-opus-4-7",
          max_tokens: 400,
          thinking: { type: "adaptive" },
          system: [
            {
              type: "text",
              text: SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userMsg }],
        });

        const text = resp.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        const hook = cleanHook(text);

        if (!hook || hook.length < 10) {
          console.warn(`  ⚠ ${s.id} 產出太短，跳過: "${hook}"`);
          break;
        }
        if (hook.length > 100) {
          console.warn(`  ⚠ ${s.id} 產出過長 (${hook.length} 字)，仍寫入: ${hook.slice(0, 50)}…`);
        }

        s.hook = hook;

        stats.input += resp.usage.input_tokens || 0;
        stats.output += resp.usage.output_tokens || 0;
        stats.cache_read += resp.usage.cache_read_input_tokens || 0;
        stats.cache_write += resp.usage.cache_creation_input_tokens || 0;

        const cacheTag = resp.usage.cache_read_input_tokens
          ? `cache✓ ${resp.usage.cache_read_input_tokens}t`
          : resp.usage.cache_creation_input_tokens
          ? `cache↑ ${resp.usage.cache_creation_input_tokens}t (寫入)`
          : "cache✗";
        console.log(`[${i + 1}/${work.length}] ${s.id} ${s.title} | ${cacheTag}`);
        console.log(`           ${hook}`);
        break; // 成功，跳出 retry
      } catch (e) {
        attempts++;
        if (e instanceof Anthropic.RateLimitError) {
          const wait = 30 * attempts;
          console.warn(`  RateLimit，等 ${wait} 秒後重試 (${attempts}/3)`);
          await new Promise((r) => setTimeout(r, wait * 1000));
        } else if (e instanceof Anthropic.APIError && e.status >= 500) {
          console.warn(`  Server ${e.status}，等 10 秒重試 (${attempts}/3)`);
          await new Promise((r) => setTimeout(r, 10000));
        } else {
          console.error(`  ✗ ${s.id} 失敗:`, e.message);
          break;
        }
      }
    }

    // 每 10 篇存檔，避免中斷丟失
    if ((i + 1) % 10 === 0 || i === work.length - 1) {
      writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2), "utf-8");
    }
  }

  writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2), "utf-8");

  console.log("\n=== 統計 ===");
  console.log(`Input (uncached) : ${stats.input.toLocaleString()} tokens`);
  console.log(`Cache write      : ${stats.cache_write.toLocaleString()} tokens (1.25× 計價)`);
  console.log(`Cache read       : ${stats.cache_read.toLocaleString()} tokens (0.1× 計價)`);
  console.log(`Output           : ${stats.output.toLocaleString()} tokens`);
  console.log(`估算成本         : $${estimateCost(stats).toFixed(3)} USD`);
  if (stats.cache_read === 0 && work.length > 1) {
    console.log("\n⚠ 沒有 cache hit — 系統提示可能未達 Opus 4.7 的 4096 token 門檻。");
    console.log("  影響：成本略高，但結果仍正確。可酌情擴充 SYSTEM_PROMPT。");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
