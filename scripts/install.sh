#!/bin/bash

# =====================================================
# CYH Terminal - Installation Script
# CanYouHack Security Terminal
# =====================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║       CYH Terminal Installation Script           ║"
echo "  ║            CanYouHack.org                        ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root for systemd installation
INSTALL_SERVICE=false
if [ "$EUID" -eq 0 ]; then
    INSTALL_SERVICE=true
    echo -e "${GREEN}✓ Running as root - systemd service will be installed${NC}"
else
    echo -e "${YELLOW}! Not running as root - systemd service will be skipped${NC}"
    echo -e "${YELLOW}  Run with sudo to enable auto-start on boot${NC}"
fi

# Check for Go
echo -e "\n${CYAN}[1/5] Checking Go installation...${NC}"
if command -v go &> /dev/null; then
    GO_VERSION=$(go version | awk '{print $3}')
    echo -e "${GREEN}✓ Go is installed: $GO_VERSION${NC}"
else
    echo -e "${RED}✗ Go is not installed!${NC}"
    echo -e "${YELLOW}  Please install Go from https://golang.org/dl/${NC}"
    exit 1
fi

# Check for Docker (optional)
echo -e "\n${CYAN}[2/5] Checking Docker installation...${NC}"
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | awk '{print $3}')
    echo -e "${GREEN}✓ Docker is installed: $DOCKER_VERSION${NC}"
else
    echo -e "${YELLOW}! Docker is not installed${NC}"
    echo -e "${YELLOW}  Docker mode will be unavailable${NC}"
fi

# Build backend
echo -e "\n${CYAN}[3/5] Building backend server...${NC}"
cd "$BACKEND_DIR"

if [ ! -f "go.mod" ]; then
    echo -e "${RED}✗ go.mod not found in backend directory${NC}"
    exit 1
fi

echo "Building binary..."
go build -o terminal-server .

if [ -f "terminal-server" ]; then
    echo -e "${GREEN}✓ Backend built successfully: terminal-server${NC}"
    chmod +x terminal-server
else
    echo -e "${RED}✗ Build failed!${NC}"
    exit 1
fi

# Make scripts executable
echo -e "\n${CYAN}[4/5] Setting up scripts...${NC}"
chmod +x "$SCRIPT_DIR/install.sh"
chmod +x "$SCRIPT_DIR/start.sh"
chmod +x "$SCRIPT_DIR/stop.sh"
echo -e "${GREEN}✓ Scripts are executable${NC}"

# Install systemd service (if root)
echo -e "\n${CYAN}[5/5] Configuring system service...${NC}"
if [ "$INSTALL_SERVICE" = true ]; then
    # Update service file with correct paths
    SERVICE_FILE="$SCRIPT_DIR/cyh-terminal.service"
    
    # Create service with correct paths
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=CYH Terminal - CanYouHack Security Terminal
Documentation=https://canyouhack.org
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
ExecStart=$BACKEND_DIR/terminal-server
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=false
ProtectSystem=false
ProtectHome=false

[Install]
WantedBy=multi-user.target
EOF

    # Copy service file
    cp "$SERVICE_FILE" /etc/systemd/system/cyh-terminal.service
    
    # Reload systemd
    systemctl daemon-reload
    
    echo -e "${GREEN}✓ Systemd service installed${NC}"
    echo -e "${CYAN}  Enable auto-start: ${NC}sudo systemctl enable cyh-terminal"
    echo -e "${CYAN}  Start service:     ${NC}sudo systemctl start cyh-terminal"
    echo -e "${CYAN}  Check status:      ${NC}sudo systemctl status cyh-terminal"
else
    echo -e "${YELLOW}! Systemd service not installed (run as root to install)${NC}"
fi

# Summary
echo -e "\n${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Installation complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e ""
echo -e "${CYAN}Quick Start:${NC}"
echo -e "  Manual start:     ${YELLOW}./scripts/start.sh${NC}"
echo -e "  Manual stop:      ${YELLOW}./scripts/stop.sh${NC}"
echo -e ""
echo -e "${CYAN}Access Terminal:${NC}"
echo -e "  Local:            ${YELLOW}http://localhost:3333${NC}"
echo -e "  Mobile:           ${YELLOW}http://YOUR_IP:3333${NC}"
echo -e ""
if [ "$INSTALL_SERVICE" = true ]; then
    echo -e "${CYAN}Auto-start on boot:${NC}"
    echo -e "  ${YELLOW}sudo systemctl enable cyh-terminal${NC}"
fi
echo -e ""
echo -e "${CYAN}Visit: ${GREEN}https://canyouhack.org${NC}"
