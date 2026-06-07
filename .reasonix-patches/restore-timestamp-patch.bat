@echo off
REM Reasonix 桌面端时间戳补丁 — 恢复脚本
REM 用法：双击运行，或在升级 Reasonix 后运行
REM
REM 把修改过的三个文件复制回 Reasonix 安装目录

set REASONIX_DIR=D:\Reasonix\dist\cli
set PATCH_DIR=%~dp0

echo ========================================
echo  Reasonix 时间戳补丁 — 恢复
echo ========================================
echo.
echo 目标目录: %REASONIX_DIR%
echo.

if not exist "%REASONIX_DIR%" (
    echo [错误] 找不到 Reasonix 目录: %REASONIX_DIR%
    pause
    exit /b 1
)

echo [1/3] 复制 chunk-P5SUHDUQ.js ...
copy /y "%PATCH_DIR%chunk-P5SUHDUQ.js" "%REASONIX_DIR%\" || (
    echo [失败]
    pause
    exit /b 1
)

echo [2/3] 复制 chunk-GMQVINZK.js ...
copy /y "%PATCH_DIR%chunk-GMQVINZK.js" "%REASONIX_DIR%\" || (
    echo [失败]
    pause
    exit /b 1
)

echo [3/3] 复制 desktop-AUBW2SLL.js ...
copy /y "%PATCH_DIR%desktop-AUBW2SLL.js" "%REASONIX_DIR%\" || (
    echo [失败]
    pause
    exit /b 1
)

echo.
echo ======== 补丁恢复完成 ========
echo 请重启 reasonix-desktop.exe 生效。
echo.
pause
