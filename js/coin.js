// Coin visuals, side emphasis and recorded physical tosses.
import {
    THREE, CANNON, state, el, COIN_IMAGES, COIN_RADIUS, COIN_THICKNESS,
    PHYSICS_STEP, ANIM_MS, secureRandomInt, randomBetween, captureBodyStates,
} from "./shared.js?v=20261021-2";
import { createPhysicsWorld } from "./scene.js?v=20261021-2";

export function createCoinController({ dice, completeCoinToss, setTossingUI }) {
    const dice3d = dice.state;
    const coin3d = {
        status: "idle", renderer: null, scene: null, camera: null,
        coins: [], textures: null, observer: null, frameId: null,
    };
    let coinEnginePromise = null;

    function renderCoinStage() {
        if (coin3d.status === "ready") {
            rebuildCoinScene();
        } else {
            renderCoinFallback();
        }
        el.coinResultArea.innerHTML = '<p class="result-hint">TOSSを押してください</p>';
    }

    function renderCoinFallback() {
        el.coinStage.innerHTML = "";
        el.coinStage.classList.toggle("emphasize-sides", Boolean(state.coinSettings.emphasizeSides));
        const { count } = state.coinSettings;

        for (let i = 0; i < count; i++) {
            el.coinStage.appendChild(createCoinElement());
        }
        if (coin3d.status === "error") {
            const notice = document.createElement("p");
            notice.className = "coin-fallback-notice";
            notice.textContent = "3D表示を利用できないため、2Dで表示しています";
            el.coinStage.appendChild(notice);
        }
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
        logo.src = COIN_IMAGES.heads;
        logo.alt = "表：エイブラハム・リンカーン";
        logo.className = "coin-logo";
        heads.appendChild(logo);

        const tails = document.createElement("div");
        tails.className = "coin-face coin-face--tails";
        const reverse = document.createElement("img");
        reverse.src = COIN_IMAGES.tails;
        reverse.alt = "裏：リンカーン記念堂";
        reverse.className = "coin-logo";
        tails.appendChild(reverse);

        coin.appendChild(heads);
        coin.appendChild(tails);
        wrap.appendChild(coin);

        return wrap;
    }

    function ensureCoinEngine() {
        if (!coinEnginePromise) coinEnginePromise = initCoinEngine();
        return coinEnginePromise;
    }

    async function initCoinEngine() {
        coin3d.status = "loading";
        let renderer;
        try {
            await dice.start();
            if (dice3d.status !== "ready") throw new Error("3Dライブラリを利用できません");
            const loader = new THREE.TextureLoader();
            const loaded = await Promise.race([
                Promise.all([loader.loadAsync(COIN_IMAGES.heads), loader.loadAsync(COIN_IMAGES.tails)]),
                new Promise((_, reject) => setTimeout(() => reject(new Error("コイン画像の読み込みタイムアウト")), 8000)),
            ]);
            renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
            renderer.setClearColor(0x101010, 1);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.05;
            renderer.domElement.setAttribute("role", "img");
            renderer.domElement.setAttribute("aria-label", "緑の盤面上のリンカーン・メモリアルペニー。表はリンカーン、裏はリンカーン記念堂。");
            loaded.forEach((texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
            });
            coin3d.textures = { heads: loaded[0], tails: loaded[1] };
            // Share the exact same table, wooden frame and lights as the dice stage.
            const scene = new THREE.Scene();
            scene.fog = dice3d.scene.fog.clone();
            dice3d.scene.children.forEach((object) => {
                if (!dice3d.dice.some((die) => die.group === object)) scene.add(object.clone());
            });
            const camera = dice3d.camera.clone();
            Object.assign(coin3d, { renderer, scene, camera, status: "ready" });
            el.coinStage.replaceChildren(renderer.domElement);
            rebuildCoinScene();
            if (window.ResizeObserver) {
                coin3d.observer = new ResizeObserver(resizeCoinRenderer);
                coin3d.observer.observe(el.coinStage);
            } else {
                window.addEventListener("resize", resizeCoinRenderer);
            }
            resizeCoinRenderer();
        } catch (error) {
            renderer?.dispose();
            coin3d.status = "error";
            console.warn("3Dコインは2D表示に切り替えます:", error);
            renderCoinFallback();
        }
    }

    function resizeCoinRenderer() {
        if (coin3d.status !== "ready") return;
        const width = el.coinStage.clientWidth;
        const height = el.coinStage.clientHeight;
        if (!width || !height) return;
        coin3d.renderer.setSize(width, height, false);
        coin3d.camera.aspect = width / height;
        coin3d.camera.updateProjectionMatrix();
        coin3d.renderer.render(coin3d.scene, coin3d.camera);
    }

    function createCoinVisual() {
        const group = new THREE.Group();
        const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xa45c37, roughness: 0.38, metalness: 0.7 });
        const edge = new THREE.Mesh(new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 64), edgeMaterial);
        edge.castShadow = true;
        edge.receiveShadow = true;
        group.add(edge);
        // The penny uses a plain copper edge, without the quarter's reeding.
        const caps = ["heads", "tails"].map((side, index) => {
            const material = new THREE.MeshStandardMaterial({
                map: coin3d.textures[side], roughness: 0.52, metalness: 0.22,
                transparent: true, alphaTest: 0.4,
            });
            const cap = new THREE.Mesh(new THREE.CircleGeometry(COIN_RADIUS, 64), material);
            setCoinCapSide(cap, side);
            cap.rotation.x = index === 0 ? -Math.PI / 2 : Math.PI / 2;
            cap.position.y = (index === 0 ? 1 : -1) * (COIN_THICKNESS / 2 + 0.001);
            cap.receiveShadow = true;
            group.add(cap);
            return cap;
        });
        return { group, caps };
    }

    function setCoinCapSide(cap, side) {
        cap.userData.coinSide = side;
        cap.material.map = coin3d.textures[side];
        cap.material.color.setHex(state.coinSettings.emphasizeSides && side === "tails" ? 0xc4c4c4 : 0xffffff);
    }

    function updateCoinEmphasis() {
        el.coinStage.classList.toggle("emphasize-sides", Boolean(state.coinSettings.emphasizeSides));
        if (coin3d.status !== "ready") return;
        coin3d.coins.forEach(({ caps }) => {
            caps.forEach((cap) => setCoinCapSide(cap, cap.userData.coinSide));
        });
        if (!coin3d.needsCanvas) coin3d.renderer.render(coin3d.scene, coin3d.camera);
    }

    function rebuildCoinScene() {
        if (coin3d.needsCanvas) {
            el.coinStage.replaceChildren(coin3d.renderer.domElement);
            coin3d.needsCanvas = false;
        }
        coin3d.coins.forEach(({ group }) => {
            coin3d.scene.remove(group);
            group.traverse((object) => {
                object.geometry?.dispose();
                object.material?.dispose(); // Face textures are shared and retained.
            });
        });
        coin3d.coins = Array.from({ length: state.coinSettings.count }, (_, i) => {
            const coin = createCoinVisual();
            coin.group.position.set((i - (state.coinSettings.count - 1) / 2) * 1.5, COIN_THICKNESS / 2, 0);
            coin3d.scene.add(coin.group);
            return coin;
        });
        resizeCoinRenderer();
    }

    function coinFaceNormalY(quaternion) {
        // World Y component of the coin's local +Y normal.
        return 1 - 2 * (quaternion.x * quaternion.x + quaternion.z * quaternion.z);
    }

    function isCoinSettled(body, index, recentFrames) {
        // Contact impulses can keep velocities noisy on a motionless stack.
        // Require a readable face and a stable pose throughout 0.3 seconds.
        if (recentFrames.length < 19 || Math.abs(coinFaceNormalY(body.quaternion)) <= 0.5) return false;
        return recentFrames.every((frame) => {
            const previous = frame[index];
            const dx = body.position.x - previous.position.x;
            const dy = body.position.y - previous.position.y;
            const dz = body.position.z - previous.position.z;
            const q = body.quaternion;
            const p = previous.quaternion;
            const dot = Math.abs(q.x * p.x + q.y * p.y + q.z * p.z + q.w * p.w);
            return dx * dx + dy * dy + dz * dz < 0.0001
                && dot > Math.cos(Math.PI / 240) // Less than 1.5 degrees.
                && Math.abs(coinFaceNormalY(p)) > 0.5
                && coinFaceNormalY(q) * coinFaceNormalY(p) > 0;
        });
    }

    function recordCoinToss(count) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const { world, diceMaterial } = createPhysicsWorld();
            world.contactmaterials.forEach((contact) => {
                contact.friction = 0.5;
                contact.restitution = 0.28;
            });
            const bodies = Array.from({ length: count }, (_, i) => {
                const body = new CANNON.Body({
                    mass: 1, material: diceMaterial,
                    shape: new CANNON.Cylinder(COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 32),
                    linearDamping: 0.22, angularDamping: 0.35, allowSleep: false,
                });
                body.position.set((i - (count - 1) / 2) * 1.5, 0.85 + i * 0.12, -0.75);
                body.velocity.set(randomBetween(-0.55, 0.55), randomBetween(4.5, 5.5), randomBetween(0.8, 1.5));
                body.angularVelocity.set(randomBetween(14, 23), randomBetween(-3, 3), randomBetween(-6, 6));
                body.quaternion.setFromEuler(randomBetween(-0.2, 0.2), randomBetween(-0.5, 0.5), 0);
                world.addBody(body);
                return body;
            });
            const frames = [captureBodyStates(bodies)];
            for (let step = 0; step < 600; step += 1) {
                world.step(PHYSICS_STEP);
                frames.push(captureBodyStates(bodies));
                const recentFrames = frames.slice(-19);
                if (step >= 100 && bodies.every((body, index) => isCoinSettled(body, index, recentFrames))) return frames;
            }
        }
        throw new Error("コインの表裏を判別できる静止状態を生成できませんでした");
    }

    function playCoinToss(results) {
        const frames = recordCoinToss(results.length);
        if (coin3d.needsCanvas) {
            el.coinStage.replaceChildren(coin3d.renderer.domElement);
            coin3d.needsCanvas = false;
            resizeCoinRenderer();
        }
        const final = frames[frames.length - 1];
        coin3d.coins.forEach((coin, i) => {
            const topIsPositive = coinFaceNormalY(final[i].quaternion) > 0;
            const positiveSide = topIsPositive ? results[i] : (results[i] === "heads" ? "tails" : "heads");
            setCoinCapSide(coin.caps[0], positiveSide);
            setCoinCapSide(coin.caps[1], positiveSide === "heads" ? "tails" : "heads");
        });
        const applyFrame = (frame) => {
            coin3d.coins.forEach(({ group }, i) => {
                group.position.copy(frame[i].position);
                group.quaternion.copy(frame[i].quaternion);
            });
            coin3d.renderer.render(coin3d.scene, coin3d.camera);
        };
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            applyFrame(final);
            completeCoinToss(results);
            return;
        }
        let startedAt;
        const animate = (timestamp) => {
            startedAt ??= timestamp;
            const frame = Math.min(Math.floor((timestamp - startedAt) / 1000 * 60 * 1.4), frames.length - 1);
            applyFrame(frames[frame]);
            if (frame < frames.length - 1) coin3d.frameId = requestAnimationFrame(animate);
            else {
                coin3d.frameId = null;
                completeCoinToss(results);
            }
        };
        coin3d.frameId = requestAnimationFrame(animate);
    }

    async function tossCoin() {
        if (state.isTossing) return;
        state.isTossing = true;
        setTossingUI(true);
        await ensureCoinEngine();

        const { count } = state.coinSettings;

        const results = [];
        for (let i = 0; i < count; i++) {
            results.push(secureRandomInt(2) === 1 ? "heads" : "tails");
        }

        if (coin3d.status === "ready") {
            try {
                playCoinToss(results);
                return;
            } catch (error) {
                console.warn("コインの投げ直しを2Dで表示します:", error);
                renderCoinFallback();
            }
        }
        const coinEls = el.coinStage.querySelectorAll(".coin");
        coinEls.forEach((coin, i) => {
            animateCoin(coin, results[i]);
        });

        setTimeout(() => {
            completeCoinToss(results);
            if (coin3d.status === "ready") {
                // Keep the final result visible until the next action. A new toss
                // reattaches the WebGL canvas after this exceptional 2D fallback.
                coin3d.needsCanvas = true;
            }
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

    function roundToTarget(current, target) {
        const base = Math.floor(current / 360) * 360;
        let candidate = base + ((target % 360) + 360) % 360;
        if (candidate < current) candidate += 360;
        return candidate;
    }

    return { state: coin3d, renderCoinStage, ensureCoinEngine, resizeCoinRenderer, updateCoinEmphasis, tossCoin };
}
