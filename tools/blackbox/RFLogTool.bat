@echo off
REM Launcher for the Rotorflight blackbox analyser.
REM Tries the Python launcher first, then common install locations.
setlocal
where py >nul 2>&1 && (py -3 "%~dp0RFLogTool.pyw" & goto :eof)
where pythonw >nul 2>&1 && (pythonw "%~dp0RFLogTool.pyw" & goto :eof)
for %%P in (
  "%LOCALAPPDATA%\Programs\Python\Python313\pythonw.exe"
  "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"
  "%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe"
) do if exist %%P ( start "" %%P "%~dp0RFLogTool.pyw" & goto :eof )
echo Could not find Python. Install it from https://python.org and tick "Add Python to PATH".
pause
