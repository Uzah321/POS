@echo off
title Core POS
set PHPRC=%~dp0php

if exist "%~dp0desktop\Core.exe" (
    start "" "%~dp0desktop\Core.exe"
    exit /b 0
)

echo Core desktop app is missing. Please reinstall Core.
pause
