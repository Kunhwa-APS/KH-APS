@echo off
SETLOCAL EnableDelayedExpansion

echo ========================================
echo   GitHub Sync Tool - APS Collaboration
echo ========================================

:: Move to the directory where the script is located
cd /d "%~dp0"

echo [1/4] Pulling latest changes from GitHub...
git pull origin main
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Pull failed. Please check for conflicts or internet connection.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/4] Staging local changes...
git add .

echo.
echo [3/4] Checking for changes to commit...
git status -s | findstr /R "." > nul
if %ERRORLEVEL% EQU 0 (
    echo   Changes detected. Committing...
    set "commit_msg=Auto-sync: %DATE% %TIME%"
    git commit -m "!commit_msg!"
) else (
    echo   No local changes to commit.
)

echo.
echo [4/4] Pushing changes to GitHub...
git push origin main
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Push failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo   Synchronization Complete!
echo ========================================
pause
