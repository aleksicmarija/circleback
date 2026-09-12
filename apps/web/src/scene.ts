import * as THREE from "three";
import { GRID_W, GRID_H, PLAYER_COLORS, DIR_DX, DIR_DZ, type PlayerSnapshot } from "@core";

const canvas = document.getElementById("stage") as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090d);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const CAMERA_HEIGHT = 26;
const CAMERA_BACK = 11;
camera.position.set(GRID_W / 2, 70, GRID_H / 2 + 30);
camera.lookAt(GRID_W / 2, 0, GRID_H / 2);

scene.add(new THREE.HemisphereLight(0xdde8ff, 0x101820, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(30, 60, 20);
scene.add(sun);

// ---- board -----------------------------------------------------------------
// One texel per cell. Cell (x, z) sits at world (x + 0.5, 0, z + 0.5); z grows
// southward (down the screen), which is why rows are flipped when writing.

const EMPTY_RGB = [21, 27, 36] as const;
const TERRITORY_RGB = PLAYER_COLORS.map(hexToRgb);
const TRAIL_RGB = TERRITORY_RGB.map((c) => c.map((v) => Math.round(v + (255 - v) * 0.55)));

const pixels = new Uint8Array(GRID_W * GRID_H * 4);
const boardTexture = new THREE.DataTexture(pixels, GRID_W, GRID_H, THREE.RGBAFormat);
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
(gridLines.material as THREE.Material).opacity = 0.22;
gridLines.position.set(GRID_W / 2, 0.01, GRID_H / 2);
scene.add(gridLines);

const border = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(GRID_W, GRID_H)),
  new THREE.LineBasicMaterial({ color: 0x3b4a5c }),
);
border.rotation.x = -Math.PI / 2;
border.position.set(GRID_W / 2, 0.02, GRID_H / 2);
scene.add(border);

/** Paints the whole board from the two grid layers. */
export function updateBoard(owner: Uint8Array, trail: Uint8Array): void {
  for (let z = 0; z < GRID_H; z++) {
    const row = (GRID_H - 1 - z) * GRID_W;
    for (let x = 0; x < GRID_W; x++) {
      const i = z * GRID_W + x;
      const t = trail[i];
      const o = owner[i];
      const rgb = t ? TRAIL_RGB[(t - 1) % TRAIL_RGB.length]
        : o ? TERRITORY_RGB[(o - 1) % TERRITORY_RGB.length]
        : EMPTY_RGB;
      const p = (row + x) * 4;
      pixels[p] = rgb[0];
      pixels[p + 1] = rgb[1];
      pixels[p + 2] = rgb[2];
      pixels[p + 3] = 255;
    }
  }
  boardTexture.needsUpdate = true;
}

updateBoard(new Uint8Array(GRID_W * GRID_H), new Uint8Array(GRID_W * GRID_H));

// ---- players -----------------------------------------------------------------

type Avatar = { group: THREE.Group; disposables: { dispose(): void }[] };

const avatars = new Map<string, Avatar>();
const lookTarget = new THREE.Vector3(GRID_W / 2, 0, GRID_H / 2);
const desiredCamera = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
let cameraSnapped = false;

function hexToRgb(hex: number): number[] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function makeLabel(text: string): { sprite: THREE.Sprite; disposables: { dispose(): void }[] } {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 30px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.75)";
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.2, 0.8, 1);
  return { sprite, disposables: [texture, material] };
}

function createAvatar(view: PlayerSnapshot, isLocal: boolean): Avatar {
  const color = PLAYER_COLORS[view.slot % PLAYER_COLORS.length];
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const bodyGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.36, 24);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.18;
  group.add(body);
  disposables.push(bodyGeometry, bodyMaterial);

  // A white "eye" on the leading edge so heading is readable at a glance.
  const eyeGeometry = new THREE.SphereGeometry(0.12, 12, 12);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  eye.position.set(0, 0.36, 0.26);
  group.add(eye);
  disposables.push(eyeGeometry, eyeMaterial);

  if (isLocal) {
    const ringGeometry = new THREE.RingGeometry(0.55, 0.68, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(ring);
    disposables.push(ringGeometry, ringMaterial);
  }

  const label = makeLabel(view.name);
  label.sprite.position.y = 1.25;
  group.add(label.sprite);
  disposables.push(...label.disposables);

  return { group, disposables };
}

function disposeAvatar(avatar: Avatar): void {
  scene.remove(avatar.group);
  for (const d of avatar.disposables) d.dispose();
}

/** Reconciles the scene graph with the interpolated player list and follows the local player. */
export function syncPlayers(views: PlayerSnapshot[], localPlayerId: string | null): void {
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
}

export function clearPlayers(): void {
  for (const avatar of avatars.values()) disposeAvatar(avatar);
  avatars.clear();
  cameraSnapped = false;
  desiredLook.set(GRID_W / 2, 0, GRID_H / 2);
}

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
