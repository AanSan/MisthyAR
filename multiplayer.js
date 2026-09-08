// --- Aetheria Multiplayer Manager ---

class AetheriaMultiplayer {
    constructor() {
        this.isActive = false;
        this.client = null;
        this.roomCode = null;
        this.playerId = this.getOrCreatePlayerId();
        this.playerName = "Pencari";
        this.playerColor = "#00ffff";
        this.isHost = false;
        this.gameMode = "coop"; // 'coop' or 'versus'
        
        // Player registries
        this.players = {}; // Other players in the room: { id: { name, color, alignment, position, lastActive } }
        this.scores = {};  // Scores in versus mode: { id: score }
        this.avatars = {}; // Three.js groups for remote players: { id: THREE.Group }
        
        // Intervals & throttling
        this.heartbeatInterval = null;
        this.checkActiveInterval = null;
        this.lastCameraPublishTime = 0;
        this.cameraPublishThrottleMs = 70; // Publish every 70ms if moving
        this.lastLocalPos = new THREE.Vector3();
        
        this.brokerUrl = "wss://broker.hivemq.com:8884/mqtt";
        this.topicPrefix = "aetheria/rooms";

        // Throttle timers for expensive operations
        this._nameTagTimers = {};    // { playerId: lastUpdateTime }
        this._hudLastUpdate = 0;
        this._hudThrottleMs = 200;   // Max 5 HUD rebuilds per second
        this._nameTagThrottleMs = 500; // Max 2 name tag redraws per second per player
    }

    getOrCreatePlayerId() {
        let id = sessionStorage.getItem('aetheria_player_id');
        if (!id) {
            id = 'p_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('aetheria_player_id', id);
        }
        return id;
    }

    init() {
        this.setupUIListeners();
        // Load saved settings if any
        const savedName = localStorage.getItem('aetheria_player_name');
        if (savedName) {
            document.getElementById('player-name-input').value = savedName;
            this.playerName = savedName;
        } else {
            // Default random name suffix
            const randSuffix = Math.floor(100 + Math.random() * 900);
            this.playerName = `Pencari #${randSuffix}`;
            document.getElementById('player-name-input').value = this.playerName;
        }
    }

    setupUIListeners() {
        // Tab switching logic
        const tabSingle = document.getElementById('tab-single-btn');
        const tabMulti = document.getElementById('tab-multi-btn');
        const panelSingle = document.getElementById('single-player-panel');
        const panelMulti = document.getElementById('multiplayer-panel');

        tabSingle.addEventListener('click', () => {
            tabSingle.classList.add('active');
            tabMulti.classList.remove('active');
            panelSingle.classList.remove('hidden');
            panelMulti.classList.add('hidden');
            this.isActive = false;
            playClickSound();
        });

        tabMulti.addEventListener('click', () => {
            tabMulti.classList.add('active');
            tabSingle.classList.remove('active');
            panelMulti.classList.remove('hidden');
            panelSingle.classList.add('hidden');
            this.isActive = true;
            playClickSound();
        });

        // Color Picker listeners
        const colorBtns = document.querySelectorAll('#color-picker-container .color-btn');
        colorBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                colorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.playerColor = btn.getAttribute('data-color');
                playClickSound();
            });
        });

        // Create Room Button
        document.getElementById('create-room-btn').addEventListener('click', () => {
            playClickSound();
            const nameInput = document.getElementById('player-name-input').value.trim();
            if (nameInput) {
                this.playerName = nameInput;
                localStorage.setItem('aetheria_player_name', this.playerName);
            }
            this.isHost = true;
            this.roomCode = this.generateRoomCode();
            this.connectToBroker();
        });

        // Join Room Button
        document.getElementById('join-room-btn').addEventListener('click', () => {
            playClickSound();
            const nameInput = document.getElementById('player-name-input').value.trim();
            if (nameInput) {
                this.playerName = nameInput;
                localStorage.setItem('aetheria_player_name', this.playerName);
            }
            const codeInput = document.getElementById('room-code-input').value.trim().toUpperCase();
            if (codeInput.length < 4) {
                alert("Kode gerbang tidak valid!");
                return;
            }
            this.isHost = false;
            this.roomCode = codeInput;
            this.connectToBroker();
        });

        // Copy Room Code
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            playClickSound();
            navigator.clipboard.writeText(this.roomCode).then(() => {
                const icon = document.querySelector('#copy-code-btn i');
                icon.className = "fa-solid fa-check";
                setTimeout(() => {
                    icon.className = "fa-regular fa-copy";
                }, 2000);
            });
        });

        // Leave Lobby
        document.getElementById('leave-lobby-btn').addEventListener('click', () => {
            playClickSound();
            this.leaveRoom();
        });

        // Host Mode settings (Co-op vs Versus)
        document.getElementById('mode-coop-btn').addEventListener('click', () => {
            if (!this.isHost) return;
            playClickSound();
            document.getElementById('mode-coop-btn').classList.add('active');
            document.getElementById('mode-versus-btn').classList.remove('active');
            this.setGameMode('coop');
        });

        document.getElementById('mode-versus-btn').addEventListener('click', () => {
            if (!this.isHost) return;
            playClickSound();
            document.getElementById('mode-versus-btn').classList.add('active');
            document.getElementById('mode-coop-btn').classList.remove('active');
            this.setGameMode('versus');
        });

        // Start Multiplayer Game Button
        document.getElementById('start-mp-game-btn').addEventListener('click', () => {
            if (!this.isHost) return;
            playClickSound();
            this.publishGameAction('startGame', { mode: this.gameMode });
        });

        // In-game Quick Chat Toggle
        const chatBtn = document.getElementById('mp-chat-btn');
        const chatMenu = document.getElementById('mp-chat-menu');
        
        chatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playClickSound();
            chatMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            chatMenu.classList.add('hidden');
        });

        // Quick Chat Options
        document.querySelectorAll('.mp-chat-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const msg = opt.getAttribute('data-msg');
                this.publishChat(msg);
                // Also trigger locally above our placeholder if we had one
                this.showBubble(this.playerId, msg);
            });
        });

        // Multiplayer Versus Next Level Button (Host only)
        document.getElementById('versus-next-btn').addEventListener('click', () => {
            if (!this.isHost) return;
            playClickSound();
            document.getElementById('versus-overlay').classList.add('hidden');
            const nextIdx = currentLevel + 1;
            if (nextIdx < levels.length) {
                this.publishGameAction('loadLevel', { levelIdx: nextIdx });
            } else {
                this.publishGameAction('endGame', {});
            }
        });
    }

    generateRoomCode() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let code = "";
        for (let i = 0; i < 5; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }

    connectToBroker() {
        // Show loading indicator / state on buttons
        const actionBtn = this.isHost ? document.getElementById('create-room-btn') : document.getElementById('join-room-btn');
        const originalHTML = actionBtn.innerHTML;
        actionBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menghubungkan...';
        actionBtn.disabled = true;

        this.client = mqtt.connect(this.brokerUrl, {
            clientId: this.playerId,
            clean: true,
            keepalive: 60
        });

        this.client.on('connect', () => {
            console.log("Connected to MQTT broker");
            
            // Subscriptions
            const rCode = this.roomCode;
            this.client.subscribe(`${this.topicPrefix}/${rCode}/presence/+`);
            this.client.subscribe(`${this.topicPrefix}/${rCode}/chat`);
            this.client.subscribe(`${this.topicPrefix}/${rCode}/game`);

            // Start sending heartbeat
            this.startHeartbeat();

            // Transition UI to Lobby
            actionBtn.innerHTML = originalHTML;
            actionBtn.disabled = false;

            document.getElementById('multiplayer-panel').classList.add('hidden');
            document.getElementById('multiplayer-lobby-panel').classList.remove('hidden');
            document.getElementById('lobby-room-code').innerText = this.roomCode;

            // Manage Host visual layouts
            if (this.isHost) {
                document.getElementById('lobby-host-controls').style.display = 'flex';
                document.getElementById('lobby-client-view').style.display = 'none';
                document.getElementById('start-mp-game-btn').style.display = 'block';
                document.getElementById('start-mp-game-btn').disabled = false;
            } else {
                document.getElementById('lobby-host-controls').style.display = 'none';
                document.getElementById('lobby-client-view').style.display = 'block';
                document.getElementById('start-mp-game-btn').style.display = 'none';
            }

            // Publish first presence immediately
            this.publishPresence();
        });

        this.client.on('message', (topic, message) => {
            try {
                const payload = JSON.parse(message.toString());
                this.handleMessage(topic, payload);
            } catch (e) {
                console.error("Error parsing MQTT message:", e);
            }
        });

        this.client.on('error', (err) => {
            console.error("MQTT connection error:", err);
            alert("Gagal terhubung ke jaringan multiplayer.");
            actionBtn.innerHTML = originalHTML;
            actionBtn.disabled = false;
            this.leaveRoom();
        });
    }

    leaveRoom() {
        // Publish offline presence
        if (this.client && this.client.connected) {
            this.client.publish(
                `${this.topicPrefix}/${this.roomCode}/presence/${this.playerId}`,
                JSON.stringify({ offline: true }),
                { retain: true }
            );
            this.client.end();
        }

        this.stopHeartbeat();
        this.clearRemoteAvatars();

        this.isActive = false;
        this.client = null;
        this.roomCode = null;
        this.isHost = false;
        this.players = {};
        this.scores = {};

        // Reset overlays
        document.getElementById('multiplayer-lobby-panel').classList.add('hidden');
        document.getElementById('multiplayer-panel').classList.remove('hidden');
        document.getElementById('multiplayer-hud').classList.add('hidden');
        document.getElementById('versus-overlay').classList.add('hidden');
        document.getElementById('success-overlay').classList.add('hidden');
        document.getElementById('start-overlay').classList.remove('hidden');
        
        // Switch back to single player tab representation in DOM
        document.getElementById('tab-single-btn').classList.add('active');
        document.getElementById('tab-multi-btn').classList.remove('active');
        document.getElementById('single-player-panel').classList.remove('hidden');
        document.getElementById('multiplayer-panel').classList.add('hidden');

        // Restart local single-player levels if in the middle of it
        if (scene) {
            loadLevel(0);
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();

        // 1. Heartbeat sender (every 2.5s)
        this.heartbeatInterval = setInterval(() => {
            this.publishPresence();
        }, 2500);

        // 2. Timeout watcher for other players (every 2s)
        this.checkActiveInterval = setInterval(() => {
            const now = Date.now();
            let changed = false;
            Object.keys(this.players).forEach(pId => {
                if (now - this.players[pId].lastActive > 7000) { // 7 seconds timeout
                    console.log(`Player ${this.players[pId].name} timed out.`);
                    this.removeAvatar(pId);
                    delete this.players[pId];
                    delete this.scores[pId];
                    changed = true;
                }
            });
            if (changed) {
                this.updateLobbyUI();
                this.updateInGameHUD();
                this.checkCoopVictoryCondition();
            }
        }, 2000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.checkActiveInterval) clearInterval(this.checkActiveInterval);
        this.heartbeatInterval = null;
        this.checkActiveInterval = null;
    }

    publishPresence() {
        if (!this.client || !this.client.connected) return;

        const payload = {
            id: this.playerId,
            name: this.playerName,
            color: this.playerColor,
            isHost: this.isHost,
            alignment: alignmentProgress,
            position: camera ? { x: camera.position.x, y: camera.position.y, z: camera.position.z } : null,
            lastActive: Date.now()
        };

        this.client.publish(
            `${this.topicPrefix}/${this.roomCode}/presence/${this.playerId}`,
            JSON.stringify(payload),
            { retain: true }
        );
    }

    publishState(pos, alignment) {
        if (!this.client || !this.client.connected) return;

        const now = Date.now();
        if (now - this.lastCameraPublishTime < this.cameraPublishThrottleMs) return;
        this.lastCameraPublishTime = now;

        const payload = {
            id: this.playerId,
            name: this.playerName,
            color: this.playerColor,
            isHost: this.isHost,
            alignment: alignment,
            position: { x: pos.x, y: pos.y, z: pos.z },
            lastActive: now
        };

        this.client.publish(
            `${this.topicPrefix}/${this.roomCode}/presence/${this.playerId}`,
            JSON.stringify(payload),
            { retain: false } // Position changes are fast, don't retain
        );
    }

    publishChat(msg) {
        if (!this.client || !this.client.connected) return;

        const payload = {
            playerId: this.playerId,
            playerName: this.playerName,
            color: this.playerColor,
            message: msg
        };

        this.client.publish(
            `${this.topicPrefix}/${this.roomCode}/chat`,
            JSON.stringify(payload)
        );
    }

    publishGameAction(action, data) {
        if (!this.client || !this.client.connected) return;

        const payload = {
            senderId: this.playerId,
            action: action,
            data: data
        };

        this.client.publish(
            `${this.topicPrefix}/${this.roomCode}/game`,
            JSON.stringify(payload)
        );
    }

    setGameMode(mode) {
        this.gameMode = mode;
        this.publishGameAction('syncSettings', { mode: mode });
    }

    handleMessage(topic, payload) {
        const roomTopic = topic.split('/');
        const category = roomTopic[3]; // 'presence', 'chat', 'game'

        if (category === 'presence') {
            const senderId = roomTopic[4];
            if (senderId === this.playerId) return; // Ignore self

            if (payload.offline) {
                // Player left
                this.removeAvatar(senderId);
                delete this.players[senderId];
                delete this.scores[senderId];
                this.updateLobbyUI();
                this.updateInGameHUD();
                this.checkCoopVictoryCondition();
            } else {
                // New or updated player
                const isNew = !this.players[senderId];
                this.players[senderId] = {
                    name: payload.name,
                    color: payload.color,
                    isHost: payload.isHost,
                    alignment: payload.alignment,
                    targetPos: payload.position ? new THREE.Vector3(payload.position.x, payload.position.y, payload.position.z) : null,
                    lastActive: payload.lastActive
                };

                if (isNew) {
                    this.scores[senderId] = 0;
                }

                // If in game, update avatar
                if (document.getElementById('start-overlay').classList.contains('hidden')) {
                    this.updateOrCreateAvatar(senderId, this.players[senderId]);
                }

                this.updateLobbyUI();
                this.updateInGameHUD();
                this.checkCoopVictoryCondition();
            }
        } 
        else if (category === 'chat') {
            const senderId = payload.playerId;
            this.showBubble(senderId, payload.message);
        } 
        else if (category === 'game') {
            const action = payload.action;
            const data = payload.data;

            if (action === 'syncSettings') {
                this.gameMode = data.mode;
                const label = this.gameMode === 'coop' ? 'Kerjasama (Co-op)' : 'Persaingan (Versus)';
                document.getElementById('lobby-current-mode-label').innerText = label;
                
                // For client UI state mirroring
                if (!this.isHost) {
                    if (this.gameMode === 'coop') {
                        document.getElementById('mode-coop-btn').classList.add('active');
                        document.getElementById('mode-versus-btn').classList.remove('active');
                    } else {
                        document.getElementById('mode-versus-btn').classList.add('active');
                        document.getElementById('mode-coop-btn').classList.remove('active');
                    }
                }
            } 
            else if (action === 'startGame') {
                this.gameMode = data.mode;
                document.getElementById('start-overlay').classList.add('hidden');
                
                // Show local multiplayer HUD
                document.getElementById('multiplayer-hud').classList.remove('hidden');
                document.getElementById('hud-room-code-display').innerText = `Room: ${this.roomCode}`;
                document.getElementById('hud-mode-display').innerText = this.gameMode === 'coop' ? 'Co-op' : 'Versus';

                if (this.gameMode === 'coop') {
                    document.getElementById('mp-coop-progress-container').classList.remove('hidden');
                } else {
                    document.getElementById('mp-coop-progress-container').classList.add('hidden');
                }

                // Start game locally at level 0
                loadLevel(0);
                initAudio(); // make sure audio initializes
            }
            else if (action === 'loadLevel') {
                // Host commanded loading a specific level
                document.getElementById('versus-overlay').classList.add('hidden');
                document.getElementById('success-overlay').classList.add('hidden');
                
                this.clearRemoteAvatars();
                loadLevel(data.levelIdx);
            }
            else if (action === 'versusWin') {
                // Someone won versus mode!
                const winnerId = data.winnerId;
                const winnerName = data.winnerName;
                
                // Record score
                this.scores[winnerId] = (this.scores[winnerId] || 0) + 1;
                
                // Show versus overlay
                document.getElementById('versus-winner-title').innerText = `${winnerName} Unggul!`;
                document.getElementById('versus-winner-msg').innerText = `Teka-teki ke-${currentLevel + 1} berhasil disejajarkan oleh ${winnerName}.`;
                
                // Build leaderboard list
                const list = document.getElementById('versus-leaderboard-list');
                list.innerHTML = '';
                
                // Combine scores (ourselves + remote players)
                const allScores = [];
                allScores.push({ id: this.playerId, name: this.playerName, color: this.playerColor, score: this.scores[this.playerId] || 0, isMe: true });
                Object.keys(this.players).forEach(pId => {
                    allScores.push({ id: pId, name: this.players[pId].name, color: this.players[pId].color, score: this.scores[pId] || 0, isMe: false });
                });
                
                // Sort by score descending
                allScores.sort((a, b) => b.score - a.score);
                
                allScores.forEach((rank, index) => {
                    const row = document.createElement('div');
                    row.className = `versus-rank-row ${rank.id === winnerId ? 'winner-row' : ''}`;
                    row.innerHTML = `
                        <div class="player-info">
                            <span class="player-color-dot" style="color: ${rank.color}; background-color: ${rank.color};"></span>
                            <span class="player-name ${rank.isMe ? 'is-me' : ''}">${rank.name}</span>
                        </div>
                        <span class="score-val">${rank.score} Win</span>
                    `;
                    list.appendChild(row);
                });

                document.getElementById('versus-overlay').classList.remove('hidden');

                // Host button visibility
                if (this.isHost) {
                    document.getElementById('versus-next-btn').classList.remove('hidden');
                    document.getElementById('versus-wait-msg').style.display = 'none';
                } else {
                    document.getElementById('versus-next-btn').classList.add('hidden');
                    document.getElementById('versus-wait-msg').style.display = 'block';
                }
            }
            else if (action === 'endGame') {
                // Show final ending overlay
                document.getElementById('versus-overlay').classList.add('hidden');
                document.getElementById('success-overlay').classList.add('hidden');
                document.getElementById('multiplayer-hud').classList.add('hidden');
                
                document.getElementById('ending-overlay').classList.remove('hidden');
            }
        }
    }

    updateLobbyUI() {
        if (!this.isActive || !this.roomCode) return;

        // Player count
        const count = Object.keys(this.players).length + 1; // plus self
        document.getElementById('lobby-player-count').innerText = count;

        // Populate list
        const listContainer = document.getElementById('lobby-players-list');
        listContainer.innerHTML = '';

        // Add self
        const selfRow = document.createElement('div');
        selfRow.className = "player-row";
        selfRow.style.borderLeftColor = this.playerColor;
        selfRow.innerHTML = `
            <div class="player-info-side">
                <span class="player-color-dot" style="color: ${this.playerColor}; background-color: ${this.playerColor};"></span>
                <span class="player-name is-me">${this.playerName}</span>
            </div>
            ${this.isHost ? '<span class="badge-host"><i class="fa-solid fa-crown"></i> Host</span>' : ''}
        `;
        listContainer.appendChild(selfRow);

        // Add others
        Object.keys(this.players).forEach(pId => {
            const p = this.players[pId];
            const row = document.createElement('div');
            row.className = "player-row";
            row.style.borderLeftColor = p.color;
            row.innerHTML = `
                <div class="player-info-side">
                    <span class="player-color-dot" style="color: ${p.color}; background-color: ${p.color};"></span>
                    <span class="player-name">${p.name}</span>
                </div>
                ${p.isHost ? '<span class="badge-host"><i class="fa-solid fa-crown"></i> Host</span>' : ''}
            `;
            listContainer.appendChild(row);
        });

        // Enable/Disable start button for Host
        if (this.isHost) {
            const startBtn = document.getElementById('start-mp-game-btn');
            if (count >= 1) { // Host can play solo for debugging or multiplayer starts when anyone is in
                startBtn.disabled = false;
            } else {
                startBtn.disabled = true;
            }
        }
    }

    updateInGameHUD() {
        if (!this.isActive || !document.getElementById('start-overlay').classList.contains('hidden')) return;

        // Throttle DOM rebuilds
        const now = Date.now();
        if (now - this._hudLastUpdate < this._hudThrottleMs) return;
        this._hudLastUpdate = now;

        const hudContainer = document.getElementById('mp-hud-players');
        hudContainer.innerHTML = '';

        // Render self row
        this.renderPlayerHUDRow(hudContainer, this.playerId, this.playerName, this.playerColor, alignmentProgress, true);

        // Render others
        Object.keys(this.players).forEach(pId => {
            const p = this.players[pId];
            this.renderPlayerHUDRow(hudContainer, pId, p.name, p.color, p.alignment, false);
        });

        // Update Co-op group progress if coop mode
        if (this.gameMode === 'coop') {
            let total = alignmentProgress;
            let count = 1;
            Object.keys(this.players).forEach(pId => {
                total += this.players[pId].alignment;
                count++;
            });
            const avg = total / count;
            const percentage = Math.round(avg * 100);

            document.getElementById('mp-coop-progress-bar').style.width = percentage + '%';
            document.getElementById('mp-coop-percentage').innerText = percentage + '%';
            
            if (percentage >= 95) {
                document.getElementById('mp-coop-progress-bar').style.boxShadow = '0 0 15px #00ff88';
            } else {
                document.getElementById('mp-coop-progress-bar').style.boxShadow = 'none';
            }
        }
    }

    renderPlayerHUDRow(container, id, name, color, alignment, isMe) {
        const percentage = Math.round(alignment * 100);
        const isAligned = alignment >= 0.90; // > 90% is aligned in HUD terms
        
        const row = document.createElement('div');
        row.className = "mp-player-row";
        row.innerHTML = `
            <div class="mp-player-meta">
                <div class="mp-player-name-container">
                    <span class="mp-player-indicator" style="background-color: ${color}; box-shadow: 0 0 6px ${color};"></span>
                    <span class="mp-player-name ${isMe ? 'is-me' : ''}">${name}</span>
                </div>
                <span class="mp-player-alignment ${isAligned ? 'aligned' : ''}">${isAligned ? 'SEJAJAR' : percentage + '%'}</span>
            </div>
            <div class="player-progress-bar-container">
                <div class="player-progress-mini" style="width: ${percentage}%; background-color: ${color}; box-shadow: 0 0 4px ${color};"></div>
            </div>
        `;
        container.appendChild(row);
    }

    onLocalMove() {
        if (!this.isActive || !this.client || !this.client.connected || !camera) return;

        // Throttled publish
        this.publishState(camera.position, alignmentProgress);
    }

    onLocalLoadLevel(levelIdx) {
        if (!this.isActive) return;
        
        // Host controls what level gets sync'd
        if (this.isHost) {
            this.publishGameAction('loadLevel', { levelIdx: levelIdx });
        }
    }

    onLocalSuccess() {
        if (!this.isActive) return;

        if (this.gameMode === 'versus') {
            // We reached 100% first in versus! Broadcast victory
            this.publishGameAction('versusWin', { winnerId: this.playerId, winnerName: this.playerName });
        }
    }

    checkCoopVictoryCondition() {
        if (!this.isActive || this.gameMode !== 'coop' || isAligned) return;

        // In co-op, everyone in the room must reach resonance >= 90% (alignment >= 0.9)
        const localReady = alignmentProgress >= 0.9;
        let allReady = localReady;

        Object.keys(this.players).forEach(pId => {
            if (this.players[pId].alignment < 0.9) {
                allReady = false;
            }
        });

        // Co-op level success trigger
        if (allReady && Object.keys(this.players).length > 0) { // requires at least 2 players in coop to align (or 1 if debug, but let's enforce everyone)
            this.triggerCoopSuccess();
        }
    }

    triggerCoopSuccess() {
        // Run local success trigger from app.js but adjust for multiplayer
        isAligned = true;
        alignmentProgress = 1;
        document.getElementById('alignment-progress').style.width = '100%';
        document.getElementById('alignment-percentage').innerText = '100%';
        document.getElementById('alignment-progress').style.boxShadow = '0 0 20px #00ff88';

        // Glowing level meshes
        if (levelGroup) {
            levelGroup.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material.color.setHex(0x00ff88);
                    if (child.material.emissive) {
                        child.material.emissive.setHex(0x00ff88);
                    }
                }
            });
        }

        playSuccessChime();

        setTimeout(() => {
            // Show popup
            document.getElementById('success-message').innerText = `Kalian semua berhasil menyelaraskan dimensi ke-${currentLevel + 1}!`;
            document.getElementById('success-overlay').classList.remove('hidden');
            
            // Adjust continuation button (only Host can proceed)
            const nextBtn = document.getElementById('next-level-btn');
            if (this.isHost) {
                nextBtn.classList.remove('hidden');
                nextBtn.innerHTML = `Lanjutkan Ritual <i class="fa-solid fa-arrow-right"></i>`;
                nextBtn.disabled = false;
            } else {
                nextBtn.classList.add('hidden'); // Clients wait for host loadLevel command
            }
        }, 1200);
    }

    // --- 3D Remote Players Rendering (Three.js) ---

    updateOrCreateAvatar(playerId, player) {
        if (!scene) return;

        let avatarGroup = this.avatars[playerId];
        if (!avatarGroup) {
            avatarGroup = this.createAvatar(player);
            this.avatars[playerId] = avatarGroup;
            scene.add(avatarGroup);
            console.log(`Created 3D avatar for player: ${player.name}`);
        }

        // Keep target positions updated for lerping inside the animate loop
        if (player.targetPos) {
            avatarGroup.userData.targetPosition.copy(player.targetPos);
        }
        
        // Update local status variables
        avatarGroup.userData.alignment = player.alignment;
        avatarGroup.userData.name = player.name;
        avatarGroup.userData.color = player.color;

        // Redraw name tag (throttled to avoid excessive canvas/texture recreation)
        const now = Date.now();
        const lastUpdate = this._nameTagTimers[playerId] || 0;
        if (now - lastUpdate > this._nameTagThrottleMs) {
            this._nameTagTimers[playerId] = now;
            this.updateNameTag(avatarGroup);
        }
    }

    createAvatar(player) {
        const group = new THREE.Group();
        group.position.set(0, 0, 10); // Start position
        
        // UserData metadata for interpolation
        group.userData = {
            targetPosition: new THREE.Vector3(0, 0, 10),
            alignment: player.alignment || 0,
            name: player.name,
            color: player.color,
            bubbleTimer: 0,
            bubbleSprite: null
        };

        const hexColor = parseInt(player.color.replace("#", "0x"));

        // Glowing crystal mesh (Octahedron)
        const geom = new THREE.OctahedronGeometry(0.25, 0);
        const mat = new THREE.MeshStandardMaterial({
            color: hexColor,
            emissive: hexColor,
            emissiveIntensity: 1.5,
            roughness: 0.1,
            metalness: 0.8
        });
        const mesh = new THREE.Mesh(geom, mat);
        group.add(mesh);

        // Holographic wireframe overlay
        const wireGeom = new THREE.OctahedronGeometry(0.27, 0);
        const wireMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0.3
        });
        const wireMesh = new THREE.Mesh(wireGeom, wireMat);
        group.add(wireMesh);

        // Add a small light
        const pointLight = new THREE.PointLight(hexColor, 1.2, 8);
        pointLight.position.set(0, 0, 0);
        group.add(pointLight);

        // Initial Name Tag Sprite
        const nameTagSprite = this.createNameTagSprite(player.name, player.alignment, player.color);
        nameTagSprite.position.set(0, 0.6, 0); // Positioned above the octahedron
        group.add(nameTagSprite);
        group.userData.nameTag = nameTagSprite;

        return group;
    }

    updateNameTag(avatarGroup) {
        const nameTag = avatarGroup.userData.nameTag;
        if (!nameTag) return;

        // Dispose old texture to prevent GPU memory leak
        if (nameTag.material && nameTag.material.map) {
            nameTag.material.map.dispose();
            nameTag.material.dispose();
        }
        avatarGroup.remove(nameTag);

        // Build new name tag sprite
        const newTag = this.createNameTagSprite(
            avatarGroup.userData.name,
            avatarGroup.userData.alignment,
            avatarGroup.userData.color
        );
        newTag.position.set(0, 0.6, 0);
        avatarGroup.add(newTag);
        avatarGroup.userData.nameTag = newTag;
    }

    createNameTagSprite(name, alignment, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Clear
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Rounded rect background
        ctx.fillStyle = 'rgba(10, 10, 15, 0.8)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        this.drawRoundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 10, true, true);

        // Nickname
        ctx.font = 'bold 18px "Orbitron", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(name, canvas.width / 2, 28);

        // Alignment percentage
        const pct = Math.round(alignment * 100);
        ctx.font = '13px "Orbitron", monospace';
        ctx.fillStyle = color;
        ctx.fillText(`${pct}% Resonansi`, canvas.width / 2, 48);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.5, 0.375, 1); // Maintain 4:1 scale aspect ratio
        return sprite;
    }

    drawRoundRect(ctx, x, y, width, height, radius, fill, stroke) {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    showBubble(playerId, text) {
        // Find avatar
        const avatar = this.avatars[playerId];
        if (!avatar) return;

        // Remove old bubble if exists
        if (avatar.userData.bubbleSprite) {
            avatar.remove(avatar.userData.bubbleSprite);
        }

        // Create new bubble sprite
        const sprite = this.createBubbleSprite(text, avatar.userData.color);
        sprite.position.set(0, 1.1, 0); // Float higher than name tag
        avatar.add(sprite);
        avatar.userData.bubbleSprite = sprite;
        avatar.userData.bubbleTimer = Date.now() + 4000; // Visible for 4 seconds
    }

    createBubbleSprite(text, color) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Bubble shape (glowing purple background with colored border)
        ctx.fillStyle = 'rgba(138, 43, 226, 0.95)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        this.drawRoundRect(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 12, true, true);

        // Draw speech bubble notch at bottom
        ctx.fillStyle = 'rgba(138, 43, 226, 0.95)';
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 - 10, canvas.height - 8);
        ctx.lineTo(canvas.width / 2 + 10, canvas.height - 8);
        ctx.lineTo(canvas.width / 2, canvas.height + 4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 - 10, canvas.height - 8);
        ctx.lineTo(canvas.width / 2, canvas.height + 4);
        ctx.lineTo(canvas.width / 2 + 10, canvas.height - 8);
        ctx.stroke();

        // Draw Text
        ctx.font = '14px "Plus Jakarta Sans", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(text, canvas.width / 2, 36);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.5, 0.375, 1);
        return sprite;
    }

    updateRemoteAvatars() {
        if (!this.isActive) return;

        const now = Date.now();
        Object.keys(this.avatars).forEach(playerId => {
            const avatar = this.avatars[playerId];
            if (!avatar) return;

            // Smoothly interpolate (lerp) from current position to targetPosition
            avatar.position.lerp(avatar.userData.targetPosition, 0.08);

            // Make avatar look at center puzzle origin
            avatar.lookAt(0, 0, 0);
            
            // Subtle floating motion
            const mesh = avatar.children[0];
            if (mesh) {
                mesh.rotation.y += 0.015;
                mesh.rotation.z += 0.005;
                mesh.position.y = Math.sin(now * 0.002 + parseInt(playerId.substring(2), 36) % 10) * 0.05;
            }

            // Check if bubble timer expired
            if (avatar.userData.bubbleSprite && now > avatar.userData.bubbleTimer) {
                avatar.remove(avatar.userData.bubbleSprite);
                avatar.userData.bubbleSprite = null;
            }
        });
    }

    clearRemoteAvatars() {
        if (!scene) return;
        Object.keys(this.avatars).forEach(playerId => {
            this.removeAvatar(playerId);
        });
        this.avatars = {};
    }

    removeAvatar(playerId) {
        const avatar = this.avatars[playerId];
        if (avatar && scene) {
            scene.remove(avatar);
            // Recursively dispose geometry and materials
            avatar.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
            delete this.avatars[playerId];
            console.log(`Removed 3D avatar for player: ${playerId}`);
        }
    }
}

// Instantiate and expose globally
window.Multiplayer = new AetheriaMultiplayer();
window.addEventListener('DOMContentLoaded', () => {
    window.Multiplayer.init();
});
