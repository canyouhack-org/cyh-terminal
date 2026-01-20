#!/bin/bash

# =====================================================
# CYH Terminal - Ubuntu/Debian Installation Script
# CanYouHack Security Terminal
# Supports: Ubuntu, Debian, Linux Mint, Pop!_OS
# =====================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║    CYH Terminal - Ubuntu/Debian Installer        ║"
echo "  ║            CanYouHack.org                        ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}! Not running as root. Some features may be skipped.${NC}"
    echo -e "${YELLOW}  Run with: sudo ./install-ubuntu.sh${NC}"
    SUDO="sudo"
else
    SUDO=""
    echo -e "${GREEN}✓ Running as root${NC}"
fi

# Detect distro
if [ -f /etc/lsb-release ]; then
    . /etc/lsb-release
    DISTRO=$DISTRIB_ID
    echo -e "${GREEN}✓ Detected: $DISTRIB_ID $DISTRIB_RELEASE${NC}"
elif [ -f /etc/debian_version ]; then
    DISTRO="Debian"
    echo -e "${GREEN}✓ Detected: Debian $(cat /etc/debian_version)${NC}"
else
    echo -e "${YELLOW}! Could not detect Ubuntu/Debian, continuing anyway...${NC}"
    DISTRO="unknown"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"

# Update system
echo -e "\n${CYAN}[1/6] Updating system packages...${NC}"
$SUDO apt-get update -y

# Install essential tools
echo -e "\n${CYAN}[2/6] Installing essential tools...${NC}"
$SUDO apt-get install -y curl wget git lsof ca-certificates gnupg
echo -e "${GREEN}✓ Essential tools installed${NC}"

# Install Go
echo -e "\n${CYAN}[3/6] Installing Go...${NC}"
if command -v go &> /dev/null; then
    GO_VER=$(go version | awk '{print $3}')
    echo -e "${GREEN}✓ Go is already installed: $GO_VER${NC}"
else
    # Try apt first
    $SUDO apt-get install -y golang-go 2>/dev/null || true
    
    if ! command -v go &> /dev/null; then
        # Install from official source
        echo -e "${YELLOW}Installing Go from official source...${NC}"
        GO_VERSION="1.21.5"
        wget -q "https://golang.org/dl/go${GO_VERSION}.linux-amd64.tar.gz" -O /tmp/go.tar.gz
        $SUDO rm -rf /usr/local/go
        $SUDO tar -C /usr/local -xzf /tmp/go.tar.gz
        rm /tmp/go.tar.gz
        
        # Add to PATH
        echo 'export PATH=$PATH:/usr/local/go/bin' | $SUDO tee /etc/profile.d/go.sh
        export PATH=$PATH:/usr/local/go/bin
    fi
    
    if command -v go &> /dev/null; then
        echo -e "${GREEN}✓ Go installed: $(go version | awk '{print $3}')${NC}"
    else
        echo -e "${RED}✗ Failed to install Go${NC}"
        exit 1
    fi
fi

# Install Docker
echo -e "\n${CYAN}[4/6] Installing Docker...${NC}"
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker is already installed${NC}"
else
    # Add Docker's official GPG key
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null || true
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg 2>/dev/null || true

    # Add repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin 2>/dev/null || {
        echo -e "${YELLOW}! Docker CE not available, trying docker.io...${NC}"
        $SUDO apt-get install -y docker.io
    }

    # Start Docker
    $SUDO systemctl start docker 2>/dev/null || true
    $SUDO systemctl enable docker 2>/dev/null || true

    # Add current user to docker group
    if [ -n "$SUDO_USER" ]; then
        $SUDO usermod -aG docker $SUDO_USER 2>/dev/null || true
        echo -e "${GREEN}✓ Added $SUDO_USER to docker group${NC}"
    elif [ -n "$USER" ] && [ "$USER" != "root" ]; then
        $SUDO usermod -aG docker $USER 2>/dev/null || true
    fi

    echo -e "${GREEN}✓ Docker installed${NC}"
fi

# Build backend
echo -e "\n${CYAN}[5/6] Building CYH Terminal...${NC}"
cd "$BACKEND_DIR"

if [ ! -f "go.mod" ]; then
    echo -e "${RED}✗ go.mod not found in backend directory${NC}"
    exit 1
fi

# Ensure Go is in PATH
export PATH=$PATH:/usr/local/go/bin

go build -o terminal-server .

if [ -f "terminal-server" ]; then
    chmod +x terminal-server
    echo -e "${GREEN}✓ Build successful: terminal-server${NC}"
else
    echo -e "${RED}✗ Build failed!${NC}"
    exit 1
fi

# Install systemd service
echo -e "\n${CYAN}[6/6] Installing systemd service...${NC}"
if [ "$EUID" -eq 0 ] || [ -n "$SUDO" ]; then
    $SUDO tee /etc/systemd/system/cyh-terminal.service > /dev/null << EOF
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
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

    $SUDO systemctl daemon-reload
    echo -e "${GREEN}✓ Systemd service installed${NC}"
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

# Get IP address
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_IP")

# Summary
echo -e "\n${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Installation complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e ""
echo -e "${CYAN}Quick Start:${NC}"
echo -e "  ${YELLOW}./scripts/start.sh${NC}"
echo -e ""
echo -e "${CYAN}Enable auto-start on boot:${NC}"
echo -e "  ${YELLOW}sudo systemctl enable cyh-terminal${NC}"
echo -e "  ${YELLOW}sudo systemctl start cyh-terminal${NC}"
echo -e ""
echo -e "${CYAN}Access:${NC}"
echo -e "  Local:  ${YELLOW}http://localhost:3333${NC}"
echo -e "  Mobile: ${YELLOW}http://${IP_ADDR}:3333${NC}"
echo -e ""
echo -e "${CYAN}Firewall (if enabled):${NC}"
echo -e "  ${YELLOW}sudo ufw allow 3333/tcp${NC}"
echo -e ""
echo -e "${CYAN}Visit: ${GREEN}https://canyouhack.org${NC}"

if [ -n "$SUDO_USER" ]; then
    echo -e ""
    echo -e "${YELLOW}NOTE: Log out and back in for docker group changes to take effect${NC}"
fi
