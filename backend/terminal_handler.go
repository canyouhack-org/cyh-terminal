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

	"github.com/creack/pty"
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

	var cmd *exec.Cmd

	// Start the appropriate shell
	if mode == "docker" && dockerMgr.IsReady() {
		log.Printf("Starting CYH Hacking Docker terminal...")
		// Use docker exec with -it for interactive TTY
		// Set PS1 to show canyouhack@root:path format
		cmd = exec.Command("docker", "exec", "-it",
			"-e", "TERM=xterm-256color",
			"-e", "COLORTERM=truecolor",
			"-e", `PS1=\[\e[32m\]canyouhack\[\e[0m\]@\[\e[31m\]root\[\e[0m\]:\[\e[36m\]\w\[\e[0m\]$ `,
			"-w", "/root",
			DockerContainerName,
			"/bin/bash", "--login")
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

	log.Printf("Terminal session started (mode: %s, pid: %d)", mode, cmd.Process.Pid)

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
		log.Printf("Terminal session ended (mode: %s)", mode)
	}

	// PTY -> WebSocket (terminal output to browser)
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
				err = conn.WriteMessage(websocket.BinaryMessage, buf[:n])
				if err != nil {
					return
				}
			}
		}
	}()

	// WebSocket -> PTY (browser input to terminal)
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
								pty.Setsize(ptmx, &pty.Winsize{
									Rows: uint16(rows),
									Cols: uint16(cols),
								})
							}
						}
						continue
					}
				}
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
