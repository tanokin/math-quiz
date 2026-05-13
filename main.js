import * as THREE from 'three';

let scene, camera, renderer;
let player, followCamGroup, swordGroup;
let clock = new THREE.Clock();

// Character body parts
let playerBody, charLegL, charLegR, charArmL, charArmR;
let slashMesh;

// Game State
let gameState = 'STORY'; 
let score = 0;
let health = 100;
let moveInput = { forward: 0, right: 0 };
let moveSpeed = 6.0;
let invincibilityTimer = 0;

// Levels Config
let currentLevelIdx = 0;
let correctAnswersInLevel = 0;
const LEVELS = [
    {
        id: 1, name: "おしろのダンジョン",
        sky: 'assets/r_sky.png', floor: 'assets/r_floor.png', wall: 'assets/r_wall.png',
        monsters: 5, genMath: () => genAddTask(5), bgmParams: { r: 100, g: 100, b: 150 }
    },
    {
        id: 2, name: "さばくのいせき",
        sky: 'assets/desert_sky.png', floor: 'assets/desert_floor.png', wall: 'assets/desert_wall.png',
        monsters: 7, genMath: () => genAddTask(9), bgmParams: { r: 200, g: 180, b: 100 }
    },
    {
        id: 3, name: "うみのどうくつ",
        sky: 'assets/r_sky.png', floor: 'assets/ocean_floor.png', wall: 'assets/ocean_wall.png',
        monsters: 10, genMath: () => genSubTask(9), bgmParams: { r: 50, g: 150, b: 200 }
    },
    {
        id: 4, name: "しんかいのもり",
        sky: 'assets/forest_sky.png', floor: 'assets/forest_floor.png', wall: 'assets/forest_wall.png',
        monsters: 12, genMath: () => genMixTask(9), bgmParams: { r: 50, g: 180, b: 80 }
    }
];

// Environments & Entities
let environmentGroup = new THREE.Group();
let monsters = [];
let crystals = [];
let obstacles = [];
let particles = [];
let quizPadsGroup = new THREE.Group();

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

function spawnGoldExplosion(pos) {
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    for (let i = 0; i < 30; i++) {
        const mat = new THREE.MeshBasicMaterial({ color: Math.random() > 0.5 ? 0xFFD700 : 0xFFA500 });
        const p = new THREE.Mesh(geo, mat);
        p.position.copy(pos);
        p.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 14,
            Math.random() * 16 + 4,
            (Math.random() - 0.5) * 14
        );
        p.lifetime = 1.0 + Math.random() * 0.5;
        scene.add(p);
        particles.push({ mesh: p, vel: p.velocity, life: p.lifetime });
    }
}

function showCelebration() {
    if (!document.getElementById('celebrate-style')) {
        const style = document.createElement('style');
        style.id = 'celebrate-style';
        style.textContent = `@keyframes celebrate {
            0%   { transform: scale(0.3); opacity: 0; }
            40%  { transform: scale(1.3); opacity: 1; }
            70%  { transform: scale(1.0); opacity: 1; }
            100% { transform: scale(1.1) translateY(-40px); opacity: 0; }
        }`;
        document.head.appendChild(style);
    }
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:flex;justify-content:center;align-items:center;pointer-events:none;z-index:200;';
    el.innerHTML = '<div style="font-size:80px;font-weight:bold;color:#FFD700;text-shadow:0 0 30px #FFA500,0 0 60px #FFD700;animation:celebrate 1.2s ease-out forwards;font-family:sans-serif;">✨ せいかい！ ✨</div>';
    document.body.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
    spawnGoldExplosion(player.position.clone().add(new THREE.Vector3(0, 2, 0)));
}

function createSymbolSprite(symbol, bgColor) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = 'bold 170px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.fillText(symbol, 128, 138);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(3.0, 3.0, 1);
    return sprite;
}

// Math generators — 小学1年生レベル
function genAddTask(maxSum) {
    const a = Math.floor(Math.random() * (maxSum - 1)) + 1;
    const b = Math.floor(Math.random() * (maxSum - a)) + 1;
    const trueAns = a + b;
    const isCorrect = Math.random() > 0.5;
    let displayedAns = trueAns;
    if (!isCorrect) {
        const offset = Math.floor(Math.random() * 2) + 1;
        displayedAns = Math.random() > 0.5 ? trueAns + offset : Math.max(1, trueAns - offset);
        if (displayedAns === trueAns) displayedAns += 1;
    }
    return { q: `${a} ＋ ${b} ＝ ${displayedAns} ？`, speak: `${a}たす${b}は、${displayedAns}ですか？`, a: isCorrect };
}

function genSubTask(maxNum) {
    const a = Math.floor(Math.random() * maxNum) + 1;
    const b = Math.floor(Math.random() * a) + 1;
    const trueAns = a - b;
    const isCorrect = Math.random() > 0.5;
    let displayedAns = trueAns;
    if (!isCorrect) {
        const offset = Math.floor(Math.random() * 2) + 1;
        displayedAns = Math.random() > 0.5 ? trueAns + offset : Math.max(0, trueAns - offset);
        if (displayedAns === trueAns) displayedAns += 1;
    }
    return { q: `${a} ー ${b} ＝ ${displayedAns} ？`, speak: `${a}ひく${b}は、${displayedAns}ですか？`, a: isCorrect };
}

function genMixTask(maxNum) {
    return Math.random() > 0.5 ? genAddTask(maxNum) : genSubTask(maxNum);
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
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444477, 0.6);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff0dd, 2.0);
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

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    scene.add(environmentGroup);
    scene.add(quizPadsGroup);

    createPlayer();
    
    // UI Events
    document.getElementById('btn-story-next').addEventListener('click', () => {
        document.getElementById('story-screen').classList.add('hidden');
        document.getElementById('start-screen').classList.remove('hidden');
        gameState = 'START';
    });

    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-restart').addEventListener('click', () => {
        currentLevelIdx = 0;
        startGame();
    });

    document.getElementById('btn-attack').addEventListener('touchstart', (e) => { e.preventDefault(); performAttack(); });
    document.getElementById('btn-attack').addEventListener('mousedown', (e) => { e.preventDefault(); performAttack(); });

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
}

function loadLevel(levelIndex) {
    if (levelIndex >= LEVELS.length) {
        document.getElementById('game-over-title').innerText = "おめでとう！ゲームクリア！";
        document.getElementById('game-over-title').style.color = "#FFD700";
        document.getElementById('final-score').innerHTML = "お<ruby>姫様<rt>ひめさま</rt></ruby>の<ruby>呪<rt>のろ</rt></ruby>いが<ruby>解<rt>と</rt></ruby>けました！";
        document.getElementById('game-over-screen').classList.remove('hidden');
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('controls').classList.add('hidden');
        gameState = 'GAMEOVER';
        return;
    }

    currentLevelIdx = levelIndex;
    const config = LEVELS[currentLevelIdx];
    correctAnswersInLevel = 0;

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

    // Floor (Large Square Arena: 100x100)
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

    // Generate Obstacles (Boxes/Barrels)
    const barrelGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 16);
    const crateGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const obstacleMat = new THREE.MeshPhysicalMaterial({ color: '#8B4513', roughness: 0.9 });
    const ironMat = new THREE.MeshStandardMaterial({ color: '#444', metalness: 0.8, roughness: 0.5 });
    
    for(let i=0; i<40; i++) {
        const isBarrel = Math.random() > 0.5;
        const mesh = new THREE.Mesh(isBarrel ? barrelGeo : crateGeo, obstacleMat);
        mesh.position.set((Math.random() - 0.5) * 90, isBarrel ? 0.6 : 0.75, (Math.random() - 0.5) * 90);
        mesh.rotation.y = Math.random() * Math.PI;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        
        // Don't spawn exactly on player start
        if (mesh.position.distanceTo(new THREE.Vector3(0,0,0)) < 5) continue;

        environmentGroup.add(mesh);
        obstacles.push(mesh);
    }

    // Spawn Crystals (Hidden in the arena)
    const crystalGeo = new THREE.OctahedronGeometry(0.5);
    const crystalMat = new THREE.MeshPhysicalMaterial({ color: 0x00ffff, transmission: 0.8, opacity: 1, transparent: true, roughness: 0.1 });
    for(let i=0; i<5; i++) { // Need 5 to progress
        const crystal = new THREE.Mesh(crystalGeo, crystalMat);
        let cx = (Math.random() - 0.5) * 80;
        let cz = (Math.random() - 0.5) * 80;
        // Keep away from center
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

    player.position.set(0, 0, 0); // Start in center
    player.rotation.set(0, Math.PI, 0); // Face -Z
    gameState = 'EXPLORE';
}

function spawnMonster(xPos, zPos) {
    if (Math.abs(xPos) < 10 && Math.abs(zPos) < 10) xPos += 20; // Don't spawn on player

    const group = new THREE.Group();
    group.position.set(xPos, 1.5, zPos);
    
    // Skull Cranium (High Poly)
    const boneMat = new THREE.MeshPhysicalMaterial({ color: '#f5f6fa', roughness: 0.5, clearcoat: 0.2 });
    const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.4, 64, 64), boneMat);
    cranium.castShadow = true; cranium.receiveShadow = true;
    group.add(cranium);

    // Jaw
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4, 32, 32, 32), boneMat);
    jaw.position.set(0, -0.3, 0.1);
    jaw.castShadow = true; jaw.receiveShadow = true;
    group.add(jaw);

    // Eyes
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

    // Glowing red pupils
    const glowMat = new THREE.MeshBasicMaterial({ color: '#ff2222' });
    const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), glowMat);
    pupilL.position.set(0, 0, 0.08);
    eyeL.add(pupilL);
    const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), glowMat);
    pupilR.position.set(0, 0, 0.08);
    eyeR.add(pupilR);

    // Floating dark aura
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
        timer: Math.random() * 2
    });
}

function performAttack() {
    if (gameState !== 'EXPLORE' || isAttacking) return;
    
    isAttacking = true;
    attackTimer = 0.4;
    playSound('swing');

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
                // Hit!
                playSound('hit');
                spawnExplosion(m.mesh.position);
                scene.remove(m.mesh);
                monsters.splice(i, 1);
                
                // Spawn new monster far away to keep level populated
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

    const matSkin = new THREE.MeshPhysicalMaterial({ color: '#ffccaa', roughness: 0.4, clearcoat: 0.1 });
    const matHair = new THREE.MeshPhysicalMaterial({ color: '#4a2c11', roughness: 0.8, clearcoat: 0.2 });
    const matHeadband = new THREE.MeshPhysicalMaterial({ color: '#f1c40f', roughness: 0.2, metalness: 0.6, clearcoat: 0.5 });
    const matTunic = new THREE.MeshPhysicalMaterial({ color: '#0984e3', roughness: 0.8, clearcoat: 0.05 });
    const matOrange = new THREE.MeshPhysicalMaterial({ color: '#e67e22', roughness: 0.8, clearcoat: 0.05 });
    const matLeather = new THREE.MeshPhysicalMaterial({ color: '#5c3a21', roughness: 0.6, clearcoat: 0.2 });
    const matSteel = new THREE.MeshPhysicalMaterial({ color: '#ecf0f1', roughness: 0.2, metalness: 0.9, clearcoat: 1.0 });

    const addMesh = (geo, mat, parent) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    };

    const torsoGeo = new THREE.CylinderGeometry(0.35, 0.45, 0.8, 64, 32);
    const torso = addMesh(torsoGeo, matTunic, playerBody);
    torso.position.y = 1.1;

    const headGroup = new THREE.Group();
    headGroup.position.y = 1.8;
    playerBody.add(headGroup);
    addMesh(new THREE.SphereGeometry(0.32, 64, 64), matSkin, headGroup);

    const hairGroup = new THREE.Group();
    headGroup.add(hairGroup);
    const coneGeo = new THREE.ConeGeometry(0.12, 0.45, 32, 16);
    for(let i=0; i<10; i++) {
        const spike = addMesh(coneGeo, matHair, hairGroup);
        const angle = (i / 10) * Math.PI * 2;
        const radius = 0.22;
        spike.position.set(Math.cos(angle)*radius, 0.25, Math.sin(angle)*radius);
        spike.rotation.x = -Math.sin(angle) * 0.6;
        spike.rotation.z = Math.cos(angle) * 0.6;
    }
    const mainSpike = addMesh(new THREE.ConeGeometry(0.18, 0.7, 32, 16), matHair, hairGroup);
    mainSpike.position.set(0, 0.45, -0.05);
    mainSpike.rotation.x = -0.2;

    charArmL = new THREE.Group();
    charArmL.position.set(-0.5, 1.4, 0);
    playerBody.add(charArmL);
    addMesh(new THREE.CylinderGeometry(0.1, 0.08, 0.5, 32), matOrange, charArmL).position.y = -0.25;

    charArmR = new THREE.Group();
    charArmR.position.set(0.5, 1.4, 0);
    playerBody.add(charArmR);
    addMesh(new THREE.CylinderGeometry(0.1, 0.08, 0.5, 32), matOrange, charArmR).position.y = -0.25;

    swordGroup = new THREE.Group();
    swordGroup.position.set(0, -0.6, 0);
    swordGroup.rotation.x = Math.PI / 2;
    charArmR.add(swordGroup);
    addMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 32), matHeadband, swordGroup);
    const blade = addMesh(new THREE.CylinderGeometry(0.01, 0.06, 1.0, 4), matSteel, swordGroup);
    blade.position.y = 0.6;
    blade.rotation.y = Math.PI / 4;

    charLegL = new THREE.Group();
    charLegL.position.set(-0.2, 0.8, 0);
    playerBody.add(charLegL);
    addMesh(new THREE.CylinderGeometry(0.12, 0.1, 0.6, 32), matOrange, charLegL).position.y = -0.3;

    charLegR = new THREE.Group();
    charLegR.position.set(0.2, 0.8, 0);
    playerBody.add(charLegR);
    addMesh(new THREE.CylinderGeometry(0.12, 0.1, 0.6, 32), matOrange, charLegR).position.y = -0.3;

    // Slash Effect Mesh
    const slashGeo = new THREE.TorusGeometry(2.5, 0.05, 16, 64, Math.PI);
    const slashMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    slashMesh = new THREE.Mesh(slashGeo, slashMat);
    slashMesh.rotation.x = Math.PI / 2;
    slashMesh.position.set(0, 1.2, 0);
    slashMesh.visible = false;
    player.add(slashMesh);

    followCamGroup = new THREE.Group();
    followCamGroup.position.set(0, 2.5, 4);
    player.add(followCamGroup);

    player.position.set(0, 0, 0);
    scene.add(player);
}

function startGame() {
    audioCtx.resume();
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('controls').classList.remove('hidden');

    health = 100;
    updateHealthUI();
    score = 0;
    
    initJoystick();
    loadLevel(currentLevelIdx);
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
    invincibilityTimer = 1.0; // 1 second i-frames
    
    playSound('damage');
    health -= amt;
    updateHealthUI();
    
    document.getElementById('hud').style.boxShadow = "inset 0 0 50px red";
    setTimeout(() => { document.getElementById('hud').style.boxShadow = "none"; }, 200);
}

function triggerQuiz() {
    playSound('crystal');
    gameState = 'QUIZ';
    document.getElementById('quiz-ui').classList.remove('hidden');
    document.getElementById('instruction-text').innerHTML = "⭕ か ✕ のうえにのってこたえてね！";

    const config = LEVELS[currentLevelIdx];
    currentQuestion = config.genMath();
    document.getElementById('question-text').innerText = currentQuestion.q;

    speak(currentQuestion.speak || currentQuestion.q);

    quizTimer = 60;
    document.getElementById('time-count').innerText = quizTimer;
    
    createQuizPads();
}

function createQuizPads() {
    while(quizPadsGroup.children.length > 0) {
        quizPadsGroup.remove(quizPadsGroup.children[0]);
    }

    const padGeo = new THREE.CylinderGeometry(1.5, 1.5, 0.2, 32);

    const oPad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: 0x3498db }));
    oPad.userData = { isCorrect: true, isPad: true };

    const xPad = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: 0xe74c3c }));
    xPad.userData = { isCorrect: false, isPad: true };

    const offset = 3.5;
    const forwardVec = new THREE.Vector3(0, 0, -offset).applyQuaternion(player.quaternion);
    const rightVec = new THREE.Vector3(offset, 0, 0).applyQuaternion(player.quaternion);

    const padCenter = player.position.clone().add(forwardVec);
    oPad.position.copy(padCenter).add(rightVec);
    xPad.position.copy(padCenter).sub(rightVec);
    oPad.position.y = 0.1;
    xPad.position.y = 0.1;

    // 浮遊スプライトで ○ と × を大きく表示
    const oSprite = createSymbolSprite('○', '#2980b9');
    oSprite.position.set(oPad.position.x, 2.2, oPad.position.z);

    const xSprite = createSymbolSprite('×', '#c0392b');
    xSprite.position.set(xPad.position.x, 2.2, xPad.position.z);

    quizPadsGroup.add(oPad);
    quizPadsGroup.add(xPad);
    quizPadsGroup.add(oSprite);
    quizPadsGroup.add(xSprite);
}

function handleAnswer(isCorrectStr) {
    if (gameState !== 'QUIZ') return;
    const isCorrect = (isCorrectStr === currentQuestion.a);

    if (isCorrect) {
        showCelebration();
        playSound('correct');
        speak("せいかい！");
        correctAnswersInLevel++;
        updateProgressUI();

        if (correctAnswersInLevel >= 5) {
            setTimeout(() => { loadLevel(currentLevelIdx + 1); }, 1200);
        }
    } else {
        playSound('damage');
        speak("ざんねん、ちがいます");
        takeDamage(20);
    }

    document.getElementById('quiz-ui').classList.add('hidden');
    document.getElementById('instruction-text').innerHTML = "クリスタルを<ruby>探<rt>さが</rt></ruby>してね！";
    while(quizPadsGroup.children.length > 0) quizPadsGroup.remove(quizPadsGroup.children[0]);

    gameState = 'EXPLORE';
}

function speak(text) {
    if ('speechSynthesis' in window) {
        const ut = new SpeechSynthesisUtterance(text);
        ut.lang = 'ja-JP';
        ut.rate = 0.9;
        window.speechSynthesis.speak(ut);
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

    if (invincibilityTimer > 0) {
        invincibilityTimer -= dt;
        // Blink effect
        playerBody.visible = Math.floor(invincibilityTimer * 10) % 2 === 0;
    } else {
        playerBody.visible = true;
    }

    if (gameState === 'EXPLORE' || gameState === 'QUIZ') {
        
        let isMoving = false;

        if ((moveInput.forward !== 0 || moveInput.right !== 0) && !isAttacking) {
            isMoving = true;
            const moveVec = new THREE.Vector3(moveInput.right, 0, -moveInput.forward);
            moveVec.normalize().multiplyScalar(moveSpeed * dt);
            
            // Apply movement
            player.position.add(moveVec);
            
            // Arena Bounds (100x100) -> -49 to 49
            player.position.x = Math.max(-49, Math.min(49, player.position.x));
            player.position.z = Math.max(-49, Math.min(49, player.position.z));

            // Obstacle Collision (Simple radial push)
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
            player.rotation.y += diff * 10 * dt;
        }

        // Animate Attack
        if (isAttacking) {
            attackTimer -= dt;
            const progress = 1.0 - (attackTimer / 0.4);

            if (progress < 0.3) {
                playerBody.rotation.y = -Math.PI / 4 * (progress / 0.3);
                charArmR.rotation.x = -Math.PI / 4;
                charArmR.rotation.z = Math.PI / 4;
                if (slashMesh) slashMesh.visible = false;
            } else {
                const swingProg = (progress - 0.3) / 0.7;
                playerBody.rotation.y = -Math.PI / 4 + (Math.PI * 1.5) * swingProg;
                charArmR.rotation.x = -Math.PI / 4;
                charArmR.rotation.z = Math.PI / 4 - (Math.PI * 0.8) * swingProg;

                if (slashMesh) {
                    slashMesh.visible = true;
                    slashMesh.scale.setScalar(0.5 + swingProg * 0.5);
                    slashMesh.material.opacity = 1.0 - swingProg;
                    slashMesh.rotation.z = -Math.PI / 2 - Math.PI * swingProg;
                }
            }

            if (attackTimer <= 0) {
                isAttacking = false;
                playerBody.rotation.y = 0;
                charArmR.rotation.z = 0;
                if (slashMesh) slashMesh.visible = false;
            }
        }

        if (isMoving && !isAttacking) {
            const time = Date.now() * 0.015;
            const swing = Math.sin(time) * 0.8;
            if (charLegL && charLegR) {
                charLegL.rotation.x = swing;
                charLegR.rotation.x = -swing;
            }
            if (charArmL && charArmR) {
                charArmL.rotation.x = -swing;
                charArmR.rotation.x = swing;
            }
        } else if (!isAttacking) {
            if (charLegL) charLegL.rotation.x = 0;
            if (charLegR) charLegR.rotation.x = 0;
            if (charArmL) charArmL.rotation.x = 0;
            if (charArmR) charArmR.rotation.x = 0;
            playerBody.rotation.y = 0;
        }

        // Monsters Logic
        monsters.forEach(m => {
            if (gameState === 'EXPLORE') {
                m.timer -= dt;
                
                const distToPlayer = m.mesh.position.distanceTo(player.position);
                
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

                m.mesh.position.addScaledVector(moveDir, m.speed * dt);
                
                // Arena Bounds
                m.mesh.position.x = Math.max(-49, Math.min(49, m.mesh.position.x));
                m.mesh.position.z = Math.max(-49, Math.min(49, m.mesh.position.z));
                
                m.mesh.position.y = 1.5 + Math.sin(Date.now() * 0.003 + m.timer) * 0.2;

                if (distToPlayer < 1.0 && invincibilityTimer <= 0) {
                    takeDamage(10);
                    // Knockback monster
                    m.mesh.position.addScaledVector(moveDir, -2.0);
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
                speak("時間切れです！");
                takeDamage(20);
                handleAnswer(null);
            }

            quizPadsGroup.children.forEach(pad => {
                if (!pad.userData.isPad) return;
                const dist = player.position.distanceTo(pad.position);
                if (dist < 1.5) {
                    handleAnswer(pad.userData.isCorrect);
                }
            });
        }

        // Particle physics
        for(let i=particles.length-1; i>=0; i--) {
            let p = particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                scene.remove(p.mesh);
                particles.splice(i, 1);
                continue;
            }
            p.vel.y -= 25 * dt; // gravity
            p.mesh.position.addScaledVector(p.vel, dt);
            
            // Floor collision
            if(p.mesh.position.y < 0.1) {
                p.mesh.position.y = 0.1;
                p.vel.y *= -0.5; // bounce
                p.vel.x *= 0.8;
                p.vel.z *= 0.8;
            }
            
            p.mesh.rotation.x += dt * 10;
            p.mesh.rotation.y += dt * 10;
            p.mesh.scale.setScalar(p.life);
        }

        // Camera follow
        const targetCamPos = new THREE.Vector3();
        followCamGroup.getWorldPosition(targetCamPos);
        camera.position.lerp(targetCamPos, 5 * dt);
        
        const lookAtPos = player.position.clone();
        lookAtPos.y += 1.5;
        camera.lookAt(lookAtPos);
    }

    renderer.render(scene, camera);
}
