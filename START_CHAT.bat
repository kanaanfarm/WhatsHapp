@echo off
title ConnectChat Pro
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo Installation failed. Check your Internet connection.
    pause
    exit /b 1
  )
)

start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
node server.js
pause
