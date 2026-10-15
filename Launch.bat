@echo off
setlocal
cd /d "%~dp0"
title Independent Books
if exist "%~dp0IndependentBooks.exe" (
    start "" "%~dp0IndependentBooks.exe"
) else (
    powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0Launch.ps1"
)
