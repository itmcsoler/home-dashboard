@echo off
title 10523 HQ Dashboard
echo.
echo  ========================================
echo   10523 HQ - Home Intelligence Dashboard
echo   Elmsford, Westchester County, NY
echo  ========================================
echo.
echo  Starting server...
echo  Once you see the URL below, open your
echo  browser and go to: http://localhost:3000
echo.
echo  Press Ctrl+C to stop the dashboard.
echo.

"C:\Users\saf\AppData\Local\Programs\Python\Python312\Lib\site-packages\playwright\driver\node.exe" "%~dp0server.js"

pause
