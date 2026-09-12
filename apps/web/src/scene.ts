import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GRID_W, GRID_H, PLAYER_COLORS, DIR_DX, DIR_DZ, type PlayerSnapshot } from "@core";

const canvas = document.getElementById("stage") as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
// Palette mirrors hackathon.cursorserbia.com: warm near-black, off-white, orange accent.
scene.background = new THREE.Color(0x0f0d06);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
const CAMERA_HEIGHT = 22;
const CAMERA_BACK = 13;
camera.position.set(GRID_W / 2, 70, GRID_H / 2 + 30);
camera.lookAt(GRID_W / 2, 0, GRID_H / 2);

scene.add(new THREE.HemisphereLight(0xfff4e6, 0x262318, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(30, 60, 20);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xe8925a, 0.35);
fill.position.set(-30, 30, -20);
scene.add(fill);

const clock = new THREE.Clock();

// ---- board -----------------------------------------------------------------
// One texel per cell. Cell (x, z) sits at world (x + 0.5, 0, z + 0.5); z grows
// southward (down the screen), which is why rows are flipped when writing.

const EMPTY_RGB = [27, 25, 19] as const;
const TERRITORY_RGB = PLAYER_COLORS.map(hexToRgb);
// A trail is drawn as a 2x2 checker of the player's colour and a dimmed
// version of it, so it reads as a dotted line next to solid territory of the
// same colour. Brightness alone was not enough for light colours.
const TRAIL_DIM_RGB = TERRITORY_RGB.map((c) => c.map((v, k) => Math.round(v * 0.35 + EMPTY_RGB[k] * 0.65)));

/** Texels per cell edge; the checker needs more than one. */
const SUB = 2;
const TEX_W = GRID_W * SUB;
const TEX_H = GRID_H * SUB;

const pixels = new Uint8Array(TEX_W * TEX_H * 4);
const boardTexture = new THREE.DataTexture(pixels, TEX_W, TEX_H, THREE.RGBAFormat);
boardTexture.magFilter = THREE.NearestFilter;
boardTexture.minFilter = THREE.NearestFilter;
boardTexture.colorSpace = THREE.SRGBColorSpace;

const board = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID_W, GRID_H),
  new THREE.MeshBasicMaterial({ map: boardTexture }),
);
board.rotation.x = -Math.PI / 2;
board.position.set(GRID_W / 2, 0, GRID_H / 2);
scene.add(board);

const gridLines = new THREE.GridHelper(GRID_W, GRID_W, 0x000000, 0x000000);
(gridLines.material as THREE.Material).transparent = true;
(gridLines.material as THREE.Material).opacity = 0.32;
gridLines.position.set(GRID_W / 2, 0.01, GRID_H / 2);
scene.add(gridLines);

const border = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(GRID_W + 0.3, GRID_H + 0.3)),
  new THREE.LineBasicMaterial({ color: 0xe8925a }),
);
border.rotation.x = -Math.PI / 2;
border.position.set(GRID_W / 2, 0.03, GRID_H / 2);
scene.add(border);

// A wide dark apron so the arena floats on a floor instead of in the void.
const apron = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID_W * 3, GRID_H * 3),
  new THREE.MeshBasicMaterial({ color: 0x14120b }),
);
apron.rotation.x = -Math.PI / 2;
apron.position.set(GRID_W / 2, -0.05, GRID_H / 2);
scene.add(apron);

function putTexel(x: number, y: number, rgb: readonly number[]): void {
  const p = (y * TEX_W + x) * 4;
  pixels[p] = rgb[0];
  pixels[p + 1] = rgb[1];
  pixels[p + 2] = rgb[2];
  pixels[p + 3] = 255;
}

/** Paints the whole board from the two grid layers. */
export function updateBoard(owner: Uint8Array, trail: Uint8Array): void {
  for (let z = 0; z < GRID_H; z++) {
    // Texture rows run bottom-up; grid z runs top-down.
    const ty = (GRID_H - 1 - z) * SUB;
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      const t = trail[i];
      const o = owner[i];
      const tx = x * SUB;
      if (t) {
        const bright = TERRITORY_RGB[(t - 1) % TERRITORY_RGB.length];
        const dim = TRAIL_DIM_RGB[(t - 1) % TRAIL_DIM_RGB.length];
        putTexel(tx, ty, bright);
        putTexel(tx + 1, ty, dim);
        putTexel(tx, ty + 1, dim);
        putTexel(tx + 1, ty + 1, bright);
      } else {
        const rgb = o ? TERRITORY_RGB[(o - 1) % TERRITORY_RGB.length] : EMPTY_RGB;
        putTexel(tx, ty, rgb);
        putTexel(tx + 1, ty, rgb);
        putTexel(tx, ty + 1, rgb);
        putTexel(tx + 1, ty + 1, rgb);
      }
    }
  }
  boardTexture.needsUpdate = true;
}

updateBoard(new Uint8Array(GRID_W * GRID_H), new Uint8Array(GRID_W * GRID_H));

// ---- models ------------------------------------------------------------------
// Kenney GLBs (CC0). Each is normalised once into a template group that is
// cloned per avatar; the node-based animations replay on the clone.

type Template = { root: THREE.Group; clips: THREE.AnimationClip[] };

const loader = new GLTFLoader();
const templates = new Map<string, Promise<Template>>();

function loadTemplate(skin: string): Promise<Template> {
  let pending = templates.get(skin);
  if (!pending) {
    pending = loader.loadAsync(`/models/${skin}.glb`).then((gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      // Fit inside a cell footprint and a sensible height, feet on the floor.
      const scale = Math.min(0.85 / size.x, 0.85 / size.z, 1.25 / size.y);
      const root = new THREE.Group();
      model.scale.setScalar(scale);
      model.position.set(
        -(box.min.x + size.x / 2) * scale,
        -box.min.y * scale,
        -(box.min.z + size.z / 2) * scale,
      );
      root.add(model);
      return { root, clips: gltf.animations };
    });
    templates.set(skin, pending);
  }
  return pending;
}

/** Warms the cache so the first avatars appear without a pop-in delay. */
export function preload(skins: readonly string[]): void {
  for (const skin of skins) void loadTemplate(skin).catch(() => {});
}

function pickClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | null {
  for (const name of ["run", "sprint", "walk"]) {
    const clip = clips.find((c) => c.name === name);
    if (clip) return clip;
  }
  return clips[0] ?? null;
}

// ---- players -----------------------------------------------------------------

type Avatar = {
  group: THREE.Group;
  skin: string;
  mixer: THREE.AnimationMixer | null;
  label: THREE.Sprite;
  labelText: string;
  disposables: { dispose(): void }[];
};

const avatars = new Map<string, Avatar>();
const lookTarget = new THREE.Vector3(GRID_W / 2, 0, GRID_H / 2);
const desiredCamera = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
let cameraSnapped = false;

function hexToRgb(hex: number): number[] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function paintLabel(canvas: HTMLCanvasElement, name: string, status: string | undefined, color: number): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  ctx.font = "bold 34px 'Kenney Future', ui-sans-serif, system-ui, sans-serif";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(name, 128, status ? 26 : 40);
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillText(name, 128, status ? 26 : 40);

  if (status) {
    ctx.font = "22px ui-sans-serif, system-ui, sans-serif";
    ctx.lineWidth = 5;
    ctx.strokeText(status, 128, 58);
    ctx.fillStyle = "#edecec";
    ctx.fillText(status, 128, 58);
  }
}

function createAvatar(view: PlayerSnapshot, isLocal: boolean): Avatar {
  const color = PLAYER_COLORS[view.slot % PLAYER_COLORS.length];
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  // Coloured base disc: the one thing that always says whose piece this is.
  const discGeometry = new THREE.CircleGeometry(0.46, 32);
  const discMaterial = new THREE.MeshBasicMaterial({ color });
  const disc = new THREE.Mesh(discGeometry, discMaterial);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.02;
  group.add(disc);
  disposables.push(discGeometry, discMaterial);

  const rimGeometry = new THREE.RingGeometry(0.46, 0.56, 32);
  const rimMaterial = new THREE.MeshBasicMaterial({ color: isLocal ? 0xedecec : 0x0f0d06 });
  const rim = new THREE.Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.025;
  group.add(rim);
  disposables.push(rimGeometry, rimMaterial);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 256;
  labelCanvas.height = 80;
  paintLabel(labelCanvas, view.name, view.status, color);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelMaterial = new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false });
  const label = new THREE.Sprite(labelMaterial);
  label.scale.set(3.4, 1.06, 1);
  label.position.y = 1.9;
  group.add(label);
  disposables.push(labelTexture, labelMaterial);

  const avatar: Avatar = {
    group,
    skin: view.skin ?? "pet-pig",
    mixer: null,
    label,
    labelText: `${view.name}\n${view.status ?? ""}`,
    disposables,
  };

  void loadTemplate(avatar.skin).then((template) => {
    if (!avatars.has(view.id)) return; // left before the model arrived
    const model = template.root.clone(true);
    group.add(model);
    const clip = pickClip(template.clips);
    if (clip) {
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(clip);
      action.play();
      // Slight per-player offset so a crowd does not run in lockstep.
      action.time = Math.random() * clip.duration;
      avatar.mixer = mixer;
    }
  });

  return avatar;
}

function disposeAvatar(avatar: Avatar): void {
  scene.remove(avatar.group);
  for (const d of avatar.disposables) d.dispose();
}

/** Reconciles the scene graph with the interpolated player list and follows the local player. */
export function syncPlayers(views: PlayerSnapshot[], localPlayerId: string | null): void {
  const dt = clock.getDelta();
  const present = new Set<string>();

  for (const view of views) {
    present.add(view.id);
    let avatar = avatars.get(view.id);
    if (!avatar) {
      avatar = createAvatar(view, view.id === localPlayerId);
      scene.add(avatar.group);
      avatars.set(view.id, avatar);
    }

    avatar.group.visible = view.alive;
    avatar.group.position.set(view.x, 0, view.z);
    avatar.group.rotation.y = Math.atan2(DIR_DX[view.dir], DIR_DZ[view.dir]);
    if (view.alive) avatar.mixer?.update(dt);

    const labelText = `${view.name}\n${view.status ?? ""}`;
    if (labelText !== avatar.labelText) {
      avatar.labelText = labelText;
      const material = avatar.label.material as THREE.SpriteMaterial;
      const texture = material.map as THREE.CanvasTexture;
      paintLabel(texture.image as HTMLCanvasElement, view.name, view.status, PLAYER_COLORS[view.slot % PLAYER_COLORS.length]);
      texture.needsUpdate = true;
    }

    if (view.id === localPlayerId && view.alive) {
      desiredLook.set(view.x, 0, view.z);
    }
  }

  for (const [id, avatar] of avatars) {
    if (!present.has(id)) {
      disposeAvatar(avatar);
      avatars.delete(id);
    }
  }

  if (localPlayerId) {
    desiredCamera.set(desiredLook.x, CAMERA_HEIGHT, desiredLook.z + CAMERA_BACK);
    if (!cameraSnapped) {
      camera.position.copy(desiredCamera);
      lookTarget.copy(desiredLook);
      cameraSnapped = true;
    } else {
      camera.position.lerp(desiredCamera, 0.1);
      lookTarget.lerp(desiredLook, 0.12);
    }
    camera.lookAt(lookTarget);
  }

  updateBursts(dt);
}

/** Fixed camera that frames the whole arena; used by the spectator page. */
export function setOverview(): void {
  const vfov = THREE.MathUtils.degToRad(camera.fov / 2);
  // Fit the board half-height, with extra room when the viewport is narrow.
  const squeeze = Math.min(1, camera.aspect / 1.3);
  const distance = ((GRID_H / 2 + 5) / Math.tan(vfov)) / squeeze;
  camera.position.set(GRID_W / 2, distance * 0.92, GRID_H / 2 + distance * 0.42);
  camera.lookAt(GRID_W / 2, 0, GRID_H / 2);
  cameraSnapped = true;
}

export function clearPlayers(): void {
  for (const avatar of avatars.values()) disposeAvatar(avatar);
  avatars.clear();
  cameraSnapped = false;
  desiredLook.set(GRID_W / 2, 0, GRID_H / 2);
}

// ---- particle bursts --------------------------------------------------------

type Burst = { points: THREE.Points; velocities: Float32Array; age: number; life: number };

const bursts: Burst[] = [];
const BURST_COUNT = 36;

/** A puff of the player's colour: on capture (big) and on death (small). */
export function burst(x: number, z: number, slot: number, big: boolean): void {
  const count = big ? BURST_COUNT : BURST_COUNT / 2;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (big ? 4 : 2.5) * (0.5 + Math.random());
    positions[i * 3] = x;
    positions[i * 3 + 1] = 0.4;
    positions[i * 3 + 2] = z;
    velocities[i * 3] = Math.cos(angle) * speed;
    velocities[i * 3 + 1] = 3 + Math.random() * 4;
    velocities[i * 3 + 2] = Math.sin(angle) * speed;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: PLAYER_COLORS[slot % PLAYER_COLORS.length],
    size: big ? 0.45 : 0.3,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  bursts.push({ points, velocities, age: 0, life: big ? 0.9 : 0.6 });
}

function updateBursts(dt: number): void {
  for (let b = bursts.length - 1; b >= 0; b--) {
    const item = bursts[b];
    item.age += dt;
    const attribute = item.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < array.length; i += 3) {
      item.velocities[i + 1] -= 12 * dt;
      array[i] += item.velocities[i] * dt;
      array[i + 1] = Math.max(0.05, array[i + 1] + item.velocities[i + 1] * dt);
      array[i + 2] += item.velocities[i + 2] * dt;
    }
    attribute.needsUpdate = true;
    (item.points.material as THREE.PointsMaterial).opacity = 1 - item.age / item.life;

    if (item.age >= item.life) {
      scene.remove(item.points);
      item.points.geometry.dispose();
      (item.points.material as THREE.Material).dispose();
      bursts.splice(b, 1);
    }
  }
}

// ---- housekeeping -----------------------------------------------------------

export function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

export function render(): void {
  renderer.render(scene, camera);
}

window.addEventListener("resize", resize);
resize();
