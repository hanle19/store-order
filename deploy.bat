@echo off
title store-order deploy
cd /d "%~dp0"

set NODE=%~dp0nodejs\node.exe
set PORT=3333
set TS=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TS=%TS: =0%

if not exist "%NODE%" (
    echo [ERROR] node not found: %NODE%
    pause
    exit /b 1
)

echo [1/6] Syntax selfcheck...
"%NODE%" server\scripts\selfcheck.js
if errorlevel 1 (
    echo [ABORT] selfcheck failed, deploy stopped.
    pause
    exit /b 1
)

echo [2/6] Backup old build to .trash ...
if not exist .trash mkdir .trash
if exist client\dist move client\dist ".trash\dist_%TS%" >nul
if exist server\public move server\public ".trash\public_%TS%" >nul

echo [3/6] Build frontend...
cd client
"%NODE%" node_modules\vite\bin\vite.js build
if errorlevel 1 (
    echo [ABORT] vite build failed.
    cd ..
    pause
    exit /b 1
)
cd ..

echo [4/6] Copy dist to server\public ...
xcopy /e /i /q client\dist server\public >nul

echo [5/6] Restart server on port %PORT% ...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /r ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
cd server
start "store-order-server" /min "%NODE%" src\index.js
cd ..
timeout /t 3 /nobreak >nul

echo [6/6] Smoke test...
"%NODE%" server\scripts\smoke.js
if errorlevel 1 (
    echo [WARN] smoke failed, please check the server window.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Deploy OK: http://localhost:%PORT%
echo ============================================
pause
