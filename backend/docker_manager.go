package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DockerImageName     = "canyouhack-terminal"
	DockerContainerName = "canyouhack-terminal-instance"
)

type DockerManager struct {
	mu             sync.Mutex
	imageReady     bool
	containerReady bool
	buildLog       strings.Builder
}

var dockerMgr = &DockerManager{}

// CheckDockerInstalled verifies if Docker is available on the system
func CheckDockerInstalled() bool {
	cmd := exec.Command("docker", "version")
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// GetPlatform returns the current operating system
func GetPlatform() string {
	switch {
	case isWindows():
		return "windows"
	case isLinux():
		return "linux"
	case isMacOS():
		return "darwin"
	default:
		return "unknown"
	}
}

func isWindows() bool {
	return os.Getenv("OS") == "Windows_NT" || strings.Contains(strings.ToLower(os.Getenv("COMSPEC")), "cmd")
}

func isLinux() bool {
	if _, err := os.Stat("/proc/version"); err == nil {
		return true
	}
	return false
}

func isMacOS() bool {
	if _, err := os.Stat("/System/Library/CoreServices"); err == nil {
		return true
	}
	return false
}

// InstallDockerLinux installs Docker on Linux systems
func InstallDockerLinux() error {
	log.Println("🐳 Attempting to install Docker on Linux...")

	// Check if running as root or with sudo
	if os.Geteuid() != 0 {
		log.Println("⚠️  Docker installation requires root privileges. Please run with sudo or install Docker manually.")
		return fmt.Errorf("root privileges required")
	}

	// Install script for common Linux distros
	script := `#!/bin/bash
set -e
# Update package index
apt-get update -y || yum update -y || dnf update -y 2>/dev/null

# Install Docker
if command -v apt-get &> /dev/null; then
    apt-get install -y docker.io docker-compose
    systemctl start docker
    systemctl enable docker
elif command -v yum &> /dev/null; then
    yum install -y docker docker-compose
    systemctl start docker
    systemctl enable docker
elif command -v dnf &> /dev/null; then
    dnf install -y docker docker-compose
    systemctl start docker
    systemctl enable docker
elif command -v pacman &> /dev/null; then
    pacman -Sy --noconfirm docker docker-compose
    systemctl start docker
    systemctl enable docker
else
    echo "Unknown package manager"
    exit 1
fi
`
	// Write install script
	tmpFile, err := os.CreateTemp("", "docker_install_*.sh")
	if err != nil {
		return fmt.Errorf("failed to create temp script: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(script); err != nil {
		return fmt.Errorf("failed to write script: %w", err)
	}
	tmpFile.Close()

	os.Chmod(tmpFile.Name(), 0755)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "bash", tmpFile.Name())
	cmd.Stdout = &logWriter{prefix: "[DOCKER INSTALL] "}
	cmd.Stderr = &logWriter{prefix: "[DOCKER INSTALL] "}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to install Docker: %w", err)
	}

	log.Println("✅ Docker installed successfully on Linux!")
	return nil
}

// InstallDockerWindows provides instructions for Windows Docker installation
func InstallDockerWindows() error {
	log.Println("🐳 Docker installation on Windows...")
	log.Println("📋 Windows Docker Desktop installation requires manual steps:")
	log.Println("   1. Download Docker Desktop from https://www.docker.com/products/docker-desktop")
	log.Println("   2. Run the installer")
	log.Println("   3. Restart your computer if prompted")
	log.Println("   4. Start Docker Desktop")

	// Try to open Docker download page
	cmd := exec.Command("cmd", "/c", "start", "https://www.docker.com/products/docker-desktop")
	cmd.Run()

	return fmt.Errorf("manual installation required - opening Docker download page")
}

// TryInstallDocker attempts to install Docker based on the platform
func TryInstallDocker() bool {
	platform := GetPlatform()
	log.Printf("🔍 Detected platform: %s", platform)

	var err error
	switch platform {
	case "linux":
		err = InstallDockerLinux()
	case "windows":
		err = InstallDockerWindows()
	default:
		log.Printf("⚠️  Docker auto-install not supported on %s. Please install manually.", platform)
		return false
	}

	if err != nil {
		log.Printf("⚠️  Docker installation failed: %v", err)
		return false
	}

	// Verify installation
	if CheckDockerInstalled() {
		log.Println("✅ Docker is now available!")
		return true
	}

	return false
}

// IsDockerImageBuilt checks if the Ubuntu image already exists
func (dm *DockerManager) IsDockerImageBuilt() bool {
	cmd := exec.Command("docker", "images", "-q", DockerImageName)
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) != ""
}

// IsContainerRunning checks if the container is already running
func (dm *DockerManager) IsContainerRunning() bool {
	cmd := exec.Command("docker", "ps", "-q", "-f", fmt.Sprintf("name=^%s$", DockerContainerName))
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) != ""
}

// IsContainerExists checks if the container exists (running or stopped)
func (dm *DockerManager) IsContainerExists() bool {
	cmd := exec.Command("docker", "ps", "-aq", "-f", fmt.Sprintf("name=^%s$", DockerContainerName))
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) != ""
}

// BuildDockerImage builds the Ubuntu Linux image
func (dm *DockerManager) BuildDockerImage() error {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	if dm.imageReady {
		return nil
	}

	// Find Dockerfile path
	execPath, err := os.Executable()
	if err != nil {
		execPath = "."
	}
	dockerDir := filepath.Join(filepath.Dir(execPath), "..", "docker")
	
	// Check if Dockerfile exists in relative path
	if _, err := os.Stat(filepath.Join(dockerDir, "Dockerfile")); os.IsNotExist(err) {
		// Try current directory structure
		dockerDir = "../docker"
		if _, err := os.Stat(filepath.Join(dockerDir, "Dockerfile")); os.IsNotExist(err) {
			return fmt.Errorf("Dockerfile not found")
		}
	}

	log.Println("🐧 Building Ubuntu Docker image... This may take a few minutes.")
	dm.buildLog.Reset()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", "build", "-t", DockerImageName, dockerDir)
	cmd.Stdout = &logWriter{prefix: "[DOCKER BUILD] "}
	cmd.Stderr = &logWriter{prefix: "[DOCKER BUILD] "}

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to build Docker image: %w", err)
	}

	dm.imageReady = true
	log.Println("✅ Ubuntu Docker image built successfully!")
	return nil
}

// StartContainer starts the Ubuntu container
func (dm *DockerManager) StartContainer() error {
	// Check if container is already running
	if dm.IsContainerRunning() {
		log.Println("✅ Ubuntu container already running.")
		dm.containerReady = true
		return nil
	}

	// Check if container exists but stopped - just start it
	if dm.IsContainerExists() {
		log.Println("🔄 Starting existing Ubuntu container...")
		cmd := exec.Command("docker", "start", DockerContainerName)
		if err := cmd.Run(); err != nil {
			// If start fails, remove and recreate
			exec.Command("docker", "rm", "-f", DockerContainerName).Run()
		} else {
			dm.containerReady = true
			log.Println("✅ CYH container started!")
			return nil
		}
	}

	log.Println("🚀 Creating new CYH Hacking container...")

	cmd := exec.Command("docker", "run",
		"-d",
		"--name", DockerContainerName,
		"--hostname", "canyouhack",
		"-e", "TERM=xterm-256color",
		"-e", "COLORTERM=truecolor",
		"-e", "LANG=en_US.UTF-8",
		"-e", "LC_ALL=en_US.UTF-8",
		DockerImageName,
		"tail", "-f", "/dev/null", // Keep container running
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Docker run error: %s", string(output))
		return fmt.Errorf("failed to start container: %w", err)
	}

	dm.containerReady = true
	log.Println("✅ CYH Hacking container created and started!")
	return nil
}

// StopContainer stops and removes the container
func (dm *DockerManager) StopContainer() error {
	log.Println("🛑 Stopping CYH container...")
	cmd := exec.Command("docker", "rm", "-f", DockerContainerName)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to stop container: %w", err)
	}
	dm.containerReady = false
	log.Println("✅ Container stopped!")
	return nil
}

// GetContainerName returns the container name for exec
func (dm *DockerManager) GetContainerName() string {
	return DockerContainerName
}

// IsReady returns if Docker environment is ready
func (dm *DockerManager) IsReady() bool {
	return dm.imageReady && dm.containerReady
}

// InitializeDocker builds image and starts container if Docker is available
func InitializeDocker() bool {
	if !CheckDockerInstalled() {
		log.Println("⚠️  Docker not installed. Attempting auto-installation...")
		
		// Try to install Docker
		if TryInstallDocker() {
			log.Println("✅ Docker installed successfully!")
		} else {
			log.Println("⚠️  Docker auto-installation failed. Only local shell will be available.")
			log.Println("📋 Please install Docker manually:")
			log.Println("   Linux:   sudo apt install docker.io")
			log.Println("   Windows: https://www.docker.com/products/docker-desktop")
			return false
		}
	}

	go func() {
		// Check if image already exists
		if dockerMgr.IsDockerImageBuilt() {
			log.Println("✅ CYH Docker image already exists. Skipping build.")
			dockerMgr.imageReady = true
		} else {
			log.Println("📦 CYH Docker image not found. Building...")
			if err := dockerMgr.BuildDockerImage(); err != nil {
				log.Printf("❌ Failed to build Docker image: %v", err)
				return
			}
		}

		// Start container (will reuse existing if available)
		if err := dockerMgr.StartContainer(); err != nil {
			log.Printf("❌ Failed to start container: %v", err)
			return
		}

		log.Println("🎉 CYH Terminal Docker environment is ready!")
	}()

	return true
}

// logWriter is a helper for logging Docker build output
type logWriter struct {
	prefix string
}

func (lw *logWriter) Write(p []byte) (n int, err error) {
	lines := strings.Split(strings.TrimSpace(string(p)), "\n")
	for _, line := range lines {
		if line != "" {
			log.Printf("%s%s", lw.prefix, line)
		}
	}
	return len(p), nil
}
