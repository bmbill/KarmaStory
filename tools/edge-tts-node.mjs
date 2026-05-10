// Node 版 edge-tts client (用在本機，避開 Cloudflare IP 封鎖)
// 用法: import { synthesize } from "./edge-tts-node.mjs"

import WebSocket from "ws";
import { createHash, randomUUID } from "node:crypto";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SEC_MS_GEC_VERSION = "1-131.0.2903.86";
const WSS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

function secMsGec() {
  const winEpoch = 11644473600n;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  let ticks = nowSec + winEpoch;
  ticks -= ticks % 300n;
  ticks *= 10000000n;
  return createHash("sha256")
    .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`)
    .digest("hex")
    .toUpperCase();
}

function uuidNoDash() {
  return randomUUID().replace(/-/g, "").toUpperCase();
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])
  );
}

function parseBinaryFrame(buf) {
  if (buf.length < 2) return null;
  const headerLen = (buf[0] << 8) | buf[1];
  const audioStart = 2 + headerLen;
  if (buf.length <= audioStart) return null;
  return buf.subarray(audioStart);
}

export async function synthesize({
  text,
  voice = "zh-TW-HsiaoChenNeural",
  rate = "+0%",
  pitch = "+0Hz",
  format = "audio-24khz-48kbitrate-mono-mp3",
  timeoutMs = 60000,
} = {}) {
  if (!text || !text.trim()) throw new Error("empty text");

  const url =
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec()}` +
    `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
    `&ConnectionId=${uuidNoDash()}`;

  const ws = new WebSocket(url, {
    headers: {
      "User-Agent": UA,
      Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-CH-UA": '"Microsoft Edge";v="130", "Chromium";v="130", "Not?A_Brand";v="99"',
      "Sec-CH-UA-Arch": '"x86"',
      "Sec-CH-UA-Bitness": '"64"',
      "Sec-CH-UA-Full-Version": '"130.0.2849.68"',
      "Sec-CH-UA-Full-Version-List":
        '"Microsoft Edge";v="130.0.2849.68", "Chromium";v="130.0.6723.117", "Not?A_Brand";v="99.0.0.0"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Model": '""',
      "Sec-CH-UA-Platform": '"Windows"',
      "Sec-CH-UA-Platform-Version": '"15.0.0"',
    },
  });

  const requestId = uuidNoDash();
  const chunks = [];

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch (_) {}
      if (err) return reject(err);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (!total) return reject(new Error("no audio"));
      resolve(Buffer.concat(chunks, total));
    };
    const timer = setTimeout(() => finish(new Error("tts timeout")), timeoutMs);

    ws.on("open", () => {
      const config = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: "false",
                wordBoundaryEnabled: "false",
              },
              outputFormat: format,
            },
          },
        },
      };
      ws.send(
        `X-Timestamp:${new Date().toISOString()}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          JSON.stringify(config)
      );
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rate}' pitch='${pitch}'>${escapeXml(text)}</prosody>` +
        `</voice></speak>`;
      ws.send(
        `X-RequestId:${requestId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${new Date().toISOString()}\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml
      );
    });

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const text = data.toString("utf-8");
        if (/Path:\s*turn\.end/i.test(text)) {
          clearTimeout(timer);
          finish();
        }
        return;
      }
      const audio = parseBinaryFrame(data);
      if (audio && audio.length) chunks.push(audio);
    });

    ws.on("close", () => {
      clearTimeout(timer);
      finish();
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      finish(e);
    });
  });
}
