@echo off
setlocal
set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%NODE_PATH%;%PATH%"
cd /d "C:\APS Test"
echo Running npm install in C:\APS Test ...
npm install
echo.
echo npm install exit code: %ERRORLEVEL%
endlocal
