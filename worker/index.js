// Cloudflare Worker — 業果故事推播伺服器
// 路由：
//   POST /subscribe    新增/更新訂閱 + prefs   body: { subscription, prefs }
//   PUT  /prefs        改設定 (時間/頻率/範圍) body: { endpoint, prefs }
//   POST /unsubscribe  body: { endpoint }
//   POST /test         立刻推一則 (用 endpoint 指定，不指定就推所有)
//   GET  /health       存活檢查
// Cron：每 10 分鐘掃一次 SUBS，比對該訂閱在其本地時區的設定時間是否到了。
//
// 部署:
//   1) 在 Cloudflare 建兩個 KV namespace: SUBS, STORIES
//   2) 把 stories.json 上傳到 STORIES (key 為 "stories")
//   3) 用 wrangler 產 VAPID 金鑰，把 VAPID_PRIVATE_JWK 放 secret，VAPID_PUBLIC 放 vars
//   4) wrangler deploy

import { sendPush, generateVapidKeys } from "./webpush.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function subKeyFromEndpoint(endpoint) {
  // 用 endpoint hash 當 key 比較好寫，但簡單起見直接 base64url
  return btoa(endpoint).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getStories(env) {
  const txt = await env.STORIES.get("stories");
  if (!txt) return [];
  return JSON.parse(txt);
}

function getVapid(env) {
  return {
    publicKey: env.VAPID_PUBLIC,
    privateKeyJwk: JSON.parse(env.VAPID_PRIVATE_JWK),
    subject: env.VAPID_SUBJECT || "mailto:admin@example.com",
  };
}

// 用本地時區算下次推播的 UTC 時間 (ms epoch)
function computeNextPushAt(prefs, fromMs = Date.now()) {
  const tz = prefs.timezone || "Asia/Taipei";
  const [hh, mm] = (prefs.time || "07:00").split(":").map(Number);

  // 在指定時區裡，今天和明天的 hh:mm 各是哪一個 UTC instant？
  // 透過 Intl.DateTimeFormat 反查
  const candidates = [];
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const probe = new Date(fromMs + dayOffset * 24 * 3600 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(probe);
    const y = parts.find((p) => p.type === "year").value;
    const M = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;
    // 構造該時區下的 hh:mm 對應的 UTC 時間
    // 方法：先用 UTC 解讀 y-M-d hh:mm，再扣去 (該時區當時的 offset)
    const naive = Date.UTC(+y, +M - 1, +d, hh, mm, 0);
    // 找 offset：該 UTC 時間在該時區是幾點，反推差距
    const tzNow = new Date(naive);
    const tzParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(tzNow);
    const tzH = +tzParts.find((p) => p.type === "hour").value;
    const tzM = +tzParts.find((p) => p.type === "minute").value;
    const offsetMin = (tzH * 60 + tzM) - (hh * 60 + mm);
    const utc = naive - offsetMin * 60 * 1000;
    if (utc > fromMs) {
      candidates.push(utc);
      break;
    }
  }
  let next = candidates[0] || fromMs + 24 * 3600 * 1000;

  // 套用頻率
  const freqMap = { daily: 1, every2days: 2, weekly: 7 };
  const days = freqMap[prefs.frequency] || 1;
  if (days > 1 && prefs.lastPushedAt) {
    const minNext = prefs.lastPushedAt + days * 24 * 3600 * 1000;
    if (next < minNext) next = minNext;
  }
  return next;
}

function pickStory(stories, sub) {
  const prefs = sub.prefs;
  let pool = stories;
  if (prefs.scope?.books?.length) {
    pool = pool.filter((s) => prefs.scope.books.includes(s.book));
  }
  if (prefs.scope?.kepan?.length) {
    pool = pool.filter((s) => s.kepan?.some((k) => prefs.scope.kepan.includes(k)));
  }
  if (!pool.length) return null;

  if (prefs.order === "sequential") {
    const lastIdx = sub.state.sequenceCursor
      ? pool.findIndex((s) => s.id === sub.state.sequenceCursor)
      : -1;
    return pool[(lastIdx + 1) % pool.length];
  }
  // random — 避開最近 30 天
  const recent = new Set((sub.state.history || []).slice(-30));
  const fresh = pool.filter((s) => !recent.has(s.id));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

async function handleSubscribe(req, env) {
  const { subscription, prefs } = await req.json();
  if (!subscription?.endpoint || !subscription?.keys) {
    return json({ error: "invalid subscription" }, 400);
  }
  const key = subKeyFromEndpoint(subscription.endpoint);
  const sub = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    prefs: prefs || {
      time: "07:00",
      timezone: "Asia/Taipei",
      frequency: "daily",
      scope: {},
      order: "random",
    },
    state: {
      lastPushedAt: 0,
      nextPushAt: computeNextPushAt(prefs || {}, Date.now()),
      sequenceCursor: null,
      history: [],
    },
  };
  await env.SUBS.put(key, JSON.stringify(sub));
  return json({ ok: true, key });
}

async function handlePrefs(req, env) {
  const { endpoint, prefs } = await req.json();
  const key = subKeyFromEndpoint(endpoint);
  const txt = await env.SUBS.get(key);
  if (!txt) return json({ error: "not found" }, 404);
  const sub = JSON.parse(txt);
  sub.prefs = { ...sub.prefs, ...prefs };
  sub.state.nextPushAt = computeNextPushAt(sub.prefs, Date.now());
  await env.SUBS.put(key, JSON.stringify(sub));
  return json({ ok: true });
}

async function handleUnsubscribe(req, env) {
  const { endpoint } = await req.json();
  const key = subKeyFromEndpoint(endpoint);
  await env.SUBS.delete(key);
  return json({ ok: true });
}

async function handleTest(req, env) {
  const body = await req.json().catch(() => ({}));
  const stories = await getStories(env);
  const vapid = getVapid(env);
  const targets = [];

  if (body.endpoint) {
    const sub = await env.SUBS.get(subKeyFromEndpoint(body.endpoint));
    if (sub) targets.push(JSON.parse(sub));
  } else {
    const list = await env.SUBS.list();
    for (const k of list.keys) {
      const txt = await env.SUBS.get(k.name);
      if (txt) targets.push(JSON.parse(txt));
    }
  }

  let success = 0, failed = 0;
  const details = [];
  for (const sub of targets) {
    const story = pickStory(stories, sub);
    if (!story) continue;
    const payload = JSON.stringify({
      id: story.id,
      title: `業果故事 — ${story.title}`,
      hook: story.hook || story.summary.slice(0, 60),
    });
    try {
      const res = await sendPush(sub, payload, vapid);
      const txt = res.ok ? "" : await res.text().catch(() => "");
      details.push({ status: res.status, ok: res.ok, body: txt.slice(0, 200) });
      if (res.ok || res.status === 201) success++;
      else failed++;
    } catch (e) {
      failed++;
      details.push({ error: e.message });
    }
  }
  return json({ ok: true, targets: targets.length, success, failed, details });
}

async function handleGenerateVapid() {
  const keys = await generateVapidKeys();
  return json({
    publicKey: keys.publicKey,
    privateKeyJwk: keys.privateKeyJwk,
    instructions: [
      "把 publicKey 設到前端 VAPID_PUBLIC",
      "把 privateKeyJwk JSON.stringify 後設為 Worker secret VAPID_PRIVATE_JWK",
      "wrangler secret put VAPID_PRIVATE_JWK",
    ],
  });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health") return json({ ok: true });
      if (url.pathname === "/subscribe" && req.method === "POST") return handleSubscribe(req, env);
      if (url.pathname === "/prefs" && req.method === "PUT") return handlePrefs(req, env);
      if (url.pathname === "/unsubscribe" && req.method === "POST") return handleUnsubscribe(req, env);
      if (url.pathname === "/test" && req.method === "POST") return handleTest(req, env);
      if (url.pathname === "/generate-vapid") return handleGenerateVapid();
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: e.message, stack: e.stack }, 500);
    }
  },

  // Cron — 掃所有訂閱
  async scheduled(event, env, ctx) {
    const stories = await getStories(env);
    const vapid = getVapid(env);
    const now = Date.now();

    let cursor;
    do {
      const list = await env.SUBS.list({ cursor });
      cursor = list.list_complete ? null : list.cursor;

      for (const k of list.keys) {
        const txt = await env.SUBS.get(k.name);
        if (!txt) continue;
        const sub = JSON.parse(txt);
        if (now < (sub.state.nextPushAt || 0)) continue;

        const story = pickStory(stories, sub);
        if (!story) continue;

        const payload = JSON.stringify({
          id: story.id,
          title: `業果故事 — ${story.title}`,
          hook: story.hook || story.summary.slice(0, 60),
        });

        try {
          const res = await sendPush(sub, payload, vapid);
          if (res.status === 410 || res.status === 404) {
            // 訂閱已失效，刪掉
            await env.SUBS.delete(k.name);
            continue;
          }
          if (!res.ok && res.status !== 201) {
            console.warn(`push ${k.name} 失敗: ${res.status}`);
            continue;
          }
          // 更新狀態
          sub.state.lastPushedAt = now;
          sub.state.history = [...(sub.state.history || []), story.id].slice(-100);
          sub.state.sequenceCursor = story.id;
          sub.state.nextPushAt = computeNextPushAt(
            { ...sub.prefs, lastPushedAt: now },
            now
          );
          await env.SUBS.put(k.name, JSON.stringify(sub));
        } catch (e) {
          console.error("push error", k.name, e);
        }
      }
    } while (cursor);
  },
};
