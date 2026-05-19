import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* 
=============================================================================
【BASIC RULE / 基本ルール】
床や障害物などを作成する際は、絶対に単色（colorだけのマテリアル）を使わず、
必ずテクスチャー（画像マテリアル）などを適用してリッチな3Dの印象にすること！
(Rule: Always use textures/materials for floors and obstacles to maintain a rich 3D look. Do not use plain colors.)
=============================================================================
*/
let scene, camera, renderer;
let player, followCamGroup, swordGroup;
let clock = new THREE.Clock();

// Character body parts
let playerBody, slashMesh;
let playerMixer = null;
let playerAnimations = {};
let currentAction = null;
let playerModel = null;

// Game State
let gameState = 'STORY'; 
let score = 0;
let health = 100;
let moveInput = { forward: 0, right: 0 };
let moveSpeed = 4.0; // Slowed down from 6.0 for better control
let invincibilityTimer = 0;
let playerFlinchTimer = 0;
let isJumping = false;
let velocityY = 0;
const GRAVITY = 25;
const JUMP_POWER = 10;

// Levels Config (loaded from levels.json)
let currentLevelIdx = 0;
let correctAnswersInLevel = 0;
let LEVELS = [];

// Crystal geometry/material shared across all spawns
const CRYSTAL_GEO = new THREE.OctahedronGeometry(0.5);
const CRYSTAL_MAT = new THREE.MeshPhysicalMaterial({ color: 0x00ffff, transmission: 0.8, opacity: 1, transparent: true, roughness: 0.1 });

// Environments & Entities
let environmentGroup = new THREE.Group();
let monsters = [];
let crystals = [];
let platforms = [];
let particles = [];

let currentQuestion = null;
let quizTimer = 60;
let lastTime = 0;
let isAttacking = false;
let attackTimer = 0;

// Materials cache
const textureLoader = new THREE.TextureLoader();
const cachedTextures = {};

function loadTexture(path, repeat = null) {
    if (cachedTextures[path]) {
        if (!repeat) return cachedTextures[path];
        // If repeat is provided but we return cached, it might have wrong repeat. 
        // We shouldn't use `loadTexture` with repeat anymore for platforms, but we'll keep it for backward compatibility.
        return cachedTextures[path];
    }
    const tex = textureLoader.load(path);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat[0], repeat[1]);
    }
    cachedTextures[path] = tex;
    return tex;
}

function getTextureWithRepeat(path, repeatU, repeatV) {
    const tex = textureLoader.load(path);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatU, repeatV);
    return tex;
}

// ----------------------------------------------------
// Typewriter & Speech API
// ----------------------------------------------------
let typeTimeout = null;
function typeText(element, text, speed, onComplete) {
    element.innerText = '';
    let i = 0;
    if(typeTimeout) clearTimeout(typeTimeout);
    
    function type() {
        if (i < text.length) {
            element.innerText += text.charAt(i);
            i++;
            typeTimeout = setTimeout(type, speed);
        } else if(onComplete) {
            onComplete();
        }
    }
    type();
}

function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const ut = new SpeechSynthesisUtterance(text);
        ut.lang = 'ja-JP';
        ut.rate = 1.0;
        ut.pitch = 1.2;
        window.speechSynthesis.speak(ut);
    }
}

function speakAction(text) {
    if ('speechSynthesis' in window && (gameState === 'EXPLORE' || gameState === 'CELEBRATE')) {
        if (gameState === 'QUIZ') return;
        window.speechSynthesis.cancel();
        const ut = new SpeechSynthesisUtterance(text);
        ut.lang = 'ja-JP';
        ut.rate = 1.5;
        ut.pitch = 1.8;
        ut.volume = 0.5;
        window.speechSynthesis.speak(ut);
    }
}

// ----------------------------------------------------
// SFX (Synthesizer via Web Audio API)
// ----------------------------------------------------
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playSound(type) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'swing') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
        gainNode.gain.setValueAtTime(0.5, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === 'hit') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
        gainNode.gain.setValueAtTime(0.8, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'damage') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
        gainNode.gain.setValueAtTime(1.0, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'correct') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(800, now + 0.1);
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    } else if (type === 'crystal') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.5);
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
        osc.start(now); osc.stop(now + 0.5);
    }
}

function spawnExplosion(pos) {
    const geo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8e44ad });
    for(let i=0; i<15; i++) {
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        p.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 15,
            Math.random() * 15,
            (Math.random() - 0.5) * 15
        );
        p.lifetime = 0.8 + Math.random() * 0.4;
        scene.add(p);
        particles.push({ mesh: p, vel: p.velocity, life: p.lifetime });
    }
}

// Math generator (Tailored for 1st Graders)
function genMathTask(levelId) {
    let a, b, trueAns;
    let isSub = false;
    
    if (levelId === 1) {
        // 1学期レベル: 繰り上がりなしのたしざん (和が10以下)
        a = Math.floor(Math.random() * 9) + 1; // 1-9
        b = Math.floor(Math.random() * (10 - a)) + 1; // a+b <= 10
        trueAns = a + b;
    } else if (levelId === 2) {
        // 1学期レベル: 繰り下がりなしのひきざん (10以下のひきざん)
        isSub = true;
        a = Math.floor(Math.random() * 9) + 2; // 2-10
        b = Math.floor(Math.random() * (a - 1)) + 1; // b < a
        trueAns = a - b;
    } else if (levelId === 3) {
        // 2学期レベル: 繰り上がりのあるたしざん (和が11〜18)
        a = Math.floor(Math.random() * 8) + 2; // 2-9
        let minB = 11 - a;
        if (minB > 9) minB = 9; 
        if (minB < 2) minB = 2;
        b = Math.floor(Math.random() * (9 - minB + 1)) + minB; 
        trueAns = a + b;
    } else {
        // 2学期レベル: 繰り下がりのあるひきざん (11〜18 から 2〜9 を引く)
        isSub = true;
        a = Math.floor(Math.random() * 8) + 11; // 11-18
        let minB = a - 9; 
        b = Math.floor(Math.random() * (9 - minB + 1)) + minB;
        trueAns = a - b;
    }
    
    // Generate 3 wrong answers (keep them close to the true answer)
    let choices = [trueAns];
    while(choices.length < 4) {
        const offset = Math.floor(Math.random() * 3) + 1;
        const fake = trueAns + (Math.random() > 0.5 ? offset : -offset);
        if (fake >= 0 && !choices.includes(fake)) {
            choices.push(fake);
        }
    }
    
    // Shuffle choices
    choices.sort(() => Math.random() - 0.5);

    // Formats
    let formats = [];
    if (!isSub) {
        formats = [
            { q: `${a} ＋ ${b} ＝ ？`, r: `${a} たす ${b} は なに？` },
            { q: `りんごが ${a}こ ありました。\nさらに ${b}こ もらうと、\nぜんぶで いくつ？`, r: `りんごが ${a}こ ありました。さらに ${b}こ もらうと、ぜんぶで いくつ？` },
            { q: `モンスターを ${a}ひき たおしました。\nさらに ${b}ひき たおすと、\nぜんぶで なんびき？`, r: `モンスターを ${a}ひき たおしました。さらに ${b}ひき たおすと、ぜんぶで なんびき？` }
        ];
    } else {
        formats = [
            { q: `${a} － ${b} ＝ ？`, r: `${a} ひく ${b} は なに？` },
            { q: `りんごが ${a}こ ありました。\n${b}こ たべると、\nのこりは いくつ？`, r: `りんごが ${a}こ ありました。${b}こ たべると、のこりは いくつ？` },
            { q: `コインを ${a}まい もっています。\n${b}まい つかうと、\nのこりは なんまい？`, r: `コインを ${a}まい もっています。${b}まい つかうと、のこりは なんまい？` }
        ];
    }
    
    const format = formats[Math.floor(Math.random() * formats.length)];
    
    return { 
        q: format.q, 
        readText: format.r,
        a: trueAns,
        choices: choices 
    };
}

init();

async function loadLevelsConfig() {
    try {
        const res = await fetch('levels.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        LEVELS = data.levels;
    } catch (e) {
        console.error('levels.json の読み込みに失敗しました:', e);
        alert('levels.json の読み込みに失敗しました。\nサーバーから起動してください（file:// は不可）。');
    }
}

async function init() {
    await loadLevelsConfig();
    const container = document.getElementById('game-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.Fog(0x87CEEB, 20, 60);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5; // Increased exposure
    container.appendChild(renderer.domElement);

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444477, 1.0); // Brighter
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff0dd, 3.0); // Brighter
    dirLight.position.set(-15, 30, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 4096;
    dirLight.shadow.mapSize.height = 4096;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 150;
    dirLight.shadow.bias = -0.0005;
    const d = 50;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Brighter
    scene.add(ambientLight);

    scene.add(environmentGroup);

    createPlayer();
    
    // UI Events
    document.getElementById('btn-story-next').addEventListener('click', () => {
        document.getElementById('story-screen').classList.add('hidden');
        startGame(false);
    });

    document.getElementById('btn-new-game').addEventListener('click', () => {
        document.getElementById('start-screen').classList.add('hidden');
        document.getElementById('story-screen').classList.remove('hidden');
        startStorySequence();
    });

    document.getElementById('btn-continue').addEventListener('click', () => {
        document.getElementById('start-screen').classList.add('hidden');
        startGame(true);
    });

    if (localStorage.getItem('mathHeroSave')) {
        document.getElementById('btn-continue').classList.remove('hidden');
    }

    document.getElementById('btn-restart').addEventListener('click', () => {
        currentLevelIdx = 0;
        startGame(false);
    });

    document.getElementById('btn-attack').addEventListener('touchstart', (e) => { e.preventDefault(); performAttack(); });
    document.getElementById('btn-attack').addEventListener('mousedown', (e) => { e.preventDefault(); performAttack(); });
    
    document.getElementById('btn-jump').addEventListener('touchstart', (e) => { e.preventDefault(); performJump(); });
    document.getElementById('btn-jump').addEventListener('mousedown', (e) => { e.preventDefault(); performJump(); });

    // Setup multiple choice answer buttons
    const answerBtns = document.querySelectorAll('.quiz-answer-btn');
    answerBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            handleAnswer(parseInt(e.target.innerText));
        });
    });

    window.addEventListener('resize', onWindowResize, false);
    
    window.addEventListener('keydown', (e) => {
        if(e.code === 'KeyW' || e.code === 'ArrowUp') moveInput.forward = 1;
        if(e.code === 'KeyS' || e.code === 'ArrowDown') moveInput.forward = -1;
        if(e.code === 'KeyA' || e.code === 'ArrowLeft') moveInput.right = -1;
        if(e.code === 'KeyD' || e.code === 'ArrowRight') moveInput.right = 1;
        if(e.code === 'Space') performAttack();
        if(e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC') performJump();
    });
    window.addEventListener('keyup', (e) => {
        if(e.code === 'KeyW' || e.code === 'ArrowUp') moveInput.forward = 0;
        if(e.code === 'KeyS' || e.code === 'ArrowDown') moveInput.forward = 0;
        if(e.code === 'KeyA' || e.code === 'ArrowLeft') moveInput.right = 0;
        if(e.code === 'KeyD' || e.code === 'ArrowRight') moveInput.right = 0;
    });

    renderer.setAnimationLoop(animate);

    // Initial state
    gameState = 'START';
}

function autoSave() {
    const saveData = {
        level: currentLevelIdx,
        health: health,
        crystals: correctAnswersInLevel
    };
    localStorage.setItem('mathHeroSave', JSON.stringify(saveData));
}

function startStorySequence() {
    const text1 = "たいへんです！おひめさまが わるいモンスターの のろいで カエルに かえられてしまいました！";
    const text2 = "ひろいダンジョンに かくされた「ちしきのクリスタル」を 5つ さがしだし、クイズに せいかいして のろいを といてください！";
    
    const p1 = document.getElementById('story-p1');
    const p2 = document.getElementById('story-p2');
    const btn = document.getElementById('btn-story-next');
    
    // Auto-resume audio ctx on first click anywhere
    window.addEventListener('click', () => {
        if(audioCtx.state === 'suspended') audioCtx.resume();
    }, { once: true });

    typeText(p1, text1, 80, () => {
        speak(text1);
        setTimeout(() => {
            typeText(p2, text2, 80, () => {
                speak(text2);
                btn.classList.remove('hidden');
            });
        }, 1500);
    });
}

// -------------------------------------------------------
// Level builder helpers (data-driven from levels.json)
// -------------------------------------------------------

function spawnCrystal(x, y, z) {
    const crystal = new THREE.Mesh(CRYSTAL_GEO, CRYSTAL_MAT);
    crystal.position.set(x, y, z);
    crystal.baseY = y;
    crystal.castShadow = true;
    scene.add(crystal);
    crystals.push(crystal);
}

function buildLevel(config, createPlatform) {
    const layout = config.layout;
    if (layout.type === 'flat') {
        buildFlatLayout(config, layout, createPlatform);
    } else if (layout.type === 'branches') {
        buildBranchLayout(layout, createPlatform);
    }
}

function buildFlatLayout(config, layout, createPlatform) {
    const half = layout.floorSize / 2;

    // メインフロア
    createPlatform(0, 0, 0, layout.floorSize, layout.floorSize, 2, false);

    // 外周壁
    if (layout.walls) {
        createPlatform(0,    3, -half, layout.floorSize, 2, 6, false); // 北
        createPlatform(0,    3,  half, layout.floorSize, 2, 6, false); // 南
        createPlatform(-half, 3, 0, 2, layout.floorSize, 6, false);   // 西
        createPlatform( half, 3, 0, 2, layout.floorSize, 6, false);   // 東
    }

    // ランダム障害物（柱・壁）
    if (layout.obstacles) {
        const obs = layout.obstacles;
        for (let i = 0; i < obs.count; i++) {
            const px = (Math.random() - 0.5) * (layout.floorSize - 10);
            const pz = (Math.random() - 0.5) * (layout.floorSize - 10);
            if (Math.abs(px) < obs.clearCenter && Math.abs(pz) < obs.clearCenter) continue;
            const w = obs.wRange[0] + Math.random() * (obs.wRange[1] - obs.wRange[0]);
            const d = obs.dRange[0] + Math.random() * (obs.dRange[1] - obs.dRange[0]);
            const h = obs.hRange[0] + Math.random() * (obs.hRange[1] - obs.hRange[0]);
            createPlatform(px, obs.y, pz, w, d, h, false);
        }
    }

    // クリスタル
    const crystalCfg = config.crystals;
    const spread = crystalCfg.spread || 46;
    for (let i = 0; i < crystalCfg.count; i++) {
        const cx = (Math.random() - 0.5) * spread;
        const cz = (Math.random() - 0.5) * spread;
        spawnCrystal(cx, crystalCfg.y || 1.0, cz);
    }

    // モンスター
    const monCfg = config.monsters;
    const monSpread = monCfg.spread || 46;
    for (let i = 0; i < monCfg.count; i++) {
        const mx = (Math.random() - 0.5) * monSpread;
        const mz = (Math.random() - 0.5) * monSpread;
        if (Math.abs(mx) < (monCfg.clearCenter || 5) && Math.abs(mz) < (monCfg.clearCenter || 5)) continue;
        spawnMonster(mx, mz, 0);
    }
}

function buildBranchLayout(layout, createPlatform) {
    const ci = layout.centerIsland;
    createPlatform(0, 0, 0, ci.w, ci.d, ci.h, false);

    const branchCount = layout.branchCount || 5;
    const monsterOffsets = [[2, 2], [-2, -2], [3, -2], [-3, 2], [0, 3]];

    for (let i = 0; i < branchCount; i++) {
        const angle = (Math.PI * 2 / branchCount) * i;
        const dx = Math.sin(angle);
        const dz = Math.cos(angle);

        layout.steps.forEach((step) => {
            const moving = step.moving || false;
            const axis = moving ? ((i % 2 === 0) ? 'x' : 'z') : 'x';
            createPlatform(dx * step.dist, step.y, dz * step.dist, step.w, step.d, step.h, moving, axis);

            const fx = dx * step.dist;
            const fz = dz * step.dist;

            // このステップ上のクリスタル
            const crystalOffsets = [[0, 0], [3, -3], [-3, 3], [3, 3]];
            for (let c = 0; c < (step.crystals || 0); c++) {
                const [ox, oz] = crystalOffsets[c] || [0, 0];
                spawnCrystal(fx + ox, step.y + 1.0, fz + oz);
            }

            // このステップ上のモンスター
            for (let m = 0; m < (step.monsters || 0); m++) {
                const [ox, oz] = monsterOffsets[m] || [0, 0];
                spawnMonster(fx + ox, fz + oz, step.y);
            }
        });

        // バックドロップ壁（最終ステップの後ろ）
        if (layout.backdropOffset) {
            const last = layout.steps[layout.steps.length - 1];
            createPlatform(
                dx * (last.dist + layout.backdropOffset),
                last.y + 3,
                dz * (last.dist + layout.backdropOffset),
                14, 14, 10, false
            );
        }
    }
}

function loadLevel(levelIndex, isResume = false) {
    if (levelIndex >= LEVELS.length) {
        document.getElementById('game-over-title').innerText = "ゲームクリア！";
        document.getElementById('game-over-title').style.color = "#FFD700";
        document.getElementById('final-score-wrap').innerHTML = "おひめさまの のろいが とけました！";
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('controls').classList.add('hidden');
        gameState = 'GAMEOVER';
        return;
    }

    currentLevelIdx = levelIndex;
    const config = LEVELS[currentLevelIdx];
    if (!isResume) {
        correctAnswersInLevel = 0;
    }
    
    autoSave();

    document.getElementById('level-count').innerText = config.id;
    updateProgressUI();

    // Clean up previous level objects
    while(environmentGroup.children.length > 0){ 
        environmentGroup.remove(environmentGroup.children[0]); 
    }
    crystals.forEach(c => scene.remove(c));
    monsters.forEach(m => scene.remove(m.mesh));
    crystals = [];
    monsters = [];
    platforms = [];

    // 空はテクスチャの映り込みを防ぐため単色で設定する
    const bgR = config.bgColor.r / 255;
    const bgG = config.bgColor.g / 255;
    const bgB = config.bgColor.b / 255;
    scene.background = new THREE.Color(bgR, bgG, bgB);
    scene.environment = null; // PBR材質への反射を無効化
    if (scene.fog) scene.fog.color.setRGB(bgR, bgG, bgB);

    // Platform helper
    function createPlatform(x, y, z, w, d, h, isMoving = false, moveAxis = 'x') {
        const topTex = getTextureWithRepeat(config.floor, Math.max(1, w/5), Math.max(1, d/5));
        const sideTexX = getTextureWithRepeat(config.wall, Math.max(1, d/5), Math.max(1, h/5));
        const sideTexZ = getTextureWithRepeat(config.wall, Math.max(1, w/5), Math.max(1, h/5));
        
        const matTop = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.8 });
        const matSideX = new THREE.MeshStandardMaterial({ map: sideTexX, roughness: 0.9 });
        const matSideZ = new THREE.MeshStandardMaterial({ map: sideTexZ, roughness: 0.9 });
        const matBottom = new THREE.MeshStandardMaterial({ color: 0x222222 }); // Dark bottom

        const matArray = [
            matSideX, // right (x+)
            matSideX, // left (x-)
            matTop,   // top (y+)
            matBottom,// bottom (y-)
            matSideZ, // front (z+)
            matSideZ  // back (z-)
        ];

        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, matArray);
        mesh.position.set(x, y - h/2, z); 
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        environmentGroup.add(mesh);
        
        const plat = {
            mesh, startX: x, startZ: z, w, d, h, isMoving, moveAxis,
            surfaceY: y
        };
        platforms.push(plat);
        return plat;
    }

    // levels.json の設定からレベルを構築
    buildLevel(config, createPlatform);

    const ps = config.playerStart || { x: 0, y: 2, z: 0 };
    player.position.set(ps.x, ps.y, ps.z);
    player.rotation.set(0, Math.PI, 0);
    gameState = 'EXPLORE';
}

function spawnMonster(xPos, zPos, yPos = 0) {
    if (Math.abs(xPos) < 10 && Math.abs(zPos) < 10) xPos += 20; 

    const group = new THREE.Group();
    group.position.set(xPos, yPos + 1.5, zPos);
    
    const boneMat = new THREE.MeshPhysicalMaterial({ color: '#f5f6fa', roughness: 0.5, clearcoat: 0.2 });
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.4, 64, 64), boneMat);
    cranium.castShadow = true; cranium.receiveShadow = true;
    group.add(cranium);

    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4, 32, 32, 32), boneMat);
    jaw.position.set(0, -0.3, 0.1);
    jaw.castShadow = true; jaw.receiveShadow = true;
    group.add(jaw);

    const eyeHoleGeo = new THREE.SphereGeometry(0.12, 32, 32);
    const eyeHoleMat = new THREE.MeshBasicMaterial({ color: '#000000' });
    const eyeL = new THREE.Mesh(eyeHoleGeo, eyeHoleMat);
    eyeL.position.set(-0.15, 0, 0.32);
    eyeL.scale.y = 1.2;
    group.add(eyeL);

    const eyeR = new THREE.Mesh(eyeHoleGeo, eyeHoleMat);
    eyeR.position.set(0.15, 0, 0.32);
    eyeR.scale.y = 1.2;
    group.add(eyeR);

    const glowMat = new THREE.MeshBasicMaterial({ color: '#ff2222' });
    const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), glowMat);
    pupilL.position.set(0, 0, 0.08);
    eyeL.add(pupilL);
    const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), glowMat);
    pupilR.position.set(0, 0, 0.08);
    eyeR.add(pupilR);

    const auraGeo = new THREE.SphereGeometry(0.65, 64, 64);
    const auraMat = new THREE.MeshPhysicalMaterial({ 
        color: '#8e44ad', transmission: 0.8, opacity: 1, transparent: true, roughness: 0.1, side: THREE.BackSide 
    });
    const aura = new THREE.Mesh(auraGeo, auraMat);
    group.add(aura);

    scene.add(group);
    monsters.push({
        mesh: group,
        speed: 1.5 + Math.random() * 2.0,
        state: 'wander',
        timer: Math.random() * 2,
        attackLunge: 0
    });
}

function performAttack() {
    if (gameState !== 'EXPLORE' || isAttacking) return;
    
    isAttacking = true;
    attackTimer = 0.5;
    playSound('swing');
    speakAction('やあっ！');

    playAnim('attack');

    if (slashMesh) {
        slashMesh.visible = true;
        slashMesh.scale.set(0.1, 0.1, 0.1);
        slashMesh.material.opacity = 1.0;
    }

    const attackRange = 3.5;
    const playerDir = new THREE.Vector3(0, 0, -1).applyQuaternion(player.quaternion);

    for (let i = monsters.length - 1; i >= 0; i--) {
        const m = monsters[i];
        const dist = player.position.distanceTo(m.mesh.position);
        if (dist < attackRange) {
            const dirToMonster = m.mesh.position.clone().sub(player.position).normalize();
            const angle = playerDir.angleTo(dirToMonster);
            if (angle < Math.PI * 0.7) { 
                playSound('hit');
                spawnExplosion(m.mesh.position);
                scene.remove(m.mesh);
                monsters.splice(i, 1);
                
                spawnMonster((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90);
            }
        }
    }
}

function performJump() {
    if (gameState !== 'EXPLORE' || isJumping || isAttacking || playerFlinchTimer > 0) return;
    
    isJumping = true;
    velocityY = JUMP_POWER;
    playSound('swing'); // Whoosh sound for jump
    speakAction('えいっ！');
}

function createPlayer() {
    if (player) scene.remove(player);
    player = new THREE.Group();
    playerBody = new THREE.Group();
    player.add(playerBody);

    const loader = new GLTFLoader();
    loader.load('assets/Warrior.glb', (gltf) => {
        playerModel = gltf.scene;
        playerModel.scale.set(0.6, 0.6, 0.6);
        playerModel.rotation.y = Math.PI; // Fix for backwards-facing characters
        
        const texLoader = new THREE.TextureLoader();
        const bodyTex = texLoader.load('assets/Warrior_Texture.png');
        bodyTex.flipY = false; // Essential for GLTF UVs
        bodyTex.colorSpace = THREE.SRGBColorSpace;
        
        const swordTex = texLoader.load('assets/Warrior_Sword_Texture.png');
        swordTex.flipY = false;
        swordTex.colorSpace = THREE.SRGBColorSpace;
        
        playerModel.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    const isSword = child.name.toLowerCase().includes('sword') || child.name.toLowerCase().includes('weapon');
                    const texMap = isSword ? swordTex : bodyTex;
                    
                    // Replace the material completely with a simpler, brighter material
                    child.material = new THREE.MeshLambertMaterial({
                        map: texMap,
                        color: 0xffffff
                    });
                }
            }
        });

        playerMixer = new THREE.AnimationMixer(playerModel);
        gltf.animations.forEach((clip) => {
            const name = clip.name.toLowerCase();
            playerAnimations[name] = playerMixer.clipAction(clip);
        });

        playAnim('idle');
        playerBody.add(playerModel);
    });

    const slashGeo = new THREE.TorusGeometry(2.5, 0.05, 16, 64, Math.PI);
    const slashMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    slashMesh = new THREE.Mesh(slashGeo, slashMat);
    slashMesh.rotation.x = Math.PI / 2;
    slashMesh.position.set(0, 1.2, 0);
    slashMesh.visible = false;
    player.add(slashMesh);

    player.position.set(0, 0, 0);
    scene.add(player);
}

function playAnim(animNamePrefix) {
    if (!playerMixer) return;
    const name = Object.keys(playerAnimations).find(n => n.includes(animNamePrefix.toLowerCase()));
    if (!name) return;
    
    const nextAction = playerAnimations[name];
    if (currentAction === nextAction) return;
    
    if (currentAction) currentAction.fadeOut(0.2);

    nextAction.reset();

    // Normal play speed
    nextAction.timeScale = 1;

    nextAction.fadeIn(0.2).play();
    currentAction = nextAction;
}

function startGame(isResume = false) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('story-screen').classList.add('hidden');
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');

    if (isResume) {
        const saved = JSON.parse(localStorage.getItem('mathHeroSave'));
        if (saved) {
            currentLevelIdx = saved.level || 0;
            health = saved.health || 100;
            correctAnswersInLevel = saved.crystals || 0;
        }
    } else {
        currentLevelIdx = 0;
        health = 100;
        correctAnswersInLevel = 0;
        localStorage.removeItem('mathHeroSave');
    }

    updateHealthUI();
    score = 0;
    
    initJoystick();
    loadLevel(currentLevelIdx, isResume);
}

let joystick;
function initJoystick() {
    if (joystick) return;
    const zone = document.getElementById('joystick-zone');
    joystick = nipplejs.create({
        zone: zone,
        mode: 'dynamic',
        color: 'white',
        size: 100
    });

    joystick.on('move', (evt, data) => {
        const force = Math.min(data.force, 1);
        const angle = data.angle.radian;
        moveInput.right = Math.cos(angle) * force;
        moveInput.forward = Math.sin(angle) * force;
    });

    joystick.on('end', () => {
        moveInput.forward = 0;
        moveInput.right = 0;
    });
}

function updateHealthUI() {
    const healthFill = document.querySelector('.health-bar-fill');
    healthFill.style.width = Math.max(0, health) + '%';
    
    if (health <= 0) {
        document.getElementById('game-over-title').innerText = "つぎはがんばろう！";
        document.getElementById('game-over-title').style.color = "#ff3333";
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('controls').classList.add('hidden');
        gameState = 'GAMEOVER';
    }
}

function updateProgressUI() {
    document.getElementById('progress-count').innerText = correctAnswersInLevel;
    const needed = LEVELS[currentLevelIdx] ? LEVELS[currentLevelIdx].crystalsToAdvance : 5;
    document.getElementById('crystals-needed').innerText = needed;
}

function takeDamage(amt) {
    if (invincibilityTimer > 0) return;
    invincibilityTimer = 1.0; 
    
    playSound('damage');
    health -= amt;
    updateHealthUI();
    
    playerFlinchTimer = 0.3; // Make player flinch backward
    
    document.getElementById('hud').style.boxShadow = "inset 0 0 50px red";
    setTimeout(() => { document.getElementById('hud').style.boxShadow = "none"; }, 200);
}

function triggerQuiz() {
    playSound('crystal');
    gameState = 'QUIZ';
    
    const ui = document.getElementById('quiz-ui');
    const answerButtons = document.getElementById('quiz-answer-buttons');
    const qText = document.getElementById('question-text');
    
    ui.classList.remove('hidden');
    document.getElementById('instruction-text').innerHTML = "ただしい こたえを えらんでね！";
    
    const config = LEVELS[currentLevelIdx];
    currentQuestion = genMathTask(config.mathLevel);
    
    answerButtons.classList.add('hidden'); // Hide buttons while typing
    
    speak(currentQuestion.readText);
    
    typeText(qText, currentQuestion.q, 60, () => {
        // Show options
        answerButtons.classList.remove('hidden');
        const btns = document.querySelectorAll('.quiz-answer-btn');
        btns.forEach((btn, i) => {
            btn.innerText = currentQuestion.choices[i];
            btn.style.display = 'block';
        });
    });

    quizTimer = 60;
    document.getElementById('time-count').innerText = quizTimer;
}

function handleAnswer(selectedAns) {
    const isCorrect = (selectedAns === currentQuestion.a);
    
    if (isCorrect) {
        playSound('correct');
        speak("せいかい！");
        correctAnswersInLevel++;
        updateProgressUI();
        
        // 正解演出
        playAnim('cheer');
        
        // キラキラパーティクル
        for(let i=0; i<30; i++) {
            const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
            const mat = new THREE.MeshBasicMaterial({ color: 0xFFD700 });
            const p = new THREE.Mesh(geo, mat);
            p.position.copy(player.position);
            p.position.y += 1.0;
            p.velocity = new THREE.Vector3(
                (Math.random() - 0.5) * 10,
                Math.random() * 15,
                (Math.random() - 0.5) * 10
            );
            p.lifetime = 1.5 + Math.random() * 0.5;
            scene.add(p);
            particles.push({ mesh: p, vel: p.velocity, life: p.lifetime });
        }
        
        gameState = 'CELEBRATE'; // 演出用の待機状態

        document.getElementById('quiz-ui').classList.add('hidden');
        document.getElementById('quiz-answer-buttons').classList.add('hidden');
        document.getElementById('instruction-text').innerHTML = "大せいかい！";

        const needed = LEVELS[currentLevelIdx].crystalsToAdvance || 5;
        if (correctAnswersInLevel >= needed) {
            setTimeout(() => {
                loadLevel(currentLevelIdx + 1, false);
            }, 2000);
        } else {
            autoSave();
            setTimeout(() => {
                gameState = 'EXPLORE';
                document.getElementById('instruction-text').innerHTML = "クリスタルを さがしてね！";
            }, 2000);
        }
    } else {
        playSound('damage');
        speak("ざんねん、ちがいます");
        takeDamage(20);
        
        document.getElementById('quiz-ui').classList.add('hidden');
        document.getElementById('quiz-answer-buttons').classList.add('hidden');
        document.getElementById('instruction-text').innerHTML = "クリスタルを さがしてね！";
        
        gameState = 'EXPLORE';
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    const now = performance.now() / 1000;
    const dt = Math.min(now - lastTime, 0.1);
    lastTime = now;

    if (playerMixer) playerMixer.update(dt);

    // Invincibility Blinking
    if (invincibilityTimer > 0) {
        invincibilityTimer -= dt;
        playerBody.visible = Math.floor(invincibilityTimer * 10) % 2 === 0;
    } else {
        playerBody.visible = true;
    }

    // Flinch Animation
    if (playerFlinchTimer > 0) {
        playerFlinchTimer -= dt;
        playerBody.rotation.x = -Math.PI / 4;
    } else {
        playerBody.rotation.x = 0;
    }

    if (gameState === 'EXPLORE' || gameState === 'QUIZ' || gameState === 'CELEBRATE') {
        
        // Update moving platforms independently of player movement
        for (let p of platforms) {
            if (p.isMoving) {
                const offset = Math.sin(now * 0.5) * 5.0; // move range 5, slower speed
                if (p.moveAxis === 'x') {
                    p.mesh.position.x = p.startX + offset;
                } else {
                    p.mesh.position.z = p.startZ + offset;
                }
            }
        }

        let isMoving = false;

        if (gameState === 'EXPLORE' && (moveInput.forward !== 0 || moveInput.right !== 0) && !isAttacking && playerFlinchTimer <= 0) {
            isMoving = true;
            const moveVec = new THREE.Vector3(moveInput.right, 0, -moveInput.forward);
            moveVec.normalize().multiplyScalar(moveSpeed * dt);
            
            // X and Z movement
            player.position.add(moveVec);
            
            // Horizontal Platform Collision (prevent walking through walls)
            for (let p of platforms) {
                let px = p.mesh.position.x;
                let pz = p.mesh.position.z;
                if (player.position.y < p.surfaceY - 0.2 && player.position.y > p.surfaceY - p.h - 1.0) {
                    if (Math.abs(player.position.x - px) < p.w/2 + 0.5 &&
                        Math.abs(player.position.z - pz) < p.d/2 + 0.5) {
                        let dx = player.position.x - px;
                        let dz = player.position.z - pz;
                        if (Math.abs(dx) > Math.abs(dz)) {
                            player.position.x = px + Math.sign(dx) * (p.w/2 + 0.51);
                        } else {
                            player.position.z = pz + Math.sign(dz) * (p.d/2 + 0.51);
                        }
                    }
                }
            }

            const targetAngle = Math.atan2(-moveVec.x, -moveVec.z);
            let diff = targetAngle - player.rotation.y;
            while(diff < -Math.PI) diff += Math.PI * 2;
            while(diff > Math.PI) diff -= Math.PI * 2;
            // Lowered turning speed for easier control
            player.rotation.y += diff * 5.0 * dt; 
        }

        // Animate Attack
        if (isAttacking) {
            attackTimer -= dt;
            const progress = 1.0 - (attackTimer / 0.5);

            if (slashMesh) {
                slashMesh.visible = true;
                slashMesh.scale.setScalar(0.5 + progress * 0.5);
                slashMesh.material.opacity = 1.0 - progress;
                // Swing from inside to outside
                slashMesh.rotation.z = Math.PI / 2 - Math.PI * progress;
            }

            if (attackTimer <= 0) {
                isAttacking = false;
                if (slashMesh) slashMesh.visible = false;
            }
        }

        // Vertical Movement (Gravity, Jumping, & Platform Support)
        let groundY = -100; // Abyss
        let onPlatform = null;

        for (let p of platforms) {
            let px = p.mesh.position.x;
            let pz = p.mesh.position.z;
            if (player.position.x >= px - p.w/2 - 0.4 && player.position.x <= px + p.w/2 + 0.4 &&
                player.position.z >= pz - p.d/2 - 0.4 && player.position.z <= pz + p.d/2 + 0.4) {
                if (player.position.y >= p.surfaceY - 0.5) { // Can step up slightly
                    if (p.surfaceY > groundY) {
                        groundY = p.surfaceY;
                        onPlatform = p;
                    }
                }
            }
        }

        if (isJumping || player.position.y > groundY) {
            velocityY -= GRAVITY * dt;
            player.position.y += velocityY * dt;
            
            if (player.position.y <= groundY && velocityY <= 0) {
                player.position.y = groundY;
                velocityY = 0;
                isJumping = false;
            }
        } else {
            player.position.y = groundY;
            if (onPlatform && onPlatform.isMoving && !isJumping) {
                // Carry player on moving platform
                const speed = Math.cos(now * 0.5) * 0.5 * 5.0 * dt;
                if (onPlatform.moveAxis === 'x') player.position.x += speed;
                else player.position.z += speed;
            }
        }

        // Death by falling
        if (player.position.y < -15) {
            takeDamage(10); // Less punishing for 1st graders
            if (health > 0) {
                player.position.set(0, 5, 0); // Respawn at center
                velocityY = 0;
                isJumping = false;
            }
        }

        if (gameState === 'CELEBRATE') {
            // Anim is already set to cheer, do nothing
        } else if (isAttacking) {
            // Anim handled in performAttack (attack clip)
        } else if (isJumping) {
            playAnim('jump');
        } else if (isMoving) {
            playAnim('run');
        } else {
            playAnim('idle');
            if (playerFlinchTimer <= 0) playerBody.rotation.y = 0;
        }

        // Monsters Logic
        monsters.forEach(m => {
            if (gameState === 'EXPLORE') {
                m.timer -= dt;
                
                const dx = m.mesh.position.x - player.position.x;
                const dz = m.mesh.position.z - player.position.z;
                const distToPlayer = Math.sqrt(dx*dx + dz*dz);
                
                if (distToPlayer < 15) {
                    m.state = 'chase';
                } else if (m.timer <= 0) {
                    m.state = 'wander';
                    m.timer = 2 + Math.random() * 2;
                    m.targetAngle = Math.random() * Math.PI * 2;
                }

                let moveDir = new THREE.Vector3();
                if (m.state === 'chase') {
                    moveDir.copy(player.position).sub(m.mesh.position).normalize();
                    m.mesh.lookAt(player.position);
                } else {
                    moveDir.set(Math.sin(m.targetAngle), 0, Math.cos(m.targetAngle));
                    m.mesh.rotation.y = m.targetAngle;
                }

                // If attacking, lunge forward fast
                if (m.attackLunge > 0) {
                    m.attackLunge -= dt;
                    m.mesh.position.addScaledVector(moveDir, m.speed * 4 * dt);
                } else {
                    m.mesh.position.addScaledVector(moveDir, m.speed * dt);
                }
                
                m.mesh.position.x = Math.max(-49, Math.min(49, m.mesh.position.x));
                m.mesh.position.z = Math.max(-49, Math.min(49, m.mesh.position.z));
                
                m.mesh.position.y = 1.5 + Math.sin(Date.now() * 0.003 + m.timer) * 0.2;

                if (distToPlayer < 1.0 && invincibilityTimer <= 0) {
                    takeDamage(10);
                    // Monster lunge animation
                    m.attackLunge = 0.3;
                    m.mesh.position.addScaledVector(moveDir, -1.0); // Step back to lunge
                }
            } else {
                m.mesh.position.y = 1.5 + Math.sin(Date.now() * 0.003 + m.timer) * 0.2;
            }
        });

        if (gameState === 'EXPLORE') {
            crystals.forEach((crystal, index) => {
                crystal.rotation.y += dt;
                crystal.position.y = crystal.baseY + Math.sin(Date.now() * 0.002) * 0.2;
                if (player.position.distanceTo(crystal.position) < 1.5) {
                    playSound('crystal');
                    spawnExplosion(crystal.position); // Add particle effects!
                    scene.remove(crystal);
                    crystals.splice(index, 1);
                    triggerQuiz();
                }
            });
        }

        if (gameState === 'QUIZ') {
            quizTimer -= dt;
            document.getElementById('time-count').innerText = Math.ceil(quizTimer);
            if (quizTimer <= 0) {
                speak("じかんぎれです！");
                takeDamage(20);
                handleAnswer(null);
            }
        }

        // Remove particles
        for(let i=particles.length-1; i>=0; i--) {
            let p = particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                scene.remove(p.mesh);
                particles.splice(i, 1);
                continue;
            }
            p.vel.y -= 25 * dt; 
            p.mesh.position.addScaledVector(p.vel, dt);
            
            if(p.mesh.position.y < 0.1) {
                p.mesh.position.y = 0.1;
                p.vel.y *= -0.5; 
                p.vel.x *= 0.8;
                p.vel.z *= 0.8;
            }
            
            p.mesh.rotation.x += dt * 10;
            p.mesh.rotation.y += dt * 10;
            p.mesh.scale.setScalar(p.life);
        }

        // Camera Update (Fixed Angle Follow)
        const targetCamPos = player.position.clone();
        targetCamPos.add(new THREE.Vector3(0, 4.0, 5.0));
        camera.position.lerp(targetCamPos, 5 * dt);
        
        const lookAtPos = player.position.clone();
        lookAtPos.y += 1.0;
        camera.lookAt(lookAtPos);
    }

    renderer.render(scene, camera);
}
