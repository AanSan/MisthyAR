// --- Game State & Level Data ---
const levels = [
    {
        title: "Teka-teki I: Cincin Aetheria",
        desc: '"Cincin kosmis yang tercerai-berai. Putar sudut pandangmu untuk menyatukan lingkaran energi dan inti cahaya."',
        hint: "Gunakan klik/drag untuk memutar kamera. Cari sudut pandang di mana lingkaran luar, lingkaran dalam, dan inti tengah sejajar melingkar sempurna.",
        targetAngle: { x: 0.5, y: 0.8, z: 0 }, // Target camera rotation representation
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
        targetAngle: { x: 0.2, y: -0.9, z: 0 },
        tolerance: 0.08,
        setup: createLevel3
    }
];

let currentLevel = 0;
let scene, camera, renderer, controls;
let levelGroup = null;
let particles = null;
let isAligned = false;
let alignmentProgress = 0;

// Cached DOM references for hot-path performance
let _elAlignProgress = null;
let _elAlignPercentage = null;
let _lastAlignPct = -1; // Track last written value to skip redundant DOM writes
let _alignFrameSkip = 0; // Frame counter for throttled alignment checks
const ALIGN_CHECK_INTERVAL = 2; // Check alignment every N frames (2 = 30Hz on 60fps)

// Resize debounce
let _resizeTimer = null;

// Audio variables
let audioCtx = null;
let ambientOsc = null;
let ambientFilter = null;
let resonanceOsc = null;
let resonanceGain = null;
let audioEnabled = false;

// --- Web Audio Synth ---
function initAudio() {
    if (audioCtx) return;
    
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // 1. Spooky Ambient Drone
        ambientOsc = audioCtx.createOscillator();
        ambientOsc.type = 'sawtooth';
        ambientOsc.frequency.setValueAtTime(55, audioCtx.currentTime); // low A drone
        
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

        // LFO to modulate filter cutoff for mystical movement
        const lfo = audioCtx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.1, audioCtx.currentTime); // very slow sweep
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.setValueAtTime(80, audioCtx.currentTime);
        lfo.connect(lfoGain);
        lfoGain.connect(ambientFilter.frequency);
        lfo.start();

        // 2. Resonance Feedback Synth (reacts to player alignment)
        resonanceOsc = audioCtx.createOscillator();
        resonanceOsc.type = 'sine';
        resonanceOsc.frequency.setValueAtTime(220, audioCtx.currentTime);
        
        resonanceGain = audioCtx.createGain();
        resonanceGain.gain.setValueAtTime(0, audioCtx.currentTime); // silent initially
        
        const resonanceFilter = audioCtx.createBiquadFilter();
        resonanceFilter.type = 'peaking';
        resonanceFilter.frequency.setValueAtTime(440, audioCtx.currentTime);
        resonanceFilter.Q.setValueAtTime(10, audioCtx.currentTime);
        
        resonanceOsc.connect(resonanceFilter);
        resonanceFilter.connect(resonanceGain);
        resonanceGain.connect(audioCtx.destination);
        resonanceOsc.start();
        
        audioEnabled = true;
        document.getElementById('audio-btn').innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    } catch (e) {
        console.error("Web Audio API not supported/allowed in browser", e);
    }
}

function updateResonanceAudio(progress) {
    if (!audioEnabled || !audioCtx) return;
    
    // As progress goes from 0 to 1, volume & frequency rise
    const targetGain = progress * 0.18;
    const targetFreq = 220 + (progress * 330); // 220Hz to 550Hz
    
    resonanceGain.gain.setTargetAtTime(targetGain, audioCtx.currentTime, 0.1);
    resonanceOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.1);
}

function playSuccessChime() {
    if (!audioEnabled || !audioCtx) return;
    
    const now = audioCtx.currentTime;
    // Arpeggio
    const freqs = [329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C Major scale arpeggio
    
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
}

function playClickSound() {
    if (!audioEnabled || !audioCtx) return;
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
}


// --- Three.js Setup & Scene Initialization ---
function initThree() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    // Dark space fog
    scene.fog = new THREE.FogExp2(0x07070b, 0.035);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Orbit Controls fallback
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 5;
    controls.maxDistance = 15;
    controls.enablePan = false;

    // Lights
    const ambientLight = new THREE.AmbientLight(0x221144, 1.5);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x8a2be2, 2, 50);
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x00ffff, 2, 50);
    pointLight2.position.set(-5, -5, -5);
    scene.add(pointLight2);

    // Particles/Stars
    createAmbientParticles();

    // Start rendering loop
    animate();

    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(onWindowResize, 150);
    });
}

function createAmbientParticles() {
    const particleCount = 400;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        // Random spherical positions
        const radius = 10 + Math.random() * 20;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[i] = radius * Math.sin(phi) * Math.cos(theta);
        positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i + 2] = radius * Math.cos(phi);

        // Mix purplish and cyan particle colors
        const isCyan = Math.random() > 0.5;
        colors[i] = isCyan ? 0.0 : 0.6;
        colors[i + 1] = isCyan ? 0.9 : 0.2;
        colors[i + 2] = isCyan ? 1.0 : 0.9;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Custom round particles
    const material = new THREE.PointsMaterial({
        size: 0.15,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    particles = new THREE.Points(geometry, material);
    scene.add(particles);
}

// --- Puzzle/Level 3D Object Creators ---

// Level 1: Aetheria Ring (Fragmented concentric rings)
function createLevel1(group) {
    // Inti Cahaya (Center core)
    const coreGeo = new THREE.SphereGeometry(0.6, 20, 20);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    // Fragmented rings. We split rings into sections or use torus shapes that are rotated off-center
    // In three.js we create an illusion of broken fragments that align when looked at from the target camera angle
    // Let's create components that are offset physically in 3D, so when viewed from target angle, they form flat parallel circular alignments.
    
    // Outer Ring Part 1
    const outer1Geo = new THREE.TorusGeometry(3, 0.08, 16, 100, Math.PI);
    const outer1Mat = new THREE.MeshStandardMaterial({ color: 0x8a2be2, emissive: 0x8a2be2, roughness: 0.2 });
    const outer1 = new THREE.Mesh(outer1Geo, outer1Mat);
    // Displaced significantly in Z axis and rotated so it only aligns at target angle
    outer1.position.set(0, 0, -2);
    outer1.rotation.set(0, 0, 0.4);
    group.add(outer1);

    // Outer Ring Part 2
    const outer2Geo = new THREE.TorusGeometry(3, 0.08, 16, 100, Math.PI);
    const outer2 = new THREE.Mesh(outer2Geo, outer1Mat);
    outer2.position.set(0, 0, 2);
    outer2.rotation.set(0, 0, Math.PI + 0.4);
    group.add(outer2);

    // Inner Ring
    const innerGeo = new THREE.TorusGeometry(1.8, 0.06, 16, 100);
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.set(0.5, -0.2, 0); // slightly off-center in X,Y but matches from target angle
    inner.rotation.set(0.3, 0.4, 0);
    group.add(inner);

    // Helper visual guide alignment pieces that merge visually
    const crossbar1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 0.1), outer1Mat);
    crossbar1.position.set(-0.2, 0, -1);
    crossbar1.rotation.z = 0.5;
    group.add(crossbar1);

    const crossbar2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 0.1), outer1Mat);
    crossbar2.position.set(0.2, 0, 1);
    crossbar2.rotation.z = 0.5;
    group.add(crossbar2);
}

// Level 2: Constellation (Forming a glowing Key symbol)
function createLevel2(group) {
    // We place glowing star spheres in 3D coordinates.
    // When projected onto screen from the target angle, they form a Key shape.
    
    // Let's define the 2D key template coordinates on a plane
    // and project them along the target angle with different Z depths.
    
    // Target camera angle represents a rotation vector
    // Let's use a simple approach: layout the Key shape relative to the camera's final orientation,
    // then randomize their distances (depths) along the line of sight.
    // From any other perspective, they look like a random cloud of stars.
    
    const keyPoints = [
        // Ring/Handle of the key
        { x: 0, y: 1.5 }, { x: 0.5, y: 1.3 }, { x: 0.7, y: 0.8 }, { x: 0.5, y: 0.3 },
        { x: 0, y: 0.1 }, { x: -0.5, y: 0.3 }, { x: -0.7, y: 0.8 }, { x: -0.5, y: 1.3 },
        // Shaft of the key
        { x: 0, y: -0.3 }, { x: 0, y: -0.8 }, { x: 0, y: -1.3 }, { x: 0, y: -1.8 }, { x: 0, y: -2.3 },
        // Teeth of the key
        { x: 0.6, y: -1.8 }, { x: 0.6, y: -2.3 }, { x: 0.3, y: -1.8 }, { x: 0.3, y: -2.3 }
    ];

    // Rotation Matrix matching the target angle
    const targetEuler = new THREE.Euler(
        levels[1].targetAngle.x,
        levels[1].targetAngle.y,
        levels[1].targetAngle.z,
        'YXZ'
    );
    const targetRotation = new THREE.Matrix4().makeRotationFromEuler(targetEuler);

    const starMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const starGeo = new THREE.SphereGeometry(0.12, 8, 8);

    keyPoints.forEach(p => {
        // Star relative vector (where Z is front/back)
        // Give each star a random depth Z from -4 to 4, but hold the exact X & Y projection
        const depth = (Math.random() - 0.5) * 6;
        const vec = new THREE.Vector3(p.x * 1.5, p.y * 1.5, depth);
        
        // Transform the point using the inverse of the target rotation
        // This ensures that when the camera matches the target rotation, the points align perfectly!
        vec.applyMatrix4(targetRotation);

        const star = new THREE.Mesh(starGeo, starMaterial);
        star.position.copy(vec);
        group.add(star);

        // Add a tiny glowing line to other stars occasionally to make it look like a constellation
        if (Math.random() > 0.6) {
            const glowRingGeo = new THREE.RingGeometry(0.15, 0.2, 16);
            const glowRingMat = new THREE.MeshBasicMaterial({ color: 0x8a2be2, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
            const glowRing = new THREE.Mesh(glowRingGeo, glowRingMat);
            glowRing.position.copy(vec);
            glowRing.lookAt(0, 0, 0);
            group.add(glowRing);
        }
    });

    // Ambient runic center marker
    const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0x8a2be2, roughness: 0.1 }));
    group.add(core);
}

// Level 3: Pillars Alignment (3 vertical columns with fragment carvings)
function createLevel3(group) {
    // 3 Columns spaced out along the Z axis
    // Pillar 1: Back, holds outer elements of a central rune
    // Pillar 2: Middle, holds mid elements of a central rune
    // Pillar 3: Front, holds inner core element of the rune
    // All align to project the final rune when viewed from target angle.

    const pillarMat = new THREE.MeshStandardMaterial({ 
        color: 0x181824, 
        roughness: 0.8,
        metalness: 0.2
    });
    const runeMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });

    const pillarPositions = [
        { x: -1.8, y: 0, z: -2.5 }, // Pillar Left/Back
        { x: 0,    y: 0, z: 0 },    // Pillar Center
        { x: 1.8,  y: 0, z: 2.5 }   // Pillar Right/Front
    ];

    // Pillar Geometry
    const colGeo = new THREE.BoxGeometry(0.8, 6, 0.8);

    pillarPositions.forEach((pos, idx) => {
        const pillar = new THREE.Mesh(colGeo, pillarMat);
        pillar.position.copy(pos);
        group.add(pillar);

        // Add runic carvings that stick out or float off-center, aligning from the target angle
        // Target camera Euler
        const targetEuler = new THREE.Euler(
            levels[2].targetAngle.x,
            levels[2].targetAngle.y,
            levels[2].targetAngle.z,
            'YXZ'
        );
        const targetRotation = new THREE.Matrix4().makeRotationFromEuler(targetEuler);

        // Let's create fragments based on index
        let fragGeo;
        if (idx === 0) {
            // Back: Outer diamond/square frame
            fragGeo = new THREE.RingGeometry(1.5, 1.6, 4);
        } else if (idx === 1) {
            // Middle: An inner circle + horizontal bar
            fragGeo = new THREE.TorusGeometry(0.9, 0.05, 8, 48);
        } else {
            // Front: Glowing cross/core symbol
            fragGeo = new THREE.BoxGeometry(0.12, 1.2, 0.12);
            const extraBar = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.12), runeMat);
            extraBar.position.set(pos.x, pos.y + 0.3, pos.z);
            
            // Transform extraBar to align at target angle
            const localVec = new THREE.Vector3(0, 0.3, 0);
            localVec.applyMatrix4(targetRotation);
            extraBar.position.copy(pos).add(localVec);
            extraBar.rotation.setFromRotationMatrix(targetRotation);
            group.add(extraBar);
        }

        if (fragGeo) {
            const frag = new THREE.Mesh(fragGeo, runeMat);
            // Orient it parallel to target camera plane, positioned exactly at the pillar location
            frag.rotation.setFromRotationMatrix(targetRotation);
            group.add(frag);
            
            // Adjust position so its flat projection is aligned
            frag.position.copy(pos);
        }
    });
}


// --- Alignment Mechanics ---
function checkAlignment() {
    if (isAligned) return;

    // Throttle: only run every ALIGN_CHECK_INTERVAL frames
    _alignFrameSkip++;
    if (_alignFrameSkip < ALIGN_CHECK_INTERVAL) return;
    _alignFrameSkip = 0;

    // Get current level data
    const levelData = levels[currentLevel];
    
    const currentYaw = controls.getAzimuthalAngle();
    const currentPitch = controls.getPolarAngle() - Math.PI / 2;

    const targetYaw = levelData.targetAngle.y;
    const targetPitch = levelData.targetAngle.x;

    let yawDiff = Math.abs(currentYaw - targetYaw);
    while (yawDiff > Math.PI) yawDiff = Math.abs(yawDiff - 2 * Math.PI);
    
    const pitchDiff = Math.abs(currentPitch - targetPitch);
    const totalDeviation = Math.sqrt(yawDiff * yawDiff + pitchDiff * pitchDiff);

    const maxDeviationRange = 1.0;
    alignmentProgress = Math.max(0, 1 - (totalDeviation / maxDeviationRange));
    alignmentProgress = Math.pow(alignmentProgress, 3); 

    const alignmentPercentage = Math.round(alignmentProgress * 100);
    
    // Only touch DOM when the displayed value actually changes
    if (alignmentPercentage !== _lastAlignPct) {
        _lastAlignPct = alignmentPercentage;
        _elAlignProgress.style.width = alignmentPercentage + '%';
        _elAlignPercentage.innerText = alignmentPercentage + '%';
    }

    // Tone resonance feedback
    updateResonanceAudio(alignmentProgress);

    // Check success condition
    if (totalDeviation < levelData.tolerance) {
        if (window.Multiplayer && window.Multiplayer.isActive) {
            if (window.Multiplayer.gameMode === 'coop') {
                alignmentProgress = 1.0;
                window.Multiplayer.publishState(camera.position, 1.0);
                window.Multiplayer.updateInGameHUD();
                window.Multiplayer.checkCoopVictoryCondition();
            } else if (window.Multiplayer.gameMode === 'versus') {
                window.Multiplayer.onLocalSuccess();
            }
        } else {
            triggerSuccess();
        }
    } else {
        if (window.Multiplayer && window.Multiplayer.isActive) {
            window.Multiplayer.onLocalMove();
            window.Multiplayer.updateInGameHUD();
        }
    }
}

function triggerSuccess() {
    isAligned = true;
    alignmentProgress = 1;
    document.getElementById('alignment-progress').style.width = '100%';
    document.getElementById('alignment-percentage').innerText = '100%';
    document.getElementById('alignment-progress').style.boxShadow = '0 0 20px #00ff88';

    // Highlight all items in the group to glow green
    levelGroup.traverse(child => {
        if (child.isMesh && child.material) {
            child.material.color.setHex(0x00ff88);
            if (child.material.emissive) {
                child.material.emissive.setHex(0x00ff88);
            }
        }
    });

    // Play chime sound
    playSuccessChime();

    // Show popup
    setTimeout(() => {
        const nextBtn = document.getElementById('next-level-btn');
        if (currentLevel === levels.length - 1) {
            // Final level finished
            document.getElementById('ending-overlay').classList.remove('hidden');
        } else {
            // Next level transition popup
            document.getElementById('success-message').innerText = `Teka-teki ke-${currentLevel + 1} berhasil kamu sejajarkan.`;
            document.getElementById('success-overlay').classList.remove('hidden');
        }
    }, 1200);
}


// --- Navigation and UI Controls ---
function setupUI() {
    // Start button logic
    document.getElementById('start-game-btn').addEventListener('click', () => {
        if (window.Multiplayer) {
            window.Multiplayer.isActive = false;
            document.getElementById('multiplayer-hud').classList.add('hidden');
        }
        initAudio();
        document.getElementById('start-overlay').classList.add('hidden');
        loadLevel(0);
    });

    // Audio Button toggle
    document.getElementById('audio-btn').addEventListener('click', () => {
        if (!audioCtx) {
            initAudio();
            return;
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
            audioEnabled = true;
            document.getElementById('audio-btn').innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        } else if (audioEnabled) {
            audioEnabled = false;
            document.getElementById('audio-btn').innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
            if (resonanceGain) resonanceGain.gain.setValueAtTime(0, audioCtx.currentTime);
        } else {
            audioEnabled = true;
            document.getElementById('audio-btn').innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        }
        playClickSound();
    });

    // Next Level Button logic
    document.getElementById('next-level-btn').addEventListener('click', () => {
        playClickSound();
        document.getElementById('success-overlay').classList.add('hidden');
        if (window.Multiplayer && window.Multiplayer.isActive) {
            window.Multiplayer.onLocalLoadLevel(currentLevel + 1);
        } else {
            loadLevel(currentLevel + 1);
        }
    });

    // Restart/Reset game
    document.getElementById('restart-game-btn').addEventListener('click', () => {
        playClickSound();
        document.getElementById('ending-overlay').classList.add('hidden');
        if (window.Multiplayer && window.Multiplayer.isActive) {
            window.Multiplayer.onLocalLoadLevel(0);
        } else {
            loadLevel(0);
        }
    });

    // Hint Modal Toggle
    document.getElementById('hint-btn').addEventListener('click', () => {
        playClickSound();
        const hintText = levels[currentLevel].hint;
        document.getElementById('hint-text').innerText = hintText;
        document.getElementById('hint-popup').classList.remove('hidden');
    });

    document.getElementById('close-hint-btn').addEventListener('click', () => {
        playClickSound();
        document.getElementById('hint-popup').classList.add('hidden');
    });

    // AR Button Simulator
    document.getElementById('ar-btn').addEventListener('click', () => {
        playClickSound();
        // WebXR Simulator alert/enable
        document.getElementById('ar-fallback-alert').classList.remove('hidden');
        // Instantly position camera close to level to simulate scanning ground
        camera.position.set(0, 2, 8);
        controls.target.set(0, 0, 0);
        controls.update();
    });

    document.getElementById('close-ar-alert-btn').addEventListener('click', () => {
        document.getElementById('ar-fallback-alert').classList.add('hidden');
    });
}

function loadLevel(levelIdx) {
    currentLevel = levelIdx;
    isAligned = false;
    alignmentProgress = 0;
    _lastAlignPct = -1; // Reset cached percentage
    _alignFrameSkip = 0;

    // Cache DOM elements on first call
    if (!_elAlignProgress) _elAlignProgress = document.getElementById('alignment-progress');
    if (!_elAlignPercentage) _elAlignPercentage = document.getElementById('alignment-percentage');

    _elAlignProgress.style.width = '0%';
    _elAlignPercentage.innerText = '0%';
    _elAlignProgress.style.boxShadow = '0 0 10px var(--secondary)';

    // Update level UI titles
    const levelData = levels[currentLevel];
    document.getElementById('current-level-num').innerText = romanize(currentLevel + 1);
    document.getElementById('riddle-title').innerText = levelData.title;
    document.getElementById('riddle-desc').innerText = levelData.desc;

    // Dispose previous level geometry & materials to prevent memory leaks
    if (levelGroup) {
        levelGroup.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        scene.remove(levelGroup);
    }
    levelGroup = new THREE.Group();
    scene.add(levelGroup);

    // Call level geometry builder
    levelData.setup(levelGroup);

    // Animate level entry (fade scale or rise up)
    levelGroup.scale.set(0.01, 0.01, 0.01);
    
    // Position camera randomly at start of level to puzzle user
    const randomAngle = Math.random() * Math.PI * 2;
    camera.position.set(
        Math.sin(randomAngle) * 8,
        (Math.random() - 0.5) * 4,
        Math.cos(randomAngle) * 8
    );
    controls.update();
}

function romanize(num) {
    if (num === 1) return "I";
    if (num === 2) return "II";
    if (num === 3) return "III";
    return num;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Render / Loop ---
function animate() {
    requestAnimationFrame(animate);

    // Render logic updates
    if (controls) {
        controls.update();
    }

    // Slowly rotate level group slightly for floating dynamic feel
    if (levelGroup && !isAligned) {
        // Expand scale up to 1 slowly at start
        if (levelGroup.scale.x < 1) {
            levelGroup.scale.addScalar(0.03);
            if (levelGroup.scale.x > 1) levelGroup.scale.set(1, 1, 1);
        }
        
        // Floating animation
        levelGroup.position.y = Math.sin(Date.now() * 0.001) * 0.15;
    }

    // Rotate background ambient stars/particles
    if (particles) {
        particles.rotation.y += 0.0003;
        particles.rotation.x += 0.0001;
    }

    // Run perspective checker
    if (levelGroup && !isAligned) {
        checkAlignment();
    }

    // Update remote multiplayer player avatars in 3D scene
    if (window.Multiplayer && window.Multiplayer.isActive) {
        window.Multiplayer.updateRemoteAvatars();
    }

    renderer.render(scene, camera);
}

// Start everything
window.addEventListener('DOMContentLoaded', () => {
    initThree();
    setupUI();
});
