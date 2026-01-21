package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"golang.org/x/crypto/bcrypt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// User represents a registered user
type User struct {
	Username     string    `json:"username"`
	PasswordHash string    `json:"password_hash"`
	CreatedAt    time.Time `json:"created_at"`
}

// Session represents an active session
type Session struct {
	Token     string    `json:"token"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

// AuthConfig represents authentication settings
type AuthConfig struct {
	Enabled bool `json:"enabled"`
}

// AuthManager manages authentication
type AuthManager struct {
	mu       sync.RWMutex
	users    map[string]User
	sessions map[string]Session
	config   AuthConfig
	dataDir  string
}

var authManager = &AuthManager{
	users:    make(map[string]User),
	sessions: make(map[string]Session),
}

// Init initializes the auth manager
func (am *AuthManager) Init() error {
	am.mu.Lock()
	defer am.mu.Unlock()

	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "/tmp"
	}
	am.dataDir = filepath.Join(homeDir, ".cyh_terminal")

	if err := os.MkdirAll(am.dataDir, 0755); err != nil {
		return err
	}

	// Load users
	am.loadUsers()
	// Load sessions
	am.loadSessions()
	// Load config
	am.loadConfig()

	return nil
}

func (am *AuthManager) loadUsers() {
	data, err := os.ReadFile(filepath.Join(am.dataDir, "users.json"))
	if err != nil {
		return
	}
	var users []User
	if err := json.Unmarshal(data, &users); err != nil {
		return
	}
	for _, u := range users {
		am.users[u.Username] = u
	}
}

func (am *AuthManager) saveUsers() error {
	var users []User
	for _, u := range am.users {
		users = append(users, u)
	}
	data, err := json.MarshalIndent(users, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(am.dataDir, "users.json"), data, 0644)
}

func (am *AuthManager) loadSessions() {
	data, err := os.ReadFile(filepath.Join(am.dataDir, "sessions.json"))
	if err != nil {
		return
	}
	var sessions []Session
	if err := json.Unmarshal(data, &sessions); err != nil {
		return
	}
	for _, s := range sessions {
		// Only load valid sessions
		if time.Now().Before(s.ExpiresAt) {
			am.sessions[s.Token] = s
		}
	}
}

func (am *AuthManager) saveSessions() error {
	var sessions []Session
	for _, s := range am.sessions {
		if time.Now().Before(s.ExpiresAt) {
			sessions = append(sessions, s)
		}
	}
	data, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(am.dataDir, "sessions.json"), data, 0644)
}

func (am *AuthManager) loadConfig() {
	data, err := os.ReadFile(filepath.Join(am.dataDir, "auth_config.json"))
	if err != nil {
		am.config = AuthConfig{Enabled: true} // Always enabled by default
		return
	}
	json.Unmarshal(data, &am.config)
}

func (am *AuthManager) saveConfig() error {
	data, err := json.MarshalIndent(am.config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(am.dataDir, "auth_config.json"), data, 0644)
}

// CreateUser creates a new user
func (am *AuthManager) CreateUser(username, password string) error {
	am.mu.Lock()
	defer am.mu.Unlock()

	if _, exists := am.users[username]; exists {
		return &AuthError{Message: "User already exists"}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	am.users[username] = User{
		Username:     username,
		PasswordHash: string(hash),
		CreatedAt:    time.Now(),
	}

	return am.saveUsers()
}

// ValidateUser validates username and password
func (am *AuthManager) ValidateUser(username, password string) bool {
	am.mu.RLock()
	defer am.mu.RUnlock()

	user, exists := am.users[username]
	if !exists {
		return false
	}

	err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password))
	return err == nil
}

// CreateSession creates a new session
func (am *AuthManager) CreateSession(username string) string {
	am.mu.Lock()
	defer am.mu.Unlock()

	token := generateToken()
	am.sessions[token] = Session{
		Token:     token,
		Username:  username,
		CreatedAt: time.Now(),
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour), // 7 days
	}

	am.saveSessions()
	return token
}

// ValidateSession validates a session token
func (am *AuthManager) ValidateSession(token string) (string, bool) {
	am.mu.RLock()
	defer am.mu.RUnlock()

	session, exists := am.sessions[token]
	if !exists {
		return "", false
	}

	if time.Now().After(session.ExpiresAt) {
		delete(am.sessions, token)
		return "", false
	}

	return session.Username, true
}

// DeleteSession deletes a session
func (am *AuthManager) DeleteSession(token string) {
	am.mu.Lock()
	defer am.mu.Unlock()
	delete(am.sessions, token)
	am.saveSessions()
}

// IsEnabled returns if auth is enabled
func (am *AuthManager) IsEnabled() bool {
	am.mu.RLock()
	defer am.mu.RUnlock()
	return am.config.Enabled
}

// SetEnabled sets auth enabled state
func (am *AuthManager) SetEnabled(enabled bool) error {
	am.mu.Lock()
	defer am.mu.Unlock()
	am.config.Enabled = enabled
	return am.saveConfig()
}

// HasUsers returns if there are any registered users
func (am *AuthManager) HasUsers() bool {
	am.mu.RLock()
	defer am.mu.RUnlock()
	return len(am.users) > 0
}

// AuthError represents an authentication error
type AuthError struct {
	Message string
}

func (e *AuthError) Error() string {
	return e.Message
}

func generateToken() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// HTTP Handlers

func handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if !authManager.ValidateUser(req.Username, req.Password) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "Invalid credentials"})
		return
	}

	token := authManager.CreateSession(req.Username)

	// Set cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "cyh_session",
		Value:    token,
		Path:     "/",
		MaxAge:   604800, // 7 days
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"username": req.Username,
	})
}

func handleAuthSignup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if len(req.Username) < 3 || len(req.Password) < 4 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Username must be at least 3 chars, password at least 4"})
		return
	}

	if err := authManager.CreateUser(req.Username, req.Password); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Auto-login after signup
	token := authManager.CreateSession(req.Username)
	http.SetCookie(w, &http.Cookie{
		Name:     "cyh_session",
		Value:    token,
		Path:     "/",
		MaxAge:   604800, // 7 days
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"username": req.Username,
	})
}

func handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cookie, err := r.Cookie("cyh_session")
	if err == nil {
		authManager.DeleteSession(cookie.Value)
	}

	// Clear cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "cyh_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "logged_out"})
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"auth_enabled": authManager.IsEnabled(),
		"has_users":    authManager.HasUsers(),
		"logged_in":    false,
		"username":     "",
	}

	cookie, err := r.Cookie("cyh_session")
	if err == nil {
		if username, valid := authManager.ValidateSession(cookie.Value); valid {
			response["logged_in"] = true
			response["username"] = username
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func handleAuthSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{
			"enabled": authManager.IsEnabled(),
		})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			Enabled bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if err := authManager.SetEnabled(req.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"enabled": req.Enabled,
		})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// AuthMiddleware checks authentication for protected routes
func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth check for auth endpoints, static files, and status endpoints
		path := r.URL.Path
		if path == "/login.html" || path == "/signup.html" ||
			path == "/api/auth/login" || path == "/api/auth/signup" ||
			path == "/api/auth/status" || path == "/api/auth/settings" ||
			path == "/api/docker/status" || path == "/api/modes" ||
			path == "/styles.css" || path == "/favicon.ico" || path == "/terminal.js" ||
			path == "/live.html" || strings.HasPrefix(path, "/live/") ||
			strings.HasPrefix(path, "/api/live/") || path == "/ws/live" {
			next.ServeHTTP(w, r)
			return
		}

		// If auth is not enabled, allow all
		if !authManager.IsEnabled() {
			next.ServeHTTP(w, r)
			return
		}

		// Check session
		cookie, err := r.Cookie("cyh_session")
		if err != nil {
			// Redirect to login for HTML pages
			if path == "/" || path == "/index.html" {
				http.Redirect(w, r, "/login.html", http.StatusFound)
				return
			}
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		if _, valid := authManager.ValidateSession(cookie.Value); !valid {
			if path == "/" || path == "/index.html" {
				http.Redirect(w, r, "/login.html", http.StatusFound)
				return
			}
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
