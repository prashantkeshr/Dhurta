@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "SERVER_JS=%ROOT%..\hyperlocal-express\serve-omni.js"
set "UPDATE_JS=%ROOT%update-favicons.js"
set "LOG_FILE=%ROOT%favicons\update-log.json"
set "BROWSER_URL=http://localhost:5179"

title DHURTA SETU - Admin Panel

:MENU
cls
echo.
echo  +------------------------------------------------------+
echo  ^|        DHURTA SETU  --  Admin Panel                 ^|
echo  +------------------------------------------------------+
echo.
echo   FAVICON MANAGEMENT
echo   --------------------------------------------------
echo   [1]  Download missing favicons       (new apps only)
echo   [2]  Re-download ALL favicons         (full refresh)
echo   [3]  Retry previously failed favicons
echo   [4]  Audit report                    (no downloads)
echo   [5]  View last update log
echo.
echo   APP MANAGEMENT
echo   --------------------------------------------------
echo   [6]  Add trending apps from curated list
echo   [7]  Add a new app manually           (interactive)
echo   [8]  Count total apps in dashboard
echo.
echo   DASHBOARD
echo   --------------------------------------------------
echo   [9]  Start server + open DHURTA SETU in browser
echo   [10] Start server only               (keep window)
echo   [11] Open browser only   (server must be running)
echo   [12] Check if server is running
echo.
echo   [0]  Exit
echo.
set "CHOICE="
set /p CHOICE=  Choose an option [0-12]:

if "%CHOICE%"=="1"  goto MISSING
if "%CHOICE%"=="2"  goto ALL
if "%CHOICE%"=="3"  goto RETRY
if "%CHOICE%"=="4"  goto REPORT
if "%CHOICE%"=="5"  goto VIEWLOG
if "%CHOICE%"=="6"  goto TRENDING
if "%CHOICE%"=="7"  goto ADD
if "%CHOICE%"=="8"  goto COUNT
if "%CHOICE%"=="9"  goto OPEN_ALL
if "%CHOICE%"=="10" goto SERVER_ONLY
if "%CHOICE%"=="11" goto OPEN_BROWSER
if "%CHOICE%"=="12" goto CHECK_SERVER
if "%CHOICE%"=="0"  goto EXIT

echo.
echo  [!] Invalid choice. Please enter a number 0-12.
timeout /t 2 >nul
goto MENU

:: -------------------------------------------------------
:MISSING
cls
echo.
echo  Downloading missing favicons (new apps only)...
echo  -----------------------------------------------
echo.
call :CHECK_NODE || goto MENU
node "%UPDATE_JS%"
echo.
pause
goto MENU

:: -------------------------------------------------------
:ALL
cls
echo.
echo  WARNING: This will re-download ALL ~1000+ favicons.
echo  It may take several minutes.
echo  -----------------------------------------------
echo.
set /p "CONFIRM=  Are you sure? (y/n): "
if /i not "%CONFIRM%"=="y" (
  echo  Cancelled.
  timeout /t 2 >nul
  goto MENU
)
call :CHECK_NODE || goto MENU
node "%UPDATE_JS%" --all
echo.
pause
goto MENU

:: -------------------------------------------------------
:RETRY
cls
echo.
echo  Retrying previously failed favicons...
echo  -----------------------------------------------
echo.
call :CHECK_NODE || goto MENU
if not exist "%LOG_FILE%" (
  echo  [!] No log file found. Run option 1 first.
  timeout /t 3 >nul
  goto MENU
)
node "%UPDATE_JS%" --retry
echo.
pause
goto MENU

:: -------------------------------------------------------
:REPORT
cls
echo.
echo  Favicon Audit Report
echo  -----------------------------------------------
echo.
call :CHECK_NODE || goto MENU
node "%UPDATE_JS%" --report
echo.
pause
goto MENU

:: -------------------------------------------------------
:VIEWLOG
cls
echo.
echo  Last Update Log
echo  -----------------------------------------------
echo.
if not exist "%LOG_FILE%" (
  echo  [!] No log found. Run a download first.
  timeout /t 3 >nul
  goto MENU
)
type "%LOG_FILE%"
echo.
pause
goto MENU

:: -------------------------------------------------------
:TRENDING
cls
echo.
echo  Adding trending apps from curated list...
echo  Edit TRENDING_APPS in update-favicons.js to configure.
echo  -----------------------------------------------
echo.
call :CHECK_NODE || goto MENU
node "%UPDATE_JS%" --trending
echo.
pause
goto MENU

:: -------------------------------------------------------
:ADD
cls
echo.
echo  Add New App (Interactive)
echo  -----------------------------------------------
echo  Enter app details below. Favicon downloads automatically.
echo.
call :CHECK_NODE || goto MENU
node "%UPDATE_JS%" --add
echo.
pause
goto MENU

:: -------------------------------------------------------
:COUNT
cls
echo.
echo  App Count in Dashboard
echo  -----------------------------------------------
echo.
call :CHECK_NODE || goto MENU
node -e "const fs=require('fs'),p=require('path');const d=['data1.js','data2.js','data3.js','workspace.js'];let t=0;d.forEach(f=>{const s=fs.readFileSync(p.join('%ROOT%'.replace(/\\/g,'/'),f),'utf8');const m=s.match(/\{id:/g)||[];console.log('  '+f.padEnd(16)+m.length+' apps');t+=m.length});console.log('  ----------------');console.log('  TOTAL           '+t+' apps');"
echo.
pause
goto MENU

:: -------------------------------------------------------
:OPEN_ALL
cls
echo.
echo  Starting server and opening DHURTA SETU...
echo  -----------------------------------------------
echo.
call :CHECK_NODE || goto MENU
if not exist "%SERVER_JS%" (
  echo  [!] Server file not found: %SERVER_JS%
  echo  Check the path in this bat file.
  pause
  goto MENU
)
echo  Starting server on port 5179 (in background)...
start "Dhurta Server" /min node "%SERVER_JS%"
echo  Waiting for server to start...
timeout /t 3 >nul
echo  Opening browser...
start "" "%BROWSER_URL%"
echo.
echo  Server is running in background (minimized window).
echo  Close the "Dhurta Server" window to stop it.
echo.
pause
goto MENU

:: -------------------------------------------------------
:SERVER_ONLY
cls
echo.
echo  Starting Local Server on port 5179
echo  -----------------------------------------------
echo  Press Ctrl+C in this window to stop the server.
echo.
call :CHECK_NODE || goto MENU
if not exist "%SERVER_JS%" (
  echo  [!] Server file not found: %SERVER_JS%
  pause
  goto MENU
)
node "%SERVER_JS%"
goto MENU

:: -------------------------------------------------------
:OPEN_BROWSER
cls
echo.
echo  Opening DHURTA SETU in browser...
echo  -----------------------------------------------
echo.
call :CHECK_SERVER_SILENT
if errorlevel 1 (
  echo  [!] Server does not appear to be running on port 5179.
  echo  Use option [9] to start server and open browser together.
  echo.
  set /p "FORCE=  Open anyway? (y/n): "
  if /i not "!FORCE!"=="y" goto MENU
)
start "" "%BROWSER_URL%"
echo  Opened: %BROWSER_URL%
timeout /t 2 >nul
goto MENU

:: -------------------------------------------------------
:CHECK_SERVER
cls
echo.
echo  Checking server status on port 5179...
echo  -----------------------------------------------
echo.
call :CHECK_SERVER_SILENT
if errorlevel 1 (
  echo  [x] Server is NOT running on port 5179.
  echo      Use option [9] or [10] to start it.
) else (
  echo  [OK] Server is running on port 5179.
  echo       Dashboard: %BROWSER_URL%
)
echo.
pause
goto MENU

:: -------------------------------------------------------
:EXIT
cls
echo.
echo  Goodbye.
echo.
endlocal
exit /b 0

:: -------------------------------------------------------
:: HELPER: check if node is installed
:CHECK_NODE
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [!] Node.js not found. Please install from https://nodejs.org
  echo.
  pause
  exit /b 1
)
exit /b 0

:: -------------------------------------------------------
:: HELPER: silently check if port 5179 is in use
:CHECK_SERVER_SILENT
netstat -ano 2>nul | findstr ":5179" | findstr "LISTENING" >nul 2>&1
exit /b %errorlevel%

