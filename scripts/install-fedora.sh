#!/bin/bash

# =====================================================
# CYH Terminal - Fedora/RHEL Installation Script
# CanYouHack Security Terminal
# Supports: Fedora, RHEL, CentOS, Rocky Linux, AlmaLinux
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
echo "  ║    CYH Terminal - Fedora/RHEL Installer          ║"
echo "  ║            CanYouHack.org                        ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}! Not running as root. Some features may be skipped.${NC}"
    echo -e "${YELLOW}  Run with: sudo ./install-fedora.sh${NC}"
    SUDO=""
else
    SUDO=""
    echo -e "${GREEN}✓ Running as root${NC}"
fi

# Detect distro
if [ -f /etc/fedora-release ]; then
    DISTRO="fedora"
    PKG_MGR="dnf"
    echo -e "${GREEN}✓ Detected: Fedora${NC}"
elif [ -f /etc/redhat-release ]; then
    DISTRO="rhel"
    if command -v dnf &> /dev/null; then
        PKG_MGR="dnf"
    else
        PKG_MGR="yum"
    fi
    echo -e "${GREEN}✓ Detected: RHEL/CentOS/Rocky${NC}"
else
    echo -e "${RED}✗ This script is for Fedora/RHEL-based systems${NC}"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"

# Update system
echo -e "\n${CYAN}[1/6] Updating system packages...${NC}"
$SUDO $PKG_MGR update -y

# Install Go
echo -e "\n${CYAN}[2/6] Installing Go...${NC}"
if command -v go &> /dev/null; then
    echo -e "${GREEN}✓ Go is already installed: $(go version | awk '{print $3}')${NC}"
else
    $SUDO $PKG_MGR install -y golang
    if command -v go &> /dev/null; then
        echo -e "${GREEN}✓ Go installed: $(go version | awk '{print $3}')${NC}"
    else
        echo -e "${RED}✗ Failed to install Go${NC}"
        exit 1
    fi
fi

# Install Docker
echo -e "\n${CYAN}[3/6] Installing Docker...${NC}"
if command -v docker &> /dev/null; then
    echo -e "${GREEN}✓ Docker is already installed${NC}"
else
    # Install Docker on Fedora
    if [ "$DISTRO" = "fedora" ]; then
        $SUDO $PKG_MGR install -y dnf-plugins-core
        $SUDO $PKG_MGR config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo
        $SUDO $PKG_MGR install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    else
        # RHEL/CentOS
        $SUDO $PKG_MGR install -y yum-utils
        $SUDO yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        $SUDO $PKG_MGR install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    fi

    # Start and enable Docker
    $SUDO systemctl start docker
    $SUDO systemctl enable docker

    # Add current user to docker group
    if [ -n "$SUDO_USER" ]; then
        $SUDO usermod -aG docker $SUDO_USER
        echo -e "${GREEN}✓ Added $SUDO_USER to docker group${NC}"
    fi

    echo -e "${GREEN}✓ Docker installed and started${NC}"
fi

# Install additional tools
echo -e "\n${CYAN}[4/6] Installing additional tools...${NC}"
$SUDO $PKG_MGR install -y git curl wget lsof
echo -e "${GREEN}✓ Tools installed${NC}"

# Build backend
echo -e "\n${CYAN}[5/6] Building CYH Terminal...${NC}"
cd "$BACKEND_DIR"

if [ ! -f "go.mod" ]; then
    echo -e "${RED}✗ go.mod not found in backend directory${NC}"
    exit 1
fi

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
if [ "$EUID" -eq 0 ]; then
    cat > /etc/systemd/system/cyh-terminal.service << EOF
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

    systemctl daemon-reload
    echo -e "${GREEN}✓ Systemd service installed${NC}"
else
    echo -e "${YELLOW}! Skipping systemd service (run as root to install)${NC}"
fi

# Make scripts executable
chmod +x "$SCRIPT_DIR"/*.sh 2>/dev/null || true

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
echo -e "  Mobile: ${YELLOW}http://$(hostname -I | awk '{print $1}'):3333${NC}"
echo -e ""
echo -e "${CYAN}Visit: ${GREEN}https://canyouhack.org${NC}"

if [ -n "$SUDO_USER" ]; then
    echo -e ""
    echo -e "${YELLOW}NOTE: Log out and back in for docker group changes to take effect${NC}"
fi
