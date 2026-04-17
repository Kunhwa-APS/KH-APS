@echo off
setlocal
set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%NODE_PATH%;%PATH%"
cd /d "%~dp0"
echo Running npm install in %~dp0 ...
npm install
echo.
echo npm install exit code: %ERRORLEVEL%
endlocal
