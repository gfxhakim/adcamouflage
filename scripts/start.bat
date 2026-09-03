@echo off
REM Launch AdCamouflage on Windows. Double-click this file, or run:
REM    scripts\start.bat
REM
REM All the real work lives in start.py so Windows, macOS and Linux run the
REM same tested code path.

setlocal

set "SCRIPT_DIR=%~dp0"

REM The py launcher ships with the python.org installer and picks the newest
REM interpreter; fall back to whatever `python` resolves to.
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    py -3 "%SCRIPT_DIR%start.py" %*
    goto :done
)

where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    python "%SCRIPT_DIR%start.py" %*
    goto :done
)

echo.
echo   error: Python was not found on PATH.
echo.
echo   Install it with:  winget install Python.Python.3.12
echo   Then open a NEW terminal window and run this script again.
echo.
exit /b 1

:done
set "EXITCODE=%ERRORLEVEL%"

REM Keep the window open when launched from Explorer so errors stay readable.
echo %CMDCMDLINE% | find /i "/c" >nul
if %ERRORLEVEL% EQU 0 pause

exit /b %EXITCODE%
