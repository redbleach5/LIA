'use client';

// ============================================================================
// VrmAvatar — 3D VRM-аватар с эмоциями, дыханием, морганием, lip-sync.
// ============================================================================
//
// Главный компонент. Содержит:
//   - VrmAvatar (thin wrapper: Canvas + BackgroundLayer + Scene)
//   - Scene (lights + VrmModel + OrbitControls)
//   - VrmModel (загрузка VRM + useFrame animation loop)
//
// Вынесено в подмодули vrm/:
//   - vrm/constants.ts   — ARM_POSE_QUATERNIONS, BoneBases, eulerToQuat
//   - vrm/background.tsx — BackgroundLayer
//   - vrm/blendshapes.ts — setExpr, emotionToBlendshapes
//
// VrmModel остаётся здесь, потому что useFrame animation loop тесно связан
// с refs (vrmRef, basesRef, animState) и не может быть легко вынесен без
// проброса всех refs через props.

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMExpressionPresetName } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useEffect, useRef, useState, Suspense } from 'react';
import type { EmotionVector } from '@/lib/personality';
import {
  DEFAULT_AVATAR_CONFIG,
  LIGHTING_PRESETS,
  resolveScenePresentation,
  type AvatarConfig,
} from '@/lib/avatar-config';
import {
  ARM_POSE_QUATERNIONS,
  createEmptyBases,
  type BoneBases,
} from './vrm/constants';
import { BackgroundLayer } from './vrm/background';
import { setExpr, emotionToBlendshapes } from './vrm/blendshapes';
import {
  updateGazeTarget,
  applyExpressionGaze,
  computeHeadGazeOffset,
  ensureVerticalLookAtRange,
} from './vrm/gaze';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

type VrmAvatarProps = {
  emotion: EmotionVector;
  speaking?: boolean;
  /** Фиксированный размер (px). Игнорируется если fill=true. */
  size?: number;
  /** Заполнить родительский контейнер (w-full h-full). */
  fill?: boolean;
  src?: string;
  config?: AvatarConfig;
  /** Вызывается когда VRM не удалось загрузить (файл отсутствует/битый). */
  onLoadError?: () => void;
  /** Боковая колонка — фиксированный ракурс, узкий zoom, без внутреннего кольца. */
  sidebar?: boolean;
  /** Мини-портрет — кадр на лицо (для узкой колонки). */
  compact?: boolean;
};

export function VrmAvatar({
  emotion,
  speaking = false,
  size = 280,
  fill = false,
  src,
  config = DEFAULT_AVATAR_CONFIG,
  onLoadError,
  sidebar = false,
  compact = false,
}: VrmAvatarProps) {
  // Нет src — не подставляем DEFAULT (иначе 404 /models/lia_v2.vrm на каждый mount).
  if (!src) {
    return null;
  }

  const presentation = resolveScenePresentation(config, { sidebar, compact });
  const sceneConfig: AvatarConfig = {
    ...config,
    background: presentation.background,
  };
  const isPortrait = compact
    || config.camera.preset === 'portrait'
    || config.camera.preset === 'closeup';
  const d = presentation.cameraDistance;
  const zoomTight = (sidebar || compact) && isPortrait;
  const orbitMin = d * (zoomTight ? 0.94 : isPortrait ? 0.88 : 0.82);
  const orbitMax = d * (zoomTight ? 1.06 : isPortrait ? 1.12 : 1.18);

  return (
    <div
      className={fill ? 'relative w-full h-full' : 'relative'}
      style={fill ? undefined : { width: size, height: size }}
    >
      {!sidebar && !compact && (
        <BackgroundLayer background={sceneConfig.background} edgeToEdge={fill} />
      )}
      <Canvas
        className={fill ? 'w-full h-full' : undefined}
        camera={{
          position: presentation.cameraPosition,
          fov: presentation.cameraFov,
        }}
        gl={{ alpha: sidebar || compact || sceneConfig.background.style === 'transparent', antialias: true }}
        dpr={[1, 2]}
      >
        <Suspense fallback={null}>
          <Scene
            emotion={emotion}
            speaking={speaking}
            src={src}
            config={sceneConfig}
            cameraPosition={presentation.cameraPosition}
            cameraTarget={presentation.cameraTarget}
            cameraFov={presentation.cameraFov}
            orbitMin={orbitMin}
            orbitMax={orbitMax}
            lockRotation={sidebar || compact}
            onLoadError={onLoadError}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

/** Синхронизирует PerspectiveCamera + OrbitControls при смене пресета/FOV. */
function CameraRig({
  position,
  target,
  fov,
  orbitMin,
  orbitMax,
  lockRotation,
}: {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  orbitMin: number;
  orbitMax: number;
  lockRotation?: boolean;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    if (camera instanceof THREE.PerspectiveCamera) {
      // React's hook immutability rule disallows assigning to a value returned
      // by useThree. Three exposes a mutation method for the same operation.
      const focalLength = 0.5 * camera.getFilmHeight()
        / Math.tan(THREE.MathUtils.degToRad(fov * 0.5));
      camera.setFocalLength(focalLength);
      camera.updateProjectionMatrix();
    }
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.minDistance = orbitMin;
      controls.maxDistance = orbitMax;
      controls.update();
    }
  }, [
    camera,
    position[0], position[1], position[2],
    target[0], target[1], target[2],
    fov, orbitMin, orbitMax,
  ]);

  return (
    <OrbitControls
      ref={controlsRef}
      target={target}
      enablePan={false}
      enableRotate={!lockRotation}
      enableZoom={!lockRotation}
      minDistance={orbitMin}
      maxDistance={orbitMax}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 2.02}
      minAzimuthAngle={lockRotation ? 0 : -Math.PI / 5}
      maxAzimuthAngle={lockRotation ? 0 : Math.PI / 5}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

// ============================================================================
// Scene — lights + VrmModel + OrbitControls
// ============================================================================
function Scene({
  emotion,
  speaking,
  src,
  config,
  cameraPosition,
  cameraTarget,
  cameraFov,
  orbitMin,
  orbitMax,
  lockRotation,
  onLoadError,
}: {
  emotion: EmotionVector;
  speaking: boolean;
  src: string;
  config: AvatarConfig;
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  cameraFov: number;
  orbitMin: number;
  orbitMax: number;
  lockRotation?: boolean;
  onLoadError?: () => void;
}) {
  const lights = LIGHTING_PRESETS[config.lighting.preset];
  const lightScale = config.lighting.intensity;

  return (
    <>
      <ambientLight intensity={lights.ambient.intensity * lightScale} color={lights.ambient.color} />
      <directionalLight
        position={lights.keyLight.position}
        intensity={lights.keyLight.intensity * lightScale}
        color={lights.keyLight.color}
      />
      <directionalLight
        position={lights.fillLight.position}
        intensity={lights.fillLight.intensity * lightScale}
        color={lights.fillLight.color}
      />
      {lights.hemisphere && (
        <hemisphereLight
          args={[lights.hemisphere.sky, lights.hemisphere.ground, lights.hemisphere.intensity * lightScale]}
        />
      )}

      <VrmModel emotion={emotion} speaking={speaking} src={src} config={config} onLoadError={onLoadError} />

      <CameraRig
        position={cameraPosition}
        target={cameraTarget}
        fov={cameraFov}
        orbitMin={orbitMin}
        orbitMax={orbitMax}
        lockRotation={lockRotation}
      />
    </>
  );
}

// ============================================================================
// VrmModel — загрузка VRM + все idle-анимации
// ============================================================================
function VrmModel({
  emotion,
  speaking,
  src,
  config,
  onLoadError,
}: {
  emotion: EmotionVector;
  speaking: boolean;
  src: string;
  config: AvatarConfig;
  onLoadError?: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const vrmRef = useRef<VRM | null>(null);
  const gazeTargetRef = useRef(new THREE.Object3D());
  const basesRef = useRef<BoneBases>(createEmptyBases());
  const loadedRef = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const onLoadErrorCalledRef = useRef(false);

  // ── Загрузка VRM + применение позы + сохранение баз ──
  useEffect(() => {
    let cancelled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    // Локальные флаги для timeout-проверки — state (loaded/loadFailed) был бы stale
    // в замыкании setTimeout из-за пустого deps array.
    let localLoaded = false;
    let localFailed = false;
    setLoadFailed(false);
    loadedRef.current = false;
    onLoadErrorCalledRef.current = false;

    // ── Страховочный timeout: если VRM не загрузился за 15 сек — считаем что failed.
    // Решает проблему когда GLTFLoader молчит (например, при сетевых проблемах,
    // или когда сервер отдаёт HTML 404 вместо бинарника, и loader пытается парсить).
    timeoutHandle = setTimeout(() => {
      if (cancelled) return;
      if (!localLoaded && !localFailed) {
        console.warn('[VRM] Load timeout (15s) — treating as failed');
        localFailed = true;
        setLoadFailed(true);
        if (!onLoadErrorCalledRef.current) {
          onLoadErrorCalledRef.current = true;
          onLoadError?.();
        }
      }
    }, 15000);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      src,
      (gltf) => {
        if (cancelled) return;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        localLoaded = true;
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          console.error('[VRM] No VRM in gltf');
          localFailed = true;
          setLoadFailed(true);
          if (!onLoadErrorCalledRef.current) {
            onLoadErrorCalledRef.current = true;
            onLoadError?.();
          }
          return;
        }

        VRMUtils.removeUnnecessaryVertices(gltf.scene);

        // ── Правильное вращение модели в зависимости от версии VRM ──
        // VRM 0.x: модели смотрят в -Z (спиной к камере на +Z) → нужно повернуть на 180°
        // VRM 1.0: модели смотрят в +Z (лицом к камере) → вращение НЕ нужно
        // Используем официальную утилиту VRMUtils.rotateVRM0() которая сама
        // определяет версию по meta.metaVersion и поворачивает только 0.x.
        // Это правильнее чем хардкод rotation.y = Math.PI для всех моделей.
        const metaVersion = vrm.meta?.metaVersion;
        const modelName = metaVersion === '1'
          ? (vrm.meta as { name?: string }).name
          : (vrm.meta as { title?: string }).title;
        console.warn(`[VRM] Model version: VRM ${metaVersion}, name: "${modelName ?? 'unknown'}"`);
        if (metaVersion === '0') {
          // VRM 0.x — поворот на 180° чтобы модель смотрела на камеру
          VRMUtils.rotateVRM0(vrm);
          console.warn('[VRM] Applied 180° rotation for VRM 0.x model');
        } else {
          // VRM 1.0 — модель уже смотрит на камеру, вращение не нужно
          vrm.scene.rotation.y = 0;
          console.warn('[VRM] VRM 1.0 model — no rotation needed');
        }

        if (vrm.expressionManager) {
          vrm.expressionManager.resetValues();
        }

        // ── Применяем позу рук напрямую через bone.rotation (Euler) ──
        const poseQuat = ARM_POSE_QUATERNIONS[config.body.armPose];
        const humanoid = vrm.humanoid;
        if (humanoid) {
          // autoUpdateHumanBones=true (default): useFrame пишет в normalized bones,
          // vrm.update() каждый кадр копирует normalized → raw (видимый скелет).
          // С false humanoid.update() — no-op и модель навсегда остаётся в T-pose.
          humanoid.autoUpdateHumanBones = true;

          let bonesFound = 0;
          let bonesTotal = 0;
          const setBoneRot = (name: string, euler: [number, number, number]) => {
            bonesTotal++;
            const node = humanoid.getNormalizedBoneNode(name as never);
            if (node) {
              node.rotation.set(euler[0], euler[1], euler[2]);
              bonesFound++;
            }
          };
          setBoneRot('leftUpperArm', poseQuat.leftUpperArm);
          setBoneRot('rightUpperArm', poseQuat.rightUpperArm);
          setBoneRot('leftLowerArm', poseQuat.leftLowerArm);
          setBoneRot('rightLowerArm', poseQuat.rightLowerArm);
          setBoneRot('leftHand', poseQuat.leftHand);
          setBoneRot('rightHand', poseQuat.rightHand);

          // Диагностика: если кости не найдены — модель может быть non-humanoid.
          if (bonesFound < bonesTotal) {
            console.warn(`[VRM] Arm pose: ${bonesFound}/${bonesTotal} bones found. ` +
              `Model may be non-humanoid. Arms will stay in default position.`);
          }

          // Синхронизируем начальную позу normalized → raw до первого кадра useFrame.
          try {
            humanoid.update();
          } catch (e) {
            console.warn('[VRM] humanoid.update() failed during pose apply:', e);
          }
        } else {
          console.warn('[VRM] No humanoid rig found — arm pose cannot be applied.');
        }

        vrm.scene.scale.setScalar(config.body.scale);
        vrm.scene.position.y = config.body.yOffset;

        if (groupRef.current) {
          while (groupRef.current.children.length > 0) {
            groupRef.current.remove(groupRef.current.children[0]);
          }
          groupRef.current.add(vrm.scene);
          const gazeTarget = gazeTargetRef.current;
          if (gazeTarget.parent) gazeTarget.parent.remove(gazeTarget);
          groupRef.current.add(gazeTarget);
        }
        vrmRef.current = vrm;

        if (vrm.lookAt) {
          vrm.lookAt.autoUpdate = true;
          vrm.lookAt.target = gazeTargetRef.current;
          // VRoid Bone lookAt: вертикальный yRange ≈10° — почти незаметен; поднимаем floor.
          ensureVerticalLookAtRange(vrm);
        }

        // ── Сохраняем базы ВСЕХ костей как Euler angles ──
        const humanoidForBones = vrm.humanoid;
        if (humanoidForBones) {
          const getBone = (name: string) => humanoidForBones.getNormalizedBoneNode(name as never);
          const hips = getBone('hips');
          const spine = getBone('spine');
          const chest = getBone('chest');
          const neck = getBone('neck');
          const head = getBone('head');
          const leftShoulder = getBone('leftShoulder');
          const rightShoulder = getBone('rightShoulder');
          const leftUpperArm = getBone('leftUpperArm');
          const rightUpperArm = getBone('rightUpperArm');
          const leftLowerArm = getBone('leftLowerArm');
          const rightLowerArm = getBone('rightLowerArm');
          const leftHand = getBone('leftHand');
          const rightHand = getBone('rightHand');
          const leftUpperLeg = getBone('leftUpperLeg');
          const rightUpperLeg = getBone('rightUpperLeg');

          const saveRot3 = (bone: THREE.Object3D | null, target: { rotX: number; rotY: number; rotZ: number }) => {
            if (!bone) return;
            target.rotX = bone.rotation.x;
            target.rotY = bone.rotation.y;
            target.rotZ = bone.rotation.z;
          };

          const b = basesRef.current;
          if (hips) {
            b.hips.posX = hips.position.x;
            b.hips.posY = hips.position.y;
            b.hips.rotX = hips.rotation.x;
            b.hips.rotY = hips.rotation.y;
            b.hips.rotZ = hips.rotation.z;
          }
          saveRot3(spine, b.spine);
          saveRot3(chest, b.chest);
          saveRot3(neck, b.neck);
          saveRot3(head, b.head);
          if (leftShoulder) b.leftShoulder.rotZ = leftShoulder.rotation.z;
          if (rightShoulder) b.rightShoulder.rotZ = rightShoulder.rotation.z;
          saveRot3(leftUpperArm, b.leftUpperArm);
          saveRot3(rightUpperArm, b.rightUpperArm);
          saveRot3(leftLowerArm, b.leftLowerArm);
          saveRot3(rightLowerArm, b.rightLowerArm);
          saveRot3(leftHand, b.leftHand);
          saveRot3(rightHand, b.rightHand);
          if (leftUpperLeg) b.leftUpperLeg.rotZ = leftUpperLeg.rotation.z;
          if (rightUpperLeg) b.rightUpperLeg.rotZ = rightUpperLeg.rotation.z;
        }

        loadedRef.current = true;
      },
      undefined,
      (err) => {
        if (cancelled) return;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        console.error('[VRM] load failed:', err);
        localFailed = true;
        setLoadFailed(true);
        if (!onLoadErrorCalledRef.current) {
          onLoadErrorCalledRef.current = true;
          onLoadError?.();
        }
      },
    );

    return () => {
      cancelled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (vrmRef.current?.lookAt) {
        vrmRef.current.lookAt.target = null;
      }
    };
  }, [src, config.body.armPose, config.body.scale, config.body.yOffset, onLoadError]);

  // ── Состояние анимаций ──
  const animState = useRef({
    blinkTimer: 2 + Math.random() * 3,
    isBlinking: false,
    blinkPhase: 0,
    blinkDuration: 0.15,
    mouthPhase: 0,
    mouthValue: 0,
    gazeX: 0,
    gazeY: 0,
    targetGazeX: 0,
    targetGazeY: 0,
    current: { happy: 0, angry: 0, sad: 0, relaxed: 0, surprised: 0 } as Record<string, number>,
    breathPhase: 0,
    swayPhase: 0,
    armPhase: 0,
    weightPhase: 0,
    headPhase: 0,
    fidgetPhase: Math.random() * Math.PI * 2,
    handPhase: Math.random() * Math.PI * 2,
  });

  // ── Gaze follow — отслеживание мыши ──
  const mouseRef = useRef({ x: 0, y: 0, hasMouse: false });
  const { gl, camera } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouseRef.current.hasMouse = true;
    };
    const onMouseLeave = () => { mouseRef.current.hasMouse = false; };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [gl]);

  // ── Главный цикл анимации ──
  // АРХИТЕКТУРА: каждый кадр начинаем с базовых значений, потом накладываем
  // все активные анимации как absolute = base + delta. Никаких += !
  useFrame((_, delta) => {
    const vrm = vrmRef.current;
    if (!vrm || !loadedRef.current) return;
    const humanoid = vrm.humanoid;
    if (!humanoid) return;
    const cfg = config.animation;
    const freq = cfg.idleFrequency;
    const b = basesRef.current;
    const t = performance.now() / 1000;
    const life = speaking ? 1.35 : 1.0;

    // Накапливаем фазы (несоизмеримые частоты → менее «роботизированный» цикл)
    animState.current.breathPhase += delta * 0.8 * freq;
    animState.current.swayPhase += delta * 0.35 * freq;
    animState.current.armPhase += delta * 0.5 * freq;
    animState.current.weightPhase += delta * 0.18 * freq;
    animState.current.headPhase += delta * 0.28 * freq;
    animState.current.fidgetPhase += delta * 0.22 * freq;
    animState.current.handPhase += delta * 0.83 * freq;

    const hips = humanoid.getNormalizedBoneNode('hips' as never);
    const spine = humanoid.getNormalizedBoneNode('spine' as never);
    const chest = humanoid.getNormalizedBoneNode('chest' as never);
    const neck = humanoid.getNormalizedBoneNode('neck' as never);
    const head = humanoid.getNormalizedBoneNode('head' as never);
    const leftShoulder = humanoid.getNormalizedBoneNode('leftShoulder' as never);
    const rightShoulder = humanoid.getNormalizedBoneNode('rightShoulder' as never);
    const leftUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm' as never);
    const rightUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm' as never);
    const leftLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm' as never);
    const rightLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm' as never);
    const leftHand = humanoid.getNormalizedBoneNode('leftHand' as never);
    const rightHand = humanoid.getNormalizedBoneNode('rightHand' as never);
    const leftUpperLeg = humanoid.getNormalizedBoneNode('leftUpperLeg' as never);
    const rightUpperLeg = humanoid.getNormalizedBoneNode('rightUpperLeg' as never);

    const resetRot3 = (
      bone: THREE.Object3D | null,
      base: { rotX: number; rotY: number; rotZ: number },
    ) => {
      if (!bone) return;
      bone.rotation.x = base.rotX;
      bone.rotation.y = base.rotY;
      bone.rotation.z = base.rotZ;
    };

    // ── Шаг 1: сброс ВСЕХ модифицируемых костей к базе (Euler) ──
    if (hips) {
      hips.position.x = b.hips.posX;
      hips.position.y = b.hips.posY;
      hips.rotation.x = b.hips.rotX;
      hips.rotation.y = b.hips.rotY;
      hips.rotation.z = b.hips.rotZ;
    }
    resetRot3(spine, b.spine);
    resetRot3(chest, b.chest);
    resetRot3(neck, b.neck);
    resetRot3(head, b.head);
    if (leftShoulder) leftShoulder.rotation.z = b.leftShoulder.rotZ;
    if (rightShoulder) rightShoulder.rotation.z = b.rightShoulder.rotZ;
    resetRot3(leftUpperArm, b.leftUpperArm);
    resetRot3(rightUpperArm, b.rightUpperArm);
    resetRot3(leftLowerArm, b.leftLowerArm);
    resetRot3(rightLowerArm, b.rightLowerArm);
    resetRot3(leftHand, b.leftHand);
    resetRot3(rightHand, b.rightHand);
    if (leftUpperLeg) leftUpperLeg.rotation.z = b.leftUpperLeg.rotZ;
    if (rightUpperLeg) rightUpperLeg.rotation.z = b.rightUpperLeg.rotZ;

    const breathPrimary = Math.sin(animState.current.breathPhase);
    const breathSecondary = Math.sin(animState.current.breathPhase * 2.17 + 0.6) * 0.35;
    const breath = breathPrimary + breathSecondary;

    // ── Шаг 2: дыхание ──
    if (cfg.breathing) {
      if (spine) {
        spine.rotation.x = b.spine.rotX + breath * 0.028 * life;
        spine.rotation.z = b.spine.rotZ + Math.sin(animState.current.breathPhase * 0.5) * 0.01;
      }
      if (chest) {
        chest.rotation.x = b.chest.rotX + breath * 0.018 * life;
        chest.rotation.y = b.chest.rotY + Math.sin(animState.current.breathPhase * 1.4) * 0.012;
      }
      if (leftShoulder) leftShoulder.rotation.z = b.leftShoulder.rotZ + breath * 0.018;
      if (rightShoulder) rightShoulder.rotation.z = b.rightShoulder.rotZ - breath * 0.018;
    }

    // ── Шаг 3: покачивание телом ──
    if (cfg.bodySway) {
      const sway = Math.sin(animState.current.swayPhase);
      const sway2 = Math.sin(animState.current.swayPhase * 1.63 + 0.8) * 0.45;
      const combined = sway + sway2;
      if (hips) {
        hips.rotation.y = b.hips.rotY + combined * 0.045 * life;
        hips.rotation.z = b.hips.rotZ + Math.sin(animState.current.swayPhase * 0.7) * 0.018;
        hips.position.y = b.hips.posY + Math.sin(animState.current.swayPhase * 2.1) * 0.004;
      }
      if (spine) {
        spine.rotation.y = b.spine.rotY + Math.sin(animState.current.swayPhase + Math.PI) * 0.025 * life;
      }
      if (chest) {
        chest.rotation.z = b.chest.rotZ + combined * 0.012;
      }
    }

    // ── Шаг 4: перенос веса ──
    if (cfg.weightShift) {
      const shift = Math.sin(animState.current.weightPhase);
      const shift2 = Math.sin(animState.current.weightPhase * 0.67 + 1.1) * 0.4;
      if (hips) hips.position.x = b.hips.posX + (shift + shift2) * 0.028;
      if (leftUpperLeg) leftUpperLeg.rotation.z = b.leftUpperLeg.rotZ + shift * 0.025;
      if (rightUpperLeg) rightUpperLeg.rotation.z = b.rightUpperLeg.rotZ - shift * 0.018;
    }

    // ── Шаг 5: микро-движения рук + кисти ──
    if (cfg.armSway) {
      const armSway1 = Math.sin(animState.current.armPhase) * 0.05 * life;
      const armSway2 = Math.sin(animState.current.armPhase + Math.PI) * 0.05 * life;
      const fidget = Math.sin(animState.current.fidgetPhase);
      if (leftUpperArm) {
        leftUpperArm.rotation.z = b.leftUpperArm.rotZ + armSway1 + fidget * 0.015;
        leftUpperArm.rotation.x = b.leftUpperArm.rotX + Math.sin(animState.current.armPhase * 0.7) * 0.025;
      }
      if (rightUpperArm) {
        rightUpperArm.rotation.z = b.rightUpperArm.rotZ + armSway2 - fidget * 0.012;
        rightUpperArm.rotation.x = b.rightUpperArm.rotX + Math.sin(animState.current.armPhase * 0.7 + Math.PI) * 0.025;
      }
      if (leftLowerArm) {
        leftLowerArm.rotation.x = b.leftLowerArm.rotX + Math.sin(animState.current.armPhase * 0.5) * 0.02;
        leftLowerArm.rotation.z = b.leftLowerArm.rotZ + Math.sin(animState.current.handPhase) * 0.012;
      }
      if (rightLowerArm) {
        rightLowerArm.rotation.x = b.rightLowerArm.rotX + Math.sin(animState.current.armPhase * 0.5 + Math.PI) * 0.02;
        rightLowerArm.rotation.z = b.rightLowerArm.rotZ + Math.sin(animState.current.handPhase + 1.2) * 0.01;
      }
      if (leftHand) {
        leftHand.rotation.z = b.leftHand.rotZ + Math.sin(animState.current.handPhase) * 0.09;
        leftHand.rotation.x = b.leftHand.rotX + Math.sin(animState.current.handPhase * 1.35) * 0.05;
      }
      if (rightHand) {
        rightHand.rotation.z = b.rightHand.rotZ + Math.sin(animState.current.handPhase + Math.PI) * 0.08;
        rightHand.rotation.x = b.rightHand.rotX + Math.sin(animState.current.handPhase * 1.1 + 0.5) * 0.04;
      }
      if (leftShoulder) leftShoulder.rotation.z += Math.sin(animState.current.fidgetPhase * 1.4) * 0.014;
      if (rightShoulder) rightShoulder.rotation.z += Math.sin(animState.current.fidgetPhase * 0.9 + 0.7) * 0.011;
    }

    // ── Шаг 6: эмоциональная поза ──
    if (cfg.emotionPose) {
      if (emotion.joy > 0.6 && hips) {
        const bounce = Math.sin(t * 2.5) * 0.015 * (emotion.joy - 0.5);
        hips.position.y = b.hips.posY + bounce;
      }
      if (emotion.sadness > 0.4) {
        const intensity = (emotion.sadness - 0.3) * 0.5;
        if (spine) spine.rotation.x = b.spine.rotX + intensity * 0.08;
        if (head) head.rotation.x = b.head.rotX + intensity * 0.1;
        if (leftShoulder) leftShoulder.rotation.z = b.leftShoulder.rotZ + intensity * 0.05;
        if (rightShoulder) rightShoulder.rotation.z = b.rightShoulder.rotZ - intensity * 0.05;
      }
      if (emotion.irritation > 0.4) {
        const intensity = (emotion.irritation - 0.3) * 0.5;
        if (head) head.rotation.x = b.head.rotX - intensity * 0.06;
        // Чуть поднять руки к T-pose: |z| уменьшаем (знаки natural: L+, R−).
        if (leftUpperArm) leftUpperArm.rotation.z = b.leftUpperArm.rotZ - intensity * 0.04;
        if (rightUpperArm) rightUpperArm.rotation.z = b.rightUpperArm.rotZ + intensity * 0.04;
      }
      if (emotion.curiosity > 0.6 && head) {
        const intensity = (emotion.curiosity - 0.5) * 0.3;
        head.rotation.z = b.head.rotZ + Math.sin(t * 0.4) * intensity * 0.08;
      }
      if (emotion.calm > 0.6) {
        const intensity = (emotion.calm - 0.5) * 0.2;
        if (leftShoulder) leftShoulder.rotation.z = b.leftShoulder.rotZ - intensity * 0.03;
        if (rightShoulder) rightShoulder.rotation.z = b.rightShoulder.rotZ + intensity * 0.03;
      }
    }

    // ── Шаг 7: покачивание головой + gaze (глаза через lookAt, голова — лёгкий доворот) ──
    if (cfg.headSway && head) {
      const h1 = Math.sin(animState.current.headPhase);
      const h2 = Math.sin(animState.current.headPhase * 1.71 + 1.3) * 0.55;
      head.rotation.y = b.head.rotY + (h1 + h2) * 0.07 * life;
      head.rotation.x = b.head.rotX + Math.sin(animState.current.headPhase * 0.6) * 0.035;
      head.rotation.z = b.head.rotZ + Math.sin(animState.current.fidgetPhase * 0.55) * 0.025;
    }
    if (cfg.headSway && neck) {
      neck.rotation.x = b.neck.rotX + Math.sin(animState.current.headPhase * 0.85) * 0.02 * life;
      neck.rotation.y = b.neck.rotY + Math.sin(animState.current.headPhase * 1.2) * 0.015;
    }
    if (cfg.gazeFollow && head) {
      if (vrm.lookAt) {
        updateGazeTarget(gazeTargetRef.current, head, camera, mouseRef.current);
        const headGaze = computeHeadGazeOffset(mouseRef.current, animState.current);
        head.rotation.y += headGaze.x;
        head.rotation.x += headGaze.y;
      } else {
        applyExpressionGaze(vrm, mouseRef.current);
        if (mouseRef.current.hasMouse) {
          head.rotation.y += mouseRef.current.x * 0.08;
          head.rotation.x += mouseRef.current.y * 0.05;
        }
      }
    }

    // ── Шаг 8: моргание ──
    if (cfg.blinking) {
      animState.current.blinkTimer -= delta;
      if (!animState.current.isBlinking && animState.current.blinkTimer < 0) {
        animState.current.isBlinking = true;
        animState.current.blinkPhase = 0;
        const isDouble = Math.random() < 0.15;
        animState.current.blinkDuration = isDouble ? 0.35 : 0.15;
      }
      if (animState.current.isBlinking) {
        animState.current.blinkPhase += delta / animState.current.blinkDuration;
        if (animState.current.blinkPhase >= 1) {
          animState.current.isBlinking = false;
          animState.current.blinkTimer = 2 + Math.random() * 4;
          setExpr(vrm, 'blink', 0);
        } else {
          let v;
          if (animState.current.blinkDuration > 0.25) {
            const half = animState.current.blinkPhase * 2;
            const localPhase = half % 1;
            v = localPhase < 0.5 ? localPhase * 2 : (1 - localPhase) * 2;
          } else {
            v = animState.current.blinkPhase < 0.5
              ? animState.current.blinkPhase * 2
              : (1 - animState.current.blinkPhase) * 2;
          }
          setExpr(vrm, 'blink', v);
        }
      }
    }

    // ── Шаг 9: эмоции (blendshapes) ──
    if (cfg.emotionMorph) {
      const target = emotionToBlendshapes(emotion);
      const lerp = 1 - Math.pow(0.001, delta);
      for (const key of Object.keys(target) as Array<keyof typeof target>) {
        if (key === 'aa') continue;
        const cur = animState.current.current[key] as number;
        const tgt = target[key];
        animState.current.current[key] = cur + (tgt - cur) * lerp;
        setExpr(vrm, key as VRMExpressionPresetName, animState.current.current[key]);
      }
    }

    // ── Шаг 10: липсинк ──
    if (cfg.lipSync && speaking) {
      animState.current.mouthPhase += delta * 12;
      const target = (Math.sin(animState.current.mouthPhase) + 1) / 2 * 0.5;
      animState.current.mouthValue = THREE.MathUtils.lerp(animState.current.mouthValue, target, 0.3);
    } else {
      animState.current.mouthValue = Math.max(0, animState.current.mouthValue - delta * 2);
    }
    setExpr(vrm, 'aa', animState.current.mouthValue);

    try {
      vrm.update(delta);
    } catch (e) {
      console.error('[VRM] vrm.update() failed:', e);
    }
  });

  if (loadFailed) {
    return (
      <group position={[0, 1.2, 0]}>
        <mesh>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial color="#c9a886" />
        </mesh>
      </group>
    );
  }

  return <group ref={groupRef} />;
}
