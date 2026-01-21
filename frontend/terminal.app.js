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
        this.currentMode = 'docker';
        this.dockerStatusInterval = null;
        this.containerListInterval = null;
        this.containers = [];
        this.isConnecting = false;
        this.isReconnecting = false;
        this.intentionalDisconnect = false;
        this.connectionId = 0;
        this.activeSessionId = '';
        this.outputSeen = false;

        // Command history tracking
        this.commandBuffer = '';
        this.commandHistory = [];
        this.historyIndex = -1;

        // Session Recording
        this.isRecording = false;
        this.recordingData = [];
        this.recordingStartTime = null;
        this.recordingTitle = '';

        // Playback
        this.isPlaying = false;
        this.isPaused = false;
        this.playbackData = null;
        this.playbackIndex = 0;
        this.playbackSpeed = 1;
        this.playbackTimeout = null;

        this.init();
    }

    init() {
        // Try to block browser shortcuts at window level (capture phase)
        window.addEventListener('keydown', (e) => {
            // Only block when we're likely focused on terminal area
            const target = e.target;
            const isTerminalArea = target.closest('.terminal-body') ||
                target.closest('.xterm') ||
                target.classList.contains('xterm-helper-textarea');

            // Handle PageUp/PageDown for command history
            if (isTerminalArea && (e.key === 'PageUp' || e.key === 'PageDown')) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (e.key === 'PageUp') {
                    this.showFullHistory();
                } else {
                    this.navigateLocalHistory('next');
                }
                return false;
            }

            if (isTerminalArea && e.ctrlKey && !e.altKey) {
                const key = e.key.toLowerCase();

                // Handle Linux Copy/Paste (Ctrl+Shift+C / Ctrl+Shift+V)
                if (e.shiftKey) {
                    if (key === 'c') {
                        e.preventDefault();
                        e.stopPropagation(); // Stop inspection
                        const selection = this.terminal.getSelection();
                        if (selection) {
                            navigator.clipboard.writeText(selection);
                        }
                        return false;
                    }
                    if (key === 'v') {
                        e.preventDefault();
                        e.stopPropagation();
                        navigator.clipboard.readText()
                            .then(text => {
                                if (text) this.terminal.paste(text);
                            })
                            .catch(console.error);
                        return false;
                    }
                }

                // Aggressively block ALL browser shortcuts for Ctrl+Key and Ctrl+Shift+Key
                // This ensures keys like Ctrl+Shift+N, Ctrl+N, Ctrl+T, etc. go to terminal
                if (key.length === 1) {
                    // Ctrl+Shift+[Key] (Except C/V which are handled above)
                    if (e.shiftKey && key !== 'c' && key !== 'v') {
                        e.preventDefault();
                        // Do NOT stop propagation, so xterm receives the key sequence
                    }
                    // Ctrl+[Key]
                    else if (!e.shiftKey) {
                        e.preventDefault();
                        // Do NOT stop propagation, so xterm receives the key sequence
                    }
                }
            }
        }, true); // true = capture phase (runs before bubbling)

        console.log('TerminalApp.init() starting...');

        // 0. Connect logic wrapped in async to await session check
        const initializeConnection = async () => {
            try {
                this.createTerminal();
                console.log('1. Terminal created successfully');
            } catch (e) {
                console.error('Failed to create terminal:', e);
            }

            try {
                this.setupEventListeners();
                console.log('2. Event listeners setup');
            } catch (e) {
                console.error('Failed to setup event listeners:', e);
            }

            // These are async and shouldn't block
            this.fetchDockerStatus();
            this.fetchContainers();
            this.fetchCommandHistory();
            console.log('3. Fetch requests started');

            this.startDockerStatusPolling();
            this.startContainerListPolling();
            console.log('4. Polling started');

            // Only show welcome banner if NOT resuming a session
            // Only show welcome banner if NOT resuming a session
            const urlParams = new URLSearchParams(window.location.search);
            const urlSessionId = (window.CYH_SESSION_ID || urlParams.get('session_id') || '').trim();
            const isSessionView = Boolean(window.isSessionView || window.CYH_SESSION_VIEW);

            if (!isSessionView || !urlSessionId) {
                try {
                    this.showWelcomeBanner();
                    console.log('5. Welcome banner shown');
                } catch (e) {
                    console.error('Failed to show welcome banner:', e);
                }
            } else {
                console.log('5. Skipping welcome banner (resuming session)');
            }

            if (isSessionView && urlSessionId) {
                this.activeSessionId = urlSessionId;
                sessionStorage.setItem('activeSessionId', urlSessionId);
                this.currentMode = 'docker';
            } else if (isSessionView) {
                // Bare session manual access -> Force CYH Hacking Default
                console.log('5. Bare session view - defaulting to CYH Hacking');
                this.currentMode = 'docker';
            } else {
                // Check for last active session
                try {
                    const r = await fetch('/api/sessions/last');
                    if (r.ok) {
                        const lastSession = await r.json();
                        if (lastSession && lastSession.id) {
                            console.log('Found last active session:', lastSession.id);
                            sessionStorage.setItem('activeSessionId', lastSession.id);
                            // If session has a specific mode, we might want to respect it,
                            // OR we force "docker" if we want "cyh hacking" by default.
                            // The user request is "create cyh hacking terminal ... and show it again on login".
                            // So we should respect the restored session's mode.

                            // Note: If lastSession.mode is 'local', we will switch to it.
                            // If we want to force Docker for *new* sessions, we do that below.
                            this.currentMode = lastSession.mode || 'docker';
                        } else {
                            // No last session, default to Docker
                            this.currentMode = 'docker';
                        }
                    } else {
                        this.currentMode = 'docker';
                    }
                } catch (e) {
                    console.error('Failed to fetch last session:', e);
                    this.currentMode = 'docker';
                }
            }

            // Update UI for mode
            document.getElementById('localModeBtn').classList.toggle('active', this.currentMode === 'local');
            document.getElementById('dockerModeBtn').classList.toggle('active', this.currentMode === 'docker');
            const label = this.currentMode === 'docker' ? 'CYH Hacking' : 'CYH Local';
            const modeText = document.getElementById('currentModeText');
            if (modeText) modeText.textContent = label;
            const headerLabel = document.getElementById('headerModeLabel');
            if (headerLabel) headerLabel.textContent = label;

            console.log('6. Calling connect() with mode:', this.currentMode);
            this.connect();

            this.startSessionTimer();
            console.log('7. TerminalApp.init() completed');

            if (isSessionView && urlSessionId) {
                setTimeout(() => {
                    if (!this.outputSeen) {
                        this.replaySessionFallback(urlSessionId);
                    }
                }, 1200);
            }
        };

        initializeConnection();
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

        // Block browser shortcuts when terminal is focused
        this.terminal.attachCustomKeyEventHandler((e) => {
            // List of Ctrl+key combinations to block from browser
            if (e.ctrlKey && !e.shiftKey && !e.altKey && e.type === 'keydown') {
                const blockedKeys = [
                    'n', // New window
                    't', // New tab
                    'w', // Close tab
                    'r', // Reload (terminal uses for reverse search)
                    'p', // Print (terminal uses for previous)
                    'f', // Find
                    'g', // Find next
                    'h', // History
                    'j', // Downloads
                    'k', // (varies)
                    'o', // Open file
                    's', // Save (terminal uses to pause output)
                    'u', // View source (terminal uses to clear line)
                    'd', // Bookmark (terminal uses for EOF)
                    'e', // Search bar
                    'b', // Bookmarks bar (terminal uses for back word)
                    'a', // Select all (terminal uses for beginning of line)
                    'l', // Address bar (terminal uses to clear screen)
                ];

                if (blockedKeys.includes(e.key.toLowerCase())) {
                    e.preventDefault();
                    e.stopPropagation();
                    // Return true to let xterm.js handle it (send to terminal)
                    return true;
                }
            }

            // Block Ctrl+Shift combinations
            if (e.ctrlKey && e.shiftKey && e.type === 'keydown') {
                const blockedShiftKeys = ['n', 't', 'w', 'p', 'j', 'b', 'o'];
                // Allow Ctrl+Shift+C and Ctrl+Shift+V for copy/paste
                if (blockedShiftKeys.includes(e.key.toLowerCase()) &&
                    e.key.toLowerCase() !== 'c' && e.key.toLowerCase() !== 'v') {
                    e.preventDefault();
                    e.stopPropagation();
                    return false; // Don't send to terminal
                }
            }

            // Let xterm.js handle everything else
            return true;
        });

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
                    this.historyIndex = -1; // Reset history navigation
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
            if (this.commandHistory.length > 500) this.commandHistory.pop();
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

        // Show all unique commands (no limit)
        const uniqueCommands = [];
        const seen = new Set();
        for (const entry of this.commandHistory) {
            if (!seen.has(entry.command)) {
                seen.add(entry.command);
                uniqueCommands.push(entry);
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
            this.historyIndex = -1;
            this.terminal.write('\r\n\x1b[38;2;127;255;0m✓ History cleared\x1b[0m\r\n');
        } catch (e) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ Failed to clear history\x1b[0m\r\n');
        }
    }

    // Navigate local command history logic
    navigateLocalHistory(direction) {
        // Use all history (global) instead of filtering by mode
        const modeHistory = this.commandHistory;

        if (modeHistory.length === 0) return;

        if (direction === 'prev') { // PageUp (older)
            if (this.historyIndex < modeHistory.length - 1) {
                this.historyIndex++;
            }
        } else { // PageDown (newer)
            if (this.historyIndex > -1) {
                this.historyIndex--;
            }
        }

        let command = '';
        if (this.historyIndex > -1 && this.historyIndex < modeHistory.length) {
            command = modeHistory[this.historyIndex].command;
        }

        // Send to terminal: Ctrl+E (end), Ctrl+U (clear line), then command
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // \x05 = Ctrl+E, \x15 = Ctrl+U
            this.socket.send('\x05\x15' + command);
        }
    }

    // Show full command history in terminal
    showFullHistory() {
        if (!this.commandHistory || this.commandHistory.length === 0) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ No command history available\x1b[0m\r\n');
            return;
        }

        // Get unique commands
        const uniqueCommands = [];
        const seen = new Set();
        for (const entry of this.commandHistory) {
            if (!seen.has(entry.command)) {
                seen.add(entry.command);
                uniqueCommands.push(entry);
            }
        }

        // Build header
        this.terminal.write('\r\n');
        this.terminal.write('\x1b[38;2;127;255;0m╔══════════════════════════════════════════════════════════════╗\x1b[0m\r\n');
        this.terminal.write('\x1b[38;2;127;255;0m║\x1b[0m  \x1b[1;37m📜 COMMAND HISTORY\x1b[0m                                         \x1b[38;2;127;255;0m║\x1b[0m\r\n');
        this.terminal.write('\x1b[38;2;127;255;0m╠══════════════════════════════════════════════════════════════╣\x1b[0m\r\n');

        // Show commands with numbers
        uniqueCommands.forEach((entry, i) => {
            const num = String(i + 1).padStart(3, ' ');
            const cmd = entry.command.length > 50 ? entry.command.substring(0, 47) + '...' : entry.command;
            const paddedCmd = cmd.padEnd(53, ' ');
            this.terminal.write(`\x1b[38;2;127;255;0m║\x1b[0m \x1b[38;2;100;100;100m${num}.\x1b[0m \x1b[38;2;255;255;255m${paddedCmd}\x1b[0m\x1b[38;2;127;255;0m║\x1b[0m\r\n`);
        });

        // Footer
        this.terminal.write('\x1b[38;2;127;255;0m╠══════════════════════════════════════════════════════════════╣\x1b[0m\r\n');
        this.terminal.write(`\x1b[38;2;127;255;0m║\x1b[0m  Total: \x1b[1;37m${uniqueCommands.length}\x1b[0m commands                                      \x1b[38;2;127;255;0m║\x1b[0m\r\n`);
        this.terminal.write('\x1b[38;2;127;255;0m╚══════════════════════════════════════════════════════════════╝\x1b[0m\r\n');
        this.terminal.write('\r\n');
    }

    showWelcomeBanner() {
        // CYH Colors
        const GREEN = '\x1b[38;2;127;255;0m';
        const BRIGHT_GREEN = '\x1b[38;2;159;255;64m';
        const GRAY = '\x1b[38;5;245m';
        const CYAN = '\x1b[38;5;87m';
        const RESET = '\x1b[0m';
        const BOLD = '\x1b[1m';

        // Helper to pad strings for alignment
        // The box width inside is 64 chars.
        // Line format: ║  ● Label: Value   ║
        // We need to carefully construct lines to match the ASCII box width
        const banner = [
            '',
            `${GREEN}  ██████╗██╗   ██╗██╗  ██╗${RESET}`,
            `${GREEN} ██╔════╝╚██╗ ██╔╝██║  ██║${RESET}`,
            `${GREEN} ██║      ╚████╔╝ ███████║${RESET}`,
            `${GREEN} ██║       ╚██╔╝  ██╔══██║${RESET}`,
            `${GREEN} ╚██████╗   ██║   ██║  ██║${RESET}`,
            `${GREEN}  ╚═════╝   ╚═╝   ╚═╝  ╚═╝${RESET}`,
            '',
            `${BRIGHT_GREEN}    CanYouHack Terminal${RESET}`,
            `${GRAY}    https://canyouhack.org${RESET}`,
            '',
            `${GREEN}╔════════════════════════════════════════════════════════════════╗${RESET}`,
            `${GREEN}║${RESET}  ${GREEN}>_${RESET}  ${BOLD}CYH Hacking Environment${RESET}  ${GRAY}|${RESET}  ${CYAN}Security Training Platform${RESET}   ${GREEN}║${RESET}`,
            `${GREEN}╠════════════════════════════════════════════════════════════════╣${RESET}`,
            `${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} Hostname: ${'\x1b[37m'}cyh-container${RESET}                                   ${GREEN}║${RESET}`,
            `${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} Kernel:   ${'\x1b[37m'}Linux CYH-Sec${RESET}                                   ${GREEN}║${RESET}`,
            `${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} User:     ${'\x1b[37m'}root${RESET}                                            ${GREEN}║${RESET}`,
            `${GREEN}║${RESET}  ${BRIGHT_GREEN}●${RESET} Shell:    ${'\x1b[37m'}/bin/bash${RESET}                                       ${GREEN}║${RESET}`,
            `${GREEN}╠════════════════════════════════════════════════════════════════╣${RESET}`,
            `${GREEN}║${RESET}  ${GRAY}Tools:${RESET} ${CYAN}nmap${RESET}  ${CYAN}nikto${RESET}  ${CYAN}sqlmap${RESET}  ${CYAN}hydra${RESET}  ${CYAN}python3${RESET}              ${GREEN}║${RESET}`,
            `${GREEN}╚════════════════════════════════════════════════════════════════╝${RESET}`,
            ''
        ];

        banner.forEach(line => {
            this.terminal.writeln(line);
            // Don't add to command history
        });
    }

    async fetchDockerStatus() {
        const dockerBtn = document.getElementById('dockerModeBtn');
        const dockerStatus = document.getElementById('dockerStatus');
        const dockerStatusDot = document.getElementById('dockerStatusDot');
        const dockerControls = document.getElementById('dockerControls');
        const dockerInfo = document.getElementById('dockerInfo');

        try {
            const response = await fetch('/api/docker/status');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const status = await response.json();
            console.log('Docker Status API Response:', status);

            if (!status.docker_installed) {
                console.log('Docker not installed');
                if (dockerStatus) dockerStatus.textContent = 'Not installed';
                if (dockerInfo) {
                    dockerInfo.textContent = 'Not installed';
                    dockerInfo.style.color = '#ff4757';
                }
                if (dockerStatusDot) dockerStatusDot.className = 'mode-status';
                if (dockerBtn) dockerBtn.disabled = true;
                if (dockerControls) dockerControls.style.display = 'none';
            } else if (status.image_ready && status.container_ready) {
                console.log('Docker is READY - updating UI');
                if (dockerStatus) dockerStatus.textContent = 'Ready';
                if (dockerInfo) {
                    dockerInfo.textContent = 'Ready';
                    dockerInfo.style.color = '#7FFF00';
                }
                if (dockerStatusDot) dockerStatusDot.className = 'mode-status available';
                if (dockerBtn) dockerBtn.disabled = false;
                if (dockerControls) dockerControls.style.display = 'block';
            } else if (status.image_ready) {
                console.log('Docker image ready, container starting');
                if (dockerStatus) dockerStatus.textContent = 'Starting...';
                if (dockerInfo) {
                    dockerInfo.textContent = 'Starting...';
                    dockerInfo.style.color = '#ffd000';
                }
                if (dockerBtn) dockerBtn.disabled = true;
                if (dockerControls) dockerControls.style.display = 'block';
            } else {
                console.log('Docker building image');
                if (dockerStatus) dockerStatus.textContent = 'Building...';
                if (dockerInfo) {
                    dockerInfo.textContent = 'Building...';
                    dockerInfo.style.color = '#ffd000';
                }
                if (dockerStatusDot) dockerStatusDot.className = 'mode-status building';
                if (dockerBtn) dockerBtn.disabled = true;
                if (dockerControls) dockerControls.style.display = 'block';
            }
        } catch (error) {
            console.error('Failed to fetch Docker status:', error);
            // Update UI even on error
            if (dockerStatus) dockerStatus.textContent = 'Error';
            if (dockerInfo) {
                dockerInfo.textContent = 'Error';
                dockerInfo.style.color = '#ff4757';
            }
            if (dockerBtn) dockerBtn.disabled = true;
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
        if (!containerList) {
            return;
        }

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
                            <button class="connect" onclick="connectToContainer('${this.escapeHtml(container.name)}')" title="Connect Terminal">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H9v-2h6v2zm-3-7l-4-4v8l4-4z"/></svg>
                            </button>
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

    connectToContainer(containerName) {
        console.log('Connecting to specific container:', containerName);
        this.targetContainer = containerName;

        // Force Docker mode if not already
        if (this.currentMode !== 'docker') {
            this.setMode('docker');
            // setMode triggers connect(), but we need to ensure targetContainer is used
            // setMode sets timeout to call connect, so we set property before that.
        } else {
            // Already in docker mode, force reconnect to new target
            this.disconnect();

            // Clear current session ID to start fresh for this container
            // We don't want to append logs to the main session if we switch context
            this.activeSessionId = '';
            // Don't clear sessionStorage yet as that tracks the "default" session

            this.terminal.clear();
            this.terminal.reset();
            if (mode !== 'docker') {
                this.showWelcomeBanner();
            }
            this.terminal.write(`\r\n\x1b[33mConnecting to container: ${containerName}...\x1b[0m\r\n`);

            setTimeout(() => {
                this.connect();
            }, 500);
        }
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
        // Update UI
        // If we are in a specific session view (restored), don't highlight mode buttons
        // as they act as "New Session" buttons in that context.
        const showActive = !this.activeSessionId;
        document.getElementById('localModeBtn').classList.toggle('active', showActive && mode === 'local');
        document.getElementById('dockerModeBtn').classList.toggle('active', showActive && mode === 'docker');

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

    async connect() {
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

        // Get active session ID from storage or previous
        let sessionId = sessionStorage.getItem('activeSessionId') || '';
        if (this.activeSessionId) sessionId = this.activeSessionId; // Prefer memory state if set

        // If resuming a session, fetch session info to get its specific container
        let sessionContainerName = this.targetContainer || '';
        if (sessionId && !sessionContainerName) {
            try {
                const response = await fetch(`/api/sessions/${sessionId}`);
                if (response.ok) {
                    const sessionInfo = await response.json();
                    if (sessionInfo && sessionInfo.container_name) {
                        sessionContainerName = sessionInfo.container_name;
                        console.log('Session container found:', sessionContainerName);
                    }
                    // Update currentSession for UI
                    if (typeof currentSession !== 'undefined') {
                        currentSession = sessionInfo;
                        if (typeof updateSessionUI === 'function') updateSessionUI();
                    }
                }
            } catch (e) {
                console.log('Could not fetch session info:', e);
            }
        }

        let socketURL = `${protocol}//${window.location.host}/ws/terminal?mode=${this.currentMode}&session_id=${sessionId}`;

        // Append specific container target if set (from session or explicit target)
        if (this.currentMode === 'docker' && sessionContainerName) {
            socketURL += `&container=${encodeURIComponent(sessionContainerName)}`;
        }

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

                // If resuming a session WITH session_id in URL, replay history AFTER shell initializes
                // Only replay if session_id was explicitly passed in URL (not auto-created)
                const urlHasSessionId = new URLSearchParams(window.location.search).get('session_id');
                if (urlHasSessionId && sessionId) {
                    setTimeout(() => {
                        this.replaySessionHistory(sessionId);
                    }, 1500); // Wait for shell to finish clear + welcome banner
                }
            };

            this.socket.onmessage = async (event) => {
                // Check if this is still the current connection
                if (currentConnectionId !== this.connectionId) return;

                const data = event.data;

                // Check for control messages (JSON)
                if (typeof data === 'string') {
                    // Try to parse as JSON control message first
                    if (data.startsWith('{')) {
                        try {
                            const msg = JSON.parse(data);
                            if (msg.type === 'session_id') {
                                this.activeSessionId = msg.data;
                                sessionStorage.setItem('activeSessionId', msg.data);

                                // Update current session global
                                if (!currentSession || currentSession.id !== msg.data) {
                                    try {
                                        const r = await fetch(`/api/sessions/${msg.data}`);
                                        if (r.ok) {
                                            currentSession = await r.json();
                                            updateSessionUI();
                                        }
                                    } catch (e) { }
                                }
                                return; // Don't write to terminal
                            }
                        } catch (e) {
                            // Not a valid JSON control message, ignore
                        }
                    }

                    this.terminal.write(data);
                    this.parseOutputForPath(data);
                    this.outputSeen = true;
                } else if (data instanceof ArrayBuffer) {
                    // Binary data is always terminal output
                    this.terminal.write(new Uint8Array(data));
                    const text = new TextDecoder().decode(new Uint8Array(data));
                    this.parseOutputForPath(text);
                    this.outputSeen = true;
                }
            };

            // ... rest of event handlers


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

    // Replay session history with beautiful CYH-themed visual design
    async replaySessionHistory(sessionId) {
        try {
            const response = await fetch(`/api/sessions/${sessionId}/data`);
            if (!response.ok) return;
            const data = await response.json();
            if (!data?.events?.length) {
                console.log('No session history to replay');
                return;
            }

            console.log('Replaying session history with', data.events.length, 'events');

            // Get session info for display
            let sessionName = 'Session';
            let sessionTime = '';
            try {
                const sessResp = await fetch(`/api/sessions/${sessionId}`);
                if (sessResp.ok) {
                    const sessInfo = await sessResp.json();
                    sessionName = sessInfo.name || 'Session';
                    if (sessInfo.created_at) {
                        const d = new Date(sessInfo.created_at);
                        sessionTime = d.toLocaleString();
                    }
                }
            } catch (e) { }

            // Premium CYH-themed Session Restored Banner
            const GREEN = '\x1b[38;2;127;255;0m';
            const BRIGHT_GREEN = '\x1b[38;2;159;255;64m';
            const DARK_GREEN = '\x1b[38;2;95;204;0m';
            const WHITE = '\x1b[1;37m';
            const GRAY = '\x1b[38;5;245m';
            const CYAN = '\x1b[38;5;87m';
            const RESET = '\x1b[0m';

            this.terminal.write('\r\n');
            this.terminal.write(`${GREEN}╔══════════════════════════════════════════════════════════════════════════╗${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}                                                                          ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}   ${BRIGHT_GREEN}██████╗${RESET}  ${BRIGHT_GREEN}███████╗${RESET} ${BRIGHT_GREEN}███████╗${RESET} ${BRIGHT_GREEN}████████╗${RESET} ${BRIGHT_GREEN}██████╗${RESET}  ${BRIGHT_GREEN}██████╗${RESET}  ${BRIGHT_GREEN}███████╗${RESET} ${BRIGHT_GREEN}██████╗${RESET}    ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}   ${BRIGHT_GREEN}██╔══██╗${RESET} ${BRIGHT_GREEN}██╔════╝${RESET} ${BRIGHT_GREEN}██╔════╝${RESET}    ${BRIGHT_GREEN}██╔══╝${RESET}  ${BRIGHT_GREEN}██╔═══██╗${RESET} ${BRIGHT_GREEN}██╔══██╗${RESET} ${BRIGHT_GREEN}██╔════╝${RESET} ${BRIGHT_GREEN}██╔══██╗${RESET}   ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}   ${BRIGHT_GREEN}██████╔╝${RESET} ${BRIGHT_GREEN}█████╗${RESET}   ${BRIGHT_GREEN}███████╗${RESET}    ${BRIGHT_GREEN}██║${RESET}     ${BRIGHT_GREEN}██║   ██║${RESET} ${BRIGHT_GREEN}██████╔╝${RESET} ${BRIGHT_GREEN}█████╗${RESET}   ${BRIGHT_GREEN}██║  ██║${RESET}   ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}   ${BRIGHT_GREEN}██╔══██╗${RESET} ${BRIGHT_GREEN}██╔══╝${RESET}   ${BRIGHT_GREEN}╚════██║${RESET}    ${BRIGHT_GREEN}██║${RESET}     ${BRIGHT_GREEN}██║   ██║${RESET} ${BRIGHT_GREEN}██╔══██╗${RESET} ${BRIGHT_GREEN}██╔══╝${RESET}   ${BRIGHT_GREEN}██║  ██║${RESET}   ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}   ${BRIGHT_GREEN}██║  ██║${RESET} ${BRIGHT_GREEN}███████╗${RESET} ${BRIGHT_GREEN}███████║${RESET}    ${BRIGHT_GREEN}██║${RESET}     ${BRIGHT_GREEN}╚██████╔╝${RESET} ${BRIGHT_GREEN}██║  ██║${RESET} ${BRIGHT_GREEN}███████╗${RESET} ${BRIGHT_GREEN}██████╔╝${RESET}   ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}   ${BRIGHT_GREEN}╚═╝  ╚═╝${RESET} ${BRIGHT_GREEN}╚══════╝${RESET} ${BRIGHT_GREEN}╚══════╝${RESET}    ${BRIGHT_GREEN}╚═╝${RESET}      ${BRIGHT_GREEN}╚═════╝${RESET}  ${BRIGHT_GREEN}╚═╝  ╚═╝${RESET} ${BRIGHT_GREEN}╚══════╝${RESET} ${BRIGHT_GREEN}╚═════╝${RESET}    ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}                                                                          ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}╠══════════════════════════════════════════════════════════════════════════╣${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}  ${CYAN}●${RESET} ${WHITE}Session:${RESET}  ${GRAY}${sessionName.substring(0, 40).padEnd(40)}${RESET}             ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}  ${CYAN}●${RESET} ${WHITE}Time:${RESET}     ${GRAY}${(sessionTime || 'Unknown').padEnd(40)}${RESET}             ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}║${RESET}  ${CYAN}●${RESET} ${WHITE}Events:${RESET}   ${GRAY}${(data.events.length + ' events restored').padEnd(40)}${RESET}             ${GREEN}║${RESET}\r\n`);
            this.terminal.write(`${GREEN}╚══════════════════════════════════════════════════════════════════════════╝${RESET}\r\n`);
            this.terminal.write('\r\n');
            this.terminal.write(`${DARK_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━ ${WHITE}Session History${RESET} ${DARK_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\r\n`);
            this.terminal.write('\r\n');

            // Replay all output events
            for (const event of data.events) {
                if (event.type === 'output' && event.data) {
                    this.terminal.write(event.data);
                }
            }

            // End separator
            this.terminal.write('\r\n');
            this.terminal.write(`${DARK_GREEN}━━━━━━━━━━━━━━━━━━━━━━━ ${WHITE}Session Continues${RESET} ${DARK_GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\r\n`);
            this.terminal.write('\r\n');

            this.outputSeen = true;
        } catch (e) {
            console.error('Session history replay failed:', e);
        }
    }

    async replaySessionFallback(sessionId) {
        // Fallback - just call replaySessionHistory
        await this.replaySessionHistory(sessionId);
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

    setupSidebarResizer() {
        const resizer = document.getElementById('sidebarResizer');
        const sidebar = document.getElementById('sidebar');
        if (!resizer || !sidebar) return;

        let isResizing = false;
        let startX, startWidth;

        const startResize = (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(getComputedStyle(sidebar).width, 10);
            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.classList.add('no-select');

            // Add overlay to prevent iframe stealing mouse events if any
            const overlay = document.createElement('div');
            overlay.id = 'resizeOverlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.zIndex = '9999';
            overlay.style.cursor = 'col-resize';
            document.body.appendChild(overlay);
        };

        const doResize = (e) => {
            if (!isResizing) return;
            // Limit width between 200px and 600px
            const newWidth = Math.max(200, Math.min(600, startWidth + (e.clientX - startX)));
            document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);

            // Trigger terminal resize
            if (this.fitAddon) {
                this.fitTerminal();
            }
        };

        const stopResize = () => {
            if (!isResizing) return;
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.classList.remove('no-select');

            const overlay = document.getElementById('resizeOverlay');
            if (overlay) overlay.remove();

            // Save preference
            localStorage.setItem('sidebarWidth', getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width'));
        };

        resizer.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);

        // Restore saved width
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            document.documentElement.style.setProperty('--sidebar-width', savedWidth);
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

        this.setupSidebarResizer();

        // Mode buttons
        document.getElementById('localModeBtn').addEventListener('click', () => this.setMode('local'));
        document.getElementById('dockerModeBtn').addEventListener('click', () => {
            // If in session view (regardless of current session_id), force redirect to fresh session
            if (window.isSessionView) {
                window.location.href = '/session.html';
            } else {
                this.setMode('docker');
            }
        });

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
            // Check if terminal is focused
            const terminalFocused = document.activeElement?.closest('.xterm') ||
                document.activeElement?.closest('.terminal-body');

            // Block browser shortcuts when terminal is focused
            if (terminalFocused && e.ctrlKey && !e.shiftKey && !e.altKey) {
                const blockedKeys = [
                    'n', // New window
                    't', // New tab
                    'w', // Close tab
                    'r', // Reload (allow Ctrl+R for terminal history search)
                    'p', // Print
                    'f', // Find
                    'g', // Find next
                    'h', // History
                    'j', // Downloads
                    'k', // (varies by browser)
                    'o', // Open file
                    's', // Save
                    'u', // View source
                    'd', // Bookmark
                    'e', // Search bar
                    'b', // Bookmarks bar
                ];

                if (blockedKeys.includes(e.key.toLowerCase())) {
                    e.preventDefault();
                    e.stopPropagation();
                    // Send to terminal as Ctrl+key
                    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                        // Convert to control character (Ctrl+A = \x01, Ctrl+B = \x02, etc.)
                        const charCode = e.key.toLowerCase().charCodeAt(0) - 96;
                        if (charCode > 0 && charCode < 27) {
                            this.socket.send(String.fromCharCode(charCode));
                        }
                    }
                    return false;
                }
            }

            // Also block Ctrl+Shift combinations that browsers use
            if (terminalFocused && e.ctrlKey && e.shiftKey) {
                const blockedShiftKeys = [
                    'n', // New incognito window
                    't', // Reopen closed tab
                    'w', // Close window
                    'p', // Print (Chrome)
                    'i', // DevTools (let this through for debugging)
                    'j', // Downloads
                    'b', // Bookmarks
                    'o', // Bookmark manager
                    'delete', // Clear browsing data
                ];

                // Don't block Ctrl+Shift+C (copy) and Ctrl+Shift+V (paste)
                if (blockedShiftKeys.includes(e.key.toLowerCase()) &&
                    e.key.toLowerCase() !== 'c' && e.key.toLowerCase() !== 'v') {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }

            // Our custom shortcuts (always work)
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

    // ==================== SESSION RECORDING ====================

    startRecording(title = '') {
        if (this.isRecording) return;
        if (this.isPlaying) this.stopPlayback();

        this.isRecording = true;
        this.recordingData = [];
        this.recordingStartTime = Date.now();
        this.recordingTitle = title || `Session ${new Date().toLocaleString()}`;

        this.updateRecordingUI();
        this.terminal.write('\r\n\x1b[38;2;255;71;87m⏺ Recording started...\x1b[0m\r\n');
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        const duration = Date.now() - this.recordingStartTime;

        this.updateRecordingUI();
        this.terminal.write(`\r\n\x1b[38;2;127;255;0m⏹ Recording stopped (${this.formatDuration(duration)})\x1b[0m\r\n`);

        return this.getRecordingData();
    }

    recordEvent(type, data) {
        if (!this.isRecording) return;

        this.recordingData.push({
            t: Date.now() - this.recordingStartTime,
            type: type,
            data: data
        });
    }

    getRecordingData() {
        return {
            version: '1.0',
            metadata: {
                title: this.recordingTitle,
                mode: this.currentMode,
                recordedAt: new Date(this.recordingStartTime).toISOString(),
                duration: Date.now() - this.recordingStartTime
            },
            events: this.recordingData
        };
    }

    exportRecording() {
        const data = this.isRecording ? this.stopRecording() : this.getRecordingData();

        if (!data.events || data.events.length === 0) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ No recording data to export\x1b[0m\r\n');
            return;
        }

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const filename = `cyh-session-${new Date().toISOString().slice(0, 10)}.json`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        this.terminal.write(`\r\n\x1b[38;2;127;255;0m📁 Exported: ${filename}\x1b[0m\r\n`);
    }

    importRecording(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.version && data.events) {
                    this.playbackData = data;
                    this.terminal.write(`\r\n\x1b[38;2;127;255;0m✓ Loaded: "${data.metadata?.title || 'Recording'}" (${this.formatDuration(data.metadata?.duration || 0)})\x1b[0m\r\n`);
                    this.terminal.write('\x1b[38;2;128;128;128mPress Play to start playback\x1b[0m\r\n');
                } else {
                    throw new Error('Invalid format');
                }
            } catch (err) {
                this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ Invalid recording file\x1b[0m\r\n');
            }
        };
        reader.readAsText(file);
    }

    startPlayback() {
        if (!this.playbackData || !this.playbackData.events.length) {
            this.terminal.write('\r\n\x1b[38;2;255;71;87m✗ No recording loaded. Import a .json file first.\x1b[0m\r\n');
            return;
        }

        if (this.isRecording) this.stopRecording();
        if (this.isPlaying && !this.isPaused) return;

        if (this.isPaused) {
            // Resume
            this.isPaused = false;
            this.updatePlaybackUI();
            this.playNextEvent();
            return;
        }

        // Start fresh
        this.isPlaying = true;
        this.isPaused = false;
        this.playbackIndex = 0;

        // Disconnect live terminal during playback
        this.intentionalDisconnect = true;
        this.cleanupSocket();

        this.terminal.clear();
        this.terminal.write(`\x1b[38;2;127;255;0m▶ Playing: "${this.playbackData.metadata?.title || 'Recording'}"\x1b[0m\r\n`);
        this.terminal.write('\x1b[38;2;128;128;128m────────────────────────────────────────\x1b[0m\r\n');

        this.updatePlaybackUI();
        this.playNextEvent();
    }

    playNextEvent() {
        if (!this.isPlaying || this.isPaused) return;
        if (this.playbackIndex >= this.playbackData.events.length) {
            this.stopPlayback();
            return;
        }

        const event = this.playbackData.events[this.playbackIndex];
        const nextEvent = this.playbackData.events[this.playbackIndex + 1];

        // Write output to terminal
        if (event.type === 'output') {
            this.terminal.write(event.data);
        }

        this.playbackIndex++;
        this.updatePlaybackProgress();

        // Schedule next event
        if (nextEvent) {
            const delay = (nextEvent.t - event.t) / this.playbackSpeed;
            // Cap delay to avoid long waits
            const cappedDelay = Math.min(delay, 2000);
            this.playbackTimeout = setTimeout(() => this.playNextEvent(), cappedDelay);
        } else {
            this.stopPlayback();
        }
    }

    pausePlayback() {
        if (!this.isPlaying) return;
        this.isPaused = true;
        if (this.playbackTimeout) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = null;
        }
        this.updatePlaybackUI();
    }

    stopPlayback() {
        this.isPlaying = false;
        this.isPaused = false;
        this.playbackIndex = 0;

        if (this.playbackTimeout) {
            clearTimeout(this.playbackTimeout);
            this.playbackTimeout = null;
        }

        this.updatePlaybackUI();
        this.terminal.write('\r\n\x1b[38;2;128;128;128m────────────────────────────────────────\x1b[0m\r\n');
        this.terminal.write('\x1b[38;2;127;255;0m⏹ Playback ended\x1b[0m\r\n');

        // Reconnect
        this.intentionalDisconnect = false;
        this.connect();
    }

    setPlaybackSpeed(speed) {
        this.playbackSpeed = speed;
        const speedBtn = document.getElementById('playbackSpeedBtn');
        if (speedBtn) speedBtn.textContent = `${speed}x`;
    }

    updateRecordingUI() {
        // Recording UI hidden as per user request
        const recordingIndicator = document.getElementById('recordingIndicator');
        if (recordingIndicator) {
            recordingIndicator.style.display = 'none';
        }
    }

    updatePlaybackUI() {
        const playBtn = document.getElementById('playBtn');
        const playbackControls = document.getElementById('playbackControls');

        if (playBtn) {
            if (this.isPlaying && !this.isPaused) {
                playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
                playBtn.title = 'Pause';
            } else {
                playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>';
                playBtn.title = 'Play';
            }
        }

        if (playbackControls) {
            playbackControls.style.display = this.isPlaying ? 'flex' : 'none';
        }
    }

    updatePlaybackProgress() {
        const progressBar = document.getElementById('playbackProgress');
        const timeDisplay = document.getElementById('playbackTime');

        if (!this.playbackData) return;

        const currentEvent = this.playbackData.events[this.playbackIndex - 1];
        const totalDuration = this.playbackData.metadata?.duration || 0;
        const currentTime = currentEvent?.t || 0;
        const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

        if (progressBar) progressBar.style.width = `${progress}%`;
        if (timeDisplay) {
            timeDisplay.textContent = `${this.formatDuration(currentTime)} / ${this.formatDuration(totalDuration)}`;
        }
    }

    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
}


// Initialize app when DOM is ready
console.log('terminal.app.js loaded successfully');
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired - creating TerminalApp');
    window.terminalApp = new TerminalApp();
    console.log('TerminalApp created');
    if (typeof initMobileEventListeners === 'function') {
        initMobileEventListeners();
    }
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
            reconnectAttempts: window.terminalApp?.reconnectAttempts,
            isRecording: window.terminalApp?.isRecording,
            isPlaying: window.terminalApp?.isPlaying
        };
    },
    switchMode: (mode) => {
        if (mode === 'local' || mode === 'docker') {
            window.terminalApp?.setMode(mode);
            return true;
        }
        return false;
    },
    // Recording API
    startRecording: (title) => window.terminalApp?.startRecording(title),
    stopRecording: () => window.terminalApp?.stopRecording(),
    exportRecording: () => window.terminalApp?.exportRecording(),
    startPlayback: () => window.terminalApp?.startPlayback(),
    pausePlayback: () => window.terminalApp?.pausePlayback(),
    stopPlayback: () => window.terminalApp?.stopPlayback()
};
