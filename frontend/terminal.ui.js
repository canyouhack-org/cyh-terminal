














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

// Global functions for UI buttons
function toggleRecording() {
    if (window.terminalApp?.isRecording) {
        window.terminalApp.stopRecording();
    } else {
        window.terminalApp?.startRecording();
    }
}

async function exportRecording() {
    // Prefer local recording export if available
    if (window.terminalApp?.recordingData?.length > 0 || window.terminalApp?.isRecording) {
        window.terminalApp.exportRecording();
        return;
    }

    if (!window.terminalApp?.activeSessionId) {
        alert('No active session or local recording to export.');
        return;
    }

    try {
        const id = window.terminalApp.activeSessionId;
        const response = await fetch(`/api/sessions/${id}/data`);
        if (!response.ok) throw new Error('Failed to download session');

        const data = await response.json();

        // Convert to export format
        const exportData = {
            version: '1.0',
            metadata: {
                title: data.session.name,
                duration: data.session.duration,
                createdAt: data.session.created_at,
                mode: data.session.mode
            },
            events: data.events.map(e => ({
                t: e.timestamp,
                type: e.type,
                data: e.data
            }))
        };

        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const filename = `cyh-session-${id}-${new Date().toISOString().slice(0, 10)}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

    } catch (e) {
        console.error('Export failed:', e);
        alert('Failed to export session');
    }
}

function importRecording() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            window.terminalApp?.importRecording(file);
        }
    };
    input.click();
}

function togglePlayback() {
    if (window.terminalApp?.isPlaying && !window.terminalApp?.isPaused) {
        window.terminalApp.pausePlayback();
    } else {
        window.terminalApp?.startPlayback();
    }
}

function stopPlayback() {
    window.terminalApp?.stopPlayback();
}

function cyclePlaybackSpeed() {
    const speeds = [0.5, 1, 1.5, 2, 4];
    const current = window.terminalApp?.playbackSpeed || 1;
    const idx = speeds.indexOf(current);
    const next = speeds[(idx + 1) % speeds.length];
    window.terminalApp?.setPlaybackSpeed(next);
}

window.connectToContainer = (name) => window.terminalApp.connectToContainer(name);
