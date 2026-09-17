@echo off
REM Launcher for the Rotorflight blackbox analyser.
REM Prefers a Python that already has numpy, so the setup step is skipped
REM when the libraries are already installed somewhere on this machine.
setlocal enabledelayedexpansion
set "TOOL=%~dp0RFLogTool.pyw"

for %%D in (Python313 Python312 Python311 Python310) do (
  set "PX=%LOCALAPPDATA%\Programs\Python\%%D\python.exe"
  set "PW=%LOCALAPPDATA%\Programs\Python\%%D\pythonw.exe"
  if exist "!PX!" (
    "!PX!" -c "import numpy, orangebox" >nul 2>&1
    if !errorlevel! equ 0 ( start "" "!PW!" "%TOOL%" & goto :eof )
  )
)

for %%D in (Python313 Python312 Python311 Python310) do (
  set "PW=%LOCALAPPDATA%\Programs\Python\%%D\pythonw.exe"
  if exist "!PW!" ( start "" "!PW!" "%TOOL%" & goto :eof )
)

where py >nul 2>&1 && ( py -3 "%TOOL%" & goto :eof )
where pythonw >nul 2>&1 && ( start "" pythonw "%TOOL%" & goto :eof )

echo Could not find Python.
echo Install it from https://python.org and tick "Add Python to PATH".
pause
