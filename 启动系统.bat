@echo off
title 晚安家居门店下单系统

cd /d "%~dp0"

set NODE=%~dp0nodejs\node.exe
set NPM=%~dp0nodejs\npm.cmd

if not exist "%NODE%" (
    echo [ERROR] 未找到 Node.js：%NODE%
    echo 请确认 nodejs 文件夹存在
    pause
    exit /b 1
)

set PATH=%~dp0nodejs;%PATH%

:: 每次启动强制释放 3333：只杀 LISTENING 状态的真进程，忽略无害的 TIME_WAIT
set PORT=3333
echo 正在准备端口 %PORT%...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /r ":%PORT% " ^| findstr "LISTENING"') do (
    echo 端口 %PORT% 被 PID %%a 占用，正在释放...
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
echo 使用端口 %PORT%

echo [1/2] 检查依赖...
if not exist "server\node_modules" (
    echo 安装服务端依赖...
    cd server
    call "%NPM%" install
    cd ..
)
if not exist "client\node_modules" (
    echo 安装前端依赖...
    cd client
    call "%NPM%" install
    cd ..
)
echo 依赖 OK

if not exist "server\public\index.html" (
    echo [2/2] 构建前端...
    cd client
    call "%NPM%" run build
    cd ..
) else (
    echo [2/2] 前端已构建，跳过
)

echo.
echo ============================================
echo   系统启动中：http://localhost:%PORT%
echo   账号：admin / admin123
echo   关闭此窗口即可停止服务
echo ============================================
echo.

start "" "http://localhost:%PORT%"

cd server
set PORT=%PORT%
"%NODE%" src/index.js

echo.
echo 正在释放端口 %PORT%...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /r ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo 端口已释放，可安全关闭窗口。
pause
