// Dice geometry, drawing and recorded physical rolls.
import {
    THREE, CANNON, state, el, DICE_COLORS, DIE_RADIUS,
    PHYSICS_STEP, MAX_PHYSICS_STEPS, MIN_PHYSICS_STEPS, MAX_ROLL_ATTEMPTS,
    TABLE_WIDTH, TABLE_DEPTH, load3DLibraries,
    secureRandomInt, randomBetween, captureBodyStates,
} from "./shared.js?v=20261021-1";
import { addWoodenTableFrame, createPhysicsWorld, disposeObject3D } from "./scene.js?v=20261021-1";

export function createDiceController({ completeDiceRoll, setRollingUI }) {
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
        physicsSteps: 0,
        targetPhysicsSteps: 0,
        replayAccumulator: 0,
        recordedFrames: [],
        phase: "idle",
        pendingResults: [],
        resizeObserver: null,
    };
    let diceEnginePromise = null;

    function start() {
        if (!diceEnginePromise) diceEnginePromise = initDiceEngine();
        return diceEnginePromise;
    }

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
            await load3DLibraries();

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
            camera.position.set(0, 10.2, 5.4);
            camera.lookAt(0, 0.05, 0);

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
                    color: 0x23663d,
                    roughness: 0.92,
                    metalness: 0.02,
                }),
            );
            table.position.y = -0.14;
            table.receiveShadow = true;
            scene.add(table);
            addWoodenTableFrame(scene);

            const { world, diceMaterial } = createPhysicsWorld();

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

        const { faces } = state.diceSettings;
        const count = getPhysicalDiceCount(state.diceSettings);
        const spec = createDieSpec(faces === 100 ? 10 : faces);
        const positions = getIdlePositions(count);

        for (let i = 0; i < count; i++) {
            const labelMode = faces === 100 ? (i === 0 ? "tens" : "ones") : "normal";
            const group = createDieVisual(spec, i, labelMode);
            const shape = new CANNON.ConvexPolyhedron({
                vertices: spec.vertices.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
                faces: spec.faces.map((face) => [...face]),
            });
            const body = new CANNON.Body({
                mass: 1,
                material: dice3d.diceMaterial,
                shape,
                linearDamping: 0.13,
                angularDamping: 0.18,
                sleepSpeedLimit: 0.08,
                sleepTimeLimit: 0.35,
            });
            const idleQuaternion = getTargetQuaternion(spec, 1, i * 0.8);
            const restY = getRestHeight(spec, idleQuaternion);
            body.position.set(positions[i].x, restY, positions[i].z);
            body.quaternion.set(
                idleQuaternion.x,
                idleQuaternion.y,
                idleQuaternion.z,
                idleQuaternion.w,
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
                colorIndex: i,
                labelMode,
            });
        }

        syncDiceMeshes();
        renderDiceFrame();
    }

    function getPhysicalDiceCount(settings) {
        return settings.faces === 100 ? 2 : settings.count;
    }

    function createDieVisual(spec, colorIndex, labelMode = "normal", faceValues = null) {
        const group = new THREE.Group();
        const palette = DICE_COLORS[colorIndex % DICE_COLORS.length];
        const geometry = createBeveledDieGeometry(spec);

        const material = new THREE.MeshStandardMaterial({
            color: palette.body,
            roughness: 0.48,
            metalness: 0.03,
            flatShading: true,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);

        const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 18),
            new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity: 0.42 }),
        );
        group.add(edges);

        const values = faceValues || Array.from({ length: spec.sides }, (_, index) => index + 1);
        spec.faces.forEach((face, index) => {
            group.add(createFaceLabel(spec, face, formatFaceValue(values[index], labelMode), palette.ink));
        });

        return group;
    }

    function formatFaceValue(value, labelMode) {
        if (labelMode === "tens") return String((value - 1) * 10).padStart(2, "0");
        if (labelMode === "ones") return String(value - 1);
        return String(value);
    }

    function createBeveledDieGeometry(spec) {
        const positions = [];
        const inset = 0.09;
        const insetPoints = new Map();
        const edgeMap = new Map();
        const vertexPoints = spec.vertices.map(() => []);

        const addTriangle = (a, b, c) => {
            let second = b;
            let third = c;
            const normal = cross(subtract(b, a), subtract(c, a));
            const center = averageVertices([a, b, c]);
            if (dot(normal, center) < 0) {
                second = c;
                third = b;
            }
            [a, second, third].forEach((point) => positions.push(point.x, point.y, point.z));
        };

        spec.faces.forEach((face, faceIndex) => {
            const center = averageVertices(face.map((index) => spec.vertices[index]));
            face.forEach((vertexIndex) => {
                const vertex = spec.vertices[vertexIndex];
                const point = {
                    x: vertex.x + (center.x - vertex.x) * inset,
                    y: vertex.y + (center.y - vertex.y) * inset,
                    z: vertex.z + (center.z - vertex.z) * inset,
                };
                insetPoints.set(`${faceIndex}:${vertexIndex}`, point);
                vertexPoints[vertexIndex].push(point);
            });
            for (let i = 1; i < face.length - 1; i++) {
                addTriangle(
                    insetPoints.get(`${faceIndex}:${face[0]}`),
                    insetPoints.get(`${faceIndex}:${face[i]}`),
                    insetPoints.get(`${faceIndex}:${face[i + 1]}`),
                );
            }
            face.forEach((vertexIndex, edgeIndex) => {
                const nextIndex = face[(edgeIndex + 1) % face.length];
                const key = [vertexIndex, nextIndex].sort((a, b) => a - b).join(":");
                if (!edgeMap.has(key)) edgeMap.set(key, []);
                edgeMap.get(key).push({ faceIndex, a: vertexIndex, b: nextIndex });
            });
        });

        edgeMap.forEach((entries) => {
            if (entries.length !== 2) return;
            const [first, second] = entries;
            const a1 = insetPoints.get(`${first.faceIndex}:${first.a}`);
            const b1 = insetPoints.get(`${first.faceIndex}:${first.b}`);
            const a2 = insetPoints.get(`${second.faceIndex}:${first.a}`);
            const b2 = insetPoints.get(`${second.faceIndex}:${first.b}`);
            addTriangle(a1, b1, b2);
            addTriangle(a1, b2, a2);
        });

        vertexPoints.forEach((points, vertexIndex) => {
            if (points.length < 3) return;
            const axis = normalize(spec.vertices[vertexIndex]);
            const reference = Math.abs(axis.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
            const tangent = normalize(cross(axis, reference));
            const bitangent = normalize(cross(axis, tangent));
            const center = averageVertices(points);
            const sorted = [...points].sort((a, b) => {
                const relA = subtract(a, center);
                const relB = subtract(b, center);
                return Math.atan2(dot(relA, bitangent), dot(relA, tangent))
                    - Math.atan2(dot(relB, bitangent), dot(relB, tangent));
            });
            for (let i = 1; i < sorted.length - 1; i++) addTriangle(sorted[0], sorted[i], sorted[i + 1]);
        });

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeVertexNormals();
        return geometry;
    }

    function createFaceLabel(spec, face, value, inkColor) {
        const { center, normal } = getFaceFrame(spec, face);
        const texture = createFaceTexture(value, spec.sides, inkColor);
        const labelSize = spec.sides >= 20 ? 0.34 : spec.sides >= 12 ? 0.4 : spec.sides >= 8 ? 0.48 : 0.56;
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

    function createFaceTexture(value, sides, inkColor) {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const context = canvas.getContext("2d");
        context.clearRect(0, 0, 128, 128);

        if (sides === 6) {
            drawPips(context, Number(value), inkColor);
        } else {
            context.fillStyle = inkColor;
            const textSize = String(value).length >= 2 ? 62 : 76;
            context.font = `900 ${textSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(String(value), 64, String(value) === "9" ? 62 : 66);
            if (String(value) === "9") {
                // Keep the reading direction clear when a numbered face is rotated.
                context.fillRect(48, 94, 32, 5);
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(4, dice3d.renderer.capabilities.getMaxAnisotropy());
        return texture;
    }

    function drawPips(context, value, inkColor) {
        const points = {
            1: [[64, 64]],
            2: [[40, 40], [88, 88]],
            3: [[40, 40], [64, 64], [88, 88]],
            4: [[40, 40], [88, 40], [40, 88], [88, 88]],
            5: [[40, 40], [88, 40], [64, 64], [40, 88], [88, 88]],
            6: [[40, 35], [88, 35], [40, 64], [88, 64], [40, 93], [88, 93]],
        };
        context.fillStyle = inkColor;
        points[value].forEach(([x, y]) => {
            context.beginPath();
            context.arc(x, y, 13, 0, Math.PI * 2);
            context.fill();
        });
    }

    function createDieSpec(sides) {
        const phi = (1 + Math.sqrt(5)) / 2;
        const invPhi = 1 / phi;
        let vertices;

        if (sides === 6) {
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

    async function rollDice() {
        if (state.isRolling) return;
        state.isRolling = true;
        setRollingUI(true);

        if (dice3d.status === "loading" && diceEnginePromise) {
            await diceEnginePromise;
        }

        const { count, faces } = state.diceSettings;
        let results;
        let physicalResults;
        if (faces === 100) {
            const percentile = secureRandomInt(100);
            const normalized = percentile === 100 ? 0 : percentile;
            results = [percentile];
            physicalResults = [Math.floor(normalized / 10) + 1, (normalized % 10) + 1];
        } else {
            results = Array.from({ length: count }, () => secureRandomInt(faces));
            physicalResults = [...results];
        }

        if (dice3d.status === "ready") {
            start3DRoll(results, physicalResults);
        } else {
            setTimeout(() => completeDiceRoll(results), 320);
        }
    }

    function start3DRoll(results, physicalResults) {
        if (dice3d.dice.length !== physicalResults.length) rebuildDiceScene();
        dice3d.pendingResults = [...results];
        dice3d.phase = "replay";
        dice3d.physicsSteps = 0;
        dice3d.replayAccumulator = 0;
        dice3d.lastFrameTime = 0;

        const recording = createSettledRollRecording(physicalResults.length);
        const finalFrame = recording.frames[recording.frames.length - 1];
        dice3d.recordedFrames = recording.frames;
        dice3d.targetPhysicsSteps = recording.frames.length - 1;
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

        dice3d.dice.forEach((die, index) => {
            const predictedFaceIndex = getTopFaceIndex(die.spec, finalFrame[index].quaternion);
            const values = createMappedFaceValues(die.spec.sides, predictedFaceIndex, physicalResults[index]);
            replaceDieVisual(die, values);
        });
        applyRecordedFrame(recording.frames[0]);

        if (reduceMotion) {
            applyRecordedFrame(finalFrame);
            dice3d.phase = "idle";
            dice3d.pendingResults = [];
            dice3d.recordedFrames = [];
            syncDiceMeshes();
            renderDiceFrame();
            setTimeout(() => completeDiceRoll(results), 60);
            return;
        }

        requestDiceAnimation();
    }

    function createLaunchPlans(count) {
        const starts = getLaunchPositions(count);
        return starts.map((position, index) => ({
            position: {
                x: position.x + randomBetween(-0.22, 0.22),
                y: 2.8 + index * 0.28,
                z: -1.55 + randomBetween(-0.18, 0.18),
            },
            velocity: {
                x: randomBetween(-1.2, 1.2),
                y: randomBetween(-0.35, 0.25),
                z: randomBetween(2.8, 4.0),
            },
            angularVelocity: {
                x: randomBetween(7, 12),
                y: randomBetween(7, 12),
                z: randomBetween(7, 12),
            },
            euler: {
                x: randomBetween(0, Math.PI * 2),
                y: randomBetween(0, Math.PI * 2),
                z: randomBetween(0, Math.PI * 2),
            },
        }));
    }

    function applyLaunchState(body, plan) {
        body.type = CANNON.Body.DYNAMIC;
        body.mass = 1;
        body.updateMassProperties();
        body.position.set(plan.position.x, plan.position.y, plan.position.z);
        body.velocity.set(plan.velocity.x, plan.velocity.y, plan.velocity.z);
        body.angularVelocity.set(plan.angularVelocity.x, plan.angularVelocity.y, plan.angularVelocity.z);
        body.quaternion.setFromEuler(plan.euler.x, plan.euler.y, plan.euler.z);
        body.force.set(0, 0, 0);
        body.torque.set(0, 0, 0);
        body.wakeUp();
    }

    function createSettledRollRecording(count) {
        let bestRecording = null;
        for (let attempt = 0; attempt < MAX_ROLL_ATTEMPTS; attempt++) {
            const recording = recordPhysicsRoll(createLaunchPlans(count));
            if (!bestRecording || recording.settleScore > bestRecording.settleScore) {
                bestRecording = recording;
            }
            if (recording.settled) {
                recording.attempts = attempt + 1;
                return recording;
            }
        }
        bestRecording.attempts = MAX_ROLL_ATTEMPTS;
        return bestRecording;
    }

    function recordPhysicsRoll(launchPlans) {
        const { world, diceMaterial } = createPhysicsWorld();
        const bodies = dice3d.dice.map((die, index) => {
            const shape = new CANNON.ConvexPolyhedron({
                vertices: die.spec.vertices.map((v) => new CANNON.Vec3(v.x, v.y, v.z)),
                faces: die.spec.faces.map((face) => [...face]),
            });
            const body = new CANNON.Body({
                mass: 1,
                material: diceMaterial,
                shape,
                linearDamping: 0.13,
                angularDamping: 0.18,
                allowSleep: false,
            });
            applyLaunchState(body, launchPlans[index]);
            world.addBody(body);
            return body;
        });

        const frames = [captureBodyStates(bodies)];
        let steps = 0;
        let quietSteps = 0;
        while (steps < MAX_PHYSICS_STEPS) {
            world.step(PHYSICS_STEP);
            steps += 1;
            const alignments = bodies.map((body, index) => getTopFaceAlignment(
                dice3d.dice[index].spec,
                body.quaternion,
            ));
            bodies.forEach((body, index) => {
                const isNearlyFlat = alignments[index] >= 0.985;
                const isMovingSlowly = body.velocity.lengthSquared() < 0.04
                    && body.angularVelocity.lengthSquared() < 0.64;
                if (isNearlyFlat && isMovingSlowly) {
                    body.angularVelocity.scale(0.78, body.angularVelocity);
                    body.velocity.x *= 0.94;
                    body.velocity.z *= 0.94;
                }
            });
            frames.push(captureBodyStates(bodies));
            const quiet = bodies.every((body, index) => alignments[index] >= 0.985
                && body.velocity.lengthSquared() < 0.0036
                && body.angularVelocity.lengthSquared() < 0.0064);
            quietSteps = quiet ? quietSteps + 1 : 0;
            if (steps >= MIN_PHYSICS_STEPS && quietSteps >= 18) break;
        }

        const finalFrame = frames[frames.length - 1];
        const settleScore = Math.min(...finalFrame.map((stateValue, index) => getTopFaceAlignment(
            dice3d.dice[index].spec,
            stateValue.quaternion,
        )));
        return {
            frames,
            settled: quietSteps >= 18,
            settleScore,
        };
    }

    function getTopFaceIndex(spec, quaternion) {
        const rotation = new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        let bestIndex = 0;
        let bestY = -Infinity;
        spec.faces.forEach((face, index) => {
            const normal = getFaceFrame(spec, face).normal;
            const worldNormal = rotation.vmult(new CANNON.Vec3(normal.x, normal.y, normal.z));
            if (worldNormal.y > bestY) {
                bestY = worldNormal.y;
                bestIndex = index;
            }
        });
        return bestIndex;
    }

    function getTopFaceAlignment(spec, quaternion) {
        const topFaceIndex = getTopFaceIndex(spec, quaternion);
        const normal = getFaceFrame(spec, spec.faces[topFaceIndex]).normal;
        const rotation = new CANNON.Quaternion(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        return rotation.vmult(new CANNON.Vec3(normal.x, normal.y, normal.z)).y;
    }

    function createMappedFaceValues(sides, topFaceIndex, desiredValue) {
        const values = Array.from({ length: sides }, (_, index) => index + 1);
        const desiredIndex = desiredValue - 1;
        [values[topFaceIndex], values[desiredIndex]] = [values[desiredIndex], values[topFaceIndex]];
        return values;
    }

    function replaceDieVisual(die, faceValues) {
        const nextGroup = createDieVisual(die.spec, die.colorIndex, die.labelMode, faceValues);
        nextGroup.position.copy(die.group.position);
        nextGroup.quaternion.copy(die.group.quaternion);
        dice3d.scene.remove(die.group);
        disposeObject3D(die.group);
        die.group = nextGroup;
        dice3d.scene.add(nextGroup);
    }

    function applyRecordedFrame(frame) {
        dice3d.dice.forEach((die, index) => {
            const stateValue = frame[index];
            die.body.position.set(stateValue.position.x, stateValue.position.y, stateValue.position.z);
            die.body.quaternion.set(
                stateValue.quaternion.x,
                stateValue.quaternion.y,
                stateValue.quaternion.z,
                stateValue.quaternion.w,
            );
            die.body.velocity.setZero();
            die.body.angularVelocity.setZero();
        });
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

        if (dice3d.phase === "replay") {
            dice3d.replayAccumulator += deltaSeconds;
            while (dice3d.replayAccumulator >= PHYSICS_STEP
                && dice3d.physicsSteps < dice3d.targetPhysicsSteps) {
                dice3d.physicsSteps += 1;
                dice3d.replayAccumulator -= PHYSICS_STEP;
            }
            applyRecordedFrame(dice3d.recordedFrames[dice3d.physicsSteps]);
            if (dice3d.physicsSteps >= dice3d.targetPhysicsSteps) {
                const results = [...dice3d.pendingResults];
                dice3d.phase = "idle";
                dice3d.pendingResults = [];
                dice3d.recordedFrames = [];
                completeDiceRoll(results);
            }
        }

        syncDiceMeshes();
        renderDiceFrame();

        if (dice3d.phase !== "idle") requestDiceAnimation();
    }

    function getTargetQuaternion(spec, value, yawAngle) {
        const face = spec.faces[value - 1];
        const resultDirection = getFaceFrame(spec, face).normal;
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

    function getIdlePositions(count) {
        if (count === 1) return [{ x: 0, z: 0.15 }];
        if (count === 2) return [{ x: -1.05, z: 0.12 }, { x: 1.05, z: -0.08 }];
        return [
            { x: -1.55, z: 0.15 },
            { x: 0, z: -0.12 },
            { x: 1.55, z: 0.18 },
        ];
    }

    function getLaunchPositions(count) {
        if (count === 1) return [{ x: 0, z: 0 }];
        if (count === 2) return [{ x: -0.82, z: 0 }, { x: 0.82, z: 0 }];
        return [{ x: -1.35, z: 0 }, { x: 0, z: 0 }, { x: 1.35, z: 0 }];
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

    return { state: dice3d, start, renderDiceStage, resizeDiceRenderer, renderDiceFrame, rollDice };
}
