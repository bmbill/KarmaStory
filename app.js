// 業果故事 PWA — 主邏輯
// 純 vanilla JS、無框架、單檔自足

// ---------- State ----------
const STATE = {
  stories: [],
  quotes: [],
  kepan: { tree: [], byId: {} },
  prefs: loadPrefs(),
  read: loadRead(),
  reader: { current: null, listIds: [], idx: -1 },
  searchFilters: { q: "", book: "all", kepan: null },
};

const VAPID_PUBLIC = "BLvu1hkHQSBvVX_RoJoYRqbvybpA6k5RWYZIcHZXpirVSE9Meu4DU57-S4j-O9360H_Z4bAPiDCuMFcfzWQufpQ";
const WORKER_URL = "https://karma-stories-push.karma-story-bmbill.workers.dev";

// ---------- Persistence ----------
function loadPrefs() {
  const d = JSON.parse(localStorage.getItem("ks-prefs") || "{}");
  return {
    pushEnabled: false,
    pushTime: "07:00",
    pushFreq: "daily",
    pushOrder: "random",
    scopeBooks: [],
    fontSize: "1.15",
    fontFamily: "serif",
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    ttsRate: "1",
    ttsVoice: "",
    ttsOnline: true,
    expandedGroups: {},
    ...d,
  };
}

const FONT_STACKS = {
  serif: '"Noto Serif TC", serif',
  sans: '"Noto Sans TC", system-ui, sans-serif',
  zhenghei: '"Microsoft JhengHei", "微軟正黑體", "PingFang TC", "Heiti TC", "Noto Sans TC", sans-serif',
  wenkai: '"LXGW WenKai TC", "Noto Serif TC", serif',
  system: 'system-ui, -apple-system, "PingFang TC", "Microsoft JhengHei", sans-serif',
};
function savePrefs() {
  localStorage.setItem("ks-prefs", JSON.stringify(STATE.prefs));
}
function loadRead() {
  return new Set(JSON.parse(localStorage.getItem("ks-read") || "[]"));
}
function saveRead() {
  localStorage.setItem("ks-read", JSON.stringify([...STATE.read]));
}

// ---------- Utils ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2000);
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function fmtDate() {
  const d = new Date();
  const w = "日一二三四五六"[d.getDay()];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 週${w}`;
}

function pickToday() {
  // 鎖當日：localStorage 紀錄今天的故事 id，跨日才換
  const key = "ks-today";
  const cached = JSON.parse(localStorage.getItem(key) || "null");
  if (cached && cached.date === todayKey()) {
    const s = STATE.stories.find((x) => x.id === cached.id);
    if (s) return s;
  }
  const pool = applyScope(STATE.stories, STATE.prefs);
  if (!pool.length) return null;
  let pick;
  if (STATE.prefs.pushOrder === "sequential") {
    const lastId = cached?.id;
    const lastIdx = lastId ? pool.findIndex((s) => s.id === lastId) : -1;
    pick = pool[(lastIdx + 1) % pool.length];
  } else {
    // 隨機，盡量避開最近 30 天讀過的
    const recent = STATE.read;
    const fresh = pool.filter((s) => !recent.has(s.id));
    const list = fresh.length ? fresh : pool;
    pick = list[Math.floor(Math.random() * list.length)];
  }
  localStorage.setItem(key, JSON.stringify({ date: todayKey(), id: pick.id }));
  return pick;
}

function pickQuote() {
  const key = "ks-quote";
  const cached = JSON.parse(localStorage.getItem(key) || "null");
  if (cached && cached.date === todayKey()) {
    return STATE.quotes[cached.idx] || STATE.quotes[0];
  }
  const idx = Math.floor(Math.random() * STATE.quotes.length);
  localStorage.setItem(key, JSON.stringify({ date: todayKey(), idx }));
  return STATE.quotes[idx];
}

function applyScope(stories, prefs) {
  return stories.filter((s) => {
    if (prefs.scopeBooks?.length && !prefs.scopeBooks.includes(s.book)) return false;
    return true;
  });
}

// 判斷某部書是否有多卷（用於是否在標題列顯示「卷 X」）
function bookHasMultipleVolumes(book) {
  const vols = new Set();
  for (const s of STATE.stories) {
    if (s.book === book) vols.add(s.volume);
    if (vols.size > 1) return true;
  }
  return false;
}

// ---------- Theme & font ----------
function applyTheme() {
  document.documentElement.dataset.theme = STATE.prefs.dark ? "dark" : "light";
  document.documentElement.style.setProperty("--fs", STATE.prefs.fontSize + "rem");
  document.documentElement.style.setProperty(
    "--reader-font",
    FONT_STACKS[STATE.prefs.fontFamily] || FONT_STACKS.serif
  );
  $("#darkToggle").checked = STATE.prefs.dark;
  if ($("#fontFamily")) $("#fontFamily").value = STATE.prefs.fontFamily;
  if ($("#readerFontFamily")) $("#readerFontFamily").value = STATE.prefs.fontFamily;
  $$(".fs-group button, .rfb-fs button").forEach((b) =>
    b.classList.toggle("on", b.dataset.fs === STATE.prefs.fontSize)
  );
}

// ---------- Pages ----------
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.page === name));
  ["home", "search", "settings"].forEach((p) => {
    $(`#page-${p}`).classList.toggle("hide", p !== name);
  });
}

// ---------- Home ----------
function renderHome() {
  const q = pickQuote();
  if (q) {
    $("#quoteText").textContent = q.text;
    $("#quoteSrc").textContent = "— " + q.source;
  }
  const today = pickToday();
  if (today) {
    $("#todayMeta").innerHTML =
      `<span class="pill">${today.book}</span>` +
      (bookHasMultipleVolumes(today.book) ? `<span>卷 ${today.volume}</span>` : "") +
      `<span>第 ${today.no} 篇</span>` +
      `<span>${today.lengthChars} 字</span>`;
    $("#todayTitle").textContent = today.title;
    const hookEl = $("#todayHook");
    hookEl.textContent = today.hook || today.summary;
    hookEl.classList.remove("empty");
    $("#todayCard").onclick = (e) => {
      if (e.target.closest("button")) return;
      openReader(today.id);
    };
    $("#todayRead").onclick = () => openReader(today.id);
  }
}

// ---------- Search ----------
function renderBookChips() {
  const books = ["全部", ...new Set(STATE.stories.map((s) => s.book))];
  $("#bookChips").innerHTML = books
    .map((b, i) => {
      const v = i === 0 ? "all" : b;
      const on = STATE.searchFilters.book === v ? "on" : "";
      return `<button class="chip ${on}" data-book="${v}">${b}</button>`;
    })
    .join("");
  $$("#bookChips .chip").forEach((c) => {
    c.onclick = () => {
      STATE.searchFilters.book = c.dataset.book;
      renderBookChips();
      renderSearchResults();
    };
  });
}

function renderKepanTree() {
  // 若沒任何故事被標到科判，整個篩選區隱藏
  const anyTagged = STATE.stories.some((s) => s.kepan && s.kepan.length);
  $("#kepanFilter").classList.toggle("hide", !anyTagged);
  if (!anyTagged || !STATE.kepan.tree.length) {
    $("#kepanContainer").innerHTML = "";
    return;
  }
  const html = STATE.kepan.tree
    .map((g) => {
      const childHtml = (g.children || [])
        .map((c) => {
          const on = STATE.searchFilters.kepan === c.id ? "on" : "";
          return `<span class="kepan-leaf ${on}" data-id="${c.id}">${c.label}</span>`;
        })
        .join("");
      const groupOn = STATE.searchFilters.kepan === g.id ? "on" : "";
      const selfPill = `<span class="kepan-leaf ${groupOn}" data-id="${g.id}">${g.label} 全部</span>`;
      return `<div class="kepan-grp">${selfPill}${childHtml}</div>`;
    })
    .join("");
  $("#kepanContainer").innerHTML = html;
  $$(".kepan-leaf").forEach((el) => {
    el.onclick = () => {
      STATE.searchFilters.kepan = STATE.searchFilters.kepan === el.dataset.id ? null : el.dataset.id;
      renderKepanTree();
      renderSearchResults();
    };
  });
}

function matchKepan(story, kid) {
  if (!kid) return true;
  if (story.kepan.includes(kid)) return true;
  // 父節點命中：包含其下任一子節點
  const node = STATE.kepan.tree.find((g) => g.id === kid);
  if (node?.children) {
    return node.children.some((c) => story.kepan.includes(c.id));
  }
  return false;
}

function bodyText(body) {
  return Array.isArray(body) ? body.join("\n") : String(body || "");
}

function renderSearchResults() {
  const { q, book, kepan } = STATE.searchFilters;
  const qLower = q.trim().toLowerCase();
  const filtered = STATE.stories.filter((s) => {
    if (book !== "all" && s.book !== book) return false;
    if (!matchKepan(s, kepan)) return false;
    if (!qLower) return true;
    return (
      s.title.toLowerCase().includes(qLower) ||
      (s.hook || "").toLowerCase().includes(qLower) ||
      s.summary.toLowerCase().includes(qLower) ||
      bodyText(s.body).toLowerCase().includes(qLower)
    );
  });

  const root = $("#searchResults");
  if (!filtered.length) {
    root.innerHTML = '<div class="empty">沒有符合條件的故事</div>';
    return;
  }

  // 沒搜尋詞 / 沒科判篩選 → 折疊分類顯示；有搜尋 → 平鋪
  const isFlat = qLower || kepan;
  if (isFlat) {
    root.innerHTML = filtered.map(renderResultRow).join("");
  } else {
    root.innerHTML = renderGrouped(filtered);
  }

  $$("#searchResults .result").forEach((r) => {
    r.onclick = () => openReader(r.dataset.id, filtered.map((s) => s.id));
  });
  // 折疊狀態同步
  $$("#searchResults details.grp").forEach((el) => {
    const k = el.dataset.k;
    if (STATE.prefs.expandedGroups[k]) el.open = true;
    el.addEventListener("toggle", () => {
      STATE.prefs.expandedGroups[k] = el.open;
      savePrefs();
    });
  });
}

function renderResultRow(s) {
  const volPart = bookHasMultipleVolumes(s.book) ? `卷${s.volume} · ` : "";
  return `<div class="result" data-id="${s.id}">
    <div class="result-body">
      <div class="result-title">${escapeHtml(s.title)}</div>
      <div class="result-meta">
        <span>${s.book}</span>
        <span>${volPart}第 ${s.no} 篇</span>
        <span>${s.lengthChars} 字</span>
      </div>
    </div>
  </div>`;
}

function renderGrouped(stories) {
  // 依 book → volume 分組
  const groups = {};
  for (const s of stories) {
    const bk = s.book;
    const vol = s.volume;
    groups[bk] = groups[bk] || { count: 0, vols: {} };
    groups[bk].count++;
    groups[bk].vols[vol] = groups[bk].vols[vol] || [];
    groups[bk].vols[vol].push(s);
  }
  const html = [];
  for (const [book, g] of Object.entries(groups)) {
    const volKeys = Object.keys(g.vols).sort((a, b) => +a - +b);
    const showVols = volKeys.length > 1; // 只有 1 卷就不分卷
    const bookKey = `book:${book}`;
    html.push(`<details class="grp grp-book" data-k="${bookKey}">
      <summary><span class="grp-label">${book}</span><span class="grp-count">${g.count} 篇</span></summary>
      <div class="grp-body">`);
    if (showVols) {
      for (const v of volKeys) {
        const list = g.vols[v];
        const volKey = `${bookKey}:vol:${v}`;
        html.push(`<details class="grp grp-vol" data-k="${volKey}">
          <summary><span class="grp-label">卷${v}</span><span class="grp-count">${list.length} 篇</span></summary>
          <div class="grp-body">${list.map(renderResultRow).join("")}</div>
        </details>`);
      }
    } else {
      html.push(g.vols[volKeys[0]].map(renderResultRow).join(""));
    }
    html.push(`</div></details>`);
  }
  return html.join("");
}

// ---------- Reader ----------
function openReader(id, listIds = null) {
  const s = STATE.stories.find((x) => x.id === id);
  if (!s) return;
  STATE.reader.current = s;
  STATE.reader.listIds = listIds || STATE.stories.map((x) => x.id);
  STATE.reader.idx = STATE.reader.listIds.indexOf(id);
  renderReader();
  $("#reader").classList.add("open");
}

function closeReader() {
  $("#reader").classList.remove("open");
  stopTTS();
}

function renderReader() {
  const s = STATE.reader.current;
  const volPart = bookHasMultipleVolumes(s.book) ? `卷${s.volume} · ` : "";
  $("#readerTitle").textContent = s.title;
  $("#readerMeta").textContent = `${s.book} · ${volPart}第 ${s.no} 篇 · ${s.lengthChars} 字`;

  const sections = [];
  sections.push(`<div class="reader-section"><h3>白話譯文</h3>${paraHtml(s.body)}</div>`);
  if (s.afterword) {
    sections.push(`<div class="reader-section"><h3>業果省思</h3>${paraHtml(s.afterword)}</div>`);
  }
  const tags = (s.kepan || [])
    .map((k) => {
      const found = findKepanLabel(k);
      return found ? `<span class="tg">${found}</span>` : "";
    })
    .join("");
  const tagsHtml = tags ? `<div class="reader-tags">${tags}</div>` : "";

  $("#readerBody").innerHTML = tagsHtml + sections.join("");
  $("#readerBody").scrollTop = 0;

  // 內部仍記錄已讀，供隨機推播去重 (使用者無感)
  if (!STATE.read.has(s.id)) {
    STATE.read.add(s.id);
    saveRead();
  }
  $("#readerPrev").disabled = STATE.reader.idx <= 0;
  $("#readerNext").disabled = STATE.reader.idx >= STATE.reader.listIds.length - 1;
}

function paraHtml(text) {
  const paras = Array.isArray(text) ? text : String(text).split(/\n+/);
  return paras
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function findKepanLabel(id) {
  for (const g of STATE.kepan.tree) {
    if (g.id === id) return g.label;
    if (g.children) {
      const c = g.children.find((x) => x.id === id);
      if (c) return c.label;
    }
  }
  return null;
}

function navReader(delta) {
  const newIdx = STATE.reader.idx + delta;
  if (newIdx < 0 || newIdx >= STATE.reader.listIds.length) return;
  STATE.reader.idx = newIdx;
  STATE.reader.current = STATE.stories.find((s) => s.id === STATE.reader.listIds[newIdx]);
  stopTTS();
  renderReader();
}

// ---------- TTS ----------
let ttsUtter = null;
let ttsAudio = null; // 線上音色用 <audio>

function ensureTtsAudio() {
  if (ttsAudio) return ttsAudio;
  ttsAudio = new Audio();
  ttsAudio.preload = "auto";
  ttsAudio.addEventListener("ended", () => setTTSBtn(false));
  ttsAudio.addEventListener("error", () => {
    setTTSBtn(false);
  });
  return ttsAudio;
}

function isOnlineTtsPlaying() {
  return ttsAudio && !ttsAudio.paused && !ttsAudio.ended;
}

function toggleTTS() {
  if ((ttsUtter && speechSynthesis.speaking) || isOnlineTtsPlaying()) {
    stopTTS();
    return;
  }
  const s = STATE.reader.current;
  if (!s) return;
  const text = [bodyText(s.body), s.afterword].filter(Boolean).join("\n");
  if (STATE.prefs.ttsOnline) {
    playOnlineTTS(text);
  } else {
    playLocalTTS(text);
  }
}

function playLocalTTS(text) {
  ttsUtter = new SpeechSynthesisUtterance(text);
  ttsUtter.lang = "zh-TW";
  ttsUtter.rate = parseFloat(STATE.prefs.ttsRate) || 1;
  // 用使用者選的嗓音；沒選就挑最像台灣 / 香港中文
  const voices = speechSynthesis.getVoices();
  const want = STATE.prefs.ttsVoice;
  const chosen =
    (want && voices.find((v) => v.voiceURI === want || v.name === want)) ||
    voices.find((v) => /zh[-_]?TW/i.test(v.lang)) ||
    voices.find((v) => /zh[-_]?HK/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang));
  if (chosen) ttsUtter.voice = chosen;
  ttsUtter.onend = () => {
    ttsUtter = null;
    setTTSBtn(false);
  };
  ttsUtter.onerror = () => {
    ttsUtter = null;
    setTTSBtn(false);
  };
  speechSynthesis.speak(ttsUtter);
  setTTSBtn(true);
}

function playOnlineTTS(text) {
  const s = STATE.reader.current;
  if (!s) return;
  const audio = ensureTtsAudio();
  audio.src = `./data/audio/${s.id}.webm`;
  audio.playbackRate = parseFloat(STATE.prefs.ttsRate) || 1;
  setTTSBtn(true);
  audio.play().catch(() => {
    setTTSBtn(false);
    toast("找不到預錄音檔，改用本機語音");
    playLocalTTS(text);
  });
}

function stopTTS() {
  speechSynthesis.cancel();
  ttsUtter = null;
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
  }
  setTTSBtn(false);
}
function setTTSBtn(playing) {
  const btn = $("#readerTTS");
  if (btn) btn.textContent = playing ? "⏸ 停止" : "🔊 朗讀";
}

function populateVoices() {
  const sel = $("#ttsVoice");
  if (!sel) return;
  const voices = speechSynthesis.getVoices().filter((v) => /^zh/i.test(v.lang));
  voices.sort((a, b) => a.lang.localeCompare(b.lang));
  const cur = STATE.prefs.ttsVoice;
  sel.innerHTML =
    '<option value="">系統預設</option>' +
    voices
      .map(
        (v) =>
          `<option value="${escapeHtml(v.voiceURI)}" ${
            cur === v.voiceURI ? "selected" : ""
          }>${escapeHtml(v.name)} (${v.lang})</option>`
      )
      .join("");
}

function applyTtsModeUI() {
  const online = !!STATE.prefs.ttsOnline;
  const localRow = $("#ttsVoiceRow");
  if (localRow) localRow.style.display = online ? "none" : "";
}

// ---------- Settings ----------
function renderSettings() {
  $("#pushToggle").checked = STATE.prefs.pushEnabled;
  $("#pushTime").value = STATE.prefs.pushTime;
  $("#pushFreq").value = STATE.prefs.pushFreq;
  $("#pushOrder").value = STATE.prefs.pushOrder;

  // 範圍 — 書目
  const books = [...new Set(STATE.stories.map((s) => s.book))];
  $("#scopeList").innerHTML = books
    .map((b) => {
      const checked = !STATE.prefs.scopeBooks.length || STATE.prefs.scopeBooks.includes(b);
      return `<label><input type="checkbox" data-book="${b}" ${checked ? "checked" : ""}/>${b}</label>`;
    })
    .join("");
  $$("#scopeList input").forEach((cb) => {
    cb.onchange = () => {
      const checked = [...$$("#scopeList input")].filter((x) => x.checked).map((x) => x.dataset.book);
      STATE.prefs.scopeBooks = checked.length === books.length ? [] : checked;
      savePrefs();
      syncPrefsToWorker();
    };
  });
  $("#ttsRate").value = STATE.prefs.ttsRate;
  const onCb = $("#ttsOnlineToggle");
  if (onCb) onCb.checked = !!STATE.prefs.ttsOnline;
  applyTtsModeUI();
}

// ---------- Push subscription ----------
async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("此瀏覽器不支援推播");
    return false;
  }
  if (!VAPID_PUBLIC || !WORKER_URL) {
    toast("尚未設定 Worker — 編輯 app.js 填入 VAPID_PUBLIC 與 WORKER_URL");
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    toast("通知權限被拒");
    return false;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
  });
  await fetch(`${WORKER_URL}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub, prefs: pushPrefs() }),
  });
  toast("已啟用推播");
  return true;
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await fetch(`${WORKER_URL}/unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
  toast("已關閉推播");
}

function pushPrefs() {
  return {
    time: STATE.prefs.pushTime,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    frequency: STATE.prefs.pushFreq,
    scope: { books: STATE.prefs.scopeBooks, kepan: [] },
    order: STATE.prefs.pushOrder,
  };
}

async function syncPrefsToWorker() {
  if (!STATE.prefs.pushEnabled || !WORKER_URL) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    await fetch(`${WORKER_URL}/prefs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint, prefs: pushPrefs() }),
    });
  } catch (e) {
    console.warn("syncPrefs failed", e);
  }
}

async function testPush() {
  if (!STATE.prefs.pushEnabled) {
    toast("先啟用推播");
    return;
  }
  if (!WORKER_URL) {
    // 本地用 showNotification 模擬
    const reg = await navigator.serviceWorker.ready;
    const today = pickToday();
    if (!today) return;
    reg.showNotification("業果故事 — 試推", {
      body: today.hook || today.title,
      icon: "./icons/icon-192.png",
      data: { storyId: today.id },
    });
    toast("已顯示本機通知");
    return;
  }
  await fetch(`${WORKER_URL}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  toast("已請求 Worker 試推一則");
}

function urlBase64ToUint8Array(s) {
  const padding = "=".repeat((4 - (s.length % 4)) % 4);
  const base64 = (s + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// ---------- Init ----------
async function loadData() {
  const [stories, quotes, kepan] = await Promise.all([
    fetch("./data/stories.json").then((r) => r.json()),
    fetch("./data/quotes.json").then((r) => r.json()),
    fetch("./data/kepan.json").then((r) => r.json()).catch(() => ({ tree: [], byId: {} })),
  ]);
  STATE.stories = stories;
  STATE.quotes = quotes;
  STATE.kepan = kepan;
}

function bindEvents() {
  $$(".tab").forEach((t) => {
    t.onclick = () => switchTab(t.dataset.page);
  });

  // 搜尋 — 按鈕或 Enter 才觸發 (避免每打一字就搜)
  const doSearch = () => {
    STATE.searchFilters.q = $("#searchInput").value;
    $("#searchClear").style.display = STATE.searchFilters.q ? "block" : "none";
    renderSearchResults();
  };
  $("#searchBtn").onclick = doSearch;
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch();
    }
  });
  $("#searchClear").onclick = () => {
    $("#searchInput").value = "";
    STATE.searchFilters.q = "";
    $("#searchClear").style.display = "none";
    renderSearchResults();
  };

  // 設定
  $("#pushToggle").onchange = async (e) => {
    if (e.target.checked) {
      const ok = await enablePush();
      if (!ok) e.target.checked = false;
      STATE.prefs.pushEnabled = e.target.checked;
    } else {
      await disablePush();
      STATE.prefs.pushEnabled = false;
    }
    savePrefs();
  };
  $("#pushTime").onchange = (e) => {
    STATE.prefs.pushTime = e.target.value;
    savePrefs();
    syncPrefsToWorker();
  };
  $("#pushFreq").onchange = (e) => {
    STATE.prefs.pushFreq = e.target.value;
    savePrefs();
    syncPrefsToWorker();
  };
  $("#pushOrder").onchange = (e) => {
    STATE.prefs.pushOrder = e.target.value;
    savePrefs();
    syncPrefsToWorker();
  };
  $("#testPush").onclick = testPush;

  $$(".fs-group button").forEach((b) => {
    b.onclick = () => {
      STATE.prefs.fontSize = b.dataset.fs;
      savePrefs();
      applyTheme();
    };
  });
  $("#darkToggle").onchange = (e) => {
    STATE.prefs.dark = e.target.checked;
    savePrefs();
    applyTheme();
  };
  $("#fontFamily").onchange = (e) => {
    STATE.prefs.fontFamily = e.target.value;
    savePrefs();
    applyTheme();
  };
  $("#ttsRate").onchange = (e) => {
    STATE.prefs.ttsRate = e.target.value;
    savePrefs();
  };
  $("#ttsVoice").onchange = (e) => {
    STATE.prefs.ttsVoice = e.target.value;
    savePrefs();
  };
  const onCb = $("#ttsOnlineToggle");
  if (onCb) {
    onCb.onchange = (e) => {
      STATE.prefs.ttsOnline = e.target.checked;
      savePrefs();
      applyTtsModeUI();
      stopTTS();
    };
  }

  // 閱讀器
  $("#readerClose").onclick = closeReader;
  $("#readerPrev").onclick = () => navReader(-1);
  $("#readerNext").onclick = () => navReader(1);
  $("#readerTTS").onclick = toggleTTS;

  // 閱讀器內字型快控
  $("#readerAaBtn").onclick = () => {
    const bar = $("#readerFontBar");
    const open = bar.classList.toggle("hide");
    $("#readerAaBtn").classList.toggle("on", !open);
  };
  $$(".rfb-fs button").forEach((b) => {
    b.onclick = () => {
      STATE.prefs.fontSize = b.dataset.fs;
      savePrefs();
      applyTheme();
    };
  });
  $("#readerFontFamily").onchange = (e) => {
    STATE.prefs.fontFamily = e.target.value;
    savePrefs();
    applyTheme();
  };

  // 鍵盤：左右翻頁、Esc 關閉
  document.addEventListener("keydown", (e) => {
    if (!$("#reader").classList.contains("open")) return;
    if (e.key === "Escape") closeReader();
    if (e.key === "ArrowLeft") navReader(-1);
    if (e.key === "ArrowRight") navReader(1);
  });

  // URL ?story=<id> 自動開啟 (從推播通知點過來、首次開啟)
  const params = new URLSearchParams(location.search);
  const sid = params.get("story");
  if (sid) {
    setTimeout(() => openReader(sid), 100);
    history.replaceState({}, "", location.pathname);
  }

  // PWA 已開著時，service worker 用 postMessage 通知要開哪則
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "open-story" && e.data.id) {
        switchTab("home");
        openReader(e.data.id);
      }
    });
  }
}

async function init() {
  $("#dateLabel").textContent = fmtDate();
  applyTheme();
  await loadData();
  renderHome();
  renderBookChips();
  renderKepanTree();
  renderSearchResults();
  renderSettings();
  populateVoices();
  if ("speechSynthesis" in window) {
    speechSynthesis.addEventListener("voiceschanged", populateVoices);
  }
  bindEvents();

  // Service worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW reg failed", e));
  }
}

init();
