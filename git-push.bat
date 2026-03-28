@echo off
title Pushing 10523 HQ to GitHub
echo.
echo  ========================================
echo   Pushing 10523 HQ Dashboard to GitHub
echo   Account: itmcsoler
echo  ========================================
echo.

cd /d "%~dp0"

:: Check git is available
"C:\Program Files\Git\cmd\git.exe" --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git not found. Something is wrong with your Git install.
    pause & exit /b 1
)

:: Check gh is available
"C:\Program Files\GitHub CLI\gh.exe" --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: GitHub CLI not found.
    pause & exit /b 1
)

:: Check gh auth status
echo Checking GitHub login...
"C:\Program Files\GitHub CLI\gh.exe" auth status >nul 2>&1
if errorlevel 1 (
    echo.
    echo You need to log in to GitHub first. Opening login...
    "C:\Program Files\GitHub CLI\gh.exe" auth login
)

:: Initialize git repo if not already done
if not exist ".git" (
    echo Initializing git repository...
    "C:\Program Files\Git\cmd\git.exe" init
    "C:\Program Files\Git\cmd\git.exe" branch -M main
)

:: Stage all files
echo.
echo Staging files...
"C:\Program Files\Git\cmd\git.exe" add -A

:: Commit
echo Committing...
"C:\Program Files\Git\cmd\git.exe" commit -m "Initial commit: 10523 HQ Dashboard v1"

:: Check if remote already set
"C:\Program Files\Git\cmd\git.exe" remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo.
    echo Creating GitHub repo: itmcsoler/home-dashboard ...
    "C:\Program Files\GitHub CLI\gh.exe" repo create home-dashboard --public --description "10523 HQ - Home Intelligence Dashboard for Elmsford, Westchester NY" --source=. --remote=origin --push
    echo.
    echo  ========================================
    echo   Done! Repo is live at:
    echo   https://github.com/itmcsoler/home-dashboard
    echo  ========================================
) else (
    echo Pushing to existing remote...
    "C:\Program Files\Git\cmd\git.exe" push -u origin main
    echo.
    echo   Done! Dashboard pushed to GitHub.
)

echo.
pause
