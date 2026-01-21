package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	MaxHistoryItems = 500
)

// CommandEntry represents a single command in history
type CommandEntry struct {
	Command   string    `json:"command"`
	Timestamp time.Time `json:"timestamp"`
	Mode      string    `json:"mode"`
}

// UserHistory manages per-user command history
type UserHistory struct {
	Commands []CommandEntry `json:"commands"`
}

// CommandHistory manages persistent command history for all users
type CommandHistory struct {
	mu       sync.RWMutex
	users    map[string]*UserHistory // username -> history
	dataDir  string
}

var cmdHistory = &CommandHistory{
	users: make(map[string]*UserHistory),
}

// getHistoryDir returns the directory for storing history
func getHistoryDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "/tmp"
	}
	return filepath.Join(homeDir, ".cyh_terminal")
}

// Init initializes the command history
func (h *CommandHistory) Init() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.dataDir = getHistoryDir()
	if err := os.MkdirAll(h.dataDir, 0755); err != nil {
		return err
	}

	// Also create users directory
	usersDir := filepath.Join(h.dataDir, "users")
	if err := os.MkdirAll(usersDir, 0755); err != nil {
		return err
	}

	return nil
}

// getUserHistoryPath returns the file path for a user's history
func (h *CommandHistory) getUserHistoryPath(username string) string {
	if username == "" {
		username = "_anonymous"
	}
	return filepath.Join(h.dataDir, "users", username+"_history.json")
}

// loadUserHistory loads history for a specific user
func (h *CommandHistory) loadUserHistory(username string) *UserHistory {
	if uh, exists := h.users[username]; exists {
		return uh
	}

	uh := &UserHistory{
		Commands: []CommandEntry{},
	}

	filePath := h.getUserHistoryPath(username)
	data, err := os.ReadFile(filePath)
	if err == nil {
		json.Unmarshal(data, &uh.Commands)
	}

	h.users[username] = uh
	return uh
}

// saveUserHistory saves history for a specific user
func (h *CommandHistory) saveUserHistory(username string) error {
	uh := h.users[username]
	if uh == nil {
		return nil
	}

	data, err := json.MarshalIndent(uh.Commands, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(h.getUserHistoryPath(username), data, 0644)
}

// AddCommand adds a new command to a user's history
func (h *CommandHistory) AddCommand(username, mode, command string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if command == "" {
		return nil
	}

	uh := h.loadUserHistory(username)

	// Don't add duplicate consecutive commands
	if len(uh.Commands) > 0 && uh.Commands[len(uh.Commands)-1].Command == command {
		return nil
	}

	entry := CommandEntry{
		Command:   command,
		Timestamp: time.Now(),
		Mode:      mode,
	}

	uh.Commands = append(uh.Commands, entry)

	// Trim if too many
	if len(uh.Commands) > MaxHistoryItems {
		uh.Commands = uh.Commands[len(uh.Commands)-MaxHistoryItems:]
	}

	return h.saveUserHistory(username)
}

// GetHistory returns commands for a specific user and mode
func (h *CommandHistory) GetHistory(username, mode string) []CommandEntry {
	h.mu.RLock()
	defer h.mu.RUnlock()

	uh := h.loadUserHistory(username)

	if mode == "" {
		return uh.Commands
	}

	var filtered []CommandEntry
	for _, cmd := range uh.Commands {
		if cmd.Mode == mode {
			filtered = append(filtered, cmd)
		}
	}
	return filtered
}

// ClearHistory clears history for a specific user
func (h *CommandHistory) ClearHistory(username, mode string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	uh := h.loadUserHistory(username)

	if mode == "" {
		uh.Commands = []CommandEntry{}
	} else {
		var kept []CommandEntry
		for _, cmd := range uh.Commands {
			if cmd.Mode != mode {
				kept = append(kept, cmd)
			}
		}
		uh.Commands = kept
	}

	return h.saveUserHistory(username)
}
