@echo off
title Dhurta Browser
echo Starting Dhurta...
cd /d "%~dp0"
taskkill /F /IM electron.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 /nobreak >nul
npm run dev
