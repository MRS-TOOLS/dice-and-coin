"use strict";

// Publish the shell as one release. Bump this whenever a shell file changes.
const CACHE_PREFIX = "dice-and-coin-";
const CACHE_NAME = CACHE_PREFIX + "20261021-1";
const NETWORK_TIMEOUT_MS = 8000;
const ROOT = new URL("./", self.registration.scope);
const INDEX_PATH = new URL("index.html", ROOT).pathname;
const APP_FILES = [
  "./",
  "./style.css",
  "./script.js?v=20261021-1",
  "./js/shared.js?v=20261021-1",
  "./js/scene.js?v=20261021-1",
  "./js/dice.js?v=20261021-1",
  "./js/coin.js?v=20261021-1",
  "./pwa.js",
  "./manifest.webmanifest",
  "./assets/icons/icon-180.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/vendor/three/three.module.js",
  "./assets/vendor/three/three.core.js",
  "./assets/vendor/cannon-es/cannon-es.js",
  "./assets/images/lincoln-memorial-heads.webp",
  "./assets/images/lincoln-memorial-tails.webp"
].map((path) => new URL(path, ROOT).href);

// Bound connection and body download time, including responses that never settle.
async function fetchComplete(request) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("App download timed out"));
      controller.abort();
    }, NETWORK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(request, { signal: controller.signal });
        if (!response.ok) throw new Error("App download failed: " + response.status);
        // A fresh Response removes redirect history for Safari navigation.
        const body = await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      })(),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      // Fetch every file before publishing any part of the new release.
      const responses = await Promise.all(APP_FILES.map((url) =>
        fetchComplete(new Request(url, { cache: "reload" }))));
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(APP_FILES.map((url, index) => cache.put(url, responses[index])));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // Do not skipWaiting: existing windows keep their complete previous release.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function unavailablePage() {
  return new Response(`<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ダイス＆コイン</title><body><main>
<h1>ダイス＆コインを開けませんでした</h1>
<p>必要なファイルを取得できませんでした。通信できる場所で、もう一度お試しください。</p>
<p>保存済みの記録や設定は削除していません。</p>
<p><a href="./">もう一度開く</a></p></main></body></html>`, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin) return;
  const isHome = request.mode === "navigate" &&
    (url.pathname === ROOT.pathname || url.pathname === INDEX_PATH);
  const key = isHome ? ROOT.href : url.href;
  if (!APP_FILES.includes(key)) return;

  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(key);
      if (cached) return cached;
    } catch (error) {
      // Cache storage failure must not block a usable network response.
    }
    try {
      // Do not overwrite a release file independently of the rest of the shell.
      return await fetchComplete(new Request(key, { cache: "reload" }));
    } catch (error) {
      return isHome ? unavailablePage() : Response.error();
    }
  })());
});

