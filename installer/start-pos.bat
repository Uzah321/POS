@echo off
title Core

REM Start PostgreSQL service if it exists (install.ps1 writes the exact service name into the copy at {app})
net start postgresql-x64-17 >nul 2>&1
net start postgresql-x64-16 >nul 2>&1

REM If server already running, just open the browser
netstat -ano | find "8080" | find "LISTENING" >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" http://localhost:8080/cashier
    goto :eof
)

REM Start Laravel in background then open browser
start /B "" "%~dp0php\php.exe" -c "%~dp0php\php.ini" "%~dp0backend\artisan" serve --host=0.0.0.0 --port=8080
timeout /t 3 /nobreak >nul
start "" http://localhost:8080/cashier
