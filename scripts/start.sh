#!/bin/bash

# =====================================================
# CYH Terminal - Start Script
# CanYouHack Security Terminal
# =====================================================

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"
PID_FILE="$SCRIPT_DIR/.cyh-terminal.pid"

PORT=3333

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║         CYH Terminal - Starting Server           ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo -e "${YELLOW}! CYH Terminal is already running (PID: $OLD_PID)${NC}"
        echo -e "${CYAN}  Access: http://localhost:$PORT${NC}"
        echo -e "${CYAN}  Stop with: ./scripts/stop.sh${NC}"
        exit 0
    else
        rm -f "$PID_FILE"
    fi
fi

# Check if port is in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${RED}✗ Port $PORT is already in use${NC}"
    echo -e "${YELLOW}  Kill the process using: lsof -ti:$PORT | xargs kill${NC}"
    exit 1
fi

# Check if binary exists
if [ ! -f "$BACKEND_DIR/terminal-server" ]; then
    echo -e "${YELLOW}! Binary not found, building...${NC}"
    cd "$BACKEND_DIR"
    go build -o terminal-server .
    if [ ! -f "terminal-server" ]; then
        echo -e "${RED}✗ Build failed!${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Build successful${NC}"
fi

# Start server
echo -e "${CYAN}Starting server...${NC}"
cd "$BACKEND_DIR"

# Run in background
nohup ./terminal-server > "$SCRIPT_DIR/cyh-terminal.log" 2>&1 &
PID=$!
echo $PID > "$PID_FILE"

# Wait a moment and check if started
sleep 2

if ps -p $PID > /dev/null 2>&1; then
    echo -e "${GREEN}"
    echo "  ╔══════════════════════════════════════════════════╗"
    echo "  ║        ✓ CYH Terminal is running!                ║"
    echo "  ╠══════════════════════════════════════════════════╣"
    echo "  ║  Local:   http://localhost:$PORT                  ║"
    echo "  ║  Mobile:  http://$(hostname -I | awk '{print $1}'):$PORT                    ║"
    echo "  ║  PID:     $PID                                    ║"
    echo "  ╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo -e "${CYAN}  Stop with: ${YELLOW}./scripts/stop.sh${NC}"
    echo -e "${CYAN}  Logs:      ${YELLOW}tail -f $SCRIPT_DIR/cyh-terminal.log${NC}"
else
    echo -e "${RED}✗ Failed to start server${NC}"
    echo -e "${YELLOW}  Check logs: cat $SCRIPT_DIR/cyh-terminal.log${NC}"
    rm -f "$PID_FILE"
    exit 1
fi
