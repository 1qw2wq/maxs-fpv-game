@echo off
setlocal
title Trench Front Server
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Trench Front  -  local game server
echo   ==========================================
echo.
echo   This window runs the server on its own,
echo   independent of Trae. Closing Trae will
echo   NOT stop it.
echo.
echo   To stop: close this window, or press Ctrl+C.
echo   LAN play: send friends the LAN url printed below.
echo.
echo   The game page opens in your browser automatically.
echo.
echo   Checking this PC is ready to run the game ...
echo.

rem  ---------------------------------------------------------------
rem   Python 3.10+ -- the server itself is a Python program.
rem  ---------------------------------------------------------------
call :find_python
if not defined PY (
    echo   [missing] Python 3.10 or newer
    call :install_python
    call :find_python
)
if not defined PY (
    echo.
    echo   [ERROR] Python could not be set up automatically.
    echo   Please install Python 3.10+ yourself, ticking
    echo   "Add Python to PATH" during setup:
    echo       https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)
echo   [ok] Python: %PY%

rem  ---------------------------------------------------------------
rem   aiohttp -- the only third-party package the server imports.
rem  ---------------------------------------------------------------
%PY% -c "import aiohttp" >nul 2>nul
if errorlevel 1 (
    echo   [missing] aiohttp  - installing ...
    call :install_aiohttp
    %PY% -c "import aiohttp" >nul 2>nul
    if errorlevel 1 (
        echo.
        echo   [ERROR] aiohttp could not be installed. Check the network
        echo   and run this launcher again.
        echo.
        pause
        exit /b 1
    )
)
echo   [ok] aiohttp
echo.

echo   All requirements satisfied - starting the server ...
echo.

%PY% "server\server.py" --open

echo.
echo   Server stopped.
pause
exit /b 0


rem ===================================================================
rem  Subroutines (kept below the exit so they are never fallen into)
rem ===================================================================

rem Locate a working Python 3.10+ and put the command that runs it in PY.
rem PATH is checked first, then the usual install locations -- a Python that
rem is installed but not yet on THIS session's PATH is the normal state right
rem after an automatic install, because a new PATH only reaches new windows.
:find_python
set "PY="
python -c "import sys;raise SystemExit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto :eof

py -3 -c "import sys;raise SystemExit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto :eof

for %%V in (314 313 312 311 310) do (
    call :try_python_dir "%LOCALAPPDATA%\Programs\Python\Python%%V"
    call :try_python_dir "C:\Python%%V"
    call :try_python_dir "%ProgramFiles%\Python\Python%%V"
)
goto :eof

:try_python_dir
if defined PY goto :eof
if not exist "%~1\python.exe" goto :eof
"%~1\python.exe" -c "import sys;raise SystemExit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
if not errorlevel 1 set "PY="%~1\python.exe""
goto :eof

rem Install Python. winget first, since it resolves a current release on its
rem own. If winget is missing or fails, download the official per-user
rem installer and run it silently -- InstallAllUsers=0 needs no admin rights.
:install_python
echo.
echo   Trying to install Python 3.12 automatically ...
echo.

where winget >nul 2>nul
if not errorlevel 1 (
    echo   - via winget ...
    winget install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if not errorlevel 1 (
        echo   winget reported success.
        goto :eof
    )
    echo   winget could not do it - falling back to a direct download.
)

set "PYVER=3.12.10"
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-amd64.exe"
set "PYEXE=%TEMP%\python-%PYVER%-amd64.exe"

echo   - downloading Python %PYVER% ...
where curl.exe >nul 2>nul
if not errorlevel 1 (
    curl.exe -L --fail --silent --show-error -o "%PYEXE%" "%PYURL%"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%PYURL%' -OutFile '%PYEXE%' -UseBasicParsing"
)
if not exist "%PYEXE%" (
    echo   [ERROR] the download failed - no internet, or a proxy is in the way.
    goto :eof
)

echo   - running the installer (this can take a minute; please wait) ...
"%PYEXE%" /quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_launcher=1 InstallLauncherAllUsers=0
del "%PYEXE%" >nul 2>nul
echo   installer finished.
goto :eof

rem Install aiohttp, falling back to a China-friendly PyPI mirror when the
rem default index is slow or unreachable. ensurepip covers the minimal Python
rem builds that ship without pip.
:install_aiohttp
%PY% -m pip --version >nul 2>nul
if errorlevel 1 %PY% -m ensurepip --upgrade >nul 2>nul

%PY% -m pip install --disable-pip-version-check aiohttp
if not errorlevel 1 goto :eof
echo   - retrying via the Tsinghua mirror ...
%PY% -m pip install --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple aiohttp
goto :eof
