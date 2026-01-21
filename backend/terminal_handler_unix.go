//go:build !windows
// +build !windows

package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"strings"
	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

type terminalMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// ensureUserContainer makes sure a user-specific container exists and is running
func ensureUserContainer(containerName string) {
	// Check if container is running
	checkCmd := exec.Command("docker", "ps", "-q", "-f", "name=^"+containerName+"$")
	output, _ := checkCmd.Output()
	if len(output) > 0 {
		return // Container is already running
	}

	// Check if container exists but stopped
	checkExistsCmd := exec.Command("docker", "ps", "-aq", "-f", "name=^"+containerName+"$")
	output, _ = checkExistsCmd.Output()
	if len(output) > 0 {
		// Start existing container
		exec.Command("docker", "start", containerName).Run()
		return
	}

	// Create new container for this user
	log.Printf("Creating new container for user: %s", containerName)
	createCmd := exec.Command("docker", "run",
		"-d",
		"--name", containerName,
		"--hostname", "canyouhack",
		"-e", "TERM=xterm-256color",
		"-e", "COLORTERM=truecolor",
		"-e", "LANG=en_US.UTF-8",
		"-e", "LC_ALL=en_US.UTF-8",
		DockerImageName,
		"tail", "-f", "/dev/null",
	)
	createCmd.Run()
}

func legacyContainerName(username string) string {
	if username == "guest" {
		return "cyh_guest_terminal"
	}
	return "cyh_" + username + "_terminal"
}

func handleTerminal(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}

	// Get terminal mode from query parameter
	mode := r.URL.Query().Get("mode")
	if mode == "" {
		mode = "local"
	}

	// Get username from session cookie
	username := "guest"
	if cookie, err := r.Cookie("cyh_session"); err == nil {
		if user, valid := authManager.ValidateSession(cookie.Value); valid {
			username = user
		}
	}

	// Active Session Management (Auto-Create)
	activeSessID := r.URL.Query().Get("session_id")
	var session *TermSession

	if activeSessID != "" {
		// Try to resume existing session
		session, err = sessionMgr.GetSession(activeSessID)
		if err != nil {
			log.Printf("Failed to resume session %s: %v", activeSessID, err)
			activeSessID = "" // Create new if not found
		} else {
			// Resuming - verify ownership
			if session.User != username {
				activeSessID = "" // Create new if owner mismatch
			}
		}
	}

	if activeSessID == "" {
		// Auto-create new session
		sessName := "Terminal " + time.Now().Format("15:04:05")
		session, err = sessionMgr.CreateSession(username, sessName, mode)
		if err != nil {
			log.Printf("Failed to create session: %v", err)
			// Continue without recording if DB fails? Or fail? 
			// Let's continue but warn
		} else {
			activeSessID = session.ID
			// Notify client about new session ID
			conn.WriteJSON(map[string]interface{}{
				"type": "session_id",
				"data": activeSessID,
			})
		}
	} else {
		log.Printf("Resuming session: %s", activeSessID)
		// Notify client about resumed session ID
		conn.WriteJSON(map[string]interface{}{
			"type": "session_id",
			"data": activeSessID,
		})

		// NOTE: Session replay is now handled by the frontend AFTER the shell 
		// initializes and displays its welcome banner. The frontend calls
		// /api/sessions/{id}/data and renders the history after a delay.
		// This prevents the shell's 'clear' command from erasing the replay.
		log.Printf("Session %s will be replayed by frontend after shell init", activeSessID)
	}

	// Track if we're resuming (not creating a new session)
	isResuming := activeSessID != "" && r.URL.Query().Get("session_id") != ""

	var cmd *exec.Cmd

	// Start the appropriate shell
	if mode == "docker" && dockerMgr.IsDockerImageBuilt() {
		// Session-specific container name (fallback to legacy per-user container)
		userContainerName := legacyContainerName(username)
		if session != nil && session.ContainerName != "" {
			userContainerName = session.ContainerName
		}

		// Check if specific container requested
		targetContainer := r.URL.Query().Get("container")
		if targetContainer != "" {
			// Basic security check: ensure it belongs to user (starts with prefix)
			expectedPrefix := containerUserPrefix(username)
			if username == "guest" {
				expectedPrefix = "cyh_guest_"
			}

			// Allow if it matches user prefix OR if it is the expected session container
			if strings.HasPrefix(targetContainer, expectedPrefix) || targetContainer == userContainerName {
				userContainerName = targetContainer
				log.Printf("Connecting to specific container: %s", userContainerName)
				if session != nil && session.ContainerName != userContainerName {
					_ = sessionMgr.SetSessionContainerName(session.ID, userContainerName)
					session.ContainerName = userContainerName
				}
			} else {
				log.Printf("Warning: User %s attempted to access unauthorized container %s", username, targetContainer)
				// Fallback to default or error? Let's fallback to default for safety
			}
		}
		
		log.Printf("Starting CYH Hacking Docker terminal for user: %s (container: %s)", username, userContainerName)
		
		// Ensure user's container exists and is running (idempotent)
		ensureUserContainer(userContainerName)
		
		// Use docker exec with -it for interactive TTY
		// If resuming, add CYH_SKIP_BANNER=1 to skip welcome banner
		dockerArgs := []string{"exec", "-it",
			"-e", "TERM=xterm-256color",
			"-e", "COLORTERM=truecolor",
			"-e", `PS1=\[\e[32m\]canyouhack\[\e[0m\]@\[\e[31m\]root\[\e[0m\]:\[\e[36m\]\w\[\e[0m\]$ `,
		}
		if isResuming {
			dockerArgs = append(dockerArgs, "-e", "CYH_SKIP_BANNER=1")
		}
		dockerArgs = append(dockerArgs, "-w", "/root", userContainerName, "/bin/bash", "--login")
		cmd = exec.Command("docker", dockerArgs...)
	} else {
		log.Printf("Starting local terminal...")
		cmd = exec.Command("/bin/bash", "--login")
	}

	// Set environment
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"LANG=en_US.UTF-8",
		"LC_ALL=en_US.UTF-8",
	)

	// Start with PTY
	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: 30, Cols: 120})
	if err != nil {
		log.Printf("Failed to start PTY: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start terminal"))
		conn.Close()
		return
	}

	log.Printf("Terminal session started (mode: %s, pid: %d, session: %s)", mode, cmd.Process.Pid, activeSessID)

	var wg sync.WaitGroup
	var closeOnce sync.Once
	done := make(chan struct{})

	closeDone := func() {
		closeOnce.Do(func() {
			close(done)
		})
	}

	// Cleanup function
	cleanup := func() {
		closeDone()
		
		if ptmx != nil {
			ptmx.Close()
		}
		
		if cmd != nil && cmd.Process != nil {
			cmd.Process.Signal(syscall.SIGHUP)
			
			// Give it a moment to exit gracefully
			exitChan := make(chan struct{})
			go func() {
				cmd.Wait()
				close(exitChan)
			}()
			
			select {
			case <-exitChan:
				// Process exited
			case <-time.After(500 * time.Millisecond):
				cmd.Process.Kill()
				cmd.Wait()
			}
		}
		
		conn.Close()
		
		// End session recording
		if activeSessID != "" {
			sessionMgr.EndSession(activeSessID)
		}
		
		log.Printf("Terminal session ended (mode: %s)", mode)
	}

	// PTY -> WebSocket (terminal output to browser AND recording)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer closeDone()
		
		buf := make([]byte, 32*1024)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				if err != io.EOF {
					select {
					case <-done:
						// Already closing, ignore error
					default:
						// Unexpected error
					}
				}
				return
			}
			
			if n > 0 {
				data := buf[:n]
				
				// Send to websocket
				err = conn.WriteMessage(websocket.BinaryMessage, data)
				if err != nil {
					return
				}
				
				// Record event
				if activeSessID != "" {
					// Async record to avoid blocking pty
					go sessionMgr.AddEvent(activeSessID, "output", string(data))
					
					// Broadcast if live
					// Broadcast to live hub (it handles existence check efficiently)
					liveHub.BroadcastOutput(activeSessID, string(data))
				}
			}
		}
	}()

	// WebSocket -> PTY (browser input to terminal AND recording)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer closeDone()
		
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				return
			}

			// Check for resize message
			if msgType == websocket.TextMessage {
				var msg terminalMessage
				if json.Unmarshal(data, &msg) == nil {
					if msg.Type == "resize" {
						if sizeData, ok := msg.Data.(map[string]interface{}); ok {
							rows, _ := sizeData["rows"].(float64)
							cols, _ := sizeData["cols"].(float64)
							
							// Apply resize
							if rows > 0 && cols > 0 {
								pty.Setsize(ptmx, &pty.Winsize{
									Rows: uint16(rows),
									Cols: uint16(cols),
								})
								
								// Record resize event
								if activeSessID != "" {
									go sessionMgr.AddEvent(activeSessID, "resize", string(data))
								}
							}
						}
						continue
					}
				}
			}
			
			// Record input event
			if activeSessID != "" {
				go sessionMgr.AddEvent(activeSessID, "input", string(data))
			}

			// Write to PTY
			_, err = ptmx.Write(data)
			if err != nil {
				return
			}
		}
	}()

	// Wait for goroutines to finish
	wg.Wait()
	cleanup()
}
