#!/bin/bash

# =====================================================
# CYH Terminal - Stop Script
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
PID_FILE="$SCRIPT_DIR/.cyh-terminal.pid"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║         CYH Terminal - Stopping Server           ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check PID file
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    
    if ps -p "$PID" > /dev/null 2>&1; then
        echo -e "${CYAN}Stopping CYH Terminal (PID: $PID)...${NC}"
        kill "$PID"
        
        # Wait for process to stop
        for i in {1..10}; do
            if ! ps -p "$PID" > /dev/null 2>&1; then
                break
            fi
            sleep 0.5
        done
        
        # Force kill if still running
        if ps -p "$PID" > /dev/null 2>&1; then
            echo -e "${YELLOW}Force stopping...${NC}"
            kill -9 "$PID" 2>/dev/null
        fi
        
        rm -f "$PID_FILE"
        echo -e "${GREEN}✓ CYH Terminal stopped${NC}"
    else
        echo -e "${YELLOW}! Process not running, cleaning up...${NC}"
        rm -f "$PID_FILE"
    fi
else
    # Try to find and kill by port
    PORT=3333
    PID=$(lsof -ti:$PORT 2>/dev/null)
    
    if [ -n "$PID" ]; then
        echo -e "${CYAN}Found process on port $PORT (PID: $PID)${NC}"
        echo -e "${CYAN}Stopping...${NC}"
        kill $PID 2>/dev/null
        sleep 1
        
        if lsof -ti:$PORT >/dev/null 2>&1; then
            kill -9 $PID 2>/dev/null
        fi
        echo -e "${GREEN}✓ CYH Terminal stopped${NC}"
    else
        echo -e "${YELLOW}! CYH Terminal is not running${NC}"
    fi
fi
