// Shared configuration, application state and persistence. No UI initialization here.
export const STORAGE_KEYS = {
    diceSettings: "dc_diceSettings",
    diceHistory: "dc_diceHistory",
    coinSettings: "dc_coinSettings",
    coinHistory: "dc_coinHistory",
};

export const DEFAULT_DICE_SETTINGS = { count: 1, faces: 6 };
export const DEFAULT_COIN_SETTINGS = { count: 1, emphasizeSides: false };

export const DICE_TYPES = [6, 8, 10, 12, 20, 100];
export const HISTORY_LIMIT = 10;
export const ANIM_MS = 950;
export const THREE_URL = new URL("../assets/vendor/three/three.module.js", import.meta.url).href;
export const CANNON_URL = new URL("../assets/vendor/cannon-es/cannon-es.js", import.meta.url).href;
export const PHYSICS_STEP = 1 / 60;
export const MAX_PHYSICS_STEPS = 420;
export const MIN_PHYSICS_STEPS = 120;
export const MAX_ROLL_ATTEMPTS = 10;
export const TABLE_WIDTH = 7.2;
export const TABLE_DEPTH = 5.2;
export const DIE_RADIUS = 0.544; // 15% smaller; shared by visual geometry and collision shapes.
export const COIN_RADIUS = 0.58;
export const COIN_THICKNESS = 0.09;
export const COIN_IMAGES = {
    heads: "assets/images/lincoln-memorial-heads.webp",
    tails: "assets/images/lincoln-memorial-tails.webp",
};
export const DICE_COLORS = [
    { body: 0xc93636, edge: 0x762020, ink: "#ffffff" },
    { body: 0x2868c7, edge: 0x163b78, ink: "#ffffff" },
    { body: 0xf0c431, edge: 0x8c6c0d, ink: "#241d08" },
];

export const state = {
    diceSettings: normalizeDiceSettings(loadJSON(STORAGE_KEYS.diceSettings, DEFAULT_DICE_SETTINGS)),
    coinSettings: { ...DEFAULT_COIN_SETTINGS, ...loadJSON(STORAGE_KEYS.coinSettings, DEFAULT_COIN_SETTINGS) },
    diceHistory: loadJSON(STORAGE_KEYS.diceHistory, []),
    coinHistory: loadJSON(STORAGE_KEYS.coinHistory, []),
    isRolling: false,
    isTossing: false,
    settingsTarget: null, // 'dice' | 'coin'
    draft: null,
    clearTarget: null, // 'dice' | 'coin'
};

export const el = {};

export let THREE = null;
export let CANNON = null;

export async function load3DLibraries() {
    [THREE, CANNON] = await Promise.race([
        Promise.all([import(THREE_URL), import(CANNON_URL)]),
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error("3Dライブラリの読み込みがタイムアウトしました")), 8000);
        }),
    ]);
}

export function loadJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return structuredCloneSafe(fallback);
        const parsed = JSON.parse(raw);
        if (parsed === null || parsed === undefined) return structuredCloneSafe(fallback);
        return parsed;
    } catch (e) {
        return structuredCloneSafe(fallback);
    }
}

export function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        // localStorageが使用できない環境でもクラッシュさせない
        console.warn("localStorageへの保存に失敗しました:", e);
    }
}

export function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
}

export function normalizeDiceSettings(value) {
    const count = Number.isInteger(value?.count) ? clamp(value.count, 1, 3) : 1;
    const faces = DICE_TYPES.includes(Number(value?.faces)) ? Number(value.faces) : 6;
    return { count, faces };
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function secureRandomInt(max) {
    if (!window.crypto?.getRandomValues) {
        return 1 + Math.floor(Math.random() * max);
    }
    const range = 0x100000000;
    const limit = range - (range % max);
    const buffer = new Uint32Array(1);
    do {
        window.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return (buffer[0] % max) + 1;
}

export function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

export function captureBodyStates(bodies) {
    return bodies.map((body) => ({
            position: { x: body.position.x, y: body.position.y, z: body.position.z },
            quaternion: { x: body.quaternion.x, y: body.quaternion.y, z: body.quaternion.z, w: body.quaternion.w },
        }));
}
