@echo off
chcp 65001 >nul
title Lumen - zatrzymywanie
cd /d "%~dp0.."
set "NODE=runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" launcher\stop.mjs
echo.
pause
