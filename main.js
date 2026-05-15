import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

// Levels Config
let currentLevelIdx = 0;
let correctAnswersInLevel = 0;
const LEVELS = [
    { 
        id: 1, name: "Castle Dungeon", 
        sky: 'assets/realistic_sky.png', floor: 'assets/realistic_stone_floor.png', wall: 'assets/realistic_castle_wall.png', 
        monsters: 25, genMath: () => genMathTask(1, 1), bgmParams: { r: 100, g: 100, b: 150 }
    },
    { 
        id: 2, name: "Desert Ruins", 
        sky: 'assets/desert_sky.png', floor: 'assets/desert_floor.png', wall: 'assets/desert_wall.png', 
        monsters: 35, genMath: () => genMathTask(1, 2), bgmParams: { r: 200, g: 180, b: 100 }
    },
    { 
        id: 3, name: "Shallow Ocean", 
        sky: 'assets/realistic_sky.png', floor: 'assets/ocean_floor.png', wall: 'assets/ocean_wall.png', 
        monsters: 50, genMath: () => genMathTask(2, 2), bgmParams: { r: 50, g: 150, b: 200 }
    },
    { 
        id: 4, name: "Deep Forest", 
        sky: 'assets/forest_sky.png', floor: 'assets/forest_floor.png', wall: 'assets/forest_wall.png', 
        monsters: 70, genMath: () => genMathTask(3, 2), bgmParams: { r: 50, g: 180, b: 80 }
    }
];

// Environments & Entities
let environmentGroup = new THREE.Group();
let monsters = [];
let crystals = [];
let obstacles = [];
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
    if (cachedTextures[path]) return cachedTextures[path];
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

// Math generator (Multiple Choice)
function genMathTask(digitsA, digitsB) {
    const minA = digitsA === 1 ? 1 : Math.pow(10, digitsA - 1);
    const maxA = Math.pow(10, digitsA) - 1;
    const minB = digitsB === 1 ? 1 : Math.pow(10, digitsB - 1);
    const maxB = Math.pow(10, digitsB) - 1;
    const a = Math.floor(Math.random() * (maxA - minA + 1)) + minA;
    const b = Math.floor(Math.random() * (maxB - minB + 1)) + minB;
    const trueAns = a + b;
    
    // Generate 3 wrong answers
    let choices = [trueAns];
    while(choices.length < 4) {
        const offset = Math.floor(Math.random() * 10) + 1;
        const fake = trueAns + (Math.random() > 0.5 ? offset : -offset);
        if (fake > 0 && !choices.includes(fake)) {
            choices.push(fake);
        }
    }
    
    // Shuffle choices
    choices.sort(() => Math.random() - 0.5);

    // Formats
    const formats = [
        { q: `${a} ＋ ${b} ＝ ？`, r: `${a} たす ${b} は？` },
        { q: `りんごが ${a}こ ありました。\nさらに ${b}こ もらうと、\nぜんぶで いくつ？`, r: `りんごが ${a}こ ありました。さらに ${b}こ もらうと、ぜんぶで いくつ？` },
        { q: `コインを ${a}まい もっています。\nたからばこから ${b}まい みつけると、\nぜんぶで なんまい？`, r: `コインを ${a}まい もっています。たからばこから ${b}まい みつけると、ぜんぶで なんまい？` },
        { q: `モンスターを ${a}ひき たおしました。\nさらに ${b}ひき たおすと、\nぜんぶで なんびき？`, r: `モンスターを ${a}ひき たおしました。さらに ${b}ひき たおすと、ぜんぶで なんびき？` },
        { q: `クッキーを ${a}まい やきました。\nさらに ${b}まい やくと、\nぜんぶで なんまい？`, r: `クッキーを ${a}まい やきました。さらに ${b}まい やくと、ぜんぶで なんまい？` }
    ];
    
    const format = formats[Math.floor(Math.random() * formats.length)];
    
    return { 
        q: format.q, 
        readText: format.r,
        a: trueAns,
        choices: choices 
    };
}

init();

function init() {
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

    // Clear old env
    while(environmentGroup.children.length > 0){ 
        environmentGroup.remove(environmentGroup.children[0]); 
    }
    crystals.forEach(c => scene.remove(c));
    crystals = [];
    monsters.forEach(m => scene.remove(m.mesh));
    monsters = [];
    obstacles = [];

    // Sky & Fog
    scene.background = loadTexture(config.sky);
    scene.background.mapping = THREE.EquirectangularReflectionMapping;
    scene.fog.color.setRGB(config.bgmParams.r/255, config.bgmParams.g/255, config.bgmParams.b/255);

    // Floor
    const floorMat = new THREE.MeshStandardMaterial({ map: loadTexture(config.floor, [50, 50]), roughness: 0.9 });
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    environmentGroup.add(floor);

    // Arena Walls
    const wallMat = new THREE.MeshStandardMaterial({ map: loadTexture(config.wall, [25, 2]), roughness: 0.8 });
    const wallGeo = new THREE.BoxGeometry(100, 6, 2);
    
    const wallN = new THREE.Mesh(wallGeo, wallMat); wallN.position.set(0, 3, -50);
    const wallS = new THREE.Mesh(wallGeo, wallMat); wallS.position.set(0, 3, 50);
    const wallE = new THREE.Mesh(wallGeo, wallMat); wallE.rotation.y = Math.PI/2; wallE.position.set(50, 3, 0);
    const wallW = new THREE.Mesh(wallGeo, wallMat); wallW.rotation.y = Math.PI/2; wallW.position.set(-50, 3, 0);
    
    [wallN, wallS, wallE, wallW].forEach(w => {
        w.receiveShadow = true;
        w.castShadow = true;
        environmentGroup.add(w);
    });

    // Generate Obstacles
    const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 16);
    const crateGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const obstacleMat = new THREE.MeshPhysicalMaterial({ color: '#8B4513', roughness: 0.9 });
    
    for(let i=0; i<40; i++) {
        const isBarrel = Math.random() > 0.5;
        const mesh = new THREE.Mesh(isBarrel ? barrelGeo : crateGeo, obstacleMat);
        mesh.position.set((Math.random() - 0.5) * 90, isBarrel ? 0.6 : 0.75, (Math.random() - 0.5) * 90);
        mesh.rotation.y = Math.random() * Math.PI;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        if (mesh.position.distanceTo(new THREE.Vector3(0,0,0)) < 5) continue;

        environmentGroup.add(mesh);
        obstacles.push(mesh);
    }

    // Spawn Crystals
    const crystalGeo = new THREE.OctahedronGeometry(0.5);
    const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0x00ffff, transmission: 0.8, opacity: 1, transparent: true, roughness: 0.1 });
    for(let i=0; i<5; i++) { 
        const crystal = new THREE.Mesh(crystalGeo, crystalMat);
        let cx = (Math.random() - 0.5) * 80;
        let cz = (Math.random() - 0.5) * 80;
        if (Math.abs(cx) < 10) cx += 20;
        crystal.position.set(cx, 1.0, cz);
        crystal.castShadow = true;
        scene.add(crystal);
        crystals.push(crystal);
    }

    // Spawn Monsters
    for(let i=0; i<config.monsters; i++) {
        spawnMonster((Math.random() - 0.5) * 90, (Math.random() - 0.5) * 90);
    }

    player.position.set(0, 0, 0); 
    player.rotation.set(0, Math.PI, 0); 
    gameState = 'EXPLORE';
}

function spawnMonster(xPos, zPos) {
    if (Math.abs(xPos) < 10 && Math.abs(zPos) < 10) xPos += 20; 

    const group = new THREE.Group();
    group.position.set(xPos, 1.5, zPos);
    
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
    nextAction.reset().fadeIn(0.2).play();
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
    currentQuestion = config.genMath();
    
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

        if (correctAnswersInLevel >= 5) {
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
        
        let isMoving = false;

        if (gameState === 'EXPLORE' && (moveInput.forward !== 0 || moveInput.right !== 0) && !isAttacking && playerFlinchTimer <= 0) {
            isMoving = true;
            const moveVec = new THREE.Vector3(moveInput.right, 0, -moveInput.forward);
            moveVec.normalize().multiplyScalar(moveSpeed * dt);
            
            player.position.add(moveVec);
            
            player.position.x = Math.max(-49, Math.min(49, player.position.x));
            player.position.z = Math.max(-49, Math.min(49, player.position.z));

            for(let o of obstacles) {
                let dist = player.position.distanceTo(o.position);
                if (dist < 1.2) {
                    let push = player.position.clone().sub(o.position).normalize().multiplyScalar(1.2 - dist);
                    push.y = 0;
                    player.position.add(push);
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
                slashMesh.rotation.z = -Math.PI / 2 - Math.PI * progress;
            }

            if (attackTimer <= 0) {
                isAttacking = false;
                if (slashMesh) slashMesh.visible = false;
            }
        }

        if (gameState === 'CELEBRATE') {
            // Anim is already set to cheer, do nothing
        } else if (isMoving && !isAttacking) {
            playAnim('run');
        } else if (!isAttacking) {
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
                crystal.position.y = 1.0 + Math.sin(Date.now() * 0.002) * 0.2;
                if (player.position.distanceTo(crystal.position) < 1.5) {
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
