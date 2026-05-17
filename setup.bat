@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /D "%~dp0"

title AUTO INSTALL + PYTHON 3.13

:: ==========================
:: PATHS
:: ==========================

set "BASE=%CD%"
set "INSTALL_DIR=%BASE%\installer_files"
set "CONDA_DIR=%INSTALL_DIR%\Miniconda"
set "ENV_DIR=%INSTALL_DIR%\Environments\anima"

set "INSTALLER=%TEMP%\miniconda_installer.exe"

set "URL=https://repo.anaconda.com/miniconda/Miniconda3-latest-Windows-x86_64.exe"

echo ======================================
echo     AUTO INSTALL + PYTHON 3.13
echo ======================================
echo.

:: ==========================
:: Create folders
:: ==========================

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\Environments" mkdir "%INSTALL_DIR%\Environments"

:: ==========================
:: Install Miniconda
:: ==========================

if exist "%CONDA_DIR%\_conda.exe" goto createEnv
if exist "%CONDA_DIR%\Scripts\conda.exe" goto createEnv
if exist "%CONDA_DIR%\condabin\conda.bat" goto createEnv

echo Downloading Miniconda...
echo.

where curl >nul 2>&1

if %errorlevel%==0 (
    curl -L "%URL%" -o "%INSTALLER%"
) else (
    powershell -Command ^
    "Invoke-WebRequest '%URL%' -OutFile '%INSTALLER%'"
)

if not exist "%INSTALLER%" (
    echo Download failed
    pause
    exit /b
)

echo Installing Miniconda...
echo.

start /wait "" "%INSTALLER%" ^
/InstallationType=JustMe ^
/NoShortcuts=1 ^
/AddToPath=0 ^
/RegisterPython=0 ^
/NoRegistry=1 ^
/S ^
/D=%CONDA_DIR%

:createEnv

:: ==========================
:: Find conda executable
:: ==========================

set "CONDA_EXE="

:: Prefer _conda.exe — calling conda.bat causes batch recursion stack overflow
if exist "%CONDA_DIR%\_conda.exe" (
    set "CONDA_EXE=%CONDA_DIR%\_conda.exe"
    goto foundConda
)

if exist "%CONDA_DIR%\Scripts\conda.exe" (
    set "CONDA_EXE=%CONDA_DIR%\Scripts\conda.exe"
    goto foundConda
)

:: conda.bat last resort only — avoid if possible (causes recursion with call)
if exist "%CONDA_DIR%\condabin\conda.bat" (
    set "CONDA_EXE=%CONDA_DIR%\condabin\conda.bat"
    goto foundConda
)

echo.
echo Conda install failed
echo.

dir "%CONDA_DIR%" /s /b

pause
exit /b

:foundConda

echo Found:
echo %CONDA_EXE%
echo.

:: ==========================
:: Create Python 3.13 env
:: ==========================

if not exist "%ENV_DIR%\python.exe" (

    echo.
    echo Creating Python 3.13 environment...
    echo.

    call "%CONDA_EXE%" create ^
    -p "%ENV_DIR%" ^
    python=3.13 ^
    -y

    if errorlevel 1 (
        echo Environment creation failed
        pause
        exit /b
    )
)

:: ==========================
:: Upgrade pip
:: ==========================

echo.
echo Updating pip...
echo.

call "%CONDA_EXE%" run ^
--no-capture-output ^
-p "%ENV_DIR%" ^
python -m pip install --upgrade pip

if errorlevel 1 (
    echo pip upgrade failed
    pause
    exit /b
)

:: ==========================
:: Install Python requirements
:: ==========================

if not exist "%BASE%\requirements.txt" (
    echo.
    echo WARNING: requirements.txt not found at %BASE%\requirements.txt
    echo Skipping package installation.
    echo.
    goto done
)

echo.
echo Installing Python packages from requirements.txt...
echo (This may take several minutes - PyTorch is large)
echo.

call "%CONDA_EXE%" run ^
--no-capture-output ^
-p "%ENV_DIR%" ^
python -m pip install -r "%BASE%\requirements.txt"

if errorlevel 1 (
    echo.
    echo Package installation failed.
    echo Check your internet connection and CUDA version, then re-run setup.bat.
    pause
    exit /b
)

:done
echo.
echo ======================================
echo Setup completed successfully
echo ======================================
echo.

pause
