// Web Push (RFC 8291 / 8292) 從頭實作，僅用 Web Crypto API。
// 在 Cloudflare Workers / Deno / 瀏覽器 service worker 都能跑。

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64UrlEncode(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...bufs) {
  const total = bufs.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) {
    out.set(new Uint8Array(b), off);
    off += b.byteLength;
  }
  return out;
}

async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey("raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
}

async function hkdfExpand(prk, info, length) {
  const key = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const out = new Uint8Array(length);
  let prev = new Uint8Array(0);
  let off = 0;
  for (let i = 1; off < length; i++) {
    prev = new Uint8Array(await crypto.subtle.sign("HMAC", key, concat(prev, info, new Uint8Array([i]))));
    const take = Math.min(prev.length, length - off);
    out.set(prev.subarray(0, take), off);
    off += take;
  }
  return out;
}

async function importEcdhPublic(rawUncompressed) {
  return crypto.subtle.importKey(
    "raw",
    rawUncompressed,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
}

async function generateEcdhKeypair() {
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
}

async function exportEcdhPublicRaw(key) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

// VAPID — sign a JWT (header+payload as ES256)
export async function signVapid(privateKeyJwk, audience, subject) {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 60 * 60, sub: subject };
  const segs = [
    b64UrlEncode(enc.encode(JSON.stringify(header))),
    b64UrlEncode(enc.encode(JSON.stringify(payload))),
  ];
  const data = enc.encode(segs.join("."));
  const key = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
  return segs.join(".") + "." + b64UrlEncode(sig);
}

// 產一支新的 VAPID 金鑰對 — 拿來部署用
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: b64UrlEncode(pubRaw),
    privateKeyJwk: privJwk,
  };
}

// AES128GCM payload encryption per RFC 8291
async function encryptPayload(payload, p256dhRaw, authSecret) {
  const ephemeral = await generateEcdhKeypair();
  const ephemeralPubRaw = await exportEcdhPublicRaw(ephemeral.publicKey);
  const subscriberPubKey = await importEcdhPublic(p256dhRaw);

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPubKey },
    ephemeral.privateKey,
    256
  );

  // PRK_key = HKDF(authSecret, sharedSecret, "WebPush: info" + ua_pub + as_pub, 32)
  const keyInfo = concat(
    enc.encode("WebPush: info\0"),
    p256dhRaw,
    ephemeralPubRaw
  );
  const prkKey = await hkdfExtract(authSecret, new Uint8Array(sharedSecret));
  // hkdfExpand 內部會自動 append 0x01，外部不能再手動加
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // Salt: 16 random bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, enc.encode("Content-Encoding: nonce\0"), 12);

  // Pad: payload + 0x02 (final-record delimiter); add 0x00 padding bytes if you want
  const plaintext = concat(payload, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plaintext)
  );

  // Build header: salt(16) | rs(4, big endian) | idlen(1) | keyid(idlen)
  // For aes128gcm web push: keyid is the ephemeral public key (65 bytes uncompressed)
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + ephemeralPubRaw.length);
  header.set(salt, 0);
  // record size as big-endian uint32
  header[16] = (rs >>> 24) & 0xff;
  header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = ephemeralPubRaw.length;
  header.set(ephemeralPubRaw, 21);

  return concat(header, ciphertext);
}

// 主出口：對單一訂閱推一則 payload (string)
export async function sendPush(subscription, payloadString, vapid) {
  const url = new URL(subscription.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await signVapid(vapid.privateKeyJwk, audience, vapid.subject);

  const p256dh = b64UrlDecode(subscription.keys.p256dh);
  const auth = b64UrlDecode(subscription.keys.auth);
  const body = await encryptPayload(enc.encode(payloadString), p256dh, auth);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    },
    body,
  });
  return res;
}
