# =====================================================
# CYH Terminal - PowerShell Installation Script
# CanYouHack Security Terminal
# Run as Administrator
# =====================================================

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this script as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell -> Run as Administrator" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║    CYH Terminal - PowerShell Installer           ║" -ForegroundColor Cyan
Write-Host "  ║            CanYouHack.org                        ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectDir "backend"

# Install Chocolatey
Write-Host "[1/5] Checking Chocolatey..." -ForegroundColor Cyan
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Chocolatey..." -ForegroundColor Yellow
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Write-Host "[OK] Chocolatey installed" -ForegroundColor Green
} else {
    Write-Host "[OK] Chocolatey is installed" -ForegroundColor Green
}

# Install Go
Write-Host ""
Write-Host "[2/5] Installing Go..." -ForegroundColor Cyan
choco install golang -y
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
if (Get-Command go -ErrorAction SilentlyContinue) {
    $goVersion = go version
    Write-Host "[OK] $goVersion" -ForegroundColor Green
} else {
    Write-Host "[WARN] Go may need a restart to be available" -ForegroundColor Yellow
}

# Install Docker
Write-Host ""
Write-Host "[3/5] Installing Docker Desktop..." -ForegroundColor Cyan
choco install docker-desktop -y
Write-Host "[OK] Docker Desktop installed (requires restart)" -ForegroundColor Green

# Install Git
Write-Host ""
Write-Host "[4/5] Installing Git..." -ForegroundColor Cyan
choco install git -y
Write-Host "[OK] Git installed" -ForegroundColor Green

# Build
Write-Host ""
Write-Host "[5/5] Building CYH Terminal..." -ForegroundColor Cyan
Set-Location $BackendDir
if (-not (Test-Path "go.mod")) {
    Write-Host "[ERROR] go.mod not found!" -ForegroundColor Red
    exit 1
}

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:GOPATH = $env:USERPROFILE + "\go"
$env:Path += ";$env:GOPATH\bin;C:\Program Files\Go\bin"

try {
    & go build -o terminal-server.exe .
    if (Test-Path "terminal-server.exe") {
        Write-Host "[OK] Build successful: terminal-server.exe" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Build failed!" -ForegroundColor Red
    }
} catch {
    Write-Host "[WARN] Build may require restart for Go to be in PATH" -ForegroundColor Yellow
}

# Create start script
$startScript = @"
@echo off
cd /d "$BackendDir"
echo Starting CYH Terminal...
start /b terminal-server.exe
timeout /t 2 /nobreak >nul
echo.
echo   CYH Terminal is running!
echo   Open: http://localhost:3333
echo.
start http://localhost:3333
"@
Set-Content -Path (Join-Path $ScriptDir "start.bat") -Value $startScript

# Summary
Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "[SUCCESS] Installation complete!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT: Please restart your computer, then:" -ForegroundColor Yellow
Write-Host "  1. Start Docker Desktop" -ForegroundColor White
Write-Host "  2. Run: scripts\start.bat" -ForegroundColor White
Write-Host "  3. Open: http://localhost:3333" -ForegroundColor White
Write-Host ""
Write-Host "Visit: https://canyouhack.org" -ForegroundColor Cyan
Write-Host ""
