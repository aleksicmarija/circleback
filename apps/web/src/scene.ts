import * as THREE from "three";
import { ARENA_HALF, PLAYER_RADIUS, PLAYER_COLORS } from "@backend/constants";
import type { PlayerView } from "./net";

const canvas = document.getElementById("stage") as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);
scene.fog = new THREE.Fog(0x0b0f14, 60, 150);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
camera.position.set(0, 34, 30);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x0b0f14, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(24, 46, 14);
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
  new THREE.MeshStandardMaterial({ color: 0x121a24, roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const grid = new THREE.GridHelper(ARENA_HALF * 2, ARENA_HALF, 0x2a3a4d, 0x1b2735);
grid.position.y = 0.02;
scene.add(grid);

const border = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(ARENA_HALF * 2, 3, ARENA_HALF * 2)),
  new THREE.LineBasicMaterial({ color: 0x2f6feb }),
);
border.position.y = 1.5;
scene.add(border);

const avatars = new Map<string, THREE.Mesh>();
const lookTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();

function createAvatar(view: PlayerView): THREE.Mesh {
  const color = PLAYER_COLORS[view.colorIndex % PLAYER_COLORS.length];
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_RADIUS * 1.6, 6, 16),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 }),
  );

  // A nose so which way a player faces is readable at a glance.
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(PLAYER_RADIUS * 0.4, PLAYER_RADIUS, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0, PLAYER_RADIUS * 1.1);
  body.add(nose);

  return body;
}

function disposeAvatar(mesh: THREE.Mesh): void {
  scene.remove(mesh);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
}

/** Reconciles the scene graph with the interpolated player list. */
export function syncPlayers(views: PlayerView[], localPlayerId: string | null): void {
  const present = new Set<string>();

  for (const view of views) {
    present.add(view.id);
    let mesh = avatars.get(view.id);
    if (!mesh) {
      mesh = createAvatar(view);
      scene.add(mesh);
      avatars.set(view.id, mesh);
    }
    mesh.position.set(view.x, PLAYER_RADIUS * 1.8, view.z);
    mesh.rotation.y = view.yaw;

    if (view.id === localPlayerId) {
      // Fixed-angle chase camera: follows position but never rotates, which
      // keeps the arena readable while the player changes direction.
      desiredCamera.set(view.x, 26, view.z + 22);
      camera.position.lerp(desiredCamera, 0.08);
      lookTarget.lerp(new THREE.Vector3(view.x, 0, view.z), 0.12);
      camera.lookAt(lookTarget);
    }
  }

  for (const [id, mesh] of avatars) {
    if (!present.has(id)) {
      disposeAvatar(mesh);
      avatars.delete(id);
    }
  }
}

export function clearPlayers(): void {
  for (const [id, mesh] of avatars) {
    disposeAvatar(mesh);
    avatars.delete(id);
  }
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
