@echo off
setlocal
cd /d "C:\Users\abdullaxows\Downloads\cyh-terminal\backend"
echo Starting CYH Terminal...
start /b "" terminal-server.exe
timeout /t 2 /nobreak >nul
echo.
echo   CYH Terminal is running!
echo   Open: http://localhost:3333
echo.
start "" http://localhost:3333
endlocal
