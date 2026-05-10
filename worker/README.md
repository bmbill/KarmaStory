# 業果故事推播 Worker — 部署步驟

完全在 Cloudflare 免費額度內。下面流程一次性 ~15 分鐘可以跑完。

## 0. 前置

- 註冊 [Cloudflare](https://cloudflare.com) 帳號 (免費)
- 安裝 wrangler：`npm install -g wrangler`
- 登入：`wrangler login`

## 1. 建兩個 KV namespace

```bash
cd worker
wrangler kv namespace create SUBS
wrangler kv namespace create STORIES
```

兩個指令各回傳一個 id，把它們填進 `wrangler.toml` 對應的 `id` 欄位。

## 2. 上傳 stories.json 到 STORIES KV

```bash
wrangler kv key put --binding=STORIES "stories" --path=../data/stories.json
```

(往後 stories.json 有更新就再跑一次)

## 3. 產 VAPID 金鑰

兩種方式：

**(a) 部署後用 Worker 產：**
先把 `VAPID_PRIVATE_JWK` 設個假值跑 `wrangler deploy`，然後 GET `https://你的worker.workers.dev/generate-vapid`，回傳裡的 publicKey 和 privateKeyJwk 拿出來用。

**(b) 本機 Node 一行產：**
```bash
node -e "const { webcrypto: c } = require('crypto'); c.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']).then(async k=>{const pub=Buffer.from(await c.subtle.exportKey('raw',k.publicKey)).toString('base64url');const priv=await c.subtle.exportKey('jwk',k.privateKey);console.log('VAPID_PUBLIC=',pub);console.log('VAPID_PRIVATE_JWK=',JSON.stringify(priv));});"
```

## 4. 設環境變數

把 publicKey 寫進 `wrangler.toml` 的 `VAPID_PUBLIC`。

把 privateKeyJwk (整個 JSON 字串) 設為 secret：
```bash
wrangler secret put VAPID_PRIVATE_JWK
# 貼上 {"crv":"P-256","kty":"EC","x":"...","y":"...","d":"..."}
```

## 5. 部署

```bash
wrangler deploy
```

部署後拿到網址 (`https://karma-stories-push.<你帳號>.workers.dev`)。

## 6. 更新前端

編輯 [`../app.js`](../app.js) 最上方：

```js
const VAPID_PUBLIC = "你的 publicKey";
const WORKER_URL = "https://karma-stories-push.<你帳號>.workers.dev";
```

## 7. 測試

1. 部署前端 (Cloudflare Pages 或本機 `python -m http.server`)
2. 用手機/桌面 Chrome 開啟，到「設定」開啟推播
3. 按「試推送一則」應該幾秒後收到通知
4. cron 預設每 10 分鐘檢查一次，依設定時間自動推

## 偵錯

- `wrangler tail` 即時看 Worker log
- 推送失敗 410/404 → Worker 會自動刪除失效訂閱
- 沒收到 → 檢查瀏覽器 Notification 權限、PWA 是否已安裝主畫面 (iOS 必要)

## 多使用者

每個訂閱獨立存 prefs，cron 各自比對本地時區的設定時間。家人朋友共用同一個 Worker，互不干擾，免費額度也夠。
