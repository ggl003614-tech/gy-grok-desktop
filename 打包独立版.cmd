@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在打独立桌面包（前端打进 exe，不依赖 Vite / localhost）...
call npm.cmd run build:desk
if errorlevel 1 (
  echo 打包失败。
  pause
  exit /b 1
)
echo.
echo 完成：app 文件夹就是发给别人的软件包。
echo 双击 app\启动 Grok Desk.cmd 即可。
echo 也可以把整个 app 文件夹拷走，或运行 app\安装到这台电脑.cmd
pause
