@echo off
chcp 65001 >nul
title Lumen - aktualizacja
cd /d "%~dp0.."
echo Pobieram najnowsza wersje z GitHuba...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo   Nie udalo sie pobrac aktualizacji. Sprawdz polaczenie z internetem.
  pause
  exit /b 1
)
call npm install
echo.
echo Gotowe. Uruchom Lumen skrotem na pulpicie - interfejs zbuduje sie sam.
pause
