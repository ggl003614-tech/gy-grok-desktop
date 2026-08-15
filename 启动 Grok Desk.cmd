@echo off
chcp 65001 >nul
set "APP=%~dp0app\grok-desk.exe"
if not exist "%APP%" if exist "%~dp0app\grok-desk-new.exe" set "APP=%~dp0app\grok-desk-new.exe"
if not exist "%APP%" (
  echo 还没有独立程序。请先双击「打包独立版.cmd」
  echo 或在本目录运行： npm run build:desk
  pause
  exit /b 1
)
start "" "%APP%"
