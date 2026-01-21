//go:build windows
// +build windows

package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
	"strings"

	"github.com/UserExistsError/conpty"
	"github.com/gorilla/websocket"
)

type terminalMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
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

	var cmdLine string
	var cwd string

	// Get username from session cookie
	username := "guest"
	if cookie, err := r.Cookie("cyh_session"); err == nil {
		if user, valid := authManager.ValidateSession(cookie.Value); valid {
			username = user
		}
	}

	// Active Session Management (Auto-Create)
	activeSessID := r.URL.Query().Get("session_id")
	var session *TermSession // Keep logic structure consistent

	if activeSessID != "" {
		// Try to resume existing session
		s, err := sessionMgr.GetSession(activeSessID)
		if err != nil {
			log.Printf("Failed to resume session %s: %v", activeSessID, err)
			activeSessID = "" // Create new if not found
		} else {
			session = s
			// Resuming - verify ownership
			if session.User != username {
				activeSessID = "" // Create new if owner mismatch
			}
		}
	}

	if activeSessID == "" {
		// Auto-create new session
		sessName := "Terminal " + time.Now().Format("15:04:05")
		s, err := sessionMgr.CreateSession(username, sessName, mode)
		if err != nil {
			log.Printf("Failed to create session: %v", err)
		} else {
			session = s
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
	}

	// Prepare command line
	if mode == "docker" && dockerMgr.IsReady() {
		log.Printf("Starting CYH Hacking Docker terminal...")
		cmdLine = `docker exec -it -e TERM=xterm-256color -e COLORTERM=truecolor -w /root ` + DockerContainerName + ` /bin/bash --login`
		cwd = ""
	} else {
		log.Printf("Starting local terminal (PowerShell)...")
		cmdLine = "powershell.exe"
		cwd, _ = os.Getwd()
	}

	// Create ConPTY
	cpty, err := conpty.Start(cmdLine, conpty.ConPtyDimensions(120, 30))
	if err != nil {
		log.Printf("Failed to start ConPTY: %v", err)
		conn.WriteMessage(websocket.TextMessage, []byte("Failed to start terminal: "+err.Error()))
		conn.Close()
		return
	}

	_ = cwd // cwd is not used with conpty.Start but kept for future use

	log.Printf("Terminal session started (mode: %s, pid: %d)", mode, cpty.Pid())

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

		if cpty != nil {
			cpty.Close()
		}

		conn.Close()
		log.Printf("Terminal session ended (mode: %s)", mode)
	}

	// ConPTY -> WebSocket (terminal output to browser)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer closeDone()

		buf := make([]byte, 32*1024)
		for {
			n, err := cpty.Read(buf)
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
				err = conn.WriteMessage(websocket.BinaryMessage, buf[:n])
				if err != nil {
					return
				}
				
				// Record event and Broadcast Live
				if activeSessID != "" {
					// Async record
					go sessionMgr.AddEvent(activeSessID, "output", string(buf[:n]))
					
					// Broadcast to live hub (Unconditional for dynamic sharing)
					liveHub.BroadcastOutput(activeSessID, string(buf[:n]))
				}
			}
		}
	}()

	// WebSocket -> ConPTY (browser input to terminal)
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
							if rows > 0 && cols > 0 {
								cpty.Resize(int(cols), int(rows))
								
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

			// Write to ConPTY
			_, err = cpty.Write(data)
			if err != nil {
				return
			}
		}
	}()

	// Wait for process to exit
	go func() {
		exitCode, err := cpty.Wait(context.Background())
		if err != nil {
			log.Printf("Process wait error: %v", err)
		} else {
			log.Printf("Process exited with code: %d", exitCode)
		}
		closeDone()
	}()

	// Wait for goroutines to finish
	wg.Wait()

	// Give a small delay for cleanup
	time.Sleep(100 * time.Millisecond)
	cleanup()
}
