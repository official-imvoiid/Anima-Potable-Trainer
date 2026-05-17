@echo off
setlocal
cd /D "%~dp0"

:: installer_files lives at the project root, one level above this script
set "ROOT=%~dp0.."
set "CONDA=%ROOT%\installer_files\Miniconda\_conda.exe"
set "ENV=%ROOT%\installer_files\Environments\anima"

echo ======================================
echo       PROJECT STARTER
echo ======================================
echo.

if not exist "%CONDA%" (
    echo Conda not found at:
    echo   %CONDA%
    echo.
    echo Run setup.bat first, then try again.
    pause
    exit /b
)

if not exist "%ENV%\python.exe" (
    echo Python environment missing at:
    echo   %ENV%
    echo.
    echo Run setup.bat first, then try again.
    pause
    exit /b
)

:: Check for Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found in PATH.
    echo Please install Node.js from https://nodejs.org and re-run this script.
    pause
    exit /b
)

:: Install npm packages if needed
if not exist "%~dp0node_modules" (
    echo Installing npm packages...
    echo.
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b
    )
    echo.
)

:: Add conda env to PATH so python/accelerate are available in this shell
set "PATH=%ENV%\Scripts;%ENV%;%ENV%\Library\bin;%PATH%"

echo Launching Training UI...
echo.
echo Open your browser at: http://localhost:3000
echo.
echo Press Ctrl+C to stop the server.
echo.

:: Start the server (stays in this window so logs are visible)
node server.js
