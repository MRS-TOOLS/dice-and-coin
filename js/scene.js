// Shared wooden table, collision world and resource disposal.
import { THREE, CANNON, TABLE_WIDTH, TABLE_DEPTH } from "./shared.js?v=20261021-2";

export function addWoodenTableFrame(scene, renderer = null) {
    const texture = createWoodTexture(renderer);
    const material = new THREE.MeshPhysicalMaterial({
        map: texture,
        color: 0xffffff,
        roughness: 0.38,
        metalness: 0,
        clearcoat: 0.32,
        clearcoatRoughness: 0.3,
    });
    const frame = new THREE.Mesh(createWoodFrameGeometry(), material);
    frame.castShadow = true;
    frame.receiveShadow = true;
    scene.add(frame);
}

function createWoodFrameGeometry() {
    // A closed, rounded rectangular sweep replaces the four overlapping rails.
    // Keep the original 0.34 height and inner wall positions (±0.15 from the edge).
    const profile = [
        [0.10, -0.09], [0.15, -0.04], [0.15, 0.19],
        [0.132, 0.232], [0.09, 0.25], [-0.09, 0.25],
        [-0.132, 0.232], [-0.15, 0.19], [-0.15, -0.04], [-0.10, -0.09],
    ];
    const cornerSteps = 12;
    const points = [];
    // The corner centers stay fixed across profiles, making the wood grain
    // follow the entire frame without a texture reset at each corner.
    const centerX = TABLE_WIDTH / 2 - 0.3;
    const centerZ = TABLE_DEPTH / 2 - 0.3;
    for (let corner = 0; corner < 4; corner += 1) {
        const cx = corner === 0 || corner === 3 ? centerX : -centerX;
        const cz = corner < 2 ? centerZ : -centerZ;
        for (let step = 0; step <= cornerSteps; step += 1) {
            const angle = (corner + step / cornerSteps) * Math.PI / 2;
            points.push({ cx, cz, cos: Math.cos(angle), sin: Math.sin(angle) });
        }
    }
    const perimeter = points.length;
    const distances = [0];
    for (let i = 1; i <= perimeter; i += 1) {
        const a = points[i - 1];
        const b = points[i % perimeter];
        distances.push(distances[i - 1] + Math.hypot(
            b.cx + b.cos * 0.3 - a.cx - a.cos * 0.3,
            b.cz + b.sin * 0.3 - a.cz - a.sin * 0.3,
        ));
    }
    const positions = [];
    const uvs = [];
    const indices = [];
    const stride = perimeter + 1;
    profile.forEach(([offset, y], row) => {
        for (let column = 0; column <= perimeter; column += 1) {
            const { cx, cz, cos, sin } = points[column % perimeter];
            positions.push(cx + cos * (0.3 + offset), y, cz + sin * (0.3 + offset));
            uvs.push(distances[column] / distances[perimeter], row / profile.length);
        }
    });
    for (let row = 0; row < profile.length; row += 1) {
        for (let column = 0; column < perimeter; column += 1) {
            const a = row * stride + column;
            const b = a + 1;
            const c = ((row + 1) % profile.length) * stride + column;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute("normal");
    for (let row = 0; row < profile.length; row += 1) {
        const first = row * stride;
        const last = first + perimeter;
        const normal = new THREE.Vector3().fromBufferAttribute(normals, first)
            .add(new THREE.Vector3().fromBufferAttribute(normals, last)).normalize();
        normals.setXYZ(first, normal.x, normal.y, normal.z);
        normals.setXYZ(last, normal.x, normal.y, normal.z);
    }
    return geometry;
}

function createWoodTexture(renderer) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, "#382218");
    gradient.addColorStop(0.35, "#67452e");
    gradient.addColorStop(0.65, "#795338");
    gradient.addColorStop(1, "#422a1c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = -6; y < 136; y += 1.6) {
        context.strokeStyle = `rgba(${Math.sin(y * 2.7) > 0 ? "32, 17, 9" : "188, 143, 96"}, 0.18)`;
        context.lineWidth = 0.5 + (Math.sin(y * 1.7) + 1) * 0.35;
        context.beginPath();
        for (let x = 0; x <= canvas.width; x += 4) {
            const phase = x / canvas.width * Math.PI * 2;
            const waveY = y + Math.sin(phase * 3 + y * 0.07) * 2.2
                + Math.sin(phase * 7 + y * 0.13) * 0.65;
            if (x === 0) context.moveTo(x, waveY);
            else context.lineTo(x, waveY);
        }
        context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, renderer?.capabilities.getMaxAnisotropy() || 1);
    return texture;
}

export function createPhysicsWorld() {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -18, 0) });
    world.allowSleep = true;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 12;

    const floorMaterial = new CANNON.Material("table");
    const wallMaterial = new CANNON.Material("wall");
    const diceMaterial = new CANNON.Material("dice");
    world.addContactMaterial(new CANNON.ContactMaterial(floorMaterial, diceMaterial, {
        friction: 0.38,
        restitution: 0.38,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(wallMaterial, diceMaterial, {
        friction: 0.08,
        restitution: 0.38,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
        friction: 0.14,
        restitution: 0.3,
    }));

    const floorBody = new CANNON.Body({ mass: 0, material: floorMaterial });
    floorBody.addShape(new CANNON.Plane());
    floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floorBody);
    addPhysicsWalls(world, wallMaterial);
    return { world, diceMaterial };
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

export function disposeObject3D(root) {
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
