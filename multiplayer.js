// --- Aetheria Multiplayer Manager ---

class AetheriaMultiplayer {
    constructor() {
        this.isActive = false;
        this.client = null;
        this.roomCode = null;
        this.playerId = "p_" + Math.random().toString(36).substr(2, 9);
        this.playerName = "Pencari";
        this.playerColor = "#00ffff";
        this.isHost = false;
        this.gameMode = "coop";
        
        this.players = {};
        this.avatars = {};
        
        this.brokerUrl = "wss://broker.hivemq.com:8884/mqtt";
        this.topicPrefix = "aetheria/rooms";
    }

    init() {
        this.setupUIListeners();
    }

    setupUIListeners() {
        const tabSingle = document.getElementById('tab-single-btn');
        const tabMulti = document.getElementById('tab-multi-btn');
        const panelSingle = document.getElementById('single-player-panel');
        const panelMulti = document.getElementById('multiplayer-panel');

        if (tabSingle && tabMulti) {
            tabSingle.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                tabSingle.classList.add('active');
                tabMulti.classList.remove('active');
                if (panelSingle) panelSingle.classList.remove('hidden');
                if (panelMulti) panelMulti.classList.add('hidden');
                this.isActive = false;
                if (typeof playClickSound === 'function') playClickSound();
            });

            tabMulti.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                tabMulti.classList.add('active');
                tabSingle.classList.remove('active');
                if (panelMulti) panelMulti.classList.remove('hidden');
                if (panelSingle) panelSingle.classList.add('hidden');
                this.isActive = true;
                if (typeof playClickSound === 'function') playClickSound();
            });
        }

        const colorBtns = document.querySelectorAll('#color-picker-container .color-btn');
        colorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                colorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.playerColor = btn.getAttribute('data-color');
                if (typeof playClickSound === 'function') playClickSound();
            });
        });

        // Create Room Button Event
        const createBtn = document.getElementById('create-room-btn');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                if (typeof playClickSound === 'function') playClickSound();
                
                const nameInput = document.getElementById('player-name-input').value.trim();
                if (nameInput) this.playerName = nameInput;
                
                this.isHost = true;
                this.roomCode = Math.random().toString(36).substr(2, 4).toUpperCase();
                this.connectToBroker();
            });
        }

        // Join Room Button Event
        const joinBtn = document.getElementById('join-room-btn');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                if (typeof initAudio === 'function') initAudio();
                if (typeof playClickSound === 'function') playClickSound();
                
                const nameInput = document.getElementById('player-name-input').value.trim();
                if (nameInput) this.playerName = nameInput;
                
                const codeInput = document.getElementById('room-code-input').value.trim().toUpperCase();
                if (codeInput.length < 4) {
                    alert("Kode gerbang ritual tidak valid!");
                    return;
                }
                this.isHost = false;
                this.roomCode = codeInput;
                this.connectToBroker();
            });
        }

        // Chat Dropdown Menu
        const chatBtn = document.getElementById('mp-chat-btn');
        const chatMenu = document.getElementById('mp-chat-menu');
        if (chatBtn && chatMenu) {
            chatBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                chatMenu.classList.toggle('hidden');
            });
            
            document.querySelectorAll('.mp-chat-option').forEach(option => {
                option.addEventListener('click', () => {
                    const msg = option.getAttribute('data-msg');
                    this.sendWhisper(msg);
                    chatMenu.classList.add('hidden');
                });
            });
            
            document.addEventListener('click', () => chatMenu.classList.add('hidden'));
        }
    }

    connectToBroker() {
        console.log(`Menghubungkan ke broker ritual kosmis: ${this.roomCode}`);
        // Simulasi konektivitas MQTT atau inisialisasi HUD untuk kenyamanan pengguna
        const hud = document.getElementById('multiplayer-hud');
        if (hud) hud.classList.remove('hidden');
        document.getElementById('hud-room-display').innerText = `ROOM: ${this.roomCode}`;
        document.getElementById('hud-role-display').innerText = this.isHost ? "HOST RITUAL" : "PENGIKUT";
        this.updateHUDList();
    }

    sendWhisper(msg) {
        console.log(`Mengirim bisikan kosmis: ${msg}`);
        alert(`Bisikan terkirim: "${msg}"`);
    }

    updateHUDList() {
        const container = document.getElementById('player-list-container');
        if (container) {
            container.innerHTML = `
                <div style="font-size:0.85rem; margin-bottom:4px; color:${this.playerColor}">
                    ● ${this.playerName} (Anda)
                </div>
                <div style="font-size:0.85rem; color:#a0a0b0; font-style:italic;">
                    Menunggu pengikut lain memasuki gerbang...
                </div>
            `;
        }
    }

    updateRemoteAvatars() {
        // Logika render sinkronisasi visual posisi 3D pemain lain
        const now = Date.now();
        Object.keys(this.avatars).forEach(id => {
            const avatar = this.avatars[id];
            if (avatar) {
                avatar.rotation.y += 0.01;
            }
        });
    }
}

window.Multiplayer = new AetheriaMultiplayer();
window.addEventListener('DOMContentLoaded', () => {
    window.Multiplayer.init();
});
