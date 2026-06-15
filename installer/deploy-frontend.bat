@echo off
REM --- deploy-frontend.bat ---
REM Copies the built React frontend into backend/public/ so Laravel serves it.
REM Run this after every "npm run build" in the frontend folder.
REM Usage: double-click or run from command prompt.

set SCRIPT_DIR=%~dp0
set ROOT=%SCRIPT_DIR%..
set DIST=%ROOT%\frontend\dist
set PUBLIC=%ROOT%\backend\public

echo.
echo  Deploying frontend to backend/public...
echo  Source : %DIST%
echo  Target : %PUBLIC%
echo.

if not exist "%DIST%\index.html" (
    echo  ERROR: frontend/dist/index.html not found.
    echo  Build the frontend first:
    echo    cd frontend
    echo    npm run build
    pause
    exit /b 1
)

REM Copy all files except Laravel's index.php
for /f "delims=" %%F in ('dir /b "%DIST%"') do (
    if /i NOT "%%F"=="index.php" (
        xcopy /E /I /Y "%DIST%\%%F" "%PUBLIC%\%%F" >nul 2>&1
        if errorlevel 1 xcopy /Y "%DIST%\%%F" "%PUBLIC%\" >nul 2>&1
    )
)

echo  Done. The app is ready at http://localhost:8080
echo.
