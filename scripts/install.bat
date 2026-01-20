@echo off
:: =====================================================
:: CYH Terminal - Windows Installation Script
:: CanYouHack Security Terminal
:: Requires Administrator privileges
:: =====================================================

setlocal EnableDelayedExpansion

echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║       CYH Terminal - Windows Installer           ║
echo   ║            CanYouHack.org                        ║
echo   ╚══════════════════════════════════════════════════╝
echo.

:: Check for admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] This script requires Administrator privileges!
    echo         Right-click and select "Run as administrator"
    pause
    exit /b 1
)

echo [1/6] Checking Chocolatey installation...
where choco >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Chocolatey not found. Installing...
    @powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))"
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install Chocolatey
        pause
        exit /b 1
    )
    echo [OK] Chocolatey installed successfully
    :: Refresh PATH
    call refreshenv
) else (
    echo [OK] Chocolatey is installed
)

echo.
echo [2/6] Installing Go...
choco install golang -y
if %errorlevel% neq 0 (
    echo [WARN] Go installation may have failed, checking...
)
where go >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Go is not available. Please install manually from https://golang.org
    pause
    exit /b 1
)
echo [OK] Go is installed

echo.
echo [3/6] Installing Docker Desktop...
choco install docker-desktop -y
if %errorlevel% neq 0 (
    echo [WARN] Docker installation may have failed
    echo [INFO] Docker is optional - Local mode will still work
) else (
    echo [OK] Docker Desktop installed
    echo [INFO] Please restart your computer and start Docker Desktop manually
)

echo.
echo [4/6] Installing Git (if needed)...
choco install git -y
echo [OK] Git is installed

echo.
echo [5/6] Building CYH Terminal...
cd /d "%~dp0..\backend"
if not exist "go.mod" (
    echo [ERROR] go.mod not found. Are you in the correct directory?
    pause
    exit /b 1
)

go build -o terminal-server.exe .
if %errorlevel% neq 0 (
    echo [ERROR] Build failed!
    pause
    exit /b 1
)
echo [OK] Build successful: terminal-server.exe

echo.
echo [6/6] Creating shortcuts...

:: Create start script
echo @echo off > "%~dp0start.bat"
echo cd /d "%%~dp0..\backend" >> "%~dp0start.bat"
echo echo Starting CYH Terminal... >> "%~dp0start.bat"
echo start /b terminal-server.exe >> "%~dp0start.bat"
echo timeout /t 2 /nobreak ^>nul >> "%~dp0start.bat"
echo echo. >> "%~dp0start.bat"
echo echo   CYH Terminal is running! >> "%~dp0start.bat"
echo echo   Open: http://localhost:3333 >> "%~dp0start.bat"
echo echo. >> "%~dp0start.bat"
echo start http://localhost:3333 >> "%~dp0start.bat"

:: Create stop script  
echo @echo off > "%~dp0stop.bat"
echo echo Stopping CYH Terminal... >> "%~dp0stop.bat"
echo taskkill /f /im terminal-server.exe ^>nul 2^>^&1 >> "%~dp0stop.bat"
echo echo CYH Terminal stopped. >> "%~dp0stop.bat"

echo [OK] Scripts created

echo.
echo   ═══════════════════════════════════════════════════
echo   [SUCCESS] Installation complete!
echo   ═══════════════════════════════════════════════════
echo.
echo   Quick Start:
echo     - Run: scripts\start.bat
echo     - Open: http://localhost:3333
echo.
echo   Note: If Docker was installed, please:
echo     1. Restart your computer
echo     2. Start Docker Desktop
echo     3. Then run start.bat
echo.
echo   Visit: https://canyouhack.org
echo.
pause
