/**
 * CYH Browser Terminal Application
 * Premium WebSocket-based terminal emulator by CanYouHack
 */

class TerminalApp {
    constructor() {
        this.terminal = null;
        this.socket = null;
        this.fitAddon = null;
        this.webLinksAddon = null;
        this.sessionStartTime = null;
        this.sessionTimer = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1500;
        this.currentMode = 'local';
        this.dockerStatusInterval = null;
        this.containerListInterval = null;
        this.containers = [];
        this.isConnecting = false;
        this.isReconnecting = false;
        this.intentionalDisconnect = false;
        this.connectionId = 0;

        // Command history tracking
        this.commandBuffer = '';
        this.commandHistory = [];
        this.historyIndex = -1;

        this.init();
    }

    init() {
        this.createTerminal();
        this.setupEventListeners();
        this.fetchDockerStatus();
        this.fetchContainers();
        this.fetchCommandHistory();
        this.startDockerStatusPolling();
        this.startContainerListPolling();
        this.showWelcomeBanner();
        this.connect();
        this.startSessionTimer();
    }

    createTerminal() {
        // Premium CYH-inspired terminal theme
        this.terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'bar',
            cursorWidth: 2,
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Monaco, 'Cascadia Code', monospace",
            fontSize: 14,
            fontWeight: '400',
            fontWeightBold: '600',
            letterSpacing: 0.5,
            lineHeight: 1.25,
            scrollback: 15000,
            tabStopWidth: 4,
            allowTransparency: true,
            theme: {
                // CYH dark theme with neon green
                background: '#0a0c0f',
                foreground: '#e8e8e8',
                cursor: '#7FFF00',
                cursorAccent: '#0a0c0f',
                selectionBackground: 'rgba(127, 255, 0, 0.25)',
                selectionForeground: '#ffffff',
                selectionInactiveBackground: 'rgba(127, 255, 0, 0.15)',
                // Standard colors
                black: '#0a0c0f',
                red: '#ff4757',
                green: '#7FFF00',
                yellow: '#ffd000',
                blue: '#00d9ff',
                magenta: '#a855f7',
                cyan: '#00e5cc',
                white: '#c4c4c4',
                // Bright colors
                brightBlack: '#505050',
                brightRed: '#ff6b7a',
                brightGreen: '#9fff40',
                brightYellow: '#ffe34d',
                brightBlue: '#4de5ff',
                brightMagenta: '#c084fc',
                brightCyan: '#33ffdd',
                brightWhite: '#ffffff'
            }
        });

        // Load addons
        this.fitAddon = new FitAddon.FitAddon();
        this.webLinksAddon = new WebLinksAddon.WebLinksAddon();

        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.webLinksAddon);

        // Open terminal in container
        const terminalBody = document.getElementById('terminalBody');
        this.terminal.open(terminalBody);

        // Initial fit and focus
        setTimeout(() => {
            this.fitTerminal();
            this.terminal.focus();
        }, 100);

        // Handle terminal title changes - extract path from title
        this.terminal.onTitleChange(title => {
            if (title && title.trim()) {
                const titleText = document.querySelector('.title-text');
                if (titleText) titleText.textContent = title;
                document.title = `${title} - CYH Terminal`;

                // Extract path from title (format: user@host:path or just path)
                const pathMatch = title.match(/:([^\s]+)/) || title.match(/~[^\s]*/);
                if (pathMatch) {
                    const path = pathMatch[1] || pathMatch[0];
                    const currentPath = document.getElementById('currentPath');
                    if (currentPath) {
                        // Shorten path if too long
                        let displayPath = path;
                        if (path.length > 30) {
                            const parts = path.split('/');
                            if (parts.length > 3) {
                                displayPath = `.../${parts.slice(-2).join('/')}`;
                            }
                        }
                        currentPath.textContent = displayPath;
                        currentPath.title = path; // Full path on hover
                    }
                }
            }
        });

        // Handle terminal data input
        this.terminal.onData(data => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(data);

                // Track commands (Enter key)
                if (data === '\r' || data === '\n') {
                    if (this.commandBuffer.trim()) {
                        this.saveCommand(this.commandBuffer.trim());
                    }
                    this.commandBuffer = '';
                } else if (data === '\x7f' || data === '\b') {
                    // Backspace
                    this.commandBuffer = this.commandBuffer.slice(0, -1);
                } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
                    // Regular printable character
                    this.commandBuffer += data;
                }
            }
        });

        // Track output buffer for path extraction
        this.outputBuffer = '';
    }

    // Parse terminal output to extract path from prompt
    parseOutputForPath(data) {
        // Add to buffer
        this.outputBuffer += data;
        // Keep buffer manageable
        if (this.outputBuffer.length > 2000) {
            this.outputBuffer = this.outputBuffer.slice(-1000);
        }

        // Look for prompt patterns like:
        // canyouhack@root:/path$
        // user@host:path$
        // [user@host path]$
        const patterns = [
            /canyouhack@root:([^\s$]+)\$/,        // Our custom Docker prompt
            /cyh@hacking:([^\s$]+)\$/,            // Fallback prompt format
            /@[^:]+:([^\s$]+)\$/,                 // Standard user@host:path$
            /\]([^\s$]+)\$\s*$/,                  // [user@host path]$
            /:\s*([~\/][^\s$\n\r]+)\s*\$/         // Generic :path$
        ];

        for (const pattern of patterns) {
            const match = this.outputBuffer.match(pattern);
            if (match && match[1]) {
                this.updatePath(match[1]);
                break;
            }
        }
    }

    updatePath(path) {
        const currentPath = document.getElementById('currentPath');
        if (!currentPath) return;

        // Shorten path if too long
        let displayPath = path;
        if (path.length > 25) {
            const parts = path.split('/');
            if (parts.length > 3) {
                displayPath = `.../${parts.slice(-2).join('/')}`;
            }
        }
        currentPath.textContent = displayPath;
        currentPath.title = path; // Full path on hover
    }

    // Save command to backend
    async saveCommand(command) {
        try {
            await fetch('/api/history/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: this.currentMode, command })
            });
            // Add to local array and refresh UI
            this.commandHistory.unshift({ command, timestamp: new Date().toISOString(), mode: this.currentMode });
            if (this.commandHistory.length > 50) this.commandHistory.pop();
            this.renderCommandHistory();
        } catch (e) {
            console.error('Failed to save command:', e);
        }
    }

    // Fetch command history from backend
    async fetchCommandHistory() {
        try {
            const response = await fetch('/api/history');
            const history = await response.json();
            this.commandHistory = history ? history.slice().reverse() : [];
            this.renderCommandHistory();
        } catch (e) {
            console.error('Failed to fetch history:', e);
        }
    }

    // Render command history in sidebar
    renderCommandHistory() {
        const historyList = document.getElementById('commandHistoryList');
        if (!historyList) return;

        if (!this.commandHistory || this.commandHistory.length === 0) {
            historyList.innerHTML = '<div class="no-history">No commands yet</div>';
            return;
        }

        // Show last 20 unique commands
        const uniqueCommands = [];
        const seen = new Set();
        for (const entry of this.commandHistory) {
            if (!seen.has(entry.command)) {
                seen.add(entry.command);
                uniqueCommands.push(entry);
                if (uniqueCommands.length >= 20) break;
            }
        }

        historyList.innerHTML = uniqueCommands.map((entry, i) => `
            <div class="history-item" data-command="${this.escapeHtml(entry.command)}">
                <span class="history-cmd" onclick="runHistoryCommand(this.parentElement)">${this.escapeHtml(entry.command)}</span>
                <div class="history-actions">
                    <button class="history-btn edit" onclick="editHistoryCommand(this.parentElement.parentElement)" title="Edit">✏️</button>
                    <button class="history-btn run" onclick="runHistoryCommand(this.parentElement.parentElement)" title="Run">▶</button>
                </div>
            </div>
        `).join('');
    }

    // Clear command history
    async clearCommandHistory() {
        try {
            await fetch('/api/history/clear?mode=' + this.currentMode, { method: 'DELETE' });
            this.commandHistory = [];
            this.renderCommandHistory();
            this.terminal.write('\r\n\x1b[38;2;127;255;0m✓ History cleared\x1b[0m\r\n');
        } catch (e) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ Failed to clear history\x1b[0m\r\n');
        }
    }

    showWelcomeBanner() {
        const banner = [
            '\x1b[38;2;127;255;0m',
            '  ╔══════════════════════════════════════════════════════════╗',
            '  ║                                                          ║',
            '  ║    \x1b[1m>_\x1b[0m\x1b[38;2;127;255;0m \x1b[37;1mCYH\x1b[0m\x1b[38;2;127;255;0m | \x1b[38;2;127;255;0mCanYouHack\x1b[0m\x1b[38;2;127;255;0m Terminal                      ║',
            '  ║                                                          ║',
            '  ║    \x1b[38;2;200;200;200mSecurity Training Platform\x1b[38;2;127;255;0m                        ║',
            '  ║    \x1b[38;2;127;255;0m🌐 https://canyouhack.org\x1b[0m\x1b[38;2;127;255;0m                          ║',
            '  ║                                                          ║',
            '  ╚══════════════════════════════════════════════════════════╝',
            '\x1b[0m',
            ''
        ];

        banner.forEach(line => {
            this.terminal.writeln(line);
        });
    }

    async fetchDockerStatus() {
        try {
            const response = await fetch('/api/docker/status');
            const status = await response.json();

            const dockerBtn = document.getElementById('dockerModeBtn');
            const dockerStatus = document.getElementById('dockerStatus');
            const dockerStatusDot = document.getElementById('dockerStatusDot');
            const dockerControls = document.getElementById('dockerControls');
            const dockerInfo = document.getElementById('dockerInfo');

            if (!status.docker_installed) {
                dockerStatus.textContent = 'Not installed';
                if (dockerInfo) dockerInfo.textContent = 'Not installed';
                dockerStatusDot.className = 'mode-status';
                dockerBtn.disabled = true;
                dockerControls.style.display = 'none';
            } else if (status.image_ready && status.container_ready) {
                dockerStatus.textContent = 'Ready';
                if (dockerInfo) {
                    dockerInfo.textContent = 'Ready';
                    dockerInfo.style.color = '#7FFF00';
                }
                dockerStatusDot.className = 'mode-status available';
                dockerBtn.disabled = false;
                dockerControls.style.display = 'block';
            } else if (status.image_ready) {
                dockerStatus.textContent = 'Starting...';
                if (dockerInfo) dockerInfo.textContent = 'Starting...';
                dockerBtn.disabled = true;
                dockerControls.style.display = 'block';
            } else {
                dockerStatus.textContent = 'Building image...';
                dockerStatusDot.className = 'mode-status building';
                dockerBtn.disabled = true;
                dockerControls.style.display = 'block';
            }
        } catch (error) {
            console.error('Failed to fetch Docker status:', error);
        }
    }

    async fetchContainers() {
        try {
            const response = await fetch('/api/containers');
            this.containers = await response.json();
            this.renderContainerList();
        } catch (error) {
            console.error('Failed to fetch containers:', error);
        }
    }

    renderContainerList() {
        const containerList = document.getElementById('containerList');

        if (!this.containers || this.containers.length === 0) {
            containerList.innerHTML = '<div class="no-containers">No containers running</div>';
            return;
        }

        containerList.innerHTML = this.containers.map((container, index) => {
            const isRunning = container.status.toLowerCase().includes('up');
            const statusClass = isRunning ? 'running' : 'stopped';

            return `
                <div class="container-item" data-id="${container.id}" style="animation-delay: ${index * 0.05}s">
                    <div class="container-status ${statusClass}"></div>
                    <div class="container-info">
                        <div class="container-name">${this.escapeHtml(container.name)}</div>
                        <div class="container-image">${this.escapeHtml(container.image)}</div>
                    </div>
                    <div class="container-actions">
                        ${isRunning ? `
                            <button class="stop" onclick="stopContainer('${container.id}')" title="Stop">
                                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                            </button>
                        ` : `
                            <button class="start" onclick="startContainer('${container.id}')" title="Start">
                                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>
                            </button>
                        `}
                        <button class="delete" onclick="deleteContainer('${container.id}', '${this.escapeHtml(container.name)}')" title="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    startDockerStatusPolling() {
        this.dockerStatusInterval = setInterval(() => {
            this.fetchDockerStatus();
        }, 5000);
    }

    startContainerListPolling() {
        this.containerListInterval = setInterval(() => {
            this.fetchContainers();
        }, 10000);
    }

    setMode(mode) {
        if (this.currentMode === mode) return;
        if (this.isConnecting) return;

        const dockerBtn = document.getElementById('dockerModeBtn');
        if (mode === 'docker' && dockerBtn.disabled) {
            return;
        }

        this.currentMode = mode;

        // Update UI
        document.getElementById('localModeBtn').classList.toggle('active', mode === 'local');
        document.getElementById('dockerModeBtn').classList.toggle('active', mode === 'docker');

        const label = mode === 'docker' ? 'CYH Hacking' : 'CYH Local';
        document.getElementById('currentModeText').textContent = label;
        document.getElementById('headerModeLabel').textContent = label;

        // Reconnect with new mode - set intentional flag to prevent auto-reconnect
        this.intentionalDisconnect = true;
        this.cleanupSocket();
        this.terminal.clear();
        this.terminal.reset();
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        setTimeout(() => {
            this.intentionalDisconnect = false;
            this.showWelcomeBanner();
            this.connect();
        }, 200);
    }

    cleanupSocket() {
        if (this.socket) {
            // Remove all event handlers first
            this.socket.onclose = null;
            this.socket.onerror = null;
            this.socket.onopen = null;
            this.socket.onmessage = null;

            // Close if still open or connecting
            if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
                try {
                    this.socket.close(1000, 'Client disconnecting');
                } catch (e) {
                    // Ignore close errors
                }
            }
            this.socket = null;
        }
    }

    disconnect() {
        this.intentionalDisconnect = true;
        this.cleanupSocket();
        this.updateConnectionStatus('disconnected');
    }

    connect() {
        // Prevent multiple simultaneous connection attempts
        if (this.isConnecting) {
            console.log('Connection already in progress, skipping...');
            return;
        }

        // Generate unique connection ID to track this attempt
        const currentConnectionId = ++this.connectionId;
        this.isConnecting = true;

        // Clean up any existing socket
        this.cleanupSocket();
        this.updateConnectionStatus('connecting');

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socketURL = `${protocol}//${window.location.host}/ws/terminal?mode=${this.currentMode}`;

        try {
            this.socket = new WebSocket(socketURL);
            this.socket.binaryType = 'arraybuffer';

            this.socket.onopen = () => {
                // Check if this connection is still the current one
                if (currentConnectionId !== this.connectionId) {
                    console.log('Stale connection opened, closing...');
                    this.socket?.close();
                    return;
                }

                this.isConnecting = false;
                this.isReconnecting = false;
                this.reconnectAttempts = 0;
                this.updateConnectionStatus('connected');

                setTimeout(() => {
                    this.fitTerminal();
                    this.sendResize();
                    this.terminal.focus();
                }, 100);
            };

            this.socket.onmessage = (event) => {
                // Check if this is still the current connection
                if (currentConnectionId !== this.connectionId) return;

                const data = event.data;
                if (data instanceof ArrayBuffer) {
                    const textData = new TextDecoder().decode(new Uint8Array(data));
                    this.terminal.write(new Uint8Array(data));
                    this.parseOutputForPath(textData);
                } else {
                    this.terminal.write(data);
                    this.parseOutputForPath(data);
                }
            };

            this.socket.onclose = (event) => {
                // Check if this is still the current connection
                if (currentConnectionId !== this.connectionId) return;

                this.isConnecting = false;
                this.updateConnectionStatus('disconnected');

                // Only auto-reconnect if not an intentional disconnect
                if (!this.intentionalDisconnect && !this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
                    this.isReconnecting = true;
                    this.reconnectAttempts++;
                    this.terminal.write(`\r\n\x1b[38;2;127;255;0m⟳ Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...\x1b[0m\r\n`);
                    setTimeout(() => {
                        // Double check before reconnecting
                        if (currentConnectionId === this.connectionId && !this.intentionalDisconnect) {
                            this.isReconnecting = false;
                            this.connect();
                        }
                    }, this.reconnectDelay);
                } else if (!this.intentionalDisconnect && this.reconnectAttempts >= this.maxReconnectAttempts) {
                    this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ Connection failed. Please refresh the page.\x1b[0m\r\n');
                }
            };

            this.socket.onerror = (error) => {
                // Check if this is still the current connection
                if (currentConnectionId !== this.connectionId) return;

                this.isConnecting = false;
                console.error('WebSocket error:', error);
            };

        } catch (error) {
            this.isConnecting = false;
            this.updateConnectionStatus('disconnected');
            console.error('Failed to create WebSocket:', error);
        }
    }

    fitTerminal() {
        if (this.fitAddon) {
            try {
                this.fitAddon.fit();
                this.updateTerminalSize();
            } catch (e) {
                // Ignore fit errors
            }
        }
    }

    sendResize() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            const dims = this.fitAddon.proposeDimensions();
            if (dims) {
                this.socket.send(JSON.stringify({
                    type: 'resize',
                    data: { rows: dims.rows, cols: dims.cols }
                }));
            }
        }
    }

    updateTerminalSize() {
        const dims = this.fitAddon.proposeDimensions();
        if (dims) {
            document.getElementById('termSize').textContent = `${dims.cols}×${dims.rows}`;
        }
    }

    updateConnectionStatus(status) {
        const dot = document.querySelector('.indicator-dot');
        const text = document.querySelector('.indicator-text');
        const wsStatus = document.getElementById('wsStatus');

        dot.className = 'indicator-dot';
        wsStatus.className = 'status-item status-connection';

        if (status === 'connected') {
            dot.classList.add('connected');
            text.textContent = 'Connected';
            wsStatus.textContent = 'Connected';
            wsStatus.classList.add('connected');
        } else if (status === 'connecting') {
            dot.classList.add('connecting');
            text.textContent = 'Connecting...';
            wsStatus.textContent = 'Connecting...';
        } else {
            text.textContent = 'Disconnected';
            wsStatus.textContent = 'Disconnected';
        }
    }

    startSessionTimer() {
        this.sessionStartTime = new Date();
        this.sessionTimer = setInterval(() => {
            const diff = Date.now() - this.sessionStartTime;
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            document.getElementById('sessionTime').textContent =
                `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }, 1000);
    }

    async rebuildDocker() {
        try {
            await fetch('/api/docker/rebuild', { method: 'POST' });
            this.terminal.write('\r\n\x1b[38;2;127;255;0m⟳ Rebuilding image...\x1b[0m\r\n');
            this.fetchDockerStatus();
        } catch (e) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ Failed to rebuild\x1b[0m\r\n');
        }
    }

    async restartContainer() {
        try {
            await fetch('/api/containers/restart', { method: 'POST' });
            this.terminal.write('\r\n\x1b[38;2;127;255;0m⟳ Restarting container...\x1b[0m\r\n');
            this.fetchDockerStatus();
            this.fetchContainers();
        } catch (e) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ Failed to restart\x1b[0m\r\n');
        }
    }

    setupEventListeners() {
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.fitTerminal();
                this.sendResize();
            }, 150);
        });

        // Mode buttons
        document.getElementById('localModeBtn').addEventListener('click', () => this.setMode('local'));
        document.getElementById('dockerModeBtn').addEventListener('click', () => this.setMode('docker'));

        // Docker action buttons
        document.getElementById('rebuildDockerBtn').addEventListener('click', () => {
            if (confirm('Rebuild Docker image? This may take a few minutes.')) {
                this.rebuildDocker();
            }
        });
        document.getElementById('restartContainerBtn').addEventListener('click', () => {
            if (confirm('Restart the container?')) {
                this.restartContainer();
            }
        });

        // Container buttons
        document.getElementById('refreshContainersBtn').addEventListener('click', () => this.fetchContainers());
        document.getElementById('newContainerBtn').addEventListener('click', () => openNewContainerModal());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'C') {
                e.preventDefault();
                this.copySelection();
            }
            if (e.ctrlKey && e.shiftKey && e.key === 'V') {
                e.preventDefault();
                this.pasteClipboard();
            }
            if (e.key === 'F11') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            if (e.key === 'Escape') {
                closeContainerModal();
            }
        });

        // Focus terminal on click
        document.addEventListener('click', (e) => {
            if (this.terminal && !e.target.closest('.sidebar') && !e.target.closest('button') && !e.target.closest('.modal')) {
                this.terminal.focus();
            }
        });

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            this.intentionalDisconnect = true;
            this.cleanupSocket();
            if (this.sessionTimer) clearInterval(this.sessionTimer);
            if (this.dockerStatusInterval) clearInterval(this.dockerStatusInterval);
            if (this.containerListInterval) clearInterval(this.containerListInterval);
        });
    }

    copySelection() {
        if (this.terminal && this.terminal.hasSelection()) {
            navigator.clipboard.writeText(this.terminal.getSelection());
            this.showToast('Copied to clipboard');
        }
    }

    pasteClipboard() {
        navigator.clipboard.readText().then(text => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN && text) {
                this.socket.send(text);
            }
        });
    }

    clearTerminal() {
        if (this.terminal) this.terminal.clear();
    }

    toggleFullscreen() {
        const container = document.querySelector('.main-content');
        if (document.fullscreenElement) {
            document.exitFullscreen().then(() => {
                setTimeout(() => { this.fitTerminal(); this.sendResize(); }, 200);
            });
        } else {
            container.requestFullscreen().then(() => {
                setTimeout(() => { this.fitTerminal(); this.sendResize(); }, 200);
            });
        }
    }

    showToast(message) {
        console.log('Toast:', message);
    }
}

// Container management functions
async function startContainer(id) {
    try {
        await fetch('/api/containers/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ container_id: id })
        });
        window.terminalApp?.fetchContainers();
    } catch (e) {
        console.error('Failed to start container:', e);
    }
}

async function stopContainer(id) {
    try {
        await fetch('/api/containers/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ container_id: id })
        });
        window.terminalApp?.fetchContainers();
    } catch (e) {
        console.error('Failed to stop container:', e);
    }
}

async function deleteContainer(id, name) {
    if (!confirm(`Delete container "${name}"?`)) return;
    try {
        await fetch('/api/containers/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ container_id: id, force: true })
        });
        window.terminalApp?.fetchContainers();
        window.terminalApp?.fetchDockerStatus();
    } catch (e) {
        console.error('Failed to delete container:', e);
    }
}

async function createContainer(name) {
    try {
        const resp = await fetch('/api/containers/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (resp.ok) {
            window.terminalApp?.fetchContainers();
            closeContainerModal();
        } else {
            const err = await resp.json();
            alert('Error: ' + (err.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Failed to create container:', e);
    }
}

function openNewContainerModal() {
    const modal = document.getElementById('containerModal');
    document.getElementById('modalTitle').textContent = 'Create New Container';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label for="containerName">Container Name</label>
            <input type="text" id="containerName" placeholder="cyh-container-1" autocomplete="off">
        </div>
        <button class="btn-primary" onclick="submitCreateContainer()">Create Container</button>
    `;
    modal.classList.add('active');
    setTimeout(() => document.getElementById('containerName')?.focus(), 100);
}

function closeContainerModal() {
    document.getElementById('containerModal').classList.remove('active');
}

function submitCreateContainer() {
    const name = document.getElementById('containerName').value.trim();
    if (name) {
        createContainer(name);
    }
}

// Global functions for window controls
function copySelection() { window.terminalApp?.copySelection(); }
function pasteClipboard() { window.terminalApp?.pasteClipboard(); }
function clearTerminal() { window.terminalApp?.clearTerminal(); }
function toggleFullscreen() { window.terminalApp?.toggleFullscreen(); }

// Command history functions
function runHistoryCommand(element) {
    const command = element.dataset.command;
    if (command && window.terminalApp?.socket?.readyState === WebSocket.OPEN) {
        window.terminalApp.socket.send(command + '\n');
        window.terminalApp.terminal.focus();
    }
}

function clearCommandHistory() {
    if (confirm('Clear command history?')) {
        window.terminalApp?.clearCommandHistory();
    }
}

function editHistoryCommand(element) {
    const command = element.dataset.command;
    const modal = document.getElementById('containerModal');
    document.getElementById('modalTitle').textContent = 'Edit Command';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label for="editCommandInput">Command</label>
            <input type="text" id="editCommandInput" value="${command.replace(/"/g, '&quot;')}" autocomplete="off" style="font-family: 'JetBrains Mono', monospace;">
        </div>
        <div style="display: flex; gap: 10px;">
            <button class="btn-primary" onclick="submitEditedCommand()" style="flex: 1;">
                ▶ Run Command
            </button>
            <button class="btn-secondary" onclick="closeContainerModal()" style="flex: 1; background: var(--bg-tertiary); border: 1px solid var(--border-secondary);">
                Cancel
            </button>
        </div>
    `;
    modal.classList.add('active');
    const input = document.getElementById('editCommandInput');
    input.focus();
    input.select();

    // Run on Enter key
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submitEditedCommand();
        }
    };
}

function submitEditedCommand() {
    const command = document.getElementById('editCommandInput').value.trim();
    if (command && window.terminalApp?.socket?.readyState === WebSocket.OPEN) {
        window.terminalApp.socket.send(command + '\n');
        window.terminalApp.terminal.focus();
        closeContainerModal();
    }
}

function closeTerminal() {
    if (confirm('Close terminal session?')) {
        window.terminalApp?.disconnect();
        window.close();
    }
}

function minimizeTerminal() {
    const c = document.querySelector('.main-content');
    c.style.transform = 'scale(0.96)';
    c.style.opacity = '0.85';
    setTimeout(() => {
        c.style.transform = '';
        c.style.opacity = '';
    }, 250);
}

function maximizeTerminal() {
    toggleFullscreen();
}

// Mobile sidebar toggle functionality
function toggleMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    sidebar.classList.toggle('open');
    mobileMenuBtn.classList.toggle('active');
    sidebarOverlay.classList.toggle('active');

    // Prevent body scroll when sidebar is open
    if (sidebar.classList.contains('open')) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

function closeMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    sidebar.classList.remove('open');
    mobileMenuBtn.classList.remove('active');
    sidebarOverlay.classList.remove('active');
    document.body.style.overflow = '';
}

// Initialize mobile event listeners
function initMobileEventListeners() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', toggleMobileSidebar);
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', closeMobileSidebar);
    }

    // Close sidebar when mode is selected on mobile
    const modeButtons = document.querySelectorAll('.mode-btn');
    modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeMobileSidebar();
            }
        });
    });

    // Handle orientation change
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            window.terminalApp?.fitTerminal();
            window.terminalApp?.sendResize();
        }, 300);
    });

    // Handle resize for mobile/desktop transitions
    let lastWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        if (lastWidth <= 768 && window.innerWidth > 768) {
            closeMobileSidebar();
        }
        lastWidth = window.innerWidth;
    });
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.terminalApp = new TerminalApp();
    initMobileEventListeners();
});

// CLI invocation support - can be called from command line tools
window.CYHTerminal = {
    execute: (command) => {
        if (window.terminalApp?.socket?.readyState === WebSocket.OPEN) {
            window.terminalApp.socket.send(command + '\n');
            return true;
        }
        return false;
    },
    getStatus: () => {
        return {
            connected: window.terminalApp?.socket?.readyState === WebSocket.OPEN,
            mode: window.terminalApp?.currentMode,
            reconnectAttempts: window.terminalApp?.reconnectAttempts
        };
    },
    switchMode: (mode) => {
        if (mode === 'local' || mode === 'docker') {
            window.terminalApp?.setMode(mode);
            return true;
        }
        return false;
    }
};
