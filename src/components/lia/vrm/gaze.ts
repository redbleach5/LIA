// ============================================================================
// Gaze — слежение глаз (и лёгкий поворот головы) за курсором.
// ============================================================================
//
// VRM lookAt: глаза через blendshapes (lookLeft/Right/Up/Down) или кости глаз.
// Fallback: ручные blendshapes если lookAt в модели нет.

import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import { setExpr } from './blendshapes';

const _dir = new THREE.Vector3();
const _head = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();

/** Минимальный outputScale вертикальных range map (градусы кости / вес expression). */
const MIN_VERTICAL_OUTPUT_SCALE = 22;

type MouseGaze = { x: number; y: number; hasMouse: boolean };

/**
 * Усилить вертикальный lookAt: у VRoid Bone lookAt часто yRange≈8–10°,
 * из‑за чего pitch почти незаметен рядом с горизонталью.
 */
export function ensureVerticalLookAtRange(vrm: VRM): void {
  const applier = vrm.lookAt?.applier as {
    rangeMapVerticalUp?: { outputScale: number };
    rangeMapVerticalDown?: { outputScale: number };
  } | undefined;
  if (!applier) return;
  if (applier.rangeMapVerticalUp) {
    applier.rangeMapVerticalUp.outputScale = Math.max(
      applier.rangeMapVerticalUp.outputScale,
      MIN_VERTICAL_OUTPUT_SCALE,
    );
  }
  if (applier.rangeMapVerticalDown) {
    applier.rangeMapVerticalDown.outputScale = Math.max(
      applier.rangeMapVerticalDown.outputScale,
      MIN_VERTICAL_OUTPUT_SCALE,
    );
  }
}

/**
 * Цель взгляда: точка перед лицом + смещение в плоскости камеры по мыши.
 * Так yaw/pitch читаются стабильнее, чем «голова + луч камеры * distance».
 */
export function updateGazeTarget(
  gazeTarget: THREE.Object3D,
  headBone: THREE.Object3D,
  camera: THREE.Camera,
  mouse: MouseGaze,
  distance = 1.6,
): void {
  headBone.getWorldPosition(_head);
  if (mouse.hasMouse) {
    _dir.copy(camera.position).sub(_head).normalize();
    gazeTarget.position.copy(_head).addScaledVector(_dir, distance);

    _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    // Горизонталь чуть шире — совпадает с привычным L/R; вертикаль усилена.
    gazeTarget.position.addScaledVector(_camRight, mouse.x * 0.85 * distance);
    gazeTarget.position.addScaledVector(_camUp, mouse.y * 0.75 * distance);
  } else {
    // Без мыши смотрим в сторону камеры (после rotateVRM0 лицо уже к ней).
    _dir.copy(camera.position).sub(_head).normalize();
    gazeTarget.position.copy(_head).addScaledVector(_dir, distance);
  }
}

/** Fallback: глаза через expression presets (если vrm.lookAt отсутствует) */
export function applyExpressionGaze(vrm: VRM, mouse: MouseGaze): void {
  if (!mouse.hasMouse) {
    for (const n of ['lookLeft', 'lookRight', 'lookUp', 'lookDown'] as const) {
      setExpr(vrm, n, 0);
    }
    return;
  }
  setExpr(vrm, 'lookLeft', Math.max(0, -mouse.x * 0.9));
  setExpr(vrm, 'lookRight', Math.max(0, mouse.x * 0.9));
  setExpr(vrm, 'lookUp', Math.max(0, mouse.y * 0.75));
  setExpr(vrm, 'lookDown', Math.max(0, -mouse.y * 0.75));
}

/** Лёгкий поворот головы — глаза делают основную работу через lookAt */
export function computeHeadGazeOffset(
  mouse: MouseGaze,
  state: { gazeX: number; gazeY: number; targetGazeX: number; targetGazeY: number },
  lerpFactor = 0.06,
): { x: number; y: number } {
  if (mouse.hasMouse) {
    state.targetGazeX = mouse.x * 0.055;
    state.targetGazeY = mouse.y * 0.04;
  } else {
    state.targetGazeX = 0;
    state.targetGazeY = 0;
  }
  state.gazeX = THREE.MathUtils.lerp(state.gazeX, state.targetGazeX, lerpFactor);
  state.gazeY = THREE.MathUtils.lerp(state.gazeY, state.targetGazeY, lerpFactor);
  return { x: state.gazeX, y: state.gazeY };
}
