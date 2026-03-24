@echo off
setlocal
set "NODE_PATH=C:\Program Files\nodejs"
set "PATH=%NODE_PATH%;%PATH%"
cd /d "C:\APS Test"
npm install --save cookie-session
echo exit: %ERRORLEVEL%
endlocal
