const sessionParams = new URLSearchParams(window.location.search);
window.CYH_SESSION_ID = sessionParams.get('session_id') || '';
window.CYH_SESSION_VIEW = window.location.pathname.endsWith('/session.html') || Boolean(window.CYH_SESSION_ID);

// =====================================================
// Session Management Functions
// =====================================================

let currentSession = null;
let isSessionShared = false;
let shareToken = null;
let liveSocket = null;
let viewerList = [];

async function initSessionPersistence() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');

    if (sessionId) {
        try {
            const response = await fetch(`/api/sessions/${sessionId}`);
            if (response.ok) {
                currentSession = await response.json();

                // If session is live and we are the owner (which we are if we got the share token via this API)
                if (currentSession.is_live && currentSession.share_token) {
                    isSessionShared = true;
                    shareToken = currentSession.share_token;
                    updateSessionUI();

                    // Reconnect to hub
                    connectToLiveHub();

                    // Fetch initial viewers
                    fetchViewers();

                    showLiveToast('Live session restored', 'info');
                } else {
                    updateSessionUI();
                }
            }
        } catch (e) {
            console.error('Failed to restore session persistence:', e);
        }
    }
}

function openSessionView(sessionId) {
    if (!sessionId) return;
    const url = `/session.html?session_id=${encodeURIComponent(sessionId)}`;

    if (window.CYH_SESSION_VIEW) {
        if (window.CYH_SESSION_ID === sessionId) return;
        window.location.href = url;
        return;
    }

    const win = window.open(url, '_blank');
    if (!win) {
        window.location.href = url;
    }
}

async function createNewSession() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const name = `Session ${dateStr} ${timeStr}`;

    try {
        const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mode: 'docker' })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Server error (${response.status}): ${errText}`);
        }

        const created = await response.json();
        showLiveToast('New session created: ' + name, 'success');
        fetchSessions();
        openSessionView(created.id);
    } catch (e) {
        console.error('Failed to create session:', e);
        alert('Failed to create session: ' + e.message + '\nCheck console for details.');
    }
}

async function endSession() {
    if (!currentSession) return;

    try {
        // Stop recording
        window.terminalApp?.stopRecording();

        // End session on server
        await fetch(`/api/sessions/${currentSession.id}/end`, {
            method: 'POST'
        });

        // Stop sharing if active
        if (isSessionShared) {
            await stopSharing();
        }

        showLiveToast('Session ended', 'info');

        currentSession = null;
        isSessionShared = false;
        shareToken = null;
        viewerList = [];

        updateSessionUI();
        fetchSessions();
    } catch (e) {
        console.error('Failed to end session:', e);
    }
}

async function shareSession() {
    if (!currentSession) {
        alert('Please start a session first');
        return;
    }

    const modal = document.getElementById('containerModal');
    document.getElementById('modalTitle').textContent = 'Share Session Live';
    document.getElementById('modalBody').innerHTML = `
        <div class="form-group">
            <label>Permission Mode</label>
            <select id="sharePermissionMode" style="width: 100%; padding: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-secondary); border-radius: 8px; color: var(--text-primary); margin-top: 8px;">
                <option value="view_only">View Only - Viewers can only watch</option>
                <option value="shared_control">Shared Control - Everyone can type</option>
            </select>
        </div>
        <p style="font-size: 12px; color: var(--text-muted); margin: 12px 0;">
            When shared, others can join via a unique link and watch your terminal in real-time.
        </p>
        <button class="btn-primary" onclick="submitShareSession()" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"></path></svg>
            Generate Share Link
        </button>
    `;
    modal.classList.add('active');
}

async function submitShareSession() {
    const mode = document.getElementById('sharePermissionMode').value;

    try {
        const response = await fetch(`/api/sessions/${currentSession.id}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode, enable: true })
        });

        if (!response.ok) {
            throw new Error('Failed to share session');
        }

        const data = await response.json();
        shareToken = data.share_token;
        isSessionShared = true;

        // Update local permission mode
        if (data.mode) {
            currentSession.permission_mode = data.mode;
        }

        // Connect to live hub as owner
        connectToLiveHub();

        // Close modal and update UI
        closeContainerModal();
        updateSessionUI();

        // Show share link
        const shareUrl = window.location.origin + data.share_url;

        showShareLinkModal(shareUrl);

    } catch (e) {
        console.error('Failed to share session:', e);
        alert('Failed to share session');
    }
}

function showShareLinkModal(url) {
    const modal = document.getElementById('containerModal');
    document.getElementById('modalTitle').textContent = 'Share Link Ready';
    document.getElementById('modalBody').innerHTML = `
        <div style="background: var(--bg-tertiary); padding: 12px; border-radius: 8px; border: 1px solid var(--cyh-green); margin-bottom: 16px;">
            <input type="text" id="shareLinkInput" value="${url}" readonly 
                style="width: 100%; background: transparent; border: none; color: var(--cyh-green); font-family: 'JetBrains Mono', monospace; font-size: 12px;">
        </div>
        <button class="btn-primary" onclick="copyShareLinkFromInput()" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
            Copy Link
        </button>
        <p style="font-size: 11px; color: var(--text-muted); margin-top: 12px; text-align: center;">
            Anyone with this link can watch your terminal live
        </p>
    `;
    modal.classList.add('active');
}

function copyShareLinkFromInput() {
    const input = document.getElementById('shareLinkInput');
    input.select();
    document.execCommand('copy');
    showLiveToast('Link copied to clipboard!', 'success');
    closeContainerModal();
}

function copyShareLink() {
    if (!shareToken) return;

    const url = window.location.origin + '/live/' + shareToken;
    navigator.clipboard.writeText(url).then(() => {
        showLiveToast('Link copied!', 'success');
    });
}

async function stopSharing() {
    if (!currentSession) return;

    try {
        await fetch(`/api/sessions/${currentSession.id}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enable: false })
        });

        // Disconnect from live hub
        if (liveSocket) {
            liveSocket.close();
            liveSocket = null;
        }

        isSessionShared = false;
        shareToken = null;
        viewerList = [];

        updateSessionUI();
        showLiveToast('Live sharing stopped', 'info');
    } catch (e) {
        console.error('Failed to stop sharing:', e);
    }
}

function connectToLiveHub() {
    if (!shareToken) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/live?token=${shareToken}`;

    liveSocket = new WebSocket(wsUrl);

    liveSocket.onopen = () => {
        console.log('Connected to live hub as owner');
    };

    liveSocket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            handleLiveMessage(msg);
        } catch (e) {
            console.error('Failed to parse live message:', e);
        }
    };

    liveSocket.onclose = () => {
        console.log('Disconnected from live hub');
    };
}

function handleLiveMessage(msg) {
    switch (msg.type) {
        case 'viewer_join':
            showLiveToast(`${msg.data.username} joined`, 'viewer-join');
            updateViewerCount(msg.data.count);
            fetchViewers();
            break;

        case 'viewer_leave':
            showLiveToast(`${msg.data.username} left`, 'viewer-leave');
            updateViewerCount(msg.data.count);
            fetchViewers();
            break;

        case 'viewer_count':
            updateViewerCount(msg.data);
            break;

        case 'input':
            // Forward input from viewer to terminal
            if (window.terminalApp?.socket?.readyState === WebSocket.OPEN) {
                window.terminalApp.socket.send(msg.data);
            } else {
                console.warn('Cannot forward live input: terminal socket not ready', window.terminalApp);
            }
            break;
    }
}

function updateViewerCount(count) {
    const countEl = document.getElementById('viewerCount');
    if (countEl) countEl.textContent = count;
}

async function fetchViewers() {
    if (!currentSession) return;

    try {
        const response = await fetch(`/api/sessions/${currentSession.id}/viewers`);
        viewerList = await response.json();
        renderViewerList();
    } catch (e) {
        console.error('Failed to fetch viewers:', e);
    }
}

function renderViewerList() {
    const list = document.getElementById('viewersList');
    if (!list) return;

    if (!viewerList || viewerList.length === 0) {
        list.innerHTML = '';
        return;
    }

    list.innerHTML = viewerList.map(v => {
        let classes = 'viewer-tag';
        let extra = '';

        if (v.is_owner) {
            classes += ' owner';
            extra = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polygon points="5 18 19 18 21 8 18 5 12 9 6 5 3 8 5 18"></polygon></svg>';
        } else if (v.can_write) {
            classes += ' can-write';
            extra = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        }

        const actions = !v.is_owner ? `
            ${v.can_write ?
                `<button class="revoke-btn" onclick="revokePermission('${v.username}')" title="Revoke"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` :
                `<button class="grant-btn" onclick="grantPermission('${v.username}')" title="Grant control"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><polyline points="20 6 9 17 4 12"></polyline></svg></button>`
            }
        ` : '';

        return `<div class="${classes}">${extra} ${v.username} ${actions}</div>`;
    }).join('');
}

async function grantPermission(username) {
    if (!currentSession) return;

    try {
        await fetch(`/api/sessions/${currentSession.id}/permission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'grant', username })
        });
        fetchViewers();
        showLiveToast(`Granted control to ${username}`, 'permission-granted');
    } catch (e) {
        console.error('Failed to grant permission:', e);
    }
}

async function revokePermission(username) {
    if (!currentSession) return;

    try {
        await fetch(`/api/sessions/${currentSession.id}/permission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'revoke', username })
        });
        fetchViewers();
    } catch (e) {
        console.error('Failed to revoke permission:', e);
    }
}



async function changePermissionMode() {
    if (!currentSession) return;

    const mode = document.getElementById('permissionMode').value;

    try {
        await fetch(`/api/sessions/${currentSession.id}/permission`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_mode', mode })
        });
        showLiveToast(`Permission mode: ${mode.replace('_', ' ')}`, 'info');
    } catch (e) {
        console.error('Failed to change permission mode:', e);
    }
}

async function fetchSessions() {
    try {
        const response = await fetch('/api/sessions');
        if (!response.ok) return;

        const sessions = await response.json();
        renderSessionsList(sessions);
    } catch (e) {
        console.error('Failed to fetch sessions:', e);
    }
}

function renderSessionsList(sessions) {
    const list = document.getElementById('sessionsList');
    if (!list) return;

    if (!sessions || sessions.length === 0) {
        list.innerHTML = '<div class="no-sessions">No sessions yet</div>';
        return;
    }

    // Filter out current session so it doesn't show as a duplicate
    const currentId = window.terminalApp?.activeSessionId;
    const filteredSessions = sessions.filter(s => s.id !== currentId);

    if (filteredSessions.length === 0) {
        list.innerHTML = '<div class="no-sessions">No other sessions</div>';
        return;
    }

    list.innerHTML = filteredSessions.slice(0, 10).map(session => {
        const duration = session.duration ? formatSessionDuration(session.duration) : '-';
        const isLive = session.is_live;
        const date = new Date(session.created_at).toLocaleDateString();
        const icon = session.mode === 'docker'
            ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="session-icon-svg"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>` // Shield
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="session-icon-svg"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`; // Terminal

        return `
            <div class="session-item" onclick="resumeSession('${session.id}')">
                <div class="session-icon">${icon}</div>
                <div class="session-details">
                    <div class="session-title">${escapeHtml(session.name)}</div>
                    <div class="session-meta">
                        <span>${date}</span>
                        <span class="session-duration">${duration}</span>
                    </div>
                </div>
                ${isLive ? `<div class="session-live-badge">LIVE</div>` : ''}
                <div class="session-actions">
                    <button class="btn-icon-sm" onclick="event.stopPropagation(); renameSession('${session.id}', '${escapeHtml(session.name).replace(/'/g, "\\'")}')" title="Rename">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="btn-icon-sm" onclick="event.stopPropagation(); deleteSession('${session.id}')" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
                        </svg>
                    </button>
                    <button class="btn-icon-sm" onclick="event.stopPropagation(); playSession('${session.id}')" title="Watch Recording">
                         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <polygon points="5 3 19 12 5 21"></polygon>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

async function resumeSession(id) {
    openSessionView(id);
}

async function renameSession(id, currentName) {
    const newName = prompt('Enter new session name:', currentName);
    if (!newName || newName === currentName) return;

    try {
        const response = await fetch(`/api/sessions/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });

        if (!response.ok) {
            throw new Error('Failed to rename session');
        }

        showLiveToast('Session renamed', 'success');
        fetchSessions(); // Refresh the list
    } catch (e) {
        console.error('Failed to rename session:', e);
        alert('Failed to rename session: ' + e.message);
    }
}

async function playSession(id) {
    try {
        const response = await fetch(`/api/sessions/${id}/data`);
        if (!response.ok) {
            throw new Error('Failed to load session');
        }

        const data = await response.json();

        if (data.events && data.events.length > 0) {
            // Convert to playback format
            window.terminalApp.playbackData = {
                version: '1.0',
                metadata: {
                    title: data.session.name,
                    duration: data.session.duration,
                    createdAt: data.session.created_at
                },
                events: data.events.map(e => ({
                    t: e.timestamp,
                    type: e.type,
                    data: e.data
                }))
            };

            window.terminalApp?.startPlayback();
        } else {
            alert('No events recorded in this session');
        }
    } catch (e) {
        console.error('Failed to play session:', e);
        alert('Failed to load session');
    }
}

async function deleteSession(id) {
    if (!confirm('Delete this session?')) return;

    try {
        await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        fetchSessions();
        showLiveToast('Session deleted', 'info');
    } catch (e) {
        console.error('Failed to delete session:', e);
    }
}

function updateSessionUI() {
    const activeCard = document.getElementById('activeSessionCard');
    const liveCard = document.getElementById('liveViewersCard');
    const nameEl = document.getElementById('activeSessionName');
    const statusEl = document.getElementById('activeSessionStatus');

    if (currentSession) {
        if (activeCard) activeCard.style.display = 'flex';
        if (nameEl) nameEl.textContent = currentSession.name;

        if (statusEl) {
            if (isSessionShared) {
                statusEl.innerHTML = '<span class="live-dot" style="background:#00d9ff;"></span> Live';
                statusEl.className = 'session-status live';
            } else {
                statusEl.innerHTML = '<span class="status-dot online"></span> Ready';
                statusEl.className = 'session-status ready';
            }
        }

        if (isSessionShared && liveCard) {
            liveCard.style.display = 'block';

            // Sync permission mode to UI
            const permSelect = document.getElementById('permissionMode');
            if (permSelect && currentSession.permission_mode) {
                permSelect.value = currentSession.permission_mode;
            }

            fetchViewers();
        } else if (liveCard) {
            liveCard.style.display = 'none';
        }
    } else {
        if (activeCard) activeCard.style.display = 'none';
        if (liveCard) liveCard.style.display = 'none';
    }
}

function formatSessionDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    } else {
        return `${seconds}s`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLiveToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `live-toast ${type}`;

    // Icon mapping
    const icons = {
        'viewer-join': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>', // User
        'viewer-leave': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M16 17l5-5-5-5M21 12H9"></path></svg>', // Exit
        'success': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"></polyline></svg>', // Check
        'info': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>', // Info
        'permission-granted': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"></polyline></svg>',
        'recording': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>'
    };

    const icon = icons[type] || icons['info'];

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span>${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// Initialize sessions on load
document.addEventListener('DOMContentLoaded', () => {
    fetchSessions();
    initSessionPersistence();
});
