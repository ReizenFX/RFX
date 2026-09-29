@echo off
rem Links this repo to %APPDATA%\Adobe\CEP\extensions\RFX (directory junction).
rem Double-clickable wrapper around dev-link.ps1. Safe to re-run.
rem Pass /nopause to skip the final pause (e.g. when run from a terminal).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-link.ps1"
set "RC=%ERRORLEVEL%"
if /i not "%~1"=="/nopause" pause
exit /b %RC%
