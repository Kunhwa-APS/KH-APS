@echo off
setlocal
set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%NODE_PATH%;%PATH%"
cd /d "C:\APS Test"
echo Starting APS AI Platform server...
node server.js
endlocal
