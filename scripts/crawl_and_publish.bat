@echo off
setlocal enabledelayedexpansion

:: Chuyen den thu muc goc cua du an (thu muc cha cua scripts)
cd /d "%~dp0\.."

echo ==================================================
echo [BAT DAU] QUY TRINH CAO TTHC VA PUBLISH DATA (WINDOWS)
echo ==================================================

:: 0. Kiem tra moi truong Node.js va Git
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo [LOI] Chua cai dat Node.js hoac chua them vao PATH!
    echo Vui long tai va cai dat tai: https://nodejs.org/
    pause
    exit /b 1
)

where git >nul 2>&1
if !errorlevel! neq 0 (
    echo [LOI] Chua cai dat Git hoac chua them vao PATH!
    echo Vui long tai va cai dat tai: https://git-scm.com/
    pause
    exit /b 1
)

:: 1. Chay co may cao du lieu
echo [1/4] Dang chay co may cao du lieu...
node tthc_crawler.js
if !errorlevel! neq 0 (
    echo [LOI] Qua trinh cao du lieu gap loi!
    node scripts/notify_telegram.js --status error --error "Qua trinh cao du lieu bi loi hoac Circuit Breaker duoc kich hoat!"
    pause
    exit /b !errorlevel!
)

:: 2. Phan tich so sanh bien dong du lieu TTHC (tang/giam/bai bo)
echo [2/4] Dang phan tich so sanh bien dong du lieu TTHC...
node scripts/compare.js
if !errorlevel! neq 0 (
    echo [CANH BAO] Phan tich so sanh bien dong TTHC gap loi!
)

echo [3/4] Dang phan tich so sanh du lieu cap Tinh va xuat file Excel...
node scripts/compare_Province.js
if !errorlevel! neq 0 (
    echo [CANH BAO] Phan tich so sanh tinh gap loi!
)
node scripts/export_excel.js

:: 3. Xuat ban du lieu & Gui thong bao Telegram dua tren cau hinh .env
echo [4/4] Dang xuat ban du lieu va gui thong bao Telegram...
node scripts/publish.js
if !errorlevel! neq 0 (
    echo [LOI] Qua trinh xuat ban du lieu gap loi!
    pause
    exit /b !errorlevel!
)

pause
