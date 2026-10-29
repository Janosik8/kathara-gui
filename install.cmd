@echo off
rem One-step install of Kathara GUI on Windows (NOTES/MYNOTES.md note 5, F45).
rem
rem Builds the interface, then installs the kathara-gui command with uv. Run it
rem again after a git pull to update. A .cmd file rather than .ps1 on purpose:
rem Windows PowerShell's default Restricted policy refuses .ps1 scripts but runs
rem this. From PowerShell type .\install.cmd; from Command Prompt, install.
rem
rem It never installs system software: a missing prerequisite is named, with the
rem command that gets it.
setlocal
cd /d "%~dp0"

where uv >nul 2>nul
if errorlevel 1 (
  echo uv is not installed. It provides Python and installs the application.
  echo Get it with:  winget install astral-sh.uv
  echo or see https://docs.astral.sh/uv/getting-started/installation/
  echo Then open a new terminal and run install.cmd again.
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. It is needed once, to build the interface.
  echo Get it with:  winget install OpenJS.NodeJS.LTS
  echo or see https://nodejs.org/
  echo Then open a new terminal and run install.cmd again.
  exit /b 1
)

echo [1/4] Fetching the tools that build the interface (npm ci)...
set "STEP=npm ci"
call npm.cmd --prefix frontend ci
if errorlevel 1 goto failed

echo [2/4] Building the interface...
set "STEP=building the interface"
call npm.cmd --prefix frontend run build
if errorlevel 1 goto failed

echo [3/4] Installing the kathara-gui command...
set "STEP=uv tool install"
rem Rebuilt every time, so a later git pull reaches the installed copy.
uv tool install --reinstall-package kathara-gui .
if errorlevel 1 goto failed

echo [4/4] Checking the installed command...
set "STEP=the installed command's check"
rem By its full path, so an old copy earlier on PATH cannot answer instead.
for /f "delims=" %%d in ('uv tool dir --bin') do set "BIN=%%d"
"%BIN%\kathara-gui.exe" --check
if errorlevel 1 goto failed

rem Puts uv's command folder on PATH if it is not there yet; nothing otherwise.
uv tool update-shell >nul 2>nul

echo.
echo Installed. Docker Desktop must be running to deploy labs.
echo If "kathara-gui" is not found, open a new terminal first. Then run:
echo   kathara-gui
echo Labs go to a kathara-labs folder in the folder you start it from.
echo "kathara-gui --help" lists the options.
exit /b 0

:failed
echo.
echo Installation stopped: %STEP% failed. The messages above say why.
exit /b 1
