package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	HistoryFileName = "history.json"
	MaxHistoryItems = 500
)

// CommandEntry represents a single command in history
type CommandEntry struct {
	Command   string    `json:"command"`
	Timestamp time.Time `json:"timestamp"`
	Mode      string    `json:"mode"`
}

// CommandHistory manages persistent command history
type CommandHistory struct {
	mu       sync.RWMutex
	Commands []CommandEntry `json:"commands"`
	filePath string
}

var cmdHistory = &CommandHistory{}

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

	dir := getHistoryDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	h.filePath = filepath.Join(dir, HistoryFileName)
	h.Commands = []CommandEntry{}

	// Load existing history
	return h.loadFromFile()
}

// loadFromFile loads history from disk
func (h *CommandHistory) loadFromFile() error {
	data, err := os.ReadFile(h.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No history yet
		}
		return err
	}

	return json.Unmarshal(data, &h.Commands)
}

// saveToFile saves history to disk
func (h *CommandHistory) saveToFile() error {
	data, err := json.MarshalIndent(h.Commands, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(h.filePath, data, 0644)
}

// AddCommand adds a new command to history
func (h *CommandHistory) AddCommand(mode, command string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Don't add empty or duplicate consecutive commands
	if command == "" {
		return nil
	}
	if len(h.Commands) > 0 && h.Commands[len(h.Commands)-1].Command == command {
		return nil
	}

	entry := CommandEntry{
		Command:   command,
		Timestamp: time.Now(),
		Mode:      mode,
	}

	h.Commands = append(h.Commands, entry)

	// Trim if too many
	if len(h.Commands) > MaxHistoryItems {
		h.Commands = h.Commands[len(h.Commands)-MaxHistoryItems:]
	}

	return h.saveToFile()
}

// GetHistory returns commands for a specific mode
func (h *CommandHistory) GetHistory(mode string) []CommandEntry {
	h.mu.RLock()
	defer h.mu.RUnlock()

	if mode == "" {
		return h.Commands
	}

	var filtered []CommandEntry
	for _, cmd := range h.Commands {
		if cmd.Mode == mode {
			filtered = append(filtered, cmd)
		}
	}
	return filtered
}

// ClearHistory clears all history
func (h *CommandHistory) ClearHistory(mode string) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	if mode == "" {
		h.Commands = []CommandEntry{}
	} else {
		var kept []CommandEntry
		for _, cmd := range h.Commands {
			if cmd.Mode != mode {
				kept = append(kept, cmd)
			}
		}
		h.Commands = kept
	}

	return h.saveToFile()
}
