// ========================================
// MRS WORKS - DICE & COIN
// Main JavaScript
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    init();
});

// ========================================
// Constants
// ========================================

const STORAGE_KEYS = {
    diceSettings: "dc_diceSettings",
    diceHistory: "dc_diceHistory",
    coinSettings: "dc_coinSettings",
    coinHistory: "dc_coinHistory",
};

const DEFAULT_DICE_SETTINGS = { count: 1, faces: 6 };
const DEFAULT_COIN_SETTINGS = { count: 1 };

const DICE_TYPES = [4, 6, 8, 10, 12, 20];
const HISTORY_LIMIT = 10;
const ANIM_MS = 950;
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
const CANNON_URL = "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js";
const PHYSICS_ROLL_MS = 1250;
const SETTLE_MS = 480;
const TABLE_WIDTH = 7.2;
const TABLE_DEPTH = 5.2;
const DIE_RADIUS = 0.7;

let THREE = null;
let CANNON = null;
let diceEnginePromise = null;

const dice3d = {
    status: "loading",
    renderer: null,
    scene: null,
    camera: null,
    world: null,
    diceMaterial: null,
    dice: [],
    frameId: null,
    lastFrameTime: 0,
    rollStartedAt: 0,
    settleStartedAt: 0,
    phase: "idle",
    pendingResults: [],
    resizeObserver: null,
};

// ========================================
// State
// ========================================

const state = {
    diceSettings: normalizeDiceSettings(loadJSON(STORAGE_KEYS.diceSettings, DEFAULT_DICE_SETTINGS)),
    coinSettings: loadJSON(STORAGE_KEYS.coinSettings, DEFAULT_COIN_SETTINGS),
    diceHistory: loadJSON(STORAGE_KEYS.diceHistory, []),
    coinHistory: loadJSON(STORAGE_KEYS.coinHistory, []),
    isRolling: false,
    isTossing: false,
    settingsTarget: null, // 'dice' | 'coin'
    draft: null,
    clearTarget: null, // 'dice' | 'coin'
};

// ========================================
// Storage helpers
// ========================================

function loadJSON(key, fallback) {
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

function saveJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        // localStorageが使用できない環境でもクラッシュさせない
        console.warn("localStorageへの保存に失敗しました:", e);
    }
}

function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeDiceSettings(value) {
    const count = Number.isInteger(value?.count) ? clamp(value.count, 1, 3) : 1;
    const faces = DICE_TYPES.includes(Number(value?.faces)) ? Number(value.faces) : 6;
    return { count, faces };
}

// ========================================
// DOM references
// ========================================

const el = {};

function cacheEls() {
    el.tabBtns = document.querySelectorAll(".tab-btn");
    el.panels = document.querySelectorAll(".panel");
    el.settingsBtn = document.getElementById("settingsBtn");

    el.diceStage = document.getElementById("diceStage");
    el.diceResultArea = document.getElementById("diceResultArea");
    el.rollBtn = document.getElementById("rollBtn");
    el.diceHistoryList = document.getElementById("diceHistoryList");

    el.coinStage = document.getElementById("coinStage");
    el.coinResultArea = document.getElementById("coinResultArea");
    el.tossBtn = document.getElementById("tossBtn");
    el.coinHistoryList = document.getElementById("coinHistoryList");

    el.settingsModal = document.getElementById("settingsModal");
    el.settingsBodyDice = document.querySelector('.modal-body[data-settings="dice"]');
    el.settingsBodyCoin = document.querySelector('.modal-body[data-settings="coin"]');
    el.diceCountValue = document.getElementById("diceCountValue");
    el.diceTypeBtns = document.querySelectorAll(".dice-type-btn");
    el.coinCountValue = document.getElementById("coinCountValue");
    el.settingsCancelBtn = document.getElementById("settingsCancelBtn");
    el.settingsConfirmBtn = document.getElementById("settingsConfirmBtn");

    el.confirmDialog = document.getElementById("confirmDialog");
    el.confirmCancelBtn = document.getElementById("confirmCancelBtn");
    el.confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
}

// ========================================
// Initialization
// ========================================

function init() {
    cacheEls();

    renderDiceStage();
    renderCoinStage();
    renderHistory("dice");
    renderHistory("coin");

    bindTabEvents();
    bindActionEvents();
    bindSettingsEvents();
    bindClearEvents();

    setupAdHeightSync();

    diceEnginePromise = initDiceEngine();

    console.log("DICE & COIN initialized");
}

// ========================================
// Ad banner height sync
// 広告は外部スクリプトが後から読み込まれ高さが変動するため、
// 実際の高さを計測して --ad-height に反映し、
// 履歴やボタンが広告に隠れないようにする。
// ========================================

function setupAdHeightSync() {
    const adBanner = document.querySelector(".ad-banner");
    if (!adBanner) return;

    const applyHeight = () => {
        const h = adBanner.offsetHeight;
        if (h > 0) {
            document.documentElement.style.setProperty("--ad-height", `${h}px`);
        }
    };

    applyHeight();

    if (window.ResizeObserver) {
        const observer = new ResizeObserver(applyHeight);
        observer.observe(adBanner);
    }

    // 広告の外部スクリプトは非同期で読み込まれ、直後は高さが0の場合があるため
    // 読み込み後の複数タイミングで再計測してフォールバックする。
    [300, 800, 1500, 3000].forEach((delay) => setTimeout(applyHeight, delay));
}

// ========================================
// Tabs
// ========================================

function bindTabEvents() {
    el.tabBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.dataset.tab;
            switchTab(target);
        });
    });
}

function switchTab(target) {
    el.tabBtns.forEach((btn) => {
        const isActive = btn.dataset.tab === target;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-selected", String(isActive));
    });
    el.panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.panel === target);
    });

    if (target === "dice" && dice3d.status === "ready") {
        requestAnimationFrame(() => {
            resizeDiceRenderer();
            renderDiceFrame();
        });
    }
}

function getActiveTab() {
    const activeBtn = document.querySelector(".tab-btn.is-active");
    return activeBtn ? activeBtn.dataset.tab : "dice";
}

// ========================================
// Dice stage rendering
// ========================================

function renderDiceStage() {
    if (dice3d.status === "ready") {
        rebuildDiceScene();
    } else if (dice3d.status === "error") {
        setStageStatus("3D表示を読み込めませんでした。出目は数値で表示します。", true);
    } else {
        setStageStatus("3Dダイスを準備しています…");
    }
    el.diceResultArea.innerHTML = '<p class="result-hint">ROLLを押してください</p>';
}

function setStageStatus(message, isError = false) {
    el.diceStage.innerHTML = "";
    const status = document.createElement("p");
    status.className = `stage-status${isError ? " stage-status--error" : ""}`;
    status.textContent = message;
    el.diceStage.appendChild(status);
}

async function initDiceEngine() {
    try {
        [THREE, CANNON] = await Promise.race([
            Promise.all([import(THREE_URL), import(CANNON_URL)]),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error("3Dライブラリの読み込みがタイムアウトしました")), 8000);
            }),
        ]);

        const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setClearColor(0x101010, 1);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.setAttribute("role", "img");
        renderer.domElement.setAttribute("aria-label", "テーブル上の3Dダイス");

        const scene = new THREE.Scene();
        scene.fog = new THREE.Fog(0x101010, 11, 18);

        const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
        camera.position.set(0, 7.1, 8.2);
        camera.lookAt(0, 0.25, 0);

        const ambient = new THREE.HemisphereLight(0xffe8d8, 0x18110d, 1.7);
        scene.add(ambient);

        const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
        keyLight.position.set(-3.5, 8, 5);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.left = -6;
        keyLight.shadow.camera.right = 6;
        keyLight.shadow.camera.top = 6;
        keyLight.shadow.camera.bottom = -6;
        scene.add(keyLight);

        const rimLight = new THREE.DirectionalLight(0xff8a3d, 1.15);
        rimLight.position.set(5, 4, -3);
        scene.add(rimLight);

        const table = new THREE.Mesh(
            new THREE.BoxGeometry(TABLE_WIDTH, 0.24, TABLE_DEPTH),
            new THREE.MeshStandardMaterial({
                color: 0x18251d,
                roughness: 0.92,
                metalness: 0.02,
            }),
        );
        table.position.y = -0.14;
        table.receiveShadow = true;
        scene.add(table);

        const tableEdge = new THREE.LineSegments(
            new THREE.EdgesGeometry(table.geometry),
            new THREE.LineBasicMaterial({ color: 0x3e4a42, transparent: true, opacity: 0.65 }),
        );
        tableEdge.position.copy(table.position);
        scene.add(tableEdge);

        const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
        world.allowSleep = true;
        world.broadphase = new CANNON.SAPBroadphase(world);
        world.solver.iterations = 12;

        const floorMaterial = new CANNON.Material("table");
        const diceMaterial = new CANNON.Material("dice");
        world.addContactMaterial(new CANNON.ContactMaterial(floorMaterial, diceMaterial, {
            friction: 0.32,
            restitution: 0.48,
        }));
        world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
            friction: 0.22,
            restitution: 0.36,
        }));

        const floorBody = new CANNON.Body({ mass: 0, material: floorMaterial });
        floorBody.addShape(new CANNON.Plane());
        floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        world.addBody(floorBody);

        addPhysicsWalls(world, floorMaterial);

        dice3d.renderer = renderer;
        dice3d.scene = scene;
        dice3d.camera = camera;
        dice3d.world = world;
        dice3d.diceMaterial = diceMaterial;
        dice3d.status = "ready";

        el.diceStage.innerHTML = "";
        el.diceStage.appendChild(renderer.domElement);
        resizeDiceRenderer();
        rebuildDiceScene();

        if (window.ResizeObserver) {
            dice3d.resizeObserver = new ResizeObserver(() => {
                resizeDiceRenderer();
                renderDiceFrame();
            });
            dice3d.resizeObserver.observe(el.diceStage);
        } else {
            window.addEventListener("resize", () => {
                resizeDiceRenderer();
                renderDiceFrame();
            });
        }
    } catch (error) {
        console.error("3Dダイスの初期化に失敗しました:", error);
        dice3d.status = "error";
        setStageStatus("3D表示を読み込めませんでした。出目は数値で表示します。", true);
    }
}

function addPhysicsWalls(world, material) {
    const wallHeight = 2.4;
    const wallThickness = 0.25;
    const configs = [
        { size: [wallThickness, wallHeight, TABLE_DEPTH], position: [-TABLE_WIDTH / 2, wallHeight / 2, 0] },
        { size: [wallThickness, wallHeight, TABLE_DEPTH], position: [TABLE_WIDTH / 2, wallHeight / 2, 0] },
        { size: [TABLE_WIDTH, wallHeight, wallThickness], position: [0, wallHeight / 2, -TABLE_DEPTH / 2] },
        { size: [TABLE_WIDTH, wallHeight, wallThickness], position: [0, wallHeight / 2, TABLE_DEPTH / 2] },
    ];

    configs.forEach(({ size, position }) => {
        const body = new CANNON.Body({ mass: 0, material });
        body.addShape(new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2)));
        body.position.set(position[0], position[1], position[2]);
        world.addBody(body);
    });
}

function resizeDiceRenderer() {
    if (dice3d.status !== "ready") return;
    const width = el.diceStage.clientWidth;
    const height = el.diceStage.clientHeight;
    if (!width || !height) return;
    dice3d.renderer.setSize(width, height, false);
    dice3d.camera.aspect = width / height;
    dice3d.camera.updateProjectionMatrix();
}

function rebuildDiceScene() {
    if (dice3d.status !== "ready") return;

    dice3d.dice.forEach((die) => {
        dice3d.scene.remove(die.group);
        dice3d.world.removeBody(die.body);
        disposeObject3D(die.group);
    });
    dice3d.dice = [];

    const { count, faces } = state.diceSettings;
    const spec = createDieSpec(faces);
    const positions = getFinalPositions(count);

    for (let i = 0; i < count; i++) {
        const group = createDieVisual(spec);
        const shape = new CANNON.ConvexPolyhedron({
            vertices: spec.vertices.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
            faces: spec.faces.map((face) => [...face]),
        });
        const body = new CANNON.Body({
            mass: 1,
            material: dice3d.diceMaterial,
            shape,
            linearDamping: 0.1,
            angularDamping: 0.12,
            sleepSpeedLimit: 0.08,
            sleepTimeLimit: 0.35,
        });
        const targetQuaternion = getTargetQuaternion(spec, 1, i * 0.8);
        const restY = getRestHeight(spec, targetQuaternion);
        body.position.set(positions[i].x, restY, positions[i].z);
        body.quaternion.set(
            targetQuaternion.x,
            targetQuaternion.y,
            targetQuaternion.z,
            targetQuaternion.w,
        );
        body.type = CANNON.Body.STATIC;
        body.mass = 0;
        body.updateMassProperties();
        dice3d.world.addBody(body);
        dice3d.scene.add(group);

        dice3d.dice.push({
            group,
            body,
            spec,
            targetQuaternion,
            settleFromQuaternion: null,
            settleFromPosition: null,
            targetPosition: positions[i],
        });
    }

    syncDiceMeshes();
    renderDiceFrame();
}

function disposeObject3D(root) {
    root.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) {
            child.material.forEach(disposeMaterial);
        } else {
            disposeMaterial(child.material);
        }
    });
}

function disposeMaterial(material) {
    if (!material) return;
    material.map?.dispose?.();
    material.dispose?.();
}

function createDieVisual(spec) {
    const group = new THREE.Group();
    const positions = [];

    spec.faces.forEach((face) => {
        for (let i = 1; i < face.length - 1; i++) {
            [face[0], face[i], face[i + 1]].forEach((index) => {
                const vertex = spec.vertices[index];
                positions.push(vertex.x, vertex.y, vertex.z);
            });
        }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        color: 0x242424,
        roughness: 0.42,
        metalness: 0.08,
        flatShading: true,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 12),
        new THREE.LineBasicMaterial({ color: 0x6b6b6b, transparent: true, opacity: 0.72 }),
    );
    group.add(edges);

    if (spec.sides === 4) {
        spec.faces.forEach((face) => {
            const { center } = getFaceFrame(spec, face);
            face.forEach((vertexIndex) => {
                const vertex = spec.vertices[vertexIndex];
                const labelCenter = {
                    x: center.x + (vertex.x - center.x) * 0.58,
                    y: center.y + (vertex.y - center.y) * 0.58,
                    z: center.z + (vertex.z - center.z) * 0.58,
                };
                group.add(createFaceLabel(spec, face, vertexIndex + 1, labelCenter, 0.2));
            });
        });
    } else {
        spec.faces.forEach((face, index) => {
            group.add(createFaceLabel(spec, face, index + 1));
        });
    }

    return group;
}

function createFaceLabel(spec, face, value, customCenter = null, customSize = null) {
    const { center: faceCenter, normal } = getFaceFrame(spec, face);
    const center = customCenter || faceCenter;
    const texture = createFaceTexture(value, spec.sides);
    const labelSize = customSize || (spec.sides >= 12 ? 0.34 : spec.sides >= 8 ? 0.4 : 0.46);
    const geometry = new THREE.PlaneGeometry(labelSize, labelSize);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
    });
    const label = new THREE.Mesh(geometry, material);
    const normalVector = new THREE.Vector3(normal.x, normal.y, normal.z);
    label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normalVector);
    label.position.set(
        center.x + normal.x * 0.012,
        center.y + normal.y * 0.012,
        center.z + normal.z * 0.012,
    );
    return label;
}

function createFaceTexture(value, sides) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, 128, 128);

    if (sides === 6) {
        drawPips(context, value);
    } else {
        if (sides !== 4) {
            context.beginPath();
            context.arc(64, 64, 43, 0, Math.PI * 2);
            context.fillStyle = "rgba(8, 8, 8, 0.78)";
            context.fill();
            context.strokeStyle = "rgba(255, 138, 61, 0.8)";
            context.lineWidth = 4;
            context.stroke();
        }
        context.fillStyle = "#ff9a58";
        context.font = `800 ${sides === 4 ? 72 : value >= 10 ? 48 : 58}px -apple-system, BlinkMacSystemFont, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(String(value), 64, 67);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, dice3d.renderer.capabilities.getMaxAnisotropy());
    return texture;
}

function drawPips(context, value) {
    const points = {
        1: [[64, 64]],
        2: [[40, 40], [88, 88]],
        3: [[40, 40], [64, 64], [88, 88]],
        4: [[40, 40], [88, 40], [40, 88], [88, 88]],
        5: [[40, 40], [88, 40], [64, 64], [40, 88], [88, 88]],
        6: [[40, 35], [88, 35], [40, 64], [88, 64], [40, 93], [88, 93]],
    };
    context.fillStyle = "#ff9a58";
    points[value].forEach(([x, y]) => {
        context.beginPath();
        context.arc(x, y, 10, 0, Math.PI * 2);
        context.fill();
    });
}

function createDieSpec(sides) {
    const phi = (1 + Math.sqrt(5)) / 2;
    const invPhi = 1 / phi;
    let vertices;

    if (sides === 4) {
        vertices = [
            [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1],
        ];
    } else if (sides === 6) {
        vertices = [];
        [-1, 1].forEach((x) => [-1, 1].forEach((y) => [-1, 1].forEach((z) => {
            vertices.push([x, y, z]);
        })));
    } else if (sides === 8) {
        vertices = [
            [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
        ];
    } else if (sides === 10) {
        vertices = createD10Vertices();
    } else if (sides === 12) {
        vertices = [
            ...cartesianSigns([1, 1, 1]),
            ...cartesianSigns([0, invPhi, phi], true),
            ...cartesianSigns([invPhi, phi, 0], true),
            ...cartesianSigns([phi, 0, invPhi], true),
        ];
    } else {
        vertices = [
            ...cartesianSigns([0, 1, phi], true),
            ...cartesianSigns([1, phi, 0], true),
            ...cartesianSigns([phi, 0, 1], true),
        ];
    }

    const uniqueVertices = dedupeVertices(vertices).map(([x, y, z]) => ({ x, y, z }));
    const maxRadius = Math.max(...uniqueVertices.map((v) => Math.hypot(v.x, v.y, v.z)));
    uniqueVertices.forEach((v) => {
        const scale = DIE_RADIUS / maxRadius;
        v.x *= scale;
        v.y *= scale;
        v.z *= scale;
    });
    const faces = buildConvexFaces(uniqueVertices);

    if (faces.length !== sides) {
        throw new Error(`D${sides}の面生成に失敗しました: ${faces.length}面`);
    }

    return { sides, vertices: uniqueVertices, faces };
}

function createD10Vertices() {
    const vertices = [[0, 1.25, 0], [0, -1.25, 0]];
    const ringRadius = 1;
    const c = Math.cos(Math.PI / 5);
    const offset = 1.25 * (1 - c) / (1 + c);
    for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5;
        const y = i % 2 === 0 ? -offset : offset;
        vertices.push([Math.cos(angle) * ringRadius, y, Math.sin(angle) * ringRadius]);
    }
    return vertices;
}

function cartesianSigns(base, preserveZero = false) {
    const values = [];
    const xs = base[0] === 0 && preserveZero ? [0] : [-base[0], base[0]];
    const ys = base[1] === 0 && preserveZero ? [0] : [-base[1], base[1]];
    const zs = base[2] === 0 && preserveZero ? [0] : [-base[2], base[2]];
    xs.forEach((x) => ys.forEach((y) => zs.forEach((z) => values.push([x, y, z]))));
    return values;
}

function dedupeVertices(vertices) {
    const seen = new Set();
    return vertices.filter((vertex) => {
        const key = vertex.map((value) => value.toFixed(8)).join(",");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildConvexFaces(vertices) {
    const epsilon = 1e-5;
    const found = new Map();

    for (let a = 0; a < vertices.length - 2; a++) {
        for (let b = a + 1; b < vertices.length - 1; b++) {
            for (let c = b + 1; c < vertices.length; c++) {
                const ab = subtract(vertices[b], vertices[a]);
                const ac = subtract(vertices[c], vertices[a]);
                let normal = cross(ab, ac);
                const length = magnitude(normal);
                if (length < epsilon) continue;
                normal = scaleVector(normal, 1 / length);
                let distance = dot(normal, vertices[a]);
                const offsets = vertices.map((vertex) => dot(normal, vertex) - distance);
                const hasPositive = offsets.some((value) => value > epsilon);
                const hasNegative = offsets.some((value) => value < -epsilon);
                if (hasPositive && hasNegative) continue;

                let indices = offsets
                    .map((value, index) => Math.abs(value) <= epsilon ? index : -1)
                    .filter((index) => index >= 0);
                if (indices.length < 3) continue;

                const center = averageVertices(indices.map((index) => vertices[index]));
                if (dot(normal, center) < 0) {
                    normal = scaleVector(normal, -1);
                    distance *= -1;
                }

                const key = [...indices].sort((x, y) => x - y).join("-");
                if (found.has(key)) continue;
                indices = sortFaceIndices(indices, vertices, center, normal);
                found.set(key, indices);
            }
        }
    }

    return [...found.values()].sort((faceA, faceB) => {
        const centerA = averageVertices(faceA.map((index) => vertices[index]));
        const centerB = averageVertices(faceB.map((index) => vertices[index]));
        return centerB.y - centerA.y || centerA.z - centerB.z || centerA.x - centerB.x;
    });
}

function sortFaceIndices(indices, vertices, center, normal) {
    const firstDirection = normalize(subtract(vertices[indices[0]], center));
    const secondDirection = normalize(cross(normal, firstDirection));
    const sorted = [...indices].sort((indexA, indexB) => {
        const relA = subtract(vertices[indexA], center);
        const relB = subtract(vertices[indexB], center);
        const angleA = Math.atan2(dot(relA, secondDirection), dot(relA, firstDirection));
        const angleB = Math.atan2(dot(relB, secondDirection), dot(relB, firstDirection));
        return angleA - angleB;
    });
    const edgeA = subtract(vertices[sorted[1]], vertices[sorted[0]]);
    const edgeB = subtract(vertices[sorted[2]], vertices[sorted[1]]);
    if (dot(cross(edgeA, edgeB), normal) < 0) sorted.reverse();
    return sorted;
}

function getFaceFrame(spec, face) {
    const points = face.map((index) => spec.vertices[index]);
    const center = averageVertices(points);
    const edgeA = subtract(points[1], points[0]);
    const edgeB = subtract(points[2], points[1]);
    let normal = normalize(cross(edgeA, edgeB));
    if (dot(normal, center) < 0) normal = scaleVector(normal, -1);
    return { center, normal };
}

function averageVertices(vertices) {
    const total = vertices.reduce((sum, vertex) => ({
        x: sum.x + vertex.x,
        y: sum.y + vertex.y,
        z: sum.z + vertex.z,
    }), { x: 0, y: 0, z: 0 });
    return scaleVector(total, 1 / vertices.length);
}

function subtract(a, b) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(vector) {
    return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector) {
    const length = magnitude(vector);
    return length ? scaleVector(vector, 1 / length) : { x: 0, y: 1, z: 0 };
}

function scaleVector(vector, factor) {
    return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

// ========================================
// Coin stage rendering
// ========================================

function renderCoinStage() {
    el.coinStage.innerHTML = "";
    const { count } = state.coinSettings;

    for (let i = 0; i < count; i++) {
        el.coinStage.appendChild(createCoinElement());
    }

    el.coinResultArea.innerHTML = '<p class="result-hint">TOSSを押してください</p>';
}

function createCoinElement() {
    const wrap = document.createElement("div");
    wrap.className = "coin-wrap";

    const coin = document.createElement("div");
    coin.className = "coin";
    coin.dataset.rot = "0";
    coin.dataset.result = "heads";

    const heads = document.createElement("div");
    heads.className = "coin-face coin-face--heads";

    const logo = document.createElement("img");
    logo.src = "assets/images/mrs games logo noback.png";
    logo.alt = "MRS GAMES";
    logo.className = "coin-logo";
    heads.appendChild(logo);

    const tails = document.createElement("div");
    tails.className = "coin-face coin-face--tails";

    coin.appendChild(heads);
    coin.appendChild(tails);
    wrap.appendChild(coin);

    return wrap;
}

// ========================================
// Roll (DICE)
// ========================================

function bindActionEvents() {
    el.rollBtn.addEventListener("click", rollDice);
    el.tossBtn.addEventListener("click", tossCoin);
}

async function rollDice() {
    if (state.isRolling) return;
    state.isRolling = true;
    setRollingUI(true);

    if (dice3d.status === "loading" && diceEnginePromise) {
        await diceEnginePromise;
    }

    const { count, faces } = state.diceSettings;
    const results = Array.from({ length: count }, () => secureRandomInt(faces));

    if (dice3d.status === "ready") {
        start3DRoll(results);
    } else {
        setTimeout(() => completeDiceRoll(results), 320);
    }
}

function secureRandomInt(max) {
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

function start3DRoll(results) {
    if (dice3d.dice.length !== results.length) rebuildDiceScene();
    dice3d.pendingResults = [...results];
    dice3d.phase = "physics";
    dice3d.rollStartedAt = performance.now();
    dice3d.settleStartedAt = 0;
    dice3d.lastFrameTime = 0;

    const finalPositions = getFinalPositions(results.length);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    dice3d.dice.forEach((die, index) => {
        const targetQuaternion = getTargetQuaternion(
            die.spec,
            results[index],
            secureRandomInt(360) * Math.PI / 180,
        );
        die.targetQuaternion = targetQuaternion;
        die.targetPosition = finalPositions[index];
        die.settleFromQuaternion = null;
        die.settleFromPosition = null;

        const body = die.body;
        body.type = CANNON.Body.DYNAMIC;
        body.mass = 1;
        body.updateMassProperties();
        body.position.set(
            finalPositions[index].x + randomBetween(-0.45, 0.45),
            3.4 + index * 0.35,
            -1.65 + randomBetween(-0.25, 0.25),
        );
        body.velocity.set(randomBetween(-1.4, 1.4), randomBetween(-0.6, 0.3), randomBetween(3.2, 4.5));
        body.angularVelocity.set(
            randomBetween(7, 12),
            randomBetween(7, 12),
            randomBetween(7, 12),
        );
        body.quaternion.setFromEuler(
            randomBetween(0, Math.PI * 2),
            randomBetween(0, Math.PI * 2),
            randomBetween(0, Math.PI * 2),
        );
        body.force.set(0, 0, 0);
        body.torque.set(0, 0, 0);
        body.wakeUp();
    });

    if (reduceMotion) {
        placeDiceAtResults();
        renderDiceFrame();
        setTimeout(() => completeDiceRoll(results), 60);
        return;
    }

    requestDiceAnimation();
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function requestDiceAnimation() {
    if (dice3d.frameId !== null) return;
    dice3d.frameId = requestAnimationFrame(animateDiceFrame);
}

function animateDiceFrame(timestamp) {
    dice3d.frameId = null;
    const deltaSeconds = dice3d.lastFrameTime
        ? Math.min((timestamp - dice3d.lastFrameTime) / 1000, 0.05)
        : 1 / 60;
    dice3d.lastFrameTime = timestamp;

    if (dice3d.phase === "physics") {
        dice3d.world.step(1 / 60, deltaSeconds, 3);
        if (timestamp - dice3d.rollStartedAt >= PHYSICS_ROLL_MS) {
            beginDiceSettle(timestamp);
        }
    }

    if (dice3d.phase === "settle") {
        updateDiceSettle(timestamp);
    }

    syncDiceMeshes();
    renderDiceFrame();

    if (dice3d.phase !== "idle") requestDiceAnimation();
}

function beginDiceSettle(timestamp) {
    dice3d.phase = "settle";
    dice3d.settleStartedAt = timestamp;
    dice3d.dice.forEach((die) => {
        die.settleFromQuaternion = new THREE.Quaternion(
            die.body.quaternion.x,
            die.body.quaternion.y,
            die.body.quaternion.z,
            die.body.quaternion.w,
        );
        die.settleFromPosition = new THREE.Vector3(
            die.body.position.x,
            Math.max(die.body.position.y, 0.3),
            die.body.position.z,
        );
        die.body.velocity.setZero();
        die.body.angularVelocity.setZero();
        die.body.type = CANNON.Body.KINEMATIC;
        die.body.updateMassProperties();
    });
}

function updateDiceSettle(timestamp) {
    const progress = clamp((timestamp - dice3d.settleStartedAt) / SETTLE_MS, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    dice3d.dice.forEach((die) => {
        const restY = getRestHeight(die.spec, die.targetQuaternion);
        const targetPosition = new THREE.Vector3(die.targetPosition.x, restY, die.targetPosition.z);
        const position = die.settleFromPosition.clone().lerp(targetPosition, eased);
        const quaternion = die.settleFromQuaternion.clone().slerp(die.targetQuaternion, eased);
        die.body.position.set(position.x, position.y, position.z);
        die.body.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    });

    if (progress >= 1) {
        const results = [...dice3d.pendingResults];
        placeDiceAtResults();
        completeDiceRoll(results);
    }
}

function placeDiceAtResults() {
    dice3d.dice.forEach((die) => {
        const restY = getRestHeight(die.spec, die.targetQuaternion);
        die.body.type = CANNON.Body.STATIC;
        die.body.mass = 0;
        die.body.position.set(die.targetPosition.x, restY, die.targetPosition.z);
        die.body.quaternion.set(
            die.targetQuaternion.x,
            die.targetQuaternion.y,
            die.targetQuaternion.z,
            die.targetQuaternion.w,
        );
        die.body.velocity.setZero();
        die.body.angularVelocity.setZero();
        die.body.updateMassProperties();
    });
    dice3d.phase = "idle";
    dice3d.pendingResults = [];
    syncDiceMeshes();
}

function completeDiceRoll(results) {
    showDiceResult(results);
    pushDiceHistory(results);
    state.isRolling = false;
    setRollingUI(false);
}

function getTargetQuaternion(spec, value, yawAngle) {
    let resultDirection;
    if (spec.sides === 4) {
        resultDirection = spec.vertices[value - 1];
    } else {
        const face = spec.faces[value - 1];
        resultDirection = getFaceFrame(spec, face).normal;
    }
    const localNormal = new THREE.Vector3(
        resultDirection.x,
        resultDirection.y,
        resultDirection.z,
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const align = new THREE.Quaternion().setFromUnitVectors(localNormal, up);
    const yaw = new THREE.Quaternion().setFromAxisAngle(up, yawAngle);
    return yaw.multiply(align).normalize();
}

function getRestHeight(spec, quaternion) {
    let minY = Infinity;
    spec.vertices.forEach((vertex) => {
        const transformed = new THREE.Vector3(vertex.x, vertex.y, vertex.z).applyQuaternion(quaternion);
        minY = Math.min(minY, transformed.y);
    });
    return -minY + 0.016;
}

function getFinalPositions(count) {
    if (count === 1) return [{ x: 0, z: 0.15 }];
    if (count === 2) return [{ x: -1.05, z: 0.12 }, { x: 1.05, z: -0.08 }];
    return [
        { x: -1.55, z: 0.15 },
        { x: 0, z: -0.12 },
        { x: 1.55, z: 0.18 },
    ];
}

function syncDiceMeshes() {
    dice3d.dice.forEach((die) => {
        die.group.position.set(die.body.position.x, die.body.position.y, die.body.position.z);
        die.group.quaternion.set(
            die.body.quaternion.x,
            die.body.quaternion.y,
            die.body.quaternion.z,
            die.body.quaternion.w,
        );
    });
}

function renderDiceFrame() {
    if (dice3d.status !== "ready") return;
    dice3d.renderer.render(dice3d.scene, dice3d.camera);
}

// 現在値から見て、目的の余り(target)に到達する直近の値を返す
function roundToTarget(current, target) {
    const base = Math.floor(current / 360) * 360;
    let candidate = base + ((target % 360) + 360) % 360;
    if (candidate < current) candidate += 360;
    return candidate;
}

function showDiceResult(results) {
    const total = results.reduce((sum, v) => sum + v, 0);
    const valuesHtml = results.map((v) => `<span>${v}</span>`).join("");
    el.diceResultArea.innerHTML = `
        <div class="result-values">${valuesHtml}</div>
        <div class="result-total">合計 <strong>${total}</strong></div>
    `;
}

function pushDiceHistory(results) {
    const total = results.reduce((sum, v) => sum + v, 0);
    const entry = {
        faces: state.diceSettings.faces,
        count: results.length,
        results,
        total,
        time: formatTime(new Date()),
    };
    state.diceHistory.unshift(entry);
    if (state.diceHistory.length > HISTORY_LIMIT) {
        state.diceHistory.length = HISTORY_LIMIT;
    }
    saveJSON(STORAGE_KEYS.diceHistory, state.diceHistory);
    renderHistory("dice");
}

// ========================================
// Toss (COIN)
// ========================================

function tossCoin() {
    if (state.isTossing) return;
    state.isTossing = true;
    setTossingUI(true);

    const { count } = state.coinSettings;

    const results = [];
    for (let i = 0; i < count; i++) {
        results.push(Math.random() < 0.5 ? "heads" : "tails");
    }

    const coinEls = el.coinStage.querySelectorAll(".coin");
    coinEls.forEach((coin, i) => {
        animateCoin(coin, results[i]);
    });

    setTimeout(() => {
        showCoinResult(results);
        pushCoinHistory(results);
        state.isTossing = false;
        setTossingUI(false);
    }, ANIM_MS);
}

function animateCoin(coin, result) {
    const targetMod = result === "heads" ? 0 : 180;
    const cur = parseFloat(coin.dataset.rot) || 0;
    const spins = 360 * (2 + Math.floor(Math.random() * 2));
    const next = roundToTarget(cur, targetMod) + spins;

    coin.classList.add("is-tossing");
    coin.style.transform = `rotateY(${next}deg)`;
    coin.dataset.rot = String(next);
    coin.dataset.result = result;
}

function showCoinResult(results) {
    const labelOf = (r) => (r === "heads" ? "表" : "裏");
    if (results.length === 1) {
        el.coinResultArea.innerHTML = `
            <div class="result-values"><span>${labelOf(results[0])}</span></div>
        `;
        return;
    }
    const heads = results.filter((r) => r === "heads").length;
    const tails = results.length - heads;
    const valuesHtml = results.map((r) => `<span>${labelOf(r)}</span>`).join("");
    el.coinResultArea.innerHTML = `
        <div class="result-values">${valuesHtml}</div>
        <div class="result-total">表：${heads} / 裏：${tails}</div>
    `;
}

function pushCoinHistory(results) {
    const heads = results.filter((r) => r === "heads").length;
    const tails = results.length - heads;
    const entry = {
        count: results.length,
        results,
        heads,
        tails,
        time: formatTime(new Date()),
    };
    state.coinHistory.unshift(entry);
    if (state.coinHistory.length > HISTORY_LIMIT) {
        state.coinHistory.length = HISTORY_LIMIT;
    }
    saveJSON(STORAGE_KEYS.coinHistory, state.coinHistory);
    renderHistory("coin");
}

// ========================================
// Rolling / Tossing UI lock (連打防止)
// ========================================

function setRollingUI(isRolling) {
    el.rollBtn.disabled = isRolling;
    el.settingsBtn.disabled = isRolling || state.isTossing;
}

function setTossingUI(isTossing) {
    el.tossBtn.disabled = isTossing;
    el.settingsBtn.disabled = isTossing || state.isRolling;
}

// ========================================
// History rendering
// ========================================

function renderHistory(tab) {
    const list = tab === "dice" ? el.diceHistoryList : el.coinHistoryList;
    const data = tab === "dice" ? state.diceHistory : state.coinHistory;

    list.innerHTML = "";

    if (data.length === 0) {
        const li = document.createElement("li");
        li.className = "history-empty";
        li.textContent = "まだ履歴がありません";
        list.appendChild(li);
        return;
    }

    data.forEach((entry) => {
        list.appendChild(tab === "dice" ? renderDiceHistoryItem(entry) : renderCoinHistoryItem(entry));
    });
}

function renderDiceHistoryItem(entry) {
    const li = document.createElement("li");
    li.className = "history-item";
    li.innerHTML = `
        <div class="history-item-main">
            <span class="history-item-type">D${entry.faces} × ${entry.count}</span>
            <span class="history-item-values">${entry.results.join("・")}</span>
            <span class="history-item-summary">合計 ${entry.total}</span>
        </div>
        <span class="history-item-time">${entry.time}</span>
    `;
    return li;
}

function renderCoinHistoryItem(entry) {
    const li = document.createElement("li");
    li.className = "history-item";
    const labels = entry.results.map((r) => (r === "heads" ? "表" : "裏")).join("・");
    li.innerHTML = `
        <div class="history-item-main">
            <span class="history-item-type">COIN × ${entry.count}</span>
            <span class="history-item-values">${labels}</span>
            <span class="history-item-summary">表：${entry.heads} / 裏：${entry.tails}</span>
        </div>
        <span class="history-item-time">${entry.time}</span>
    `;
    return li;
}

function formatTime(date) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
}

// ========================================
// History clear (confirm dialog)
// ========================================

function bindClearEvents() {
    document.querySelectorAll(".clear-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            state.clearTarget = btn.dataset.clear;
            el.confirmDialog.hidden = false;
        });
    });

    el.confirmCancelBtn.addEventListener("click", () => {
        state.clearTarget = null;
        el.confirmDialog.hidden = true;
    });

    el.confirmDeleteBtn.addEventListener("click", () => {
        if (state.clearTarget === "dice") {
            state.diceHistory = [];
            saveJSON(STORAGE_KEYS.diceHistory, state.diceHistory);
            renderHistory("dice");
        } else if (state.clearTarget === "coin") {
            state.coinHistory = [];
            saveJSON(STORAGE_KEYS.coinHistory, state.coinHistory);
            renderHistory("coin");
        }
        state.clearTarget = null;
        el.confirmDialog.hidden = true;
    });
}

// ========================================
// Settings modal (完了ボタンで確定 / キャンセルで破棄)
// ========================================

function bindSettingsEvents() {
    el.settingsBtn.addEventListener("click", openSettingsModal);

    el.settingsModal.querySelectorAll(".stepper-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const targetKey = btn.dataset.target; // 'diceCount' | 'coinCount'
            const dir = btn.dataset.step === "inc" ? 1 : -1;
            adjustDraftCount(targetKey, dir);
        });
    });

    el.diceTypeBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            if (state.settingsTarget !== "dice") return;
            const faces = Number(btn.dataset.faces);
            if (DICE_TYPES.includes(faces)) {
                state.draft.faces = faces;
                renderSettingsDraft();
            }
        });
    });

    el.settingsCancelBtn.addEventListener("click", closeSettingsModal);
    el.settingsConfirmBtn.addEventListener("click", confirmSettings);

    // オーバーレイの背景タップはキャンセル扱い（変更を破棄）
    el.settingsModal.addEventListener("click", (e) => {
        if (e.target === el.settingsModal) closeSettingsModal();
    });
}

function openSettingsModal() {
    const tab = getActiveTab();
    state.settingsTarget = tab;

    if (tab === "dice") {
        state.draft = { ...state.diceSettings };
        el.settingsBodyDice.hidden = false;
        el.settingsBodyCoin.hidden = true;
    } else {
        state.draft = { ...state.coinSettings };
        el.settingsBodyDice.hidden = true;
        el.settingsBodyCoin.hidden = false;
    }

    renderSettingsDraft();
    el.settingsModal.hidden = false;
}

function closeSettingsModal() {
    state.draft = null;
    el.settingsModal.hidden = true;
}

function adjustDraftCount(targetKey, dir) {
    if (targetKey === "diceCount") {
        state.draft.count = clamp(state.draft.count + dir, 1, 3);
    } else if (targetKey === "coinCount") {
        state.draft.count = clamp(state.draft.count + dir, 1, 3);
    }
    renderSettingsDraft();
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function renderSettingsDraft() {
    if (state.settingsTarget === "dice") {
        el.diceCountValue.textContent = String(state.draft.count);
        el.diceTypeBtns.forEach((btn) => {
            const isSelected = Number(btn.dataset.faces) === state.draft.faces;
            btn.classList.toggle("is-selected", isSelected);
            btn.setAttribute("aria-pressed", String(isSelected));
        });
    } else {
        el.coinCountValue.textContent = String(state.draft.count);
    }
}

function confirmSettings() {
    if (state.settingsTarget === "dice") {
        state.diceSettings = normalizeDiceSettings(state.draft);
        saveJSON(STORAGE_KEYS.diceSettings, state.diceSettings);
        renderDiceStage();
    } else if (state.settingsTarget === "coin") {
        state.coinSettings = { ...state.draft };
        saveJSON(STORAGE_KEYS.coinSettings, state.coinSettings);
        renderCoinStage();
    }
    closeSettingsModal();
}
