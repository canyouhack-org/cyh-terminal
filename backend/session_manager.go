//go:build !windows
// +build !windows

package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Permission modes for live sessions
type PermissionMode string

const (
	PermissionViewOnly      PermissionMode = "view_only"
	PermissionSharedControl PermissionMode = "shared_control"
	PermissionInstructor    PermissionMode = "instructor"
)

// TermSession represents a terminal recording session
type TermSession struct {
	ID             string         `json:"id"`
	User           string         `json:"user"`
	Name           string         `json:"name"`
	Mode           string         `json:"mode"`
	ContainerName  string         `json:"container_name,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	EndedAt        *time.Time     `json:"ended_at,omitempty"`
	Duration       int64          `json:"duration"`
	IsLive         bool           `json:"is_live"`
	ShareToken     string         `json:"share_token,omitempty"`
	PermissionMode PermissionMode `json:"permission_mode"`
	ViewerCount    int            `json:"viewer_count"`
}

// SessionEvent represents a recorded event in a session
type SessionEvent struct {
	Type      string `json:"type"` // "output", "input", "resize"
	Timestamp int64  `json:"timestamp"`
	Data      string `json:"data"`
}

// SessionData represents the full session with events
type SessionData struct {
	Session *TermSession    `json:"session"`
	Events  []*SessionEvent `json:"events"`
}

// SessionManager handles session persistence and live sessions
type SessionManager struct {
	db             *sql.DB
	activeSessions map[string]*ActiveSession
	mu             sync.RWMutex
}

// ActiveSession represents a currently running session
type ActiveSession struct {
	Session      *TermSession
	Events       []*SessionEvent
	StartTime    time.Time
	LastActivity time.Time
	mu           sync.Mutex
}

var sessionMgr *SessionManager

// NewSessionManager creates a new session manager
func NewSessionManager(dbPath string) (*SessionManager, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}

	// Create sessions table
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS term_sessions (
			id TEXT PRIMARY KEY,
			user TEXT NOT NULL,
			name TEXT NOT NULL,
			mode TEXT DEFAULT 'local',
			container_name TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			ended_at DATETIME,
			duration INTEGER DEFAULT 0,
			is_live BOOLEAN DEFAULT 0,
			share_token TEXT UNIQUE,
			permission_mode TEXT DEFAULT 'view_only',
			data BLOB
		);
		CREATE INDEX IF NOT EXISTS idx_term_sessions_user ON term_sessions(user);
		CREATE INDEX IF NOT EXISTS idx_term_sessions_share_token ON term_sessions(share_token);

		CREATE TABLE IF NOT EXISTS terminal_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			data TEXT,
			timestamp INTEGER,
			FOREIGN KEY(session_id) REFERENCES term_sessions(id)
		);
		CREATE INDEX IF NOT EXISTS idx_logs_session ON terminal_logs(session_id);
	`)
	if err != nil {
		return nil, err
	}

	// Backfill schema for existing databases
	_, _ = db.Exec(`ALTER TABLE term_sessions ADD COLUMN container_name TEXT`)

	return &SessionManager{
		db:             db,
		activeSessions: make(map[string]*ActiveSession),
	}, nil
}

// GenerateID generates a random session ID
func GenerateID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// GenerateShareToken generates a unique share token
func GenerateShareToken() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func sanitizeContainerUser(user string) string {
	base := strings.ToLower(user)
	var b strings.Builder
	b.Grow(len(base))
	for _, r := range base {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	safeUser := b.String()
	if safeUser == "" {
		safeUser = "user"
	}
	return safeUser
}

func containerUserPrefix(user string) string {
	return "cyh_" + sanitizeContainerUser(user) + "_"
}

func buildContainerName(user, sessionID string) string {
	return "cyh_" + sanitizeContainerUser(user) + "_sess_" + sessionID
}

// CreateSession creates a new session
func (sm *SessionManager) CreateSession(user, name, mode string) (*TermSession, error) {
	session := &TermSession{
		ID:             GenerateID(),
		User:           user,
		Name:           name,
		Mode:           mode,
		ContainerName:  "",
		CreatedAt:      time.Now(),
		IsLive:         false,
		PermissionMode: PermissionViewOnly,
	}
	if mode == "docker" {
		session.ContainerName = buildContainerName(user, session.ID)
	}

	_, err := sm.db.Exec(`
		INSERT INTO term_sessions (id, user, name, mode, container_name, created_at, permission_mode)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, session.ID, session.User, session.Name, session.Mode, session.ContainerName, session.CreatedAt, session.PermissionMode)

	if err != nil {
		return nil, err
	}

	// Create active session for recording
	sm.mu.Lock()
	sm.activeSessions[session.ID] = &ActiveSession{
		Session:      session,
		Events:       make([]*SessionEvent, 0),
		StartTime:    time.Now(),
		LastActivity: time.Now(),
	}
	sm.mu.Unlock()

	log.Printf("Session created: %s (user: %s, name: %s)", session.ID, user, name)
	return session, nil
}

// SetSessionContainerName updates the container name for a session
func (sm *SessionManager) SetSessionContainerName(id, containerName string) error {
	_, err := sm.db.Exec(`UPDATE term_sessions SET container_name = ? WHERE id = ?`, containerName, id)
	return err
}

// GetSession retrieves a session by ID
func (sm *SessionManager) GetSession(id string) (*TermSession, error) {
	var session TermSession
	var endedAt sql.NullTime
	var shareToken sql.NullString

	err := sm.db.QueryRow(`
		SELECT id, user, name, mode, container_name, created_at, ended_at, duration, is_live, share_token, permission_mode
		FROM term_sessions WHERE id = ?
	`, id).Scan(
		&session.ID, &session.User, &session.Name, &session.Mode, &session.ContainerName,
		&session.CreatedAt, &endedAt, &session.Duration, &session.IsLive,
		&shareToken, &session.PermissionMode,
	)

	if err != nil {
		return nil, err
	}

	if endedAt.Valid {
		session.EndedAt = &endedAt.Time
	}
	if shareToken.Valid {
		session.ShareToken = shareToken.String
	}

	return &session, nil
}

// GetSessionByShareToken retrieves a session by share token
func (sm *SessionManager) GetSessionByShareToken(token string) (*TermSession, error) {
	var session TermSession
	var endedAt sql.NullTime
	var shareToken sql.NullString

	err := sm.db.QueryRow(`
		SELECT id, user, name, mode, container_name, created_at, ended_at, duration, is_live, share_token, permission_mode
		FROM term_sessions WHERE share_token = ?
	`, token).Scan(
		&session.ID, &session.User, &session.Name, &session.Mode, &session.ContainerName,
		&session.CreatedAt, &endedAt, &session.Duration, &session.IsLive,
		&shareToken, &session.PermissionMode,
	)

	if err != nil {
		return nil, err
	}

	if endedAt.Valid {
		session.EndedAt = &endedAt.Time
	}
	if shareToken.Valid {
		session.ShareToken = shareToken.String
	}

	return &session, nil
}

// ListSessions lists all sessions for a user
func (sm *SessionManager) ListSessions(user string) ([]*TermSession, error) {
	rows, err := sm.db.Query(`
		SELECT id, user, name, mode, container_name, created_at, ended_at, duration, is_live, share_token, permission_mode
		FROM term_sessions WHERE user = ?
		ORDER BY created_at DESC
	`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*TermSession
	for rows.Next() {
		var session TermSession
		var endedAt sql.NullTime
		var shareToken sql.NullString

		err := rows.Scan(
			&session.ID, &session.User, &session.Name, &session.Mode, &session.ContainerName,
			&session.CreatedAt, &endedAt, &session.Duration, &session.IsLive,
			&shareToken, &session.PermissionMode,
		)
		if err != nil {
			continue
		}

		if endedAt.Valid {
			session.EndedAt = &endedAt.Time
		}
		if shareToken.Valid {
			session.ShareToken = shareToken.String
		}

		sessions = append(sessions, &session)
	}

	return sessions, nil
}

// GetLastActiveSession retrieves the most recent active session for a user
func (sm *SessionManager) GetLastActiveSession(user string) (*TermSession, error) {
	var session TermSession
	var endedAt sql.NullTime
	var shareToken sql.NullString

	// Find the most recent session that hasn't ended (or even if ended, we might want to restart it?)
	// For "persistence", we want the last session that was created.
	// If we want to strictly find "active" (not ended), we check ended_at IS NULL.
	// Let's get the absolute last session, and if it's ended, we'll see if we should create a new one or revive.
	// For now, let's just get the last session.
	err := sm.db.QueryRow(`
		SELECT id, user, name, mode, container_name, created_at, ended_at, duration, is_live, share_token, permission_mode
		FROM term_sessions 
		WHERE user = ? 
		ORDER BY created_at DESC 
		LIMIT 1
	`, user).Scan(
		&session.ID, &session.User, &session.Name, &session.Mode, &session.ContainerName,
		&session.CreatedAt, &endedAt, &session.Duration, &session.IsLive,
		&shareToken, &session.PermissionMode,
	)

	if err != nil {
		return nil, err
	}

	if endedAt.Valid {
		session.EndedAt = &endedAt.Time
	}
	if shareToken.Valid {
		session.ShareToken = shareToken.String
	}

	return &session, nil
}

// DeleteSession deletes a session
func (sm *SessionManager) DeleteSession(id, user string) error {
	result, err := sm.db.Exec(`DELETE FROM term_sessions WHERE id = ? AND user = ?`, id, user)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return sql.ErrNoRows
	}

	// Remove from active sessions if exists
	sm.mu.Lock()
	delete(sm.activeSessions, id)
	sm.mu.Unlock()

	log.Printf("Session deleted: %s", id)
	return nil
}

// RenameSession updates the name of a session
func (sm *SessionManager) RenameSession(id, user, newName string) error {
	result, err := sm.db.Exec(`UPDATE term_sessions SET name = ? WHERE id = ? AND user = ?`, newName, id, user)
	if err != nil {
		return err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return sql.ErrNoRows
	}

	// Update in memory if exists
	sm.mu.Lock()
	if sess, ok := sm.activeSessions[id]; ok {
		sess.Session.Name = newName
	}
	sm.mu.Unlock()

	log.Printf("Session %s renamed to: %s", id, newName)
	return nil
}

// StartLiveSession enables live sharing for a session
func (sm *SessionManager) StartLiveSession(id string, mode PermissionMode) (string, error) {
	shareToken := GenerateShareToken()

	_, err := sm.db.Exec(`
		UPDATE term_sessions SET is_live = 1, share_token = ?, permission_mode = ?
		WHERE id = ?
	`, shareToken, mode, id)

	if err != nil {
		return "", err
	}

	log.Printf("Live session started: %s (token: %s, mode: %s)", id, shareToken[:8]+"...", mode)
	return shareToken, nil
}

// StopLiveSession disables live sharing
func (sm *SessionManager) StopLiveSession(id string) error {
	_, err := sm.db.Exec(`UPDATE term_sessions SET is_live = 0 WHERE id = ?`, id)
	return err
}

// UpdatePermissionMode updates the permission mode for a session
func (sm *SessionManager) UpdatePermissionMode(id string, mode PermissionMode) error {
	_, err := sm.db.Exec(`UPDATE term_sessions SET permission_mode = ? WHERE id = ?`, mode, id)
	return err
}

// AddEvent adds an event to an active session
func (sm *SessionManager) AddEvent(sessionID string, eventType string, data string) {
	// 1. Write to Database (Persistent Log)
	timestamp := time.Now().UnixMilli()
	_, err := sm.db.Exec(`
		INSERT INTO terminal_logs (session_id, event_type, data, timestamp)
		VALUES (?, ?, ?, ?)
	`, sessionID, eventType, data, timestamp)
	
	if err != nil {
		log.Printf("Failed to write log to DB: %v", err)
	}

	// 2. Update Active Session State (Active Status)
	sm.mu.RLock()
	active, exists := sm.activeSessions[sessionID]
	sm.mu.RUnlock()

	if exists {
		active.mu.Lock()
		active.LastActivity = time.Now()
		// We no longer keep full history in memory to save RAM
		// active.Events = append(active.Events, event) 
		active.mu.Unlock()
	}
}

// EndSession ends a session
func (sm *SessionManager) EndSession(id string) error {
	sm.mu.Lock()
	active, exists := sm.activeSessions[id]
	if !exists {
		sm.mu.Unlock()
		return sql.ErrNoRows
	}
	delete(sm.activeSessions, id)
	sm.mu.Unlock()

	active.mu.Lock()
	defer active.mu.Unlock()

	duration := time.Since(active.StartTime).Milliseconds()
	endedAt := time.Now()

	// Update session metadata
	// Note: We don't save 'data' blob anymore as events are in terminal_logs
	_, err := sm.db.Exec(`
		UPDATE term_sessions SET ended_at = ?, duration = ?, is_live = 0
		WHERE id = ?
	`, endedAt, duration, id)

	if err != nil {
		return err
	}

	log.Printf("Session ended: %s (duration: %dms)", id, duration)
	return nil
}

// GetSessionData retrieves full session data including events
func (sm *SessionManager) GetSessionData(id string) (*SessionData, error) {
	session, err := sm.GetSession(id)
	if err != nil {
		return nil, err
	}

	// Fetch logs from DB
	rows, err := sm.db.Query(`
		SELECT event_type, data, timestamp 
		FROM terminal_logs 
		WHERE session_id = ? 
		ORDER BY timestamp ASC
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*SessionEvent
	for rows.Next() {
		var evtType, data string
		var ts int64
		if err := rows.Scan(&evtType, &data, &ts); err != nil {
			continue
		}
		events = append(events, &SessionEvent{
			Type:      evtType,
			Data:      data,
			Timestamp: ts, // Use absolute timestamp from DB
		})
	}

	// Normalizing timestamps to be relative to start if needed?
	// The frontend might expect relative time.
	// Let's keep them absolute or calculate relative if start time known.
	// For now returning stored timestamp (which is UnixMilli).
	
	// If frontend expects relative to start:
	// But start time is session.CreatedAt?
	// The original implementation used relative to StartTime.
	// To maintain compatibility, let's adjust if we can, but 
	// actually the original AddEvent used: time.Since(active.StartTime).Milliseconds()
	// So it was relative.
	// But our new DB schema stores absolute UnixMilli.
	// We should probably convert back to relative for frontend compatibility 
	// OR update frontend.
	// Let's recalculate relative to first event or session start.
	
	if len(events) > 0 {
		startTs := session.CreatedAt.UnixMilli()
		// Adjust if first event is earlier (clocks are tricky)
		if events[0].Timestamp < startTs {
			startTs = events[0].Timestamp
		}
		
		for _, e := range events {
			rel := e.Timestamp - startTs
			if rel < 0 { rel = 0 }
			e.Timestamp = rel
		}
	}

	return &SessionData{
		Session: session,
		Events:  events,
	}, nil
}

// GetActiveSession returns an active session if it exists
func (sm *SessionManager) GetActiveSession(id string) *ActiveSession {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return sm.activeSessions[id]
}

// IsSessionActive checks if a session is currently active
func (sm *SessionManager) IsSessionActive(id string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	_, exists := sm.activeSessions[id]
	return exists
}

// Close closes the database connection
func (sm *SessionManager) Close() error {
	return sm.db.Close()
}
