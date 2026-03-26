@echo off
REM Запуск без cd: двойной щелчок или одна строка в cmd.exe
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0shectory-run-create-user.ps1"
exit /b %ERRORLEVEL%
