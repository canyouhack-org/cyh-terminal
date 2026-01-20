package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// TerminalMode represents the available terminal modes
type TerminalMode struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Available   bool   `json:"available"`
	Icon        string `json:"icon"`
}

// ContainerInfo represents Docker container info
type ContainerInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	Status  string `json:"status"`
	Created string `json:"created"`
	Ports   string `json:"ports"`
}

// HistoryRequest represents a request to save a command
type HistoryRequest struct {
	Mode    string `json:"mode"`
	Command string `json:"command"`
}

// handleHistoryGet returns command history
func handleHistoryGet(w http.ResponseWriter, r *http.Request) {
	mode := r.URL.Query().Get("mode")
	history := cmdHistory.GetHistory(mode)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(history)
}

// handleHistorySave saves a command to history
func handleHistorySave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req HistoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if err := cmdHistory.AddCommand(req.Mode, req.Command); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "saved"})
}

// handleHistoryClear clears command history
func handleHistoryClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mode := r.URL.Query().Get("mode")
	if err := cmdHistory.ClearHistory(mode); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
}

// GetTerminalModes returns available terminal modes
func handleTerminalModes(w http.ResponseWriter, r *http.Request) {
	modes := []TerminalMode{
		{
			ID:          "local",
			Name:        "Local Shell",
			Description: "Use local system shell (bash/sh)",
			Available:   true,
			Icon:        "💻",
		},
		{
			ID:          "docker",
			Name:        "CYH Hacking Terminal",
			Description: "Professional hacking environment",
			Available:   CheckDockerInstalled() && dockerMgr.IsReady(),
			Icon:        "🔐",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(modes)
}

// GetDockerStatus returns the current Docker build/run status
func handleDockerStatus(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"docker_installed": CheckDockerInstalled(),
		"image_ready":      dockerMgr.imageReady,
		"container_ready":  dockerMgr.containerReady,
		"container_name":   DockerContainerName,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// Rebuild Docker image
func handleDockerRebuild(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	go func() {
		dockerMgr.imageReady = false
		dockerMgr.containerReady = false
		
		if err := dockerMgr.StopContainer(); err != nil {
			log.Printf("Warning: %v", err)
		}
		
		if err := dockerMgr.BuildDockerImage(); err != nil {
			log.Printf("Rebuild failed: %v", err)
			return
		}
		
		if err := dockerMgr.StartContainer(); err != nil {
			log.Printf("Container start failed: %v", err)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "building",
		"message": "CYH Docker image rebuild started",
	})
}

// List all containers
func handleContainerList(w http.ResponseWriter, r *http.Request) {
	if !CheckDockerInstalled() {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]ContainerInfo{})
		return
	}

	// Get all containers (running and stopped)
	cmd := exec.Command("docker", "ps", "-a", "--format", "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.CreatedAt}}|{{.Ports}}")
	output, err := cmd.Output()
	if err != nil {
		http.Error(w, "Failed to list containers", http.StatusInternalServerError)
		return
	}

	containers := []ContainerInfo{}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "|")
		if len(parts) >= 5 {
			ports := ""
			if len(parts) >= 6 {
				ports = parts[5]
			}
			containers = append(containers, ContainerInfo{
				ID:      parts[0],
				Name:    parts[1],
				Image:   parts[2],
				Status:  parts[3],
				Created: parts[4],
				Ports:   ports,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(containers)
}

// Start a container
func handleContainerStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ContainerID string `json:"container_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cmd := exec.Command("docker", "start", req.ContainerID)
	if err := cmd.Run(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "started", "container_id": req.ContainerID})
}

// Stop a container
func handleContainerStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ContainerID string `json:"container_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	cmd := exec.Command("docker", "stop", req.ContainerID)
	if err := cmd.Run(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped", "container_id": req.ContainerID})
}

// Delete a container
func handleContainerDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ContainerID string `json:"container_id"`
		Force       bool   `json:"force"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	args := []string{"rm"}
	if req.Force {
		args = append(args, "-f")
	}
	args = append(args, req.ContainerID)

	cmd := exec.Command("docker", args...)
	if err := cmd.Run(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Update dockerMgr if we deleted the main container
	if req.ContainerID == DockerContainerName {
		dockerMgr.containerReady = false
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted", "container_id": req.ContainerID})
}

// Create a new container from the Ubuntu image
func handleContainerCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
		req.Name = "ubuntu-terminal-" + time.Now().Format("20060102-150405")
	}

	// Check if image exists
	if !dockerMgr.IsDockerImageBuilt() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "Ubuntu image not built yet"})
		return
	}

	cmd := exec.Command("docker", "run",
		"-d",
		"--name", req.Name,
		"--hostname", "canyouhack",
		"-e", "TERM=xterm-256color",
		"-e", "COLORTERM=truecolor",
		"-e", "LANG=en_US.UTF-8",
		"-e", "LC_ALL=en_US.UTF-8",
		DockerImageName,
		"tail", "-f", "/dev/null",
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": string(output)})
		return
	}

	containerID := strings.TrimSpace(string(output))
	if len(containerID) > 12 {
		containerID = containerID[:12]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":       "created",
		"container_id": containerID,
		"name":         req.Name,
	})
}

// Restart the main Ubuntu container
func handleContainerRestart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Stop and start the container
	dockerMgr.containerReady = false
	
	exec.Command("docker", "rm", "-f", DockerContainerName).Run()
	
	if err := dockerMgr.StartContainer(); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "restarted"})
}

func main() {
	mux := http.NewServeMux()

	// Static files for frontend
	fs := http.FileServer(http.Dir("../frontend"))
	mux.Handle("/", fs)

	// API endpoints
	mux.HandleFunc("/api/modes", handleTerminalModes)
	mux.HandleFunc("/api/docker/status", handleDockerStatus)
	mux.HandleFunc("/api/docker/rebuild", handleDockerRebuild)

	// Container management endpoints
	mux.HandleFunc("/api/containers", handleContainerList)
	mux.HandleFunc("/api/containers/start", handleContainerStart)
	mux.HandleFunc("/api/containers/stop", handleContainerStop)
	mux.HandleFunc("/api/containers/delete", handleContainerDelete)
	mux.HandleFunc("/api/containers/create", handleContainerCreate)
	mux.HandleFunc("/api/containers/restart", handleContainerRestart)

	// Command history endpoints
	mux.HandleFunc("/api/history", handleHistoryGet)
	mux.HandleFunc("/api/history/save", handleHistorySave)
	mux.HandleFunc("/api/history/clear", handleHistoryClear)

	// Terminal WebSocket endpoint
	mux.HandleFunc("/ws/terminal", handleTerminal)

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// CORS configuration
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
	})

	handler := c.Handler(mux)

	server := &http.Server{
		Addr:         ":3333",
		Handler:      handler,
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Initialize command history
	if err := cmdHistory.Init(); err != nil {
		log.Printf("⚠️  Failed to initialize command history: %v", err)
	}

	// Initialize Docker in background
	dockerAvailable := InitializeDocker()

	log.Println("╔══════════════════════════════════════════════════════════════╗")
	log.Println("║         >_ CYH | CanYouHack Terminal Server                  ║")
	log.Println("╠══════════════════════════════════════════════════════════════╣")
	log.Println("║  🌐 Server:     http://localhost:3333                        ║")
	log.Println("║  🔌 WebSocket:  ws://localhost:3333/ws/terminal              ║")
	log.Println("╠══════════════════════════════════════════════════════════════╣")
	log.Println("║  📋 Terminal Modes:                                          ║")
	log.Println("║     • CYH Local    - ws://localhost:3333/ws/terminal?mode=local")
	log.Println("║     • CYH Hacking  - ws://localhost:3333/ws/terminal?mode=docker")
	if dockerAvailable {
		log.Println("║  🔐 Docker: Ready (CYH Hacking environment available)        ║")
	} else {
		log.Println("║  ⚠️  Docker: Not installed (only local shell available)       ║")
	}
	log.Println("╚══════════════════════════════════════════════════════════════╝")

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan
		
		log.Println("\n🛑 Shutting down server...")
		
		os.Exit(0)
	}()

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("❌ Could not start server: %s\n", err)
	}
}
