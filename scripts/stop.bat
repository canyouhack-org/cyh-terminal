@echo off
:: =====================================================
:: CYH Terminal - Windows Stop
:: =====================================================

echo Stopping CYH Terminal...
taskkill /f /im terminal-server.exe >nul 2>&1
echo.
echo CYH Terminal stopped.
timeout /t 2 >nul
