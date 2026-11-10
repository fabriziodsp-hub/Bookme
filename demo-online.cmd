@echo off
rem Double-click to put the Docker demo online through a temporary Cloudflare tunnel.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0demo-online.ps1" %*
