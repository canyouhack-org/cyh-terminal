//go:build !windows
// +build !windows

package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// LiveMessage types
const (
	MsgTypeOutput          = "output"
	MsgTypeInput           = "input"
	MsgTypeResize          = "resize"
	MsgTypeViewerJoin      = "viewer_join"
	MsgTypeViewerLeave     = "viewer_leave"
	MsgTypeViewerCount     = "viewer_count"
	MsgTypePermissionReq   = "permission_request"
	MsgTypePermissionGrant = "permission_grant"
	MsgTypePermissionDeny  = "permission_deny"
	MsgTypeChat            = "chat"
)

// LiveMessage represents a message in a live session
type LiveMessage struct {
	Type      string      `json:"type"`
	SessionID string      `json:"session_id"`
	Data      interface{} `json:"data"`
	Sender    string      `json:"sender,omitempty"`
	Timestamp int64       `json:"timestamp"`
}

// LiveViewer represents a viewer in a live session
type LiveViewer struct {
	Conn      *websocket.Conn
	Username  string
	SessionID string
	IsOwner   bool
	CanWrite  bool // Can send input to terminal
	Hub       *LiveHub
	send      chan []byte
	mu        sync.Mutex
}

// LiveRoom represents a live session room
type LiveRoom struct {
	SessionID      string
	Owner          *LiveViewer
	Viewers        map[*LiveViewer]bool
	PermissionMode PermissionMode
	Session        *TermSession
	OutputBuffer   string
	mu             sync.RWMutex
}

// LiveHub manages all live rooms
type LiveHub struct {
	rooms      map[string]*LiveRoom
	register   chan *LiveViewer
	unregister chan *LiveViewer
	broadcast  chan *LiveMessage
	mu         sync.RWMutex
}

var liveHub *LiveHub

// NewLiveHub creates a new live hub
func NewLiveHub() *LiveHub {
	hub := &LiveHub{
		rooms:      make(map[string]*LiveRoom),
		register:   make(chan *LiveViewer, 256),
		unregister: make(chan *LiveViewer, 256),
		broadcast:  make(chan *LiveMessage, 1024),
	}
	go hub.run()
	return hub
}

// run handles hub events
func (h *LiveHub) run() {
	for {
		select {
		case viewer := <-h.register:
			h.handleRegister(viewer)
		case viewer := <-h.unregister:
			h.handleUnregister(viewer)
		case msg := <-h.broadcast:
			h.handleBroadcast(msg)
		}
	}
}

func (h *LiveHub) handleRegister(viewer *LiveViewer) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, exists := h.rooms[viewer.SessionID]
	if !exists {
		// Create new room
		session, err := sessionMgr.GetSession(viewer.SessionID)
		if err != nil {
			log.Printf("Failed to get session for room: %v", err)
			return
		}

		room = &LiveRoom{
			SessionID:      viewer.SessionID,
			Viewers:        make(map[*LiveViewer]bool),
			PermissionMode: session.PermissionMode,
			Session:        session,
		}
		h.rooms[viewer.SessionID] = room
	}

	room.mu.Lock()
	if viewer.IsOwner {
		room.Owner = viewer
		viewer.CanWrite = true
	} else {
		// Set write permission based on mode
		switch room.PermissionMode {
		case PermissionViewOnly:
			viewer.CanWrite = false
		case PermissionSharedControl:
			viewer.CanWrite = true
		case PermissionInstructor:
			viewer.CanWrite = false // Will be granted by owner
		}
	}
	room.Viewers[viewer] = true
	viewerCount := len(room.Viewers)
	room.mu.Unlock()

	log.Printf("Viewer joined room %s: %s (owner: %v, canWrite: %v)",
		viewer.SessionID, viewer.Username, viewer.IsOwner, viewer.CanWrite)

	// If viewer has write permission (e.g. Shared Control), notify them immediately
	if viewer.CanWrite {
		msg := &LiveMessage{
			Type:      MsgTypePermissionGrant,
			SessionID: viewer.SessionID,
			Data: map[string]interface{}{
				"username": viewer.Username,
			},
			Timestamp: time.Now().UnixMilli(),
		}
		data, _ := json.Marshal(msg)
		select {
		case viewer.send <- data:
		default:
		}
	}

	// Send initial buffer (Fix for race condition)
	if len(room.OutputBuffer) > 0 {
		msg := &LiveMessage{
			Type:      MsgTypeOutput,
			SessionID: viewer.SessionID,
			Data:      room.OutputBuffer,
			Timestamp: time.Now().UnixMilli(),
		}
		data, _ := json.Marshal(msg)
		select {
		case viewer.send <- data:
		default:
		}
	}

	// Notify all viewers about new viewer
	h.broadcast <- &LiveMessage{
		Type:      MsgTypeViewerJoin,
		SessionID: viewer.SessionID,
		Data: map[string]interface{}{
			"username": viewer.Username,
			"count":    viewerCount,
		},
		Timestamp: time.Now().UnixMilli(),
	}
}

func (h *LiveHub) handleUnregister(viewer *LiveViewer) {
	h.mu.Lock()
	defer h.mu.Unlock()

	room, exists := h.rooms[viewer.SessionID]
	if !exists {
		return
	}

	room.mu.Lock()
	delete(room.Viewers, viewer)
	if room.Owner == viewer {
		room.Owner = nil
	}
	viewerCount := len(room.Viewers)
	room.mu.Unlock()

	close(viewer.send)

	log.Printf("Viewer left room %s: %s (remaining: %d)",
		viewer.SessionID, viewer.Username, viewerCount)

	if viewerCount == 0 {
		// Remove empty room
		delete(h.rooms, viewer.SessionID)
		log.Printf("Room closed: %s", viewer.SessionID)
	} else {
		// Notify remaining viewers
		h.broadcast <- &LiveMessage{
			Type:      MsgTypeViewerLeave,
			SessionID: viewer.SessionID,
			Data: map[string]interface{}{
				"username": viewer.Username,
				"count":    viewerCount,
			},
			Timestamp: time.Now().UnixMilli(),
		}
	}
}

func (h *LiveHub) handleBroadcast(msg *LiveMessage) {
	h.mu.RLock()
	room, exists := h.rooms[msg.SessionID]
	h.mu.RUnlock()

	if !exists {
		return
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	room.mu.RLock()
	for viewer := range room.Viewers {
		select {
		case viewer.send <- data:
		default:
			// Buffer full, skip
		}
	}
	room.mu.RUnlock()
}

// GetRoom returns a room by session ID
func (h *LiveHub) GetRoom(sessionID string) *LiveRoom {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.rooms[sessionID]
}

// GetViewerCount returns the number of viewers in a room
func (h *LiveHub) GetViewerCount(sessionID string) int {
	h.mu.RLock()
	room, exists := h.rooms[sessionID]
	h.mu.RUnlock()

	if !exists {
		return 0
	}

	room.mu.RLock()
	defer room.mu.RUnlock()
	return len(room.Viewers)
}

// BroadcastOutput sends terminal output to all viewers
// BroadcastOutput sends terminal output to all viewers
func (h *LiveHub) BroadcastOutput(sessionID string, data string) {
	h.mu.RLock()
	room, exists := h.rooms[sessionID]
	h.mu.RUnlock()

	if !exists {
		return
	}

	// Create JSON message once
	msg := &LiveMessage{
		Type:      MsgTypeOutput,
		SessionID: sessionID,
		Data:      data,
		Timestamp: time.Now().UnixMilli(),
	}
	jsonMsg, err := json.Marshal(msg)
	if err != nil {
		return
	}

	// Lock room for broadcasting and buffer update
	room.mu.Lock()
	// Update buffer efficiently
	room.OutputBuffer += data
	if len(room.OutputBuffer) > 50000 { // Keep last 50KB
		room.OutputBuffer = room.OutputBuffer[len(room.OutputBuffer)-50000:]
	}

	// Direct broadcast to viewers (skips main hub channel)
	for viewer := range room.Viewers {
		select {
		case viewer.send <- jsonMsg:
		default:
			// Buffer full, skip to avoid blocking the hub/session
		}
	}
	room.mu.Unlock()
}

// GrantPermission grants write permission to a viewer
func (h *LiveHub) GrantPermission(sessionID string, username string) bool {
	h.mu.RLock()
	room, exists := h.rooms[sessionID]
	h.mu.RUnlock()

	if !exists {
		return false
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	for viewer := range room.Viewers {
		if viewer.Username == username {
			viewer.CanWrite = true

			// Notify the viewer
			msg := &LiveMessage{
				Type:      MsgTypePermissionGrant,
				SessionID: sessionID,
				Data: map[string]interface{}{
					"username": username,
				},
				Timestamp: time.Now().UnixMilli(),
			}
			data, _ := json.Marshal(msg)
			select {
			case viewer.send <- data:
			default:
			}
			return true
		}
	}
	return false
}

// RevokePermission revokes write permission from a viewer
func (h *LiveHub) RevokePermission(sessionID string, username string) bool {
	h.mu.RLock()
	room, exists := h.rooms[sessionID]
	h.mu.RUnlock()

	if !exists {
		return false
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	for viewer := range room.Viewers {
		if viewer.Username == username && !viewer.IsOwner {
			viewer.CanWrite = false

			// Notify the viewer
			msg := &LiveMessage{
				Type:      MsgTypePermissionDeny,
				SessionID: sessionID,
				Data: map[string]interface{}{
					"username": username,
				},
				Timestamp: time.Now().UnixMilli(),
			}
			data, _ := json.Marshal(msg)
			select {
			case viewer.send <- data:
			default:
			}
			return true
		}
	}
	return false
}

// UpdatePermissionMode updates the permission mode for a room
func (h *LiveHub) UpdatePermissionMode(sessionID string, mode PermissionMode) {
	h.mu.Lock()
	room, exists := h.rooms[sessionID]
	if !exists {
		room = &LiveRoom{
			SessionID:      sessionID,
			Viewers:        make(map[*LiveViewer]bool),
			PermissionMode: mode,
		}
		h.rooms[sessionID] = room
	}
	h.mu.Unlock()

	room.mu.Lock()
	room.PermissionMode = mode

	// Update all viewers' permissions
	for viewer := range room.Viewers {
		if viewer.IsOwner {
			continue
		}

		switch mode {
		case PermissionViewOnly:
			viewer.CanWrite = false
		case PermissionSharedControl:
			viewer.CanWrite = true
		case PermissionInstructor:
			viewer.CanWrite = false
		}
	}
	room.mu.Unlock()

	// Broadcast mode change
	h.broadcast <- &LiveMessage{
		Type:      "permission_mode_change",
		SessionID: sessionID,
		Data: map[string]interface{}{
			"mode": mode,
		},
		Timestamp: time.Now().UnixMilli(),
	}
}

// WritePump handles sending messages to the viewer
func (v *LiveViewer) WritePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		v.Conn.Close()
	}()

	for {
		select {
		case message, ok := <-v.send:
			if !ok {
				v.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			v.mu.Lock()
			err := v.Conn.WriteMessage(websocket.TextMessage, message)
			v.mu.Unlock()

			if err != nil {
				return
			}

		case <-ticker.C:
			v.mu.Lock()
			err := v.Conn.WriteMessage(websocket.PingMessage, nil)
			v.mu.Unlock()

			if err != nil {
				return
			}
		}
	}
}

// ReadPump handles reading messages from the viewer
func (v *LiveViewer) ReadPump(inputChan chan<- []byte) {
	defer func() {
		v.Hub.unregister <- v
		v.Conn.Close()
	}()

	for {
		_, data, err := v.Conn.ReadMessage()
		if err != nil {
			return
		}

		var msg LiveMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case MsgTypeInput:
			// Forward to owner if viewer has write permission
			if v.CanWrite {
				room := v.Hub.GetRoom(v.SessionID)
				if room != nil && room.Owner != nil {
					// Forward input message to owner
					fwdMsg := &LiveMessage{
						Type:      MsgTypeInput,
						SessionID: v.SessionID,
						Data:      msg.Data,
						Sender:    v.Username,
						Timestamp: time.Now().UnixMilli(),
					}
					data, _ := json.Marshal(fwdMsg)
					select {
					case room.Owner.send <- data:
					default:
					}
				}
			}

		case MsgTypePermissionReq:
			// Forward permission request to owner
			room := v.Hub.GetRoom(v.SessionID)
			if room != nil && room.Owner != nil {
				reqMsg := &LiveMessage{
					Type:      MsgTypePermissionReq,
					SessionID: v.SessionID,
					Data: map[string]interface{}{
						"username": v.Username,
					},
					Sender:    v.Username,
					Timestamp: time.Now().UnixMilli(),
				}
				msgData, _ := json.Marshal(reqMsg)
				select {
				case room.Owner.send <- msgData:
				default:
				}
			}

		case MsgTypePermissionGrant:
			if v.IsOwner {
				if grantData, ok := msg.Data.(map[string]interface{}); ok {
					if username, ok := grantData["username"].(string); ok {
						v.Hub.GrantPermission(v.SessionID, username)
					}
				}
			}

		case MsgTypePermissionDeny:
			if v.IsOwner {
				if denyData, ok := msg.Data.(map[string]interface{}); ok {
					if username, ok := denyData["username"].(string); ok {
						v.Hub.RevokePermission(v.SessionID, username)
					}
				}
			}

		case MsgTypeChat:
			// Broadcast chat message to all viewers
			v.Hub.broadcast <- &LiveMessage{
				Type:      MsgTypeChat,
				SessionID: v.SessionID,
				Data:      msg.Data,
				Sender:    v.Username,
				Timestamp: time.Now().UnixMilli(),
			}
		}
	}
}

// GetViewerList returns list of viewers in a room
func (h *LiveHub) GetViewerList(sessionID string) []map[string]interface{} {
	h.mu.RLock()
	room, exists := h.rooms[sessionID]
	h.mu.RUnlock()

	if !exists {
		return nil
	}

	room.mu.RLock()
	defer room.mu.RUnlock()

	viewers := make([]map[string]interface{}, 0, len(room.Viewers))
	for viewer := range room.Viewers {
		viewers = append(viewers, map[string]interface{}{
			"username":  viewer.Username,
			"is_owner":  viewer.IsOwner,
			"can_write": viewer.CanWrite,
		})
	}

	return viewers
}
