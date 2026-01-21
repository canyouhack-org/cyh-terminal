//go:build !windows
// +build !windows

package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
)

// Session API handlers

// handleSessions handles listing and creating sessions
func handleSessions(w http.ResponseWriter, r *http.Request) {
	// Get username from session
	username := ""
	if cookie, err := r.Cookie("cyh_session"); err == nil {
		if user, valid := authManager.ValidateSession(cookie.Value); valid {
			username = user
		}
	}

	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		// List sessions
		sessions, err := sessionMgr.ListSessions(username)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Add viewer counts for live sessions
		for _, s := range sessions {
			if s.IsLive {
				s.ViewerCount = liveHub.GetViewerCount(s.ID)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(sessions)

	case http.MethodPost:
		// Create new session
		var req struct {
			Name string `json:"name"`
			Mode string `json:"mode"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.Name == "" {
			req.Name = "Session " + GenerateID()[:6]
		}
		if req.Mode == "" {
			req.Mode = "docker" // Default to docker as per user request
		}

		session, err := sessionMgr.CreateSession(username, req.Name, req.Mode)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleSessionByID handles individual session operations
func handleSessionByID(w http.ResponseWriter, r *http.Request) {
	// Get session ID from path: /api/sessions/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "Session ID required", http.StatusBadRequest)
		return
	}
	sessionID := parts[0]

	// Get username from session
	username := ""
	if cookie, err := r.Cookie("cyh_session"); err == nil {
		if user, valid := authManager.ValidateSession(cookie.Value); valid {
			username = user
		}
	}

	// Handle sub-paths
	if len(parts) > 1 {
		switch parts[1] {
		case "share":
			handleSessionShare(w, r, sessionID, username)
			return
		case "end":
			handleSessionEnd(w, r, sessionID, username)
			return
		case "data":
			handleSessionData(w, r, sessionID, username)
			return
		case "permission":
			handleSessionPermission(w, r, sessionID, username)
			return
		case "viewers":
			handleSessionViewers(w, r, sessionID, username)
			return
		}
	}

	switch r.Method {
	case http.MethodGet:
		session, err := sessionMgr.GetSession(sessionID)
		if err != nil {
			http.Error(w, "Session not found", http.StatusNotFound)
			return
		}

		// Check ownership
		if session.User != username {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}

		if session.IsLive {
			session.ViewerCount = liveHub.GetViewerCount(sessionID)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(session)

	case http.MethodDelete:
		if username == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if err := sessionMgr.DeleteSession(sessionID, username); err != nil {
			http.Error(w, "Session not found or access denied", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})

	case http.MethodPatch:
		// Rename session
		if username == "" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		if req.Name == "" {
			http.Error(w, "Name is required", http.StatusBadRequest)
			return
		}

		if err := sessionMgr.RenameSession(sessionID, username, req.Name); err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "renamed", "name": req.Name})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleSessionLast retrieves the most recent active session
func handleSessionLast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	username := ""
	if cookie, err := r.Cookie("cyh_session"); err == nil {
		if user, valid := authManager.ValidateSession(cookie.Value); valid {
			username = user
		}
	}

	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := sessionMgr.GetLastActiveSession(username)
	if err != nil {
		// No session found is not an error, just return empty/null
		if err == sql.ErrNoRows {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(nil)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(session)
}

// handleSessionShare enables live sharing for a session
func handleSessionShare(w http.ResponseWriter, r *http.Request, sessionID, username string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := sessionMgr.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.User != username {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		Mode   string `json:"mode"` // view_only, shared_control, instructor
		Enable bool   `json:"enable"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Enable {
		permMode := PermissionViewOnly
		switch req.Mode {
		case "shared_control":
			permMode = PermissionSharedControl
		case "instructor":
			permMode = PermissionInstructor
		}

		shareToken, err := sessionMgr.StartLiveSession(sessionID, permMode)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Ensure LiveHub has correct mode (Fix for input not working)
		liveHub.UpdatePermissionMode(sessionID, permMode)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "live",
			"share_token": shareToken,
			"share_url":   "/live/" + shareToken,
			"mode":        permMode,
		})
	} else {
		if err := sessionMgr.StopLiveSession(sessionID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
	}
}

// handleSessionEnd ends a recording session
func handleSessionEnd(w http.ResponseWriter, r *http.Request, sessionID, username string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := sessionMgr.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.User != username {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	if err := sessionMgr.EndSession(sessionID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ended"})
}

// handleSessionData returns full session data with events
func handleSessionData(w http.ResponseWriter, r *http.Request, sessionID, username string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	session, err := sessionMgr.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	// Check access: owner or via share token
	if session.User != username {
		// Check if session is shared
		if !session.IsLive {
			http.Error(w, "Access denied", http.StatusForbidden)
			return
		}
	}

	data, err := sessionMgr.GetSessionData(sessionID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// handleSessionPermission handles permission mode changes and grants
func handleSessionPermission(w http.ResponseWriter, r *http.Request, sessionID, username string) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if username == "" {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	session, err := sessionMgr.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.User != username {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	var req struct {
		Action   string `json:"action"` // set_mode, grant, revoke
		Mode     string `json:"mode,omitempty"`
		Username string `json:"username,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	switch req.Action {
	case "set_mode":
		var permMode PermissionMode
		switch req.Mode {
		case "view_only":
			permMode = PermissionViewOnly
		case "shared_control":
			permMode = PermissionSharedControl
		case "instructor":
			permMode = PermissionInstructor
		default:
			http.Error(w, "Invalid permission mode", http.StatusBadRequest)
			return
		}

		sessionMgr.UpdatePermissionMode(sessionID, permMode)
		liveHub.UpdatePermissionMode(sessionID, permMode)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "updated", "mode": req.Mode})

	case "grant":
		if req.Username == "" {
			http.Error(w, "Username required", http.StatusBadRequest)
			return
		}
		liveHub.GrantPermission(sessionID, req.Username)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "granted"})

	case "revoke":
		if req.Username == "" {
			http.Error(w, "Username required", http.StatusBadRequest)
			return
		}
		liveHub.RevokePermission(sessionID, req.Username)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "revoked"})

	default:
		http.Error(w, "Invalid action", http.StatusBadRequest)
	}
}

// handleSessionViewers returns list of viewers for a live session
func handleSessionViewers(w http.ResponseWriter, r *http.Request, sessionID, username string) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	session, err := sessionMgr.GetSession(sessionID)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if session.User != username {
		http.Error(w, "Access denied", http.StatusForbidden)
		return
	}

	viewers := liveHub.GetViewerList(sessionID)
	if viewers == nil {
		viewers = []map[string]interface{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(viewers)
}

// handleJoinLiveSession handles joining a live session via share token
func handleJoinLiveSession(w http.ResponseWriter, r *http.Request) {
	// Get share token from path: /api/live/{token}
	path := strings.TrimPrefix(r.URL.Path, "/api/live/")
	shareToken := strings.Split(path, "/")[0]

	if shareToken == "" {
		http.Error(w, "Share token required", http.StatusBadRequest)
		return
	}

	session, err := sessionMgr.GetSessionByShareToken(shareToken)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if !session.IsLive {
		http.Error(w, "Session is not live", http.StatusGone)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"session_id":      session.ID,
		"name":            session.Name,
		"owner":           session.User,
		"permission_mode": session.PermissionMode,
		"viewer_count":    liveHub.GetViewerCount(session.ID),
	})
}

// handleLiveWebSocket handles WebSocket connections for live viewing
func handleLiveWebSocket(w http.ResponseWriter, r *http.Request) {
	// Get share token from query
	shareToken := r.URL.Query().Get("token")
	if shareToken == "" {
		http.Error(w, "Share token required", http.StatusBadRequest)
		return
	}

	session, err := sessionMgr.GetSessionByShareToken(shareToken)
	if err != nil {
		http.Error(w, "Session not found", http.StatusNotFound)
		return
	}

	if !session.IsLive {
		http.Error(w, "Session is not live", http.StatusGone)
		return
	}

	// Ensure room exists with correct mode (Fix for race condition)
	liveHub.UpdatePermissionMode(session.ID, PermissionMode(session.PermissionMode))

	// Get viewer username
	username := "guest_" + GenerateID()[:6]
	if cookie, err := r.Cookie("cyh_session"); err == nil {
		if user, valid := authManager.ValidateSession(cookie.Value); valid {
			username = user
		}
	}

	// Check if this is the owner
	isOwner := username == session.User

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	viewer := &LiveViewer{
		Conn:      conn,
		Username:  username,
		SessionID: session.ID,
		IsOwner:   isOwner,
		Hub:       liveHub,
		send:      make(chan []byte, 2048),
	}

	liveHub.register <- viewer

	// Start reader and writer goroutines
	go viewer.WritePump()
	go viewer.ReadPump(nil) // No input channel for viewers (handled via permission)
}
