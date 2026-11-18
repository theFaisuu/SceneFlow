@echo off
setlocal enabledelayedexpansion
title SceneFlow Studio Server

echo ========================================================
echo   SceneFlow 1-Click Studio Launcher
echo ========================================================
echo.

:: Switch to script directory
cd /d "%~dp0"

:: If launched from parent directory, switch into frame-maker
if exist "frame-maker\server.js" (
    cd /d "%~dp0frame-maker"
)

:: 1. Verify Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\nodejs;!PATH!"
    )
)
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [NOTICE] Node.js is required to run SceneFlow Studio.
    echo Opening official Node.js download page in your browser...
    start https://nodejs.org/en/download
    echo.
    echo Please install the recommended Node.js LTS version,
    echo then double-click Start_SceneFlow.cmd again.
    echo.
    pause
    exit /b 1
)

:: 2. Verify dependencies
if not exist "node_modules" (
    echo [1/4] Installing dependencies...
    call npm.cmd install
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] npm install encountered an error.
        pause
        exit /b 1
    )
) else (
    echo [1/4] Dependencies verified.
)

:: 3. Verify FFmpeg engine (prevents spawn EFTYPE / corrupt binary errors)
echo [2/4] Verifying FFmpeg engine...
node bin/verify-ffmpeg.js >nul 2>nul
if !ERRORLEVEL! NEQ 0 (
    echo [NOTICE] FFmpeg binary was missing or incomplete. Repairing...
    node bin/verify-ffmpeg.js --repair
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] FFmpeg initialization failed.
        pause
        exit /b 1
    )
)

:: 4. Free port 3000 if previously occupied
echo [3/4] Checking port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Freeing port 3000 - PID %%a
    taskkill /F /PID %%a >nul 2>nul
)

:: 5. Start server (it will automatically open your default browser when ready)
echo [4/4] Starting SceneFlow Studio server...
echo.
echo ========================================================
echo   SceneFlow Studio is LIVE at http://localhost:3000
echo   Opening default browser with link...
echo   Keep this command window open while using SceneFlow.
echo   To stop the server, press Ctrl+C or close this window.
echo ========================================================
echo.

node server.js
pause
