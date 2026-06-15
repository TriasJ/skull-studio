@echo off
rem Double-click launcher for Skull Studio (Windows).
title Skull Studio
cd /d "%~dp0.."
where python >nul 2>nul
if %errorlevel%==0 (
  python launch.py %*
) else (
  py launch.py %*
)
echo.
pause
