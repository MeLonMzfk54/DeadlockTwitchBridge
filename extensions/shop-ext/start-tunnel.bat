@echo off
rem Cloudflare quick tunnel to 127.0.0.1:3920 and write the URL into config.js.
rem Do not put this file in the Twitch extension zip.
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0start-tunnel.ps1"
if errorlevel 1 pause
