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
							}
						}
						continue
					}
				}
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
