@echo off
rem Removes the kathara-gui command installed by install.cmd (bug 38, F45).
rem
rem Only the command goes. Labs in kathara-labs folders stay, and so do uv,
rem Node.js and Docker, which may serve other things: this never removes system
rem software, as install.cmd never installs it. Run from PowerShell as
rem .\uninstall.cmd, from Command Prompt as uninstall, or by double-click.
setlocal
cd /d "%~dp0"

rem As in install.cmd: a double-clicked window would close before anything in it
rem could be read, so wait for a key when cmd was started just to run this.
echo "%cmdcmdline%" | find /i "%~f0" >nul && set "HOLD=1"

where uv >nul 2>nul
if errorlevel 1 (
  echo uv is not installed, so neither is kathara-gui: it is installed with uv.
  echo Nothing to remove.
  set "RC=0"
  goto end
)

uv tool list 2>nul | find /i "kathara-gui" >nul
if errorlevel 1 (
  echo kathara-gui is not installed. Nothing to remove.
  set "RC=0"
  goto end
)

echo Removing the kathara-gui command...
uv tool uninstall kathara-gui
if errorlevel 1 (
  echo.
  echo Removal stopped: uv could not remove it. If kathara-gui is running, stop it
  echo with Ctrl+C in its window, then run uninstall.cmd again.
  set "RC=1"
  goto end
)

echo.
echo Removed. Kept, on purpose:
echo   - your labs, in the kathara-labs folders where you started kathara-gui;
echo   - any lab still deployed: its containers run on in Docker. Stop them with
echo     "Stop every lab" before uninstalling.
echo   - uv, Node.js and Docker, which you may use for other things. Remove them in
echo     Settings, Apps, if you do not.
echo This project folder can now be deleted. To install again, run install.cmd.
set "RC=0"

:end
if defined HOLD (
  echo.
  pause
)
exit /b %RC%
