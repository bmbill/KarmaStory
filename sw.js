// 業果故事 PWA — service worker
// 1) Cache-first 離線快取  2) push 事件顯示通知  3) 點擊通知開故事

const CACHE = "karma-stories-v5";
const AUDIO_CACHE = "karma-stories-audio-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./data/stories.json",
  "./data/quotes.json",
  "./data/kepan.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // 個別 add，缺一個檔不要整體失敗
      Promise.all(ASSETS.map((u) => c.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  const KEEP = new Set([CACHE, AUDIO_CACHE]);
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for HTML/JSON (拿到新內容)，cache fallback (離線時)
// 對預錄 mp3 (data/audio/*.mp3): cache-first，第一次播完就離線可用
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/data/audio/") && /\.(webm|mp3)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(AUDIO_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("./index.html")))
  );
});

// Web Push handler
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (_) {
    data = { title: "業果故事", body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "業果故事";
  const opts = {
    body: data.hook || data.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "karma-daily",
    data: { storyId: data.id || null },
    requireInteraction: false,
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.storyId;
  const scope = self.registration.scope;
  const urlWithStory = id ? `${scope}?story=${encodeURIComponent(id)}` : scope;

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      // 找已開啟的同源視窗
      const existing = cs.find((c) => c.url.startsWith(scope));
      if (existing) {
        // iOS Safari PWA 的 client.navigate() 不穩，改 postMessage
        existing.postMessage({ type: "open-story", id });
        return existing.focus();
      }
      // 沒開啟過 → 直接開 URL 帶 query string
      return self.clients.openWindow(urlWithStory);
    })
  );
});
