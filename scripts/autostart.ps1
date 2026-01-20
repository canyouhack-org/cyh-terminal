# =====================================================
# CYH Terminal - Windows Auto-Start Setup
# Adds CYH Terminal to Windows startup
# Run as Administrator
# =====================================================

param(
    [switch]$Remove,
    [switch]$TaskScheduler
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$VbsPath = Join-Path $ScriptDir "start-hidden.vbs"
$TaskName = "CYH Terminal"

Write-Host ""
Write-Host "  CYH Terminal - Windows Auto-Start Setup" -ForegroundColor Cyan
Write-Host "  ========================================" -ForegroundColor Cyan
Write-Host ""

# Remove mode
if ($Remove) {
    Write-Host "Removing auto-start..." -ForegroundColor Yellow
    
    # Remove from startup folder
    $StartupPath = [Environment]::GetFolderPath("Startup")
    $ShortcutPath = Join-Path $StartupPath "CYH Terminal.lnk"
    if (Test-Path $ShortcutPath) {
        Remove-Item $ShortcutPath -Force
        Write-Host "[OK] Removed from Startup folder" -ForegroundColor Green
    }
    
    # Remove scheduled task
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Removed scheduled task" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "Auto-start disabled!" -ForegroundColor Green
    exit 0
}

# Check for VBS launcher
if (-not (Test-Path $VbsPath)) {
    Write-Host "[ERROR] start-hidden.vbs not found!" -ForegroundColor Red
    exit 1
}

if ($TaskScheduler) {
    # ========================================
    # Method 1: Task Scheduler (Recommended)
    # Runs even before user login
    # ========================================
    
    Write-Host "Setting up Task Scheduler..." -ForegroundColor Cyan
    
    # Check admin
    $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host "[ERROR] Task Scheduler requires Administrator!" -ForegroundColor Red
        Write-Host "Run: Start-Process powershell -Verb runAs -ArgumentList '-File', '$($MyInvocation.MyCommand.Path)', '-TaskScheduler'" -ForegroundColor Yellow
        exit 1
    }
    
    # Remove existing task if present
    $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    
    # Create action
    $Action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument """$VbsPath""" -WorkingDirectory $ScriptDir
    
    # Create trigger (on startup)
    $Trigger = New-ScheduledTaskTrigger -AtStartup
    
    # Create settings
    $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    
    # Create principal (run as SYSTEM for before-login start)
    $Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    
    # Register task
    Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "CYH Terminal - CanYouHack Security Terminal Server"
    
    Write-Host ""
    Write-Host "[OK] Task Scheduler configured!" -ForegroundColor Green
    Write-Host ""
    Write-Host "CYH Terminal will start automatically on boot" -ForegroundColor Cyan
    Write-Host "(even before Windows login)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Management:" -ForegroundColor Yellow
    Write-Host "  View: Get-ScheduledTask -TaskName 'CYH Terminal'" -ForegroundColor White
    Write-Host "  Start: Start-ScheduledTask -TaskName 'CYH Terminal'" -ForegroundColor White
    Write-Host "  Stop: Stop-ScheduledTask -TaskName 'CYH Terminal'" -ForegroundColor White
    Write-Host "  Remove: .\autostart.ps1 -Remove" -ForegroundColor White
    
} else {
    # ========================================
    # Method 2: Startup Folder (Simple)
    # Runs after user login
    # ========================================
    
    Write-Host "Adding to Startup folder..." -ForegroundColor Cyan
    
    $StartupPath = [Environment]::GetFolderPath("Startup")
    $ShortcutPath = Join-Path $StartupPath "CYH Terminal.lnk"
    
    # Create shortcut
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = "wscript.exe"
    $Shortcut.Arguments = """$VbsPath"""
    $Shortcut.WorkingDirectory = $ScriptDir
    $Shortcut.Description = "CYH Terminal - CanYouHack Security Terminal"
    $Shortcut.Save()
    
    Write-Host ""
    Write-Host "[OK] Added to Startup folder!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Location: $ShortcutPath" -ForegroundColor Gray
    Write-Host ""
    Write-Host "CYH Terminal will start automatically on login" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "For start-on-boot (before login), run:" -ForegroundColor Yellow
    Write-Host "  .\autostart.ps1 -TaskScheduler" -ForegroundColor White
}

Write-Host ""
Write-Host "Access: http://localhost:3333" -ForegroundColor Cyan
Write-Host ""
