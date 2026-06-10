// --- Game State & Level Data ---
let audioCtx = null;
let audioEnabled = false;
let ambientOsc, ambientFilter, resonanceOsc, resonanceGain;
let scene, camera, renderer, controls, levelGroup, particles;
let isAligned = false;
let currentLevelIndex = 0;

const levels = [
    {
        title: "Teka-teki I: Cincin Aetheria",
        desc: '"Cincin kosmis yang tercerai-berai. Putar sudut pandangmu untuk menyatukan lingkaran energi dan inti cahaya."',
        hint: "Gunakan klik/drag untuk memutar kamera. Cari sudut pandang di mana lingkaran luar, lingkaran dalam, dan inti tengah sejajar melingkar sempurna.",
        targetAngle: { x: 0.5, y: 0.8, z: 0 },
        tolerance: 0.08,
        setup: createLevel1
    },
    {
        title: "Teka-teki II: Rasi Bintang Kunci",
        desc: '"Bintang-bintang berserakan di langit malam. Satukan konstelasi ini dari sudut yang tepat untuk membentuk Kunci Gerbang."',
        hint: "Bintang-bintang ini tampak acak. Cari sudut pandang di mana bintang-bintang tersebut berkumpul membentuk pola seperti Kunci (Key).",
        targetAngle: { x: -0.6, y: -0.3, z: 0 },
        tolerance: 0.08,
        setup: createLevel2
    },
    {
        title: "Teka-teki III: Pilar Penjaga",
        desc: '"Tiga pilar kuno menyimpan ukiran simbol misterius. Temukan perspektif yang menyelaraskan ukiran tersebut menjadi satu kesatuan."',
        hint: "Posisikan kamera sehingga simbol-simbol di ketiga pilar tersebut tumpang tindih dan membentuk satu rune utuh yang melayang di tengah.",
        targetAngle: { x: 0.1, y: -0.9, z: 0 },
        tolerance: 0.08,
        setup: createLevel3
    }
];

// --- Web Audio Synth with Browser Fallbacks ---
function initAudio() {
    if (audioCtx) {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return;
    }
    
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 1. Spooky Ambient Drone
        ambientOsc = audioCtx.createOscillator();
        ambientOsc.type = 'sawtooth';
        ambientOsc.frequency.setValueAtTime(55, audioCtx.currentTime);
        
        ambientFilter = audioCtx.createBiquadFilter();
        ambientFilter.type = 'lowpass';
        ambientFilter.frequency.setValueAtTime(150, audioCtx.currentTime);
        ambientFilter.Q.setValueAtTime(5, audioCtx.currentTime);
        
        const ambientGain = audioCtx.createGain();
        ambientGain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        
        ambientOsc.connect(ambientFilter);
        ambientFilter.connect(ambientGain);
        ambientGain.connect(audioCtx.destination);
        ambientOsc.start();

        const lfo = audioCtx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.1, audioCtx.currentTime);
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.setValueAtTime(80, audioCtx.currentTime);
        lfo.connect(lfoGain);
        lfoGain.connect(ambientFilter.frequency);
        lfo.start();

        // 2. Resonance Feedback Synth
        resonanceOsc = audioCtx.createOscillator();
        resonanceOsc.type = 'sine';
        resonanceOsc.frequency.setValueAtTime(220, audioCtx.currentTime);
        
        resonanceGain = audioCtx.createGain();
        resonanceGain.gain.setValueAtTime(0, audioCtx.currentTime);
        
        const resonanceFilter = audioCtx.createBiquadFilter();
        resonanceFilter.type = 'peaking';
        resonanceFilter.frequency.setValueAtTime(440, audioCtx.currentTime);
        resonanceFilter.Q.setValueAtTime(10, audioCtx.currentTime);
        
        resonanceOsc.connect(resonanceFilter);
        resonanceFilter.connect(resonanceGain);
        resonanceGain.connect(audioCtx.destination);
        resonanceOsc.start();
        
        audioEnabled = true;
        const audioBtn = document.getElementById('audio-btn');
        if (audioBtn) audioBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    } catch (e) {
        console.error("Web Audio API tidak didukung atau diblokir browser:", e);
    }
}

function playClickSound() {
    if (!audioEnabled || !audioCtx || audioCtx.state === 'suspended') return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.11);
    } catch (e) {
        console.warn("Gagal memainkan suara klik:", e);
    }
}

function playSuccessChime() {
    if (!audioEnabled || !audioCtx || audioCtx.state === 'suspended') return;
    try {
        const now = audioCtx.currentTime;
        const freqs = [329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // Tangga nada C Major Arpeggio
        freqs.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + (index * 0.08));
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(0.15, now + (index * 0.08) + 0.02);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + (index * 0.08) + 0.8);
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start(now + (index * 0.08));
            osc.stop(now + (index * 0.08) + 0.85);
        });
    } catch (e) {
        console.warn("Gagal memainkan lonceng keberhasilan:", e);
    }
}

// --- Fullscreen API Implementation ---
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
            const fsBtn = document.getElementById('fullscreen-btn');
            if (fsBtn) fsBtn.innerHTML = '<i class="fa-solid fa-compress"></i>';
        }).catch(err => {
            console.error(`Gagal mengaktifkan Fullscreen: ${err.message}`);
        });
    } else {
        document.exitFullscreen().then(() => {
            const fsBtn = document.getElementById('fullscreen-btn');
            if (fsBtn) fsBtn.innerHTML = '<i class="fa-solid fa-expand"></i>';
        });
    }
}

// --- Three.js Environment Setup ---
function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 8);

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.8;
    controls.enableZoom = false; // Fokus pada pergeseran perspektif

    // Pencahayaan Dunia Esoteris
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x8a2be2, 1.5, 30);
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x00ffff, 1.2, 30);
    pointLight2.position.set(-5, -5, 3);
    scene.add(pointLight2);

    // Bintang Latar Belakang (Ambient Stars)
    const starsGeometry = new THREE.BufferGeometry();
    const starsCount = 500;
    const starPositions = new Float32Array(starsCount * 3);
    for(let i=0; i < starsCount * 3; i++) {
        starPositions[i] = (Math.random() - 0.5) * 40;
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.6 });
    particles = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(particles);

    loadLevel(currentLevelIndex);
    animate();
}

// --- Level Builders ---
function loadLevel(index) {
    if (levelGroup) scene.remove(levelGroup);
    
    isAligned = false;
    levelGroup = new THREE.Group();
    levelGroup.scale.set(0.01, 0.01, 0.01); // Efek membesar di awal animasi
    scene.add(levelGroup);

    const data = levels[index];
    document.getElementById('level-title').innerText = `RITUAL ${romanize(index + 1)}: ${data.title.split(': ')[1]}`;
    document.getElementById('level-desc').innerHTML = data.desc;
    document.getElementById('level-hint').innerText = data.hint;

    data.setup();
}

function createLevel1() {
    // Lingkaran Luar Berpindah Tempat
    const outerGeo = new THREE.RingGeometry(2.2, 2.4, 64);
    const outerMat = new THREE.MeshBasicMaterial({ color: 0x8a2be2, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const outerRing = new THREE.Mesh(outerGeo, outerMat);
    outerRing.position.set(-0.5, 0.3, -1);
    outerRing.rotation.set(0.2, 0.4, 0);
    levelGroup.add(outerRing);

    // Lingkaran Dalam Berpindah Tempat
    const innerGeo = new THREE.RingGeometry(1.4, 1.6, 64);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const innerRing = new THREE.Mesh(innerGeo, innerMat);
    innerRing.position.set(0.6, -0.4, 1.2);
    innerRing.rotation.set(-0.3, 0.1, 0);
    levelGroup.add(innerRing);

    // Inti Pusat Cahaya
    const coreGeo = new THREE.SphereGeometry(0.3, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(0, 0, 0);
    levelGroup.add(core);
}

function createLevel2() {
    // Membuat rasi bintang tiruan acak yang tampak rapi dari satu sudut pandang tertentu
    const positions = [
        [0, 1.5, 0], [0, 0.5, 0], [0, -0.5, 0], [0, -1.5, 0], // Batang Kunci
        [0.5, 1.5, 0], [0.5, 1.0, 0], // Gigi atas
        [-0.5, -0.5, 0], [-1, -0.5, 0], [-1, -1.2, 0], [-0.5, -1.2, 0] // Handle cincin bawah
    ];
    
    positions.forEach((pos, idx) => {
        const starGeo = new THREE.SphereGeometry(0.12, 16, 16);
        const starMat = new THREE.MeshBasicMaterial({ color: idx % 2 === 0 ? 0x00ffff : 0xff007f });
        const star = new THREE.Mesh(starGeo, starMat);
        
        // Membuyarkan posisi asli agar terlihat acak dari depan, namun sejajar pada target koordinat rahasia
        const depthDistortion = (idx - positions.length / 2) * 0.7;
        star.position.set(
            pos[0] + depthDistortion * 0.3,
            pos[1] - depthDistortion * 0.2,
            pos[2] + depthDistortion
        );
        levelGroup.add(star);
    });
}

function createLevel3() {
    // Tiga Pilar Utama Proyeksi Rune Kuno
    for (let i = -1; i <= 1; i++) {
        if (i === 0) continue;
        const pilarGeo = new THREE.CylinderGeometry(0.2, 0.2, 3, 16);
        const pilarMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.7 });
        const pilar = new THREE.Mesh(pilarGeo, pilarMat);
        pilar.position.set(i * 2.5, 0, i * 1.5);
        levelGroup.add(pilar);
    }
    
    const centerGeo = new THREE.TorusGeometry(0.8, 0.1, 16, 100);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, wireframe: true });
    const centerRune = new THREE.Mesh(centerGeo, centerMat);
    centerRune.position.set(0, 0, -2);
    levelGroup.add(centerRune);
}

// --- Alignment Check Logic ---
function checkAlignment() {
    const target = levels[currentLevelIndex].targetAngle;
    const tolerance = levels[currentLevelIndex].tolerance;

    // Hitung normalisasi posisi rotasi kamera
    const cx = Math.sin(camera.rotation.x);
    const cy = Math.sin(camera.rotation.y);

    const diffX = Math.abs(cx - Math.sin(target.x));
    const diffY = Math.abs(cy - Math.sin(target.y));

    // Modulasi feedback suara detak dinamis berdasarkan kedekatan jarak
    if (audioEnabled && resonanceGain) {
        const proximity = 1.0 - Math.min(1.0, (diffX + diffY) / 1.5);
        resonanceGain.gain.setValueAtTime(proximity * 0.25, audioCtx.currentTime);
        if (resonanceOsc) {
            resonanceOsc.frequency.setValueAtTime(220 + (proximity * 220), audioCtx.currentTime);
        }
    }

    if (diffX < tolerance && diffY < tolerance) {
        isAligned = true;
        playSuccessChime();
        
        // Animasi transisi naik level
        setTimeout(() => {
            currentLevelIndex = (currentLevelIndex + 1) % levels.length;
            loadLevel(currentLevelIndex);
        }, 2200);
    }
}

// --- Render Loop ---
function animate() {
    requestAnimationFrame(animate);

    if (controls) controls.update();

    if (levelGroup && !isAligned) {
        if (levelGroup.scale.x < 1) {
            levelGroup.scale.addScalar(0.03);
            if (levelGroup.scale.x > 1) levelGroup.scale.set(1, 1, 1);
        }
        levelGroup.position.y = Math.sin(Date.now() * 0.001) * 0.15;
    }

    if (particles) {
        particles.rotation.y += 0.0003;
        particles.rotation.x += 0.0001;
    }

    if (levelGroup && !isAligned) {
        checkAlignment();
    }

    if (window.Multiplayer && window.Multiplayer.isActive) {
        window.Multiplayer.updateRemoteAvatars();
    }

    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

// --- Kamera Realtime (Webcam AR Handler) ---
async function startWebcam() {
    const video = document.getElementById('webcam');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false
        });
        video.srcObject = stream;
    } catch (e) {
        console.warn("Kamera AR belakang tidak tersedia, mengaktifkan simulasi giroskop.");
        const fallbackAlert = document.getElementById('ar-fallback-alert');
        if (fallbackAlert) fallbackAlert.classList.remove('hidden');
    }
}

// --- Initialize Event Listeners ---
window.addEventListener('DOMContentLoaded', () => {
    initThree();
    startWebcam();

    document.getElementById('audio-btn').addEventListener('click', () => {
        initAudio();
        playClickSound();
    });

    document.getElementById('fullscreen-btn').addEventListener('click', () => {
        initAudio();
        toggleFullscreen();
        playClickSound();
    });

    const closeAlert = document.getElementById('close-ar-alert-btn');
    if (closeAlert) {
        closeAlert.addEventListener('click', () => {
            document.getElementById('ar-fallback-alert').classList.add('hidden');
        });
    }

    // Unclog system audio on mobile tap inside the canvas
    document.body.addEventListener('click', () => {
        initAudio();
    }, { once: true });
});

function onWindowResize() {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}
window.addEventListener('resize', onWindowResize);
