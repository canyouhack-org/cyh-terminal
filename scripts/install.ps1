# =====================================================
# CYH Terminal - PowerShell Installation Script
# CanYouHack.org - CYH Terminal
# Run as Administrator
# =====================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($msg)  { Write-Host $msg -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host $msg -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host $msg -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host $msg -ForegroundColor Red }

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Err  "ERROR: Run this script as Administrator!"
    Write-Warn "Right-click PowerShell -> Run as Administrator"
    exit 1
}

Write-Host ""
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host "   CYH Terminal - PowerShell Installer         " -ForegroundColor Cyan
Write-Host "   https://canyouhack.org                      " -ForegroundColor Cyan
Write-Host "===============================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectDir "backend"

if (-not (Test-Path $BackendDir)) {
    Write-Err "[ERROR] Backend directory not found: $BackendDir"
    exit 1
}

# -----------------------------------------------------
# [1/5] Install Chocolatey
# -----------------------------------------------------
Write-Info "[1/5] Checking Chocolatey..."
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Warn "Installing Chocolatey..."
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force | Out-Null
        [System.Net.ServicePointManager]::SecurityProtocol = `
            [System.Net.ServicePointManager]::SecurityProtocol -bor 3072

        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString(
            'https://community.chocolatey.org/install.ps1'
        ))

        # Refresh PATH for current session
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")

        Write-Ok "[OK] Chocolatey installed"
    } catch {
        Write-Err "[ERROR] Chocolatey install failed: $($_.Exception.Message)"
        throw
    }
} else {
    Write-Ok "[OK] Chocolatey is installed"
}

# -----------------------------------------------------
# [2/5] Install Go
# -----------------------------------------------------
Write-Host ""
Write-Info "[2/5] Installing Go..."
try {
    choco install golang -y | Out-Host
} catch {
    Write-Err "[ERROR] Go install (choco) failed: $($_.Exception.Message)"
    throw
}

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

if (Get-Command go -ErrorAction SilentlyContinue) {
    Write-Ok ("[OK] " + (go version))
} else {
    Write-Warn "[WARN] Go may need a restart to be available in PATH."
}

# -----------------------------------------------------
# [3/5] Install Docker Desktop
# -----------------------------------------------------
Write-Host ""
Write-Info "[3/5] Installing Docker Desktop..."
try {
    choco install docker-desktop -y | Out-Host
    Write-Ok "[OK] Docker Desktop installed (restart may be required)"
} catch {
    Write-Warn "[WARN] Docker Desktop install failed or requires manual install: $($_.Exception.Message)"
    Write-Warn "You can install Docker Desktop manually if needed."
}

# -----------------------------------------------------
# [4/5] Install Git
# -----------------------------------------------------
Write-Host ""
Write-Info "[4/5] Installing Git..."
try {
    choco install git -y | Out-Host
    Write-Ok "[OK] Git installed"
} catch {
    Write-Warn "[WARN] Git install failed: $($_.Exception.Message)"
}

# -----------------------------------------------------
# [5/5] Build backend
# -----------------------------------------------------
Write-Host ""
Write-Info "[5/5] Building CYH Terminal backend..."

Set-Location $BackendDir

if (-not (Test-Path "go.mod")) {
    Write-Err "[ERROR] go.mod not found in backend dir!"
    exit 1
}

# Refresh PATH + GOPATH for this session
$env:Path  = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
             [System.Environment]::GetEnvironmentVariable("Path", "User")

$env:GOPATH = Join-Path $env:USERPROFILE "go"

# Ensure common Go install paths are present for this session
# (Chocolatey usually adds these, but this helps without restart)
$goBin1 = Join-Path $env:GOPATH "bin"
$goBin2 = "C:\Program Files\Go\bin"
if ($env:Path -notlike "*$goBin1*") { $env:Path += ";$goBin1" }
if (Test-Path $goBin2) {
    if ($env:Path -notlike "*$goBin2*") { $env:Path += ";$goBin2" }
}

try {
    & go env | Out-Null
} catch {
    Write-Warn "[WARN] 'go' is not available yet. Restart may be required, then re-run this script."
    throw
}

try {
    & go build -o terminal-server.exe . | Out-Host
    if (Test-Path "terminal-server.exe") {
        Write-Ok "[OK] Build successful: terminal-server.exe"
    } else {
        Write-Err "[ERROR] Build finished but terminal-server.exe not found."
        exit 1
    }
} catch {
    Write-Err "[ERROR] Build failed: $($_.Exception.Message)"
    throw
}

# -----------------------------------------------------
# Create start.bat (safe)
# -----------------------------------------------------
# Use a literal here-string so CMD content doesn't get parsed by PowerShell,
# then replace placeholder with real path.
$startBat = @'
@echo off
setlocal
cd /d "__BACKEND_DIR__"
echo Starting CYH Terminal...
start /b "" terminal-server.exe
timeout /t 2 /nobreak >nul
echo.
echo   CYH Terminal is running!
echo   Open: http://localhost:3333
echo.
start "" http://localhost:3333
endlocal
'@

$startBat = $startBat.Replace('__BACKEND_DIR__', $BackendDir)

$startBatPath = Join-Path $ScriptDir "start.bat"
Set-Content -Path $startBatPath -Value $startBat -Encoding ASCII
Write-Ok "[OK] Created: $startBatPath"

# -----------------------------------------------------
# Summary
# -----------------------------------------------------
Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "[SUCCESS] Installation complete!" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
Write-Warn "IMPORTANT:"
Write-Host "  1) Restart your computer" -ForegroundColor White
Write-Host "  2) Start Docker Desktop (if you need it)" -ForegroundColor White
Write-Host "  3) Run: scripts\start.bat" -ForegroundColor White
Write-Host "  4) Open: http://localhost:3333" -ForegroundColor White
Write-Host ""
Write-Host "Visit: https://canyouhack.org" -ForegroundColor Cyan
Write-Host ""
