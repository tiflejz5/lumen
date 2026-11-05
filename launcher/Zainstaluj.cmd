@echo off
chcp 65001 >nul
title Lumen - instalacja
cd /d "%~dp0.."
set "NODE=runtime\node.exe"
if not exist "%NODE%" set "NODE=node"

"%NODE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto :getnode
goto :install

:getnode
echo.
echo   Nie znaleziono Node.js 24 lub nowszego. Pobieram przenosna wersje do folderu runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File "launcher\fetch-node.ps1"
if errorlevel 1 goto :fail
set "NODE=runtime\node.exe"

:install
"%NODE%" launcher\install.mjs
if errorlevel 1 goto :fail
echo.
pause
exit /b 0

:fail
echo.
echo   Instalacja nie powiodla sie. Przeczytaj komunikat powyzej.
pause
exit /b 1
