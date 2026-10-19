// Bump this version whenever a precached file changes.
const CACHE_PREFIX = "dice-and-coin-";
const CACHE_NAME = `${CACHE_PREFIX}20261019-1`;
const ASSETS = [
    "./", "./index.html", "./style.css", "./script.js", "./pwa.js",
    "./manifest.webmanifest",
    "./assets/icons/icon-180.png", "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png", "./assets/icons/icon-maskable-512.png",
    "./assets/vendor/three/three.module.js", "./assets/vendor/three/three.core.js",
    "./assets/vendor/cannon-es/cannon-es.js",
    "./assets/images/lincoln-memorial-heads.webp",
    "./assets/images/lincoln-memorial-tails.webp",
];
const assetURLs = new Set(ASSETS.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll([...assetURLs].map((url) => new Request(url, { cache: "reload" })));
        } catch (error) {
            await caches.delete(CACHE_NAME);
            throw error;
        }
        // Let updates wait until existing windows close, so a toss is never interrupted.
    })());
});

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    url.search = "";
    // Only the app shell and its fixed assets. Ads and external links use the network.
    if (!assetURLs.has(url.href)) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(url.href);
        return cached || fetch(event.request);
    })());
});
