'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { sound } from './TreasureHuntAudio';

export interface SceneHotspot {
  id: string;
  name: string;
  x: number; // 3D world x
  y: number; // 3D world y
  z: number; // 3D world z
  isCorrect: boolean;
  type: 'painting' | 'bookshelf' | 'lamp' | 'credenza' | 'chest' | 'box' | 'jar';
}

interface Props {
  hotspots: SceneHotspot[];
  onInteract: (hotspot: SceneHotspot) => void;
  isFound: boolean;
  shakeId: string | null;
  canInteract: boolean;
  /** `local` is false while the character is walking to a position sent by the other side. */
  onPlayerMove?: (x: number, z: number, rot: number, local: boolean) => void;
  stageTheme?: string;
  /** Where the other side moved the shared explorer; `n` changes on every update. */
  remoteMove?: { x: number; z: number; rot: number; n: number } | null;
  /** Whether this viewer may walk the explorer (keys / floor clicks). */
  canMove?: boolean;
}

export default function TreasureHunt3DScene({
  hotspots,
  onInteract,
  isFound,
  shakeId,
  canInteract,
  onPlayerMove,
  stageTheme = 'study',
  remoteMove = null,
  canMove = true,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  // The render loop is set up once, so it reads these through refs.
  const onPlayerMoveRef = useRef(onPlayerMove);
  onPlayerMoveRef.current = onPlayerMove;
  const canMoveRef = useRef(canMove);
  canMoveRef.current = canMove;
  // False while walking to a position the other side sent, so it is not echoed back.
  const localDriven = useRef(true);

  // Character state refs for render loop
  const playerPos = useRef({ x: 0, z: 0.4, rot: 0 });
  const targetPos = useRef<{ x: number; z: number } | null>(null);
  const isWalking = useRef(false);
  const walkPhase = useRef(0);
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const mouseHoverPos = useRef({ x: 0, y: 0 });

  // Mesh & Scene references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Interactive furniture groups
  const paintingGroupRef = useRef<THREE.Group | null>(null);
  const bookshelfGroupRef = useRef<THREE.Group | null>(null);
  const lampGroupRef = useRef<THREE.Group | null>(null);
  const credenzaGroupRef = useRef<THREE.Group | null>(null);
  const chestGroupRef = useRef<THREE.Group | null>(null);
  const jarGroupRef = useRef<THREE.Group | null>(null);

  // Character rig references
  const playerGroupRef = useRef<THREE.Group | null>(null);
  const leftLegRef = useRef<THREE.Group | null>(null);
  const rightLegRef = useRef<THREE.Group | null>(null);
  const leftArmRef = useRef<THREE.Group | null>(null);
  const rightArmRef = useRef<THREE.Group | null>(null);
  const hairRef = useRef<THREE.Group | null>(null);

  // Visual FX references
  const reticleRingRef = useRef<THREE.Mesh | null>(null);
  const secretGlowRef = useRef<THREE.Mesh | null>(null);
  const clickableObjects = useRef<Map<THREE.Object3D, SceneHotspot>>(new Map());
  const sparkParticles = useRef<{ mesh: THREE.Points; velocities: THREE.Vector3[]; life: number } | null>(null);

  // Shaking feedback reference
  const shakingGroupRef = useRef<THREE.Group | null>(null);
  const shakeStartTime = useRef<number>(0);

  const [hoveredHotspot, setHoveredHotspot] = useState<SceneHotspot | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Initialize Three.js scene once on mount
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // --- SCENE & CAMERA ---
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0xd7c9b8); // Warm cream wall backdrop

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 3.1, 5.7);
    camera.lookAt(0, 1.35, 0);
    camera.updateMatrixWorld();
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    // --- LIGHTING ---
    // Warm interior ambient light
    const ambientLight = new THREE.AmbientLight(0xffeedb, 0.85);
    scene.add(ambientLight);

    // Sunlight from left window
    const sunLight = new THREE.DirectionalLight(0xfff5dd, 1.4);
    sunLight.position.set(-5.5, 4.2, 1.2);
    sunLight.target.position.set(0.5, 0.8, -0.8);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 15;
    sunLight.shadow.camera.left = -4;
    sunLight.shadow.camera.right = 4;
    sunLight.shadow.camera.top = 4;
    sunLight.shadow.camera.bottom = -4;
    sunLight.shadow.bias = -0.001;
    scene.add(sunLight);
    scene.add(sunLight.target);

    // Overhead picture spotlight above the mountain landscape painting
    const picSpotLight = new THREE.SpotLight(0xffe2a3, 3.2, 5, Math.PI / 4, 0.65, 1.2);
    picSpotLight.position.set(0, 3.2, -2.5);
    picSpotLight.target.position.set(0, 2.1, -2.85);
    scene.add(picSpotLight);
    scene.add(picSpotLight.target);

    // Brass wall sconce above the painting
    const sconceMat = new THREE.MeshStandardMaterial({ color: 0xbfa15f, metalness: 0.8, roughness: 0.3 });
    const sconceBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.12, 16), sconceMat);
    sconceBase.position.set(0, 3.22, -2.78);
    sconceBase.rotation.x = Math.PI / 2;

    const sconceShade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.16, 24), sconceMat);
    sconceShade.position.set(0, 3.12, -2.52);
    sconceShade.rotation.x = -Math.PI / 6;

    // Table lamp light on right credenza
    const lampLight = new THREE.PointLight(0xffd788, 1.5, 4.5, 1.5);
    lampLight.position.set(1.95, 1.75, -2.05);
    scene.add(lampLight);

    // Bookshelf secret glow light
    const bookGlowLight = new THREE.PointLight(0xffbf33, 1.2, 2.5, 1.8);
    bookGlowLight.position.set(-2.25, 1.35, -2.2);
    scene.add(bookGlowLight);

    // --- ROOM ARCHITECTURE ---
    // Back Wall
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9ccba, roughness: 0.9 });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), wallMat);
    backWall.position.set(0, 2.5, -2.9);
    backWall.receiveShadow = true;
    scene.add(backWall);

    // Back wall baseboard
    const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x422d1d, roughness: 0.5 });
    const baseboard = new THREE.Mesh(new THREE.BoxGeometry(12, 0.18, 0.08), baseboardMat);
    baseboard.position.set(0, 0.09, -2.86);
    scene.add(baseboard);

    // Floor (Polished warm wood parquet)
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 512;
    floorCanvas.height = 512;
    const fctx = floorCanvas.getContext('2d');
    if (fctx) {
      fctx.fillStyle = '#b78b5e';
      fctx.fillRect(0, 0, 512, 512);
      fctx.fillStyle = '#9e7347';
      for (let y = 0; y < 512; y += 32) {
        fctx.fillRect(0, y, 512, 2);
      }
      fctx.fillStyle = '#895f36';
      for (let x = 0; x < 512; x += 64) {
        for (let y = 0; y < 512; y += 32) {
          fctx.fillRect(x + ((y / 32) % 2) * 32, y, 2, 32);
        }
      }
    }
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.wrapS = THREE.RepeatWrapping;
    floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(4, 4);

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.45,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Large Center Area Rug (soft woven beige rug with dark border)
    const rugCanvas = document.createElement('canvas');
    rugCanvas.width = 512;
    rugCanvas.height = 512;
    const rctx = rugCanvas.getContext('2d');
    if (rctx) {
      rctx.fillStyle = '#ede5d4';
      rctx.fillRect(0, 0, 512, 512);
      rctx.lineWidth = 14;
      rctx.strokeStyle = '#917d69';
      rctx.strokeRect(16, 16, 480, 480);
      rctx.lineWidth = 4;
      rctx.strokeStyle = '#b8a591';
      rctx.strokeRect(36, 36, 440, 440);
    }
    const rugTex = new THREE.CanvasTexture(rugCanvas);
    const rugMat = new THREE.MeshStandardMaterial({ map: rugTex, roughness: 0.95 });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 3.4), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.015, -0.4);
    rug.receiveShadow = true;
    scene.add(rug);

    // Diagonal sunlight beam patch on floor
    const sunPatchMat = new THREE.MeshBasicMaterial({
      color: 0xfffae8,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const sunPatch = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 2.2), sunPatchMat);
    sunPatch.rotation.x = -Math.PI / 2;
    sunPatch.rotation.z = Math.PI / 7;
    sunPatch.position.set(-0.6, 0.02, -0.3);
    scene.add(sunPatch);

    // Right Archway doorway
    const archMat = new THREE.MeshStandardMaterial({ color: 0xbaab96, roughness: 0.9 });
    const archWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.2, 1.8), archMat);
    archWall.position.set(4.1, 2.1, -1.9);
    scene.add(archWall);

    // --- INTERACTIVE PROPS & FURNITURE ---

    // 1. BACK WALL: MOUNTAIN LANDSCAPE PAINTING GROUP
    const paintingGroup = new THREE.Group();
    paintingGroupRef.current = paintingGroup;
    paintingGroup.position.set(0, 2.2, -2.8);

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.4 });
    const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(1.84, 1.28, 0.08), frameMat);
    frameOuter.position.set(0, 0, -0.03);
    frameOuter.castShadow = true;
    paintingGroup.add(frameOuter);

    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = 512;
    paintCanvas.height = 360;
    const pctx = paintCanvas.getContext('2d');
    if (pctx) {
      const skyGrad = pctx.createLinearGradient(0, 0, 0, 360);
      skyGrad.addColorStop(0, '#c7d6dc');
      skyGrad.addColorStop(0.5, '#e4d6bf');
      skyGrad.addColorStop(1, '#e39f67');
      pctx.fillStyle = skyGrad;
      pctx.fillRect(0, 0, 512, 360);

      pctx.fillStyle = '#f7b643';
      pctx.beginPath();
      pctx.arc(310, 160, 36, 0, Math.PI * 2);
      pctx.fill();

      pctx.fillStyle = '#8ca5b0';
      pctx.beginPath();
      pctx.moveTo(0, 280);
      pctx.lineTo(140, 150);
      pctx.lineTo(280, 240);
      pctx.lineTo(440, 130);
      pctx.lineTo(512, 210);
      pctx.lineTo(512, 360);
      pctx.lineTo(0, 360);
      pctx.closePath();
      pctx.fill();

      pctx.fillStyle = '#4c6c77';
      pctx.beginPath();
      pctx.moveTo(0, 290);
      pctx.lineTo(190, 175);
      pctx.lineTo(340, 280);
      pctx.lineTo(420, 220);
      pctx.lineTo(512, 300);
      pctx.lineTo(512, 360);
      pctx.lineTo(0, 360);
      pctx.closePath();
      pctx.fill();
    }
    const paintTex = new THREE.CanvasTexture(paintCanvas);
    const paintMat = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.6 });
    const paintingCanvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.68, 1.12), paintMat);
    paintingCanvasMesh.position.set(0, 0, 0.02);
    paintingCanvasMesh.name = 'painting';
    paintingGroup.add(paintingCanvasMesh);

    // Pulsing Reticle beneath the painting
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const reticleMesh = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.12, 32), reticleMat);
    reticleMesh.position.set(0, -0.72, 0.01);
    reticleRingRef.current = reticleMesh;
    paintingGroup.add(reticleMesh);

    const reticleCenter = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 })
    );
    reticleCenter.position.set(0, -0.72, 0.02);
    paintingGroup.add(reticleCenter);

    paintingGroup.add(sconceBase);
    paintingGroup.add(sconceShade);
    scene.add(paintingGroup);

    // 2. LEFT: BOOKSHELF WITH BOOKS & SECRET COMPARTMENT GROUP
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3e2617, roughness: 0.6 });
    const bookshelfGroup = new THREE.Group();
    bookshelfGroupRef.current = bookshelfGroup;
    bookshelfGroup.position.set(-2.4, 0, -2.35);

    const leftSide = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.06), woodMat);
    leftSide.position.set(-0.68, 1.6, 0);
    leftSide.castShadow = true;
    bookshelfGroup.add(leftSide);

    const rightSide = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.06), woodMat);
    rightSide.position.set(0.68, 1.6, 0);
    rightSide.castShadow = true;
    bookshelfGroup.add(rightSide);

    const topBoard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 1.42), woodMat);
    topBoard.position.set(0, 3.2, 0);
    bookshelfGroup.add(topBoard);

    const backBoard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 3.2, 1.35), woodMat);
    backBoard.position.set(-0.16, 1.6, 0);
    bookshelfGroup.add(backBoard);

    const shelfYs = [0.8, 1.5, 2.2, 2.9];
    shelfYs.forEach((sy) => {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 1.35), woodMat);
      shelf.position.set(0, sy, 0);
      shelf.castShadow = true;
      bookshelfGroup.add(shelf);
    });

    const bookColors = [0x8b2626, 0x1f4e5b, 0x2e6f40, 0xa66c2e, 0x4d3b6b, 0xc9a86b];
    for (let i = 0; i < 9; i++) {
      const bMat = new THREE.MeshStandardMaterial({ color: bookColors[i % bookColors.length], roughness: 0.4 });
      const bHeight = 0.38 + (i % 3) * 0.06;
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.24, bHeight, 0.06), bMat);
      book.position.set(0, 1.5 + bHeight / 2 + 0.02, -0.55 + i * 0.075);
      bookshelfGroup.add(book);
    }

    for (let i = 0; i < 7; i++) {
      const bMat = new THREE.MeshStandardMaterial({ color: bookColors[(i + 2) % bookColors.length], roughness: 0.4 });
      const bHeight = 0.34 + (i % 2) * 0.05;
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.24, bHeight, 0.065), bMat);
      book.position.set(0, 0.8 + bHeight / 2 + 0.02, -0.5 + i * 0.08);
      bookshelfGroup.add(book);
    }

    // Glowing Golden Secret Book
    const secretMat = new THREE.MeshStandardMaterial({
      color: 0xf6cf65,
      emissive: 0xdf9826,
      emissiveIntensity: 0.85,
      roughness: 0.3,
    });
    const secretBook = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.48, 0.16), secretMat);
    secretBook.position.set(0.02, 0.8 + 0.25, 0.32);
    secretBook.rotation.z = -0.15;
    bookshelfGroup.add(secretBook);

    // Glowing border frame around the secret book
    const glowFrameMat = new THREE.MeshBasicMaterial({
      color: 0xffd24d,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    const glowFrame = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.58, 0.42), glowFrameMat);
    glowFrame.position.set(0.02, 0.8 + 0.28, 0.32);
    secretGlowRef.current = glowFrame;
    bookshelfGroup.add(glowFrame);

    const vaseMat = new THREE.MeshStandardMaterial({ color: 0xefede8, roughness: 0.2 });
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.3, 16), vaseMat);
    vase.position.set(0, 2.38, -0.2);
    bookshelfGroup.add(vase);

    scene.add(bookshelfGroup);

    // 3. RIGHT: WALNUT CREDENZA & SIDEBOARD GROUP
    const credenzaGroup = new THREE.Group();
    credenzaGroupRef.current = credenzaGroup;
    credenzaGroup.position.set(2.4, 0, -2.25);

    const credMat = new THREE.MeshStandardMaterial({ color: 0x412818, roughness: 0.5 });
    const credenzaBody = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.95, 0.62), credMat);
    credenzaBody.position.set(0, 0.55, 0);
    credenzaBody.castShadow = true;
    credenzaGroup.add(credenzaBody);

    const knobMat = new THREE.MeshStandardMaterial({ color: 0xcfb56d, metalness: 0.8, roughness: 0.2 });
    for (let i = 0; i < 4; i++) {
      const x = -0.75 + i * 0.5;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 12), knobMat);
      knob.position.set(x + (i % 2 === 0 ? 0.18 : -0.18), 0.6, 0.32);
      credenzaGroup.add(knob);
    }

    // Potted ivy plant on credenza
    const potMat = new THREE.MeshStandardMaterial({ color: 0xc4683a, roughness: 0.6 });
    const smallPot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.15, 16), potMat);
    smallPot.position.set(0.65, 1.1, 0);
    credenzaGroup.add(smallPot);

    const ivyLeafMat = new THREE.MeshStandardMaterial({ color: 0x367341, roughness: 0.4, side: THREE.DoubleSide });
    for (let i = 0; i < 7; i++) {
      const ivy = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.16), ivyLeafMat);
      ivy.position.set(0.65 + (i % 2 ? 0.08 : -0.08), 1.05 - i * 0.05, 0.1 + i * 0.02);
      ivy.rotation.x = Math.PI / 3;
      credenzaGroup.add(ivy);
    }

    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.18), new THREE.MeshStandardMaterial({ color: 0x23496d }));
    b1.position.set(0.2, 1.05, 0);
    credenzaGroup.add(b1);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: 0x7a2929 }));
    b2.position.set(0.21, 1.1, 0.01);
    b2.rotation.y = 0.15;
    credenzaGroup.add(b2);

    // 4. VINTAGE TABLE LAMP GROUP (Mounted on credenza)
    const lampGroup = new THREE.Group();
    lampGroupRef.current = lampGroup;
    lampGroup.position.set(-0.45, 1.05, 0);

    const lampStemMat = new THREE.MeshStandardMaterial({ color: 0xc4a355, metalness: 0.7, roughness: 0.3 });
    const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.06, 0.42, 16), lampStemMat);
    lampStem.position.set(0, 0.2, 0);
    lampGroup.add(lampStem);

    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0xfff3db,
      emissive: 0xffd485,
      emissiveIntensity: 0.65,
      roughness: 0.9,
    });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.32, 24, 1, true), shadeMat);
    shade.position.set(0, 0.45, 0);
    lampGroup.add(shade);

    credenzaGroup.add(lampGroup);
    scene.add(credenzaGroup);

    // 5. WOODEN TREASURE CHEST / STORAGE BOX GROUP (Front-right floor)
    const chestGroup = new THREE.Group();
    chestGroupRef.current = chestGroup;
    chestGroup.position.set(1.1, 0, -2.0);

    const chestWoodMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.55 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8a24d, metalness: 0.8, roughness: 0.25 });

    const chestBody = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.38, 0.44), chestWoodMat);
    chestBody.position.set(0, 0.19, 0);
    chestBody.castShadow = true;
    chestGroup.add(chestBody);

    const lidGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.72, 16, 1, false, 0, Math.PI);
    const chestLid = new THREE.Mesh(lidGeo, chestWoodMat);
    chestLid.position.set(0, 0.38, 0);
    chestLid.rotation.z = Math.PI / 2;
    chestLid.castShadow = true;
    chestGroup.add(chestLid);

    [-0.24, 0, 0.24].forEach((bx) => {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.4, 0.46), brassMat);
      band.position.set(bx, 0.2, 0);
      chestGroup.add(band);
    });

    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.04), brassMat);
    latch.position.set(0, 0.32, 0.23);
    chestGroup.add(latch);

    scene.add(chestGroup);

    // 6. GLAZED CERAMIC URN / JAR PEDESTAL GROUP (Far left)
    const jarGroup = new THREE.Group();
    jarGroupRef.current = jarGroup;
    jarGroup.position.set(-3.2, 0, -1.2);

    const pedMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.6 });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 16), pedMat);
    ped.position.set(0, 0.25, 0);
    ped.castShadow = true;
    jarGroup.add(ped);

    const jarMat = new THREE.MeshStandardMaterial({
      color: 0x2b5b6f,
      roughness: 0.18,
      metalness: 0.1,
    });
    const urnBody = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), jarMat);
    urnBody.position.set(0, 0.62, 0);
    urnBody.scale.set(1, 1.25, 1);
    urnBody.castShadow = true;
    jarGroup.add(urnBody);

    const urnNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.1, 16), jarMat);
    urnNeck.position.set(0, 0.76, 0);
    jarGroup.add(urnNeck);

    const urnLid = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 16), brassMat);
    urnLid.position.set(0, 0.84, 0);
    jarGroup.add(urnLid);

    scene.add(jarGroup);

    // --- 3D CHARACTER RIG (Explorer) ---
    const playerGroup = new THREE.Group();
    playerGroupRef.current = playerGroup;
    playerGroup.position.set(playerPos.current.x, 0, playerPos.current.z);

    const hoodieMat = new THREE.MeshStandardMaterial({ color: 0xedeae2, roughness: 0.75 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.62, 16), hoodieMat);
    torso.position.set(0, 0.95, 0);
    torso.castShadow = true;
    playerGroup.add(torso);

    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), hoodieMat);
    hood.position.set(0, 1.28, -0.06);
    playerGroup.add(hood);

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a27e, roughness: 0.7 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), skinMat);
    head.position.set(0, 1.45, 0);
    head.castShadow = true;
    playerGroup.add(head);

    const hairMat = new THREE.MeshStandardMaterial({ color: 0x24160d, roughness: 0.85 });
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 16), hairMat);
    hair.position.set(0, 1.48, -0.02);
    playerGroup.add(hair);

    const hairGroup = new THREE.Group();
    hairRef.current = hairGroup;
    hairGroup.position.set(0, 1.45, -0.2);

    const hairTieMat = new THREE.MeshStandardMaterial({ color: 0x4a7c6f });
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.015, 8, 16), hairTieMat);
    hairGroup.add(tie);

    const ponytail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 12), hairMat);
    ponytail.position.set(0, -0.16, -0.02);
    ponytail.rotation.x = -Math.PI / 10;
    hairGroup.add(ponytail);
    playerGroup.add(hairGroup);

    const jeansMat = new THREE.MeshStandardMaterial({ color: 0x3d5066, roughness: 0.8 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });

    const leftLegGroup = new THREE.Group();
    leftLegRef.current = leftLegGroup;
    leftLegGroup.position.set(-0.11, 0.65, 0);
    const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 12), jeansMat);
    leftLeg.position.set(0, -0.32, 0);
    leftLeg.castShadow = true;
    leftLegGroup.add(leftLeg);
    const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), shoeMat);
    leftShoe.position.set(0, -0.62, 0.04);
    leftLegGroup.add(leftShoe);
    playerGroup.add(leftLegGroup);

    const rightLegGroup = new THREE.Group();
    rightLegRef.current = rightLegGroup;
    rightLegGroup.position.set(0.11, 0.65, 0);
    const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.65, 12), jeansMat);
    rightLeg.position.set(0, -0.32, 0);
    rightLeg.castShadow = true;
    rightLegGroup.add(rightLeg);
    const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), shoeMat);
    rightShoe.position.set(0, -0.62, 0.04);
    rightLegGroup.add(rightShoe);
    playerGroup.add(rightLegGroup);

    const leftArmGroup = new THREE.Group();
    leftArmRef.current = leftArmGroup;
    leftArmGroup.position.set(-0.28, 1.2, 0);
    const leftArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.52, 12), hoodieMat);
    leftArm.position.set(0, -0.24, 0);
    leftArmGroup.add(leftArm);
    playerGroup.add(leftArmGroup);

    const rightArmGroup = new THREE.Group();
    rightArmRef.current = rightArmGroup;
    rightArmGroup.position.set(0.28, 1.2, 0);
    const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.055, 0.52, 12), hoodieMat);
    rightArm.position.set(0, -0.24, 0);
    rightArmGroup.add(rightArm);
    playerGroup.add(rightArmGroup);

    scene.add(playerGroup);

    // --- GOLDEN SPARK PARTICLES ---
    const sparkCount = 45;
    const sparkGeo = new THREE.BufferGeometry();
    const sparkPositions = new Float32Array(sparkCount * 3);
    const sparkVelocities: THREE.Vector3[] = [];
    for (let i = 0; i < sparkCount; i++) {
      sparkPositions[i * 3] = 0;
      sparkPositions[i * 3 + 1] = 0;
      sparkPositions[i * 3 + 2] = 0;
      sparkVelocities.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 2.2,
          Math.random() * 2.0 + 0.4,
          (Math.random() - 0.5) * 2.2
        )
      );
    }
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
      color: 0xffd24d,
      size: 0.12,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
    });
    const sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    scene.add(sparkPoints);
    sparkParticles.current = { mesh: sparkPoints, velocities: sparkVelocities, life: 0 };

    // --- RESIZE HANDLER ---
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // --- ANIMATION / RENDER LOOP ---
    let animId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Pulsing reticle animation below painting
      if (reticleRingRef.current) {
        const pulse = 1 + Math.sin(elapsed * 3) * 0.14;
        reticleRingRef.current.scale.set(pulse, pulse, 1);
        (reticleRingRef.current.material as THREE.MeshBasicMaterial).opacity = 0.65 + Math.sin(elapsed * 3) * 0.25;
      }

      // Bookshelf secret glow animation
      if (secretGlowRef.current) {
        const glowScale = 1 + Math.sin(elapsed * 2.4) * 0.08;
        secretGlowRef.current.scale.set(glowScale, glowScale, glowScale);
      }

      // Shaking wobble physics for wrong clue feedback
      if (shakingGroupRef.current) {
        const elapsedShake = (performance.now() - shakeStartTime.current) / 1000;
        if (elapsedShake < 0.8) {
          const decay = Math.max(0, 1 - elapsedShake / 0.8);
          shakingGroupRef.current.rotation.z = Math.sin(elapsedShake * 32) * 0.06 * decay;
        } else {
          shakingGroupRef.current.rotation.z = 0;
          shakingGroupRef.current = null;
        }
      }

      // Spark particle physics
      if (sparkParticles.current && sparkParticles.current.life > 0) {
        sparkParticles.current.life -= delta;
        const pts = sparkParticles.current.mesh.geometry.attributes.position as THREE.BufferAttribute;
        const vels = sparkParticles.current.velocities;
        for (let i = 0; i < sparkCount; i++) {
          pts.setXYZ(
            i,
            pts.getX(i) + vels[i].x * delta,
            pts.getY(i) + vels[i].y * delta,
            pts.getZ(i) + vels[i].z * delta
          );
          vels[i].y -= 3.5 * delta;
        }
        pts.needsUpdate = true;
        (sparkParticles.current.mesh.material as THREE.PointsMaterial).opacity = Math.max(
          0,
          sparkParticles.current.life / 1.5
        );
      }

      // Keyboard & Click-to-Move Player Movement
      let moveX = 0;
      let moveZ = 0;

      if (keysPressed.current['w'] || keysPressed.current['arrowup']) moveZ -= 1;
      if (keysPressed.current['s'] || keysPressed.current['arrowdown']) moveZ += 1;
      if (keysPressed.current['a'] || keysPressed.current['arrowleft']) moveX -= 1;
      if (keysPressed.current['d'] || keysPressed.current['arrowright']) moveX += 1;

      if (targetPos.current) {
        const dx = targetPos.current.x - playerPos.current.x;
        const dz = targetPos.current.z - playerPos.current.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.08) {
          moveX = dx / dist;
          moveZ = dz / dist;
        } else {
          targetPos.current = null;
        }
      }

      const isMoving = moveX !== 0 || moveZ !== 0;
      isWalking.current = isMoving;

      if (isMoving) {
        const speed = 2.4 * delta;
        const nextX = Math.max(-2.8, Math.min(2.8, playerPos.current.x + moveX * speed));
        const nextZ = Math.max(-1.8, Math.min(1.5, playerPos.current.z + moveZ * speed));
        playerPos.current.x = nextX;
        playerPos.current.z = nextZ;

        const targetRot = Math.atan2(moveX, moveZ);
        playerPos.current.rot = THREE.MathUtils.lerp(playerPos.current.rot, targetRot, 0.2);

        walkPhase.current += delta * 12;
        if (Math.sin(walkPhase.current) > 0.95 && Math.random() < 0.2) {
          sound.playStep();
        }

        onPlayerMoveRef.current?.(playerPos.current.x, playerPos.current.z, playerPos.current.rot, localDriven.current);
      }

      // Update Character Transform & Bone Animations
      if (playerGroupRef.current) {
        playerGroupRef.current.position.set(playerPos.current.x, 0, playerPos.current.z);
        playerGroupRef.current.rotation.y = playerPos.current.rot;

        if (isMoving) {
          const legSwing = Math.sin(walkPhase.current) * 0.45;
          if (leftLegRef.current) leftLegRef.current.rotation.x = legSwing;
          if (rightLegRef.current) rightLegRef.current.rotation.x = -legSwing;
          if (leftArmRef.current) leftArmRef.current.rotation.x = -legSwing * 0.6;
          if (rightArmRef.current) rightArmRef.current.rotation.x = legSwing * 0.6;
          playerGroupRef.current.position.y = Math.abs(Math.sin(walkPhase.current * 2)) * 0.04;
          if (hairRef.current) hairRef.current.rotation.x = -Math.PI / 12 + Math.sin(walkPhase.current) * 0.12;
        } else {
          const breath = Math.sin(elapsed * 2.2) * 0.015;
          if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
          if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
          if (leftArmRef.current) leftArmRef.current.rotation.x = breath;
          if (rightArmRef.current) rightArmRef.current.rotation.x = breath;
          playerGroupRef.current.position.y = breath;
          if (hairRef.current) hairRef.current.rotation.x = -Math.PI / 12;
        }
      }

      // Camera subtle mouse parallax
      if (cameraRef.current) {
        cameraRef.current.position.x = THREE.MathUtils.lerp(cameraRef.current.position.x, mouseHoverPos.current.x * 0.35, 0.05);
        cameraRef.current.position.y = THREE.MathUtils.lerp(cameraRef.current.position.y, 3.1 + mouseHoverPos.current.y * 0.25, 0.05);
        cameraRef.current.lookAt(0, 1.35, 0);
        cameraRef.current.updateMatrixWorld();
        renderer.render(scene, cameraRef.current);
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []); // Mount scene once

  // Register all clickable object hierarchies whenever hotspots prop updates
  useEffect(() => {
    clickableObjects.current.clear();
    if (!hotspots || hotspots.length === 0) return;

    const registerHierarchy = (obj: THREE.Object3D | null | undefined, hotspot: SceneHotspot | undefined) => {
      if (!obj || !hotspot) return;
      clickableObjects.current.set(obj, hotspot);
      obj.traverse((child) => {
        clickableObjects.current.set(child, hotspot);
      });
    };

    const paintingHotspot = hotspots.find((h) => h.type === 'painting' || h.name === 'painting');
    const bookHotspot = hotspots.find((h) => h.type === 'bookshelf' || h.name === 'notebook' || h.name === 'map');
    const lampHotspot = hotspots.find((h) => h.type === 'lamp' || h.name === 'lantern');
    const chestHotspot = hotspots.find((h) => h.type === 'chest' || h.name === 'chest' || h.name === 'box');
    const jarHotspot = hotspots.find((h) => h.type === 'jar' || h.name === 'jar');
    const credHotspot = hotspots.find((h) => h.type === 'credenza' || h.name === 'drawer');

    registerHierarchy(paintingGroupRef.current, paintingHotspot);
    registerHierarchy(bookshelfGroupRef.current, bookHotspot);
    registerHierarchy(chestGroupRef.current, chestHotspot);
    registerHierarchy(jarGroupRef.current, jarHotspot);
    registerHierarchy(credenzaGroupRef.current, credHotspot);
    // Lamp is child of credenzaGroup, register after credenza to ensure lamp priority
    registerHierarchy(lampGroupRef.current, lampHotspot);
  }, [hotspots]);

  // Trigger spark burst when clue is discovered
  useEffect(() => {
    if (isFound && sparkParticles.current) {
      sparkParticles.current.life = 1.8;
      const pts = sparkParticles.current.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const correctH = hotspots.find((h) => h.isCorrect) || hotspots[0];
      const targetX = correctH?.x ?? 0;
      const targetY = correctH?.y ?? 2.0;
      const targetZ = correctH?.z ?? -2.6;

      for (let i = 0; i < 45; i++) {
        pts.setXYZ(i, targetX, targetY, targetZ);
      }
      pts.needsUpdate = true;
      (sparkParticles.current.mesh.material as THREE.PointsMaterial).opacity = 1.0;
      sound.playClueFound();
    }
  }, [isFound, hotspots]);

  // Wobble feedback when shakeId prop is provided
  useEffect(() => {
    if (shakeId) {
      const targetHotspot = hotspots.find((h) => h.id === shakeId);
      if (targetHotspot) {
        if (targetHotspot.type === 'painting') shakingGroupRef.current = paintingGroupRef.current;
        else if (targetHotspot.type === 'bookshelf') shakingGroupRef.current = bookshelfGroupRef.current;
        else if (targetHotspot.type === 'lamp') shakingGroupRef.current = lampGroupRef.current;
        else if (targetHotspot.type === 'chest') shakingGroupRef.current = chestGroupRef.current;
        else if (targetHotspot.type === 'jar') shakingGroupRef.current = jarGroupRef.current;
        else if (targetHotspot.type === 'credenza') shakingGroupRef.current = credenzaGroupRef.current;
        shakeStartTime.current = performance.now();
      }
    } else {
      if (shakingGroupRef.current) {
        shakingGroupRef.current.rotation.z = 0;
        shakingGroupRef.current = null;
      }
    }
  }, [shakeId, hotspots]);

  // Walk the explorer to where the other side moved it. A far jump (joining
  // mid-stage) snaps instead of walking across the room.
  useEffect(() => {
    if (!remoteMove) return;
    localDriven.current = false;
    const dist = Math.hypot(remoteMove.x - playerPos.current.x, remoteMove.z - playerPos.current.z);
    if (dist > 2) {
      playerPos.current = { x: remoteMove.x, z: remoteMove.z, rot: remoteMove.rot };
      targetPos.current = null;
    } else {
      targetPos.current = { x: remoteMove.x, z: remoteMove.z };
    }
  }, [remoteMove]);

  // Keyboard navigation listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (!canMoveRef.current) return;
        localDriven.current = true;
        keysPressed.current[k] = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (keysPressed.current[k]) {
        keysPressed.current[k] = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Raycasting for object click & mouse movement
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!mountRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      const camera = cameraRef.current;
      camera.updateMatrixWorld();

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Check if clicked directly on an interactive hotspot object
      const hits = raycaster.intersectObjects(sceneRef.current.children, true);
      let hitHotspot: SceneHotspot | null = null;

      for (const hit of hits) {
        // Skip player explorer character so clicks on objects behind player are not blocked
        let isPlayer = false;
        let pCur: THREE.Object3D | null = hit.object;
        while (pCur) {
          if (pCur === playerGroupRef.current) {
            isPlayer = true;
            break;
          }
          pCur = pCur.parent;
        }
        if (isPlayer) continue;

        let cur: THREE.Object3D | null = hit.object;
        while (cur) {
          if (clickableObjects.current.has(cur)) {
            hitHotspot = clickableObjects.current.get(cur)!;
            break;
          }
          cur = cur.parent;
        }
        if (hitHotspot) break;
      }

      if (hitHotspot && canInteract) {
        sound.playHover();
        onInteract(hitHotspot);
        // Face player towards clicked hotspot
        const dx = hitHotspot.x - playerPos.current.x;
        const dz = hitHotspot.z - playerPos.current.z;
        playerPos.current.rot = Math.atan2(dx, dz);
        // Walk a step towards the hotspot
        localDriven.current = true;
        targetPos.current = {
          x: Math.max(-2.5, Math.min(2.5, hitHotspot.x * 0.7)),
          z: Math.max(-1.5, Math.min(1.2, hitHotspot.z + 1.2)),
        };
        return;
      }

      // Otherwise click on floor to walk character there
      if (!canMove) return;
      const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersectionPoint = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(floorPlane, intersectionPoint)) {
        localDriven.current = true;
        targetPos.current = {
          x: Math.max(-2.8, Math.min(2.8, intersectionPoint.x)),
          z: Math.max(-1.8, Math.min(1.5, intersectionPoint.z)),
        };
      }
    },
    [canInteract, canMove, onInteract]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!mountRef.current || !sceneRef.current || !cameraRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseHoverPos.current = { x: nx, y: ny };

      const camera = cameraRef.current;
      camera.updateMatrixWorld();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);

      const hits = raycaster.intersectObjects(sceneRef.current.children, true);
      let hitHotspot: SceneHotspot | null = null;
      for (const hit of hits) {
        let isPlayer = false;
        let pCur: THREE.Object3D | null = hit.object;
        while (pCur) {
          if (pCur === playerGroupRef.current) {
            isPlayer = true;
            break;
          }
          pCur = pCur.parent;
        }
        if (isPlayer) continue;

        let cur: THREE.Object3D | null = hit.object;
        while (cur) {
          if (clickableObjects.current.has(cur)) {
            hitHotspot = clickableObjects.current.get(cur)!;
            break;
          }
          cur = cur.parent;
        }
        if (hitHotspot) break;
      }

      if (hitHotspot && canInteract) {
        setHoveredHotspot(hitHotspot);
        setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        if (mountRef.current) mountRef.current.style.cursor = 'pointer';
        if (rendererRef.current?.domElement) rendererRef.current.domElement.style.cursor = 'pointer';
      } else {
        setHoveredHotspot(null);
        setHoverPos(null);
        if (mountRef.current) mountRef.current.style.cursor = 'default';
        if (rendererRef.current?.domElement) rendererRef.current.domElement.style.cursor = 'default';
      }
    },
    [canInteract]
  );

  const handlePointerLeave = useCallback(() => {
    setHoveredHotspot(null);
    setHoverPos(null);
    if (mountRef.current) mountRef.current.style.cursor = 'default';
    if (rendererRef.current?.domElement) rendererRef.current.domElement.style.cursor = 'default';
  }, []);

  return (
    <div
      ref={mountRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: hoveredHotspot && canInteract ? 'pointer' : 'default',
        touchAction: 'none',
      }}
    >
      {/* Floating Interactive Hover Tooltip */}
      {hoveredHotspot && hoverPos && canInteract && (
        <div
          style={{
            position: 'absolute',
            left: Math.max(16, hoverPos.x + 16),
            top: Math.max(16, hoverPos.y - 36),
            pointerEvents: 'none',
            zIndex: 40,
            background: 'rgba(24, 32, 28, 0.94)',
            backdropFilter: 'blur(8px)',
            border: '1.5px solid rgba(255, 215, 120, 0.75)',
            borderRadius: 999,
            padding: '5px 14px',
            color: '#fff',
            fontSize: 12,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#ffd24d' }}>🔍</span>
          <span>Click to inspect {hoveredHotspot.name.replace(/^[a-z]/, (c) => c.toUpperCase())}</span>
        </div>
      )}
    </div>
  );
}
