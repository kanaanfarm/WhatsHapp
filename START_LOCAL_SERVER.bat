@echo off
title ConnectChat Pro - Owner Local Server
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" (
  echo Local owner configuration is missing.
  echo Copy .env.example to .env and add your private Supabase values.
  echo NEVER share .env or upload it to GitHub.
  pause
  exit /b 1
)

echo Installing or checking required packages...
call npm install
if errorlevel 1 (
  echo Installation failed. Check your Internet connection.
  pause
  exit /b 1
)

start "" /b cmd /c "timeout /t 4 /nobreak ^>nul ^& start http://localhost:3000"
node --env-file=.env server.js
pause
