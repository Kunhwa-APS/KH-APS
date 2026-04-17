@echo off
SETLOCAL EnableDelayedExpansion

echo ========================================
echo   GitHub Download Tool - APS Collaboration
echo ========================================

:: Move to the directory where the script is located
cd /d "%~dp0"

echo [1/1] Getting the latest changes from GitHub...
git pull origin main
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Download failed. Please check internet connection.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================
echo   Download Complete!
echo ========================================
pause
