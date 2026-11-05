@echo off
chcp 65001 >nul
title Lumen - serwer lokalny (nie zamykaj tego okna)
cd /d "%~dp0.."
set "NODE=runtime\node.exe"
if not exist "%NODE%" set "NODE=node"
"%NODE%" launcher\start.mjs
if errorlevel 1 (
  echo.
  echo   Lumen zakonczyl prace z bledem. Nacisnij dowolny klawisz, aby zamknac okno.
  pause >nul
)
