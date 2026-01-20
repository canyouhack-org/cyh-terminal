#!/bin/bash

# ============================================
# CYH Terminal - macOS Installation Script
# ============================================
# This script installs all dependencies for
# CYH Terminal on macOS (Intel & Apple Silicon)
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║   ██████╗██╗   ██╗██╗  ██╗    ████████╗███████╗██████╗   ║"
echo "║  ██╔════╝╚██╗ ██╔╝██║  ██║    ╚══██╔══╝██╔════╝██╔══██╗  ║"
echo "║  ██║      ╚████╔╝ ███████║       ██║   █████╗  ██████╔╝  ║"
echo "║  ██║       ╚██╔╝  ██╔══██║       ██║   ██╔══╝  ██╔══██╗  ║"
echo "║  ╚██████╗   ██║   ██║  ██║       ██║   ███████╗██║  ██║  ║"
echo "║   ╚═════╝   ╚═╝   ╚═╝  ╚═╝       ╚═╝   ╚══════╝╚═╝  ╚═╝  ║"
echo "║                                                           ║"
echo "║           macOS Installation Script v1.0                  ║"
echo "║                  canyouhack.org                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running on macOS
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}❌ Error: This script is for macOS only!${NC}"
    echo -e "${YELLOW}   For Linux, use: ./install-ubuntu.sh or ./install-fedora.sh${NC}"
    exit 1
fi

# Detect architecture
ARCH=$(uname -m)
echo -e "${CYAN}📱 Detected Architecture: ${ARCH}${NC}"
if [[ "$ARCH" == "arm64" ]]; then
    echo -e "${GREEN}   ✓ Apple Silicon (M1/M2/M3) detected${NC}"
else
    echo -e "${GREEN}   ✓ Intel Mac detected${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}📦 Step 1: Checking Homebrew...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check and install Homebrew
if ! command -v brew &> /dev/null; then
    echo -e "${YELLOW}⚠️  Homebrew not found. Installing...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for Apple Silicon
    if [[ "$ARCH" == "arm64" ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    echo -e "${GREEN}✅ Homebrew installed successfully!${NC}"
else
    echo -e "${GREEN}✅ Homebrew is already installed${NC}"
    brew update
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}📦 Step 2: Installing Go...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check and install Go
if ! command -v go &> /dev/null; then
    echo -e "${YELLOW}⚠️  Go not found. Installing...${NC}"
    brew install go
    echo -e "${GREEN}✅ Go installed successfully!${NC}"
else
    GO_VERSION=$(go version | awk '{print $3}')
    echo -e "${GREEN}✅ Go is already installed (${GO_VERSION})${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🐳 Step 3: Installing Docker Desktop...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check and install Docker
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker not found. Installing Docker Desktop...${NC}"
    brew install --cask docker
    echo -e "${GREEN}✅ Docker Desktop installed!${NC}"
    echo -e "${YELLOW}📌 Please open Docker Desktop manually for the first time${NC}"
else
    echo -e "${GREEN}✅ Docker is already installed${NC}"
    docker --version
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🔧 Step 4: Installing Additional Tools...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Install git if not present
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}⚠️  Git not found. Installing...${NC}"
    brew install git
    echo -e "${GREEN}✅ Git installed!${NC}"
else
    echo -e "${GREEN}✅ Git is already installed${NC}"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🏗️  Step 5: Building CYH Terminal...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Get the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"

echo -e "${CYAN}   Project directory: $PROJECT_DIR${NC}"

# Build the backend
cd "$BACKEND_DIR"
echo -e "${YELLOW}   Downloading Go modules...${NC}"
go mod tidy
echo -e "${YELLOW}   Building terminal-server...${NC}"
go build -o terminal-server .
chmod +x terminal-server
echo -e "${GREEN}✅ Build complete!${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}📝 Step 6: Creating Launch Scripts...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Create start script for macOS
cat > "$SCRIPT_DIR/start-macos.sh" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR/backend"

# Check if already running
if pgrep -f "terminal-server" > /dev/null; then
    echo "⚠️  CYH Terminal is already running!"
    echo "   Stop it first with: ./stop-macos.sh"
    exit 1
fi

echo "🚀 Starting CYH Terminal..."
nohup ./terminal-server > /dev/null 2>&1 &
sleep 1

if pgrep -f "terminal-server" > /dev/null; then
    echo "✅ CYH Terminal started successfully!"
    echo "🌐 Open: http://localhost:3333"
else
    echo "❌ Failed to start CYH Terminal"
    exit 1
fi
EOF
chmod +x "$SCRIPT_DIR/start-macos.sh"

# Create stop script for macOS
cat > "$SCRIPT_DIR/stop-macos.sh" << 'EOF'
#!/bin/bash
echo "⏹️  Stopping CYH Terminal..."
pkill -f "terminal-server" 2>/dev/null

if pgrep -f "terminal-server" > /dev/null; then
    echo "❌ Failed to stop CYH Terminal"
    exit 1
else
    echo "✅ CYH Terminal stopped"
fi
EOF
chmod +x "$SCRIPT_DIR/stop-macos.sh"

echo -e "${GREEN}✅ Created start-macos.sh and stop-macos.sh${NC}"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}📝 Step 7: Creating LaunchAgent (Auto-Start)...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Create LaunchAgent plist
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_FILE="$LAUNCH_AGENT_DIR/org.canyouhack.terminal.plist"

mkdir -p "$LAUNCH_AGENT_DIR"

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>org.canyouhack.terminal</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BACKEND_DIR/terminal-server</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$BACKEND_DIR</string>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/cyh-terminal.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/cyh-terminal.error.log</string>
</dict>
</plist>
EOF

echo -e "${GREEN}✅ LaunchAgent created at: $PLIST_FILE${NC}"
echo -e "${YELLOW}   To enable auto-start on login:${NC}"
echo -e "${CYAN}   launchctl load $PLIST_FILE${NC}"
echo -e "${YELLOW}   To disable auto-start:${NC}"
echo -e "${CYAN}   launchctl unload $PLIST_FILE${NC}"

echo ""
echo -e "${GREEN}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                                                           ║"
echo "║         🎉 Installation Complete! 🎉                      ║"
echo "║                                                           ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║                                                           ║"
echo "║  📌 Quick Start:                                          ║"
echo "║     cd $(dirname "$SCRIPT_DIR")                           ║"
echo "║     ./scripts/start-macos.sh                              ║"
echo "║                                                           ║"
echo "║  🌐 Then open: http://localhost:3333                      ║"
echo "║                                                           ║"
echo "║  📌 Commands:                                             ║"
echo "║     Start:  ./scripts/start-macos.sh                      ║"
echo "║     Stop:   ./scripts/stop-macos.sh                       ║"
echo "║                                                           ║"
echo "║  🐳 Docker Mode:                                          ║"
echo "║     Make sure Docker Desktop is running!                  ║"
echo "║     Open Docker.app before using Docker Mode              ║"
echo "║                                                           ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Ask user if they want to start now
echo ""
read -p "🚀 Start CYH Terminal now? [y/N]: " START_NOW
if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    "$SCRIPT_DIR/start-macos.sh"
    
    # Open browser
    sleep 2
    open "http://localhost:3333"
fi
