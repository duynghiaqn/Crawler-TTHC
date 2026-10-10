@echo off
setlocal enabledelayedexpansion

:: Dam bao thu muc lam viec luon la thu muc chua file run.bat
cd /d "%~dp0"
title CRAWLER THU TUC HANH CHINH (DVCQG)

:: Ho tro chay truc tiep voi tham so: run.bat crawl | compare | all | test-tele | install | excel
if /i "%~1"=="crawl" goto opt_crawl
if /i "%~1"=="compare" goto opt_compare
if /i "%~1"=="all" goto opt_all
if /i "%~1"=="publish" goto opt_all
if /i "%~1"=="test-tele" goto opt_test_tele
if /i "%~1"=="install" goto opt_install
if /i "%~1"=="crawl-gl" goto opt_crawl_gl
if /i "%~1"=="excel" goto opt_excel

:menu
cls
echo =====================================================================
echo           CONG CU CAO VA XU LY DU LIEU TTHC (DVCQG)
echo =====================================================================
echo.
echo   [1] Cao du lieu TTHC moi nhat (node tthc_crawler.js)
echo   [2] So sanh bien dong TTHC va Cap Tinh (compare.js)
echo   [3] Chay TOAN BO quy trinh: Cao + So sanh + Xuat ban va Thong bao
echo   [4] Kiem tra ket noi va thu nghiem gui tin nhan Telegram
echo   [5] Cai dat / Cap nhat thu vien NPM (npm install)
echo   [6] Kiem tra trang thai Git (git status)
echo   [7] Xuat file Excel TTHC Cap Tinh, Cap Xa va Bien dong Gia Lai
echo   [8] Cao va loc du lieu TTHC Gia Lai rieng biet (node tthc_crawler_gl.js)
echo   [0] Thoat
echo.
echo =====================================================================
set /p "CHOICE=>> Vui long nhap lua chon (0-8) roi nhan Enter: "

if "%CHOICE%"=="1" goto opt_crawl
if "%CHOICE%"=="2" goto opt_compare
if "%CHOICE%"=="3" goto opt_all
if "%CHOICE%"=="4" goto opt_test_tele
if "%CHOICE%"=="5" goto opt_install
if "%CHOICE%"=="6" goto opt_git_status
if "%CHOICE%"=="7" goto opt_excel
if "%CHOICE%"=="8" goto opt_crawl_gl
if "%CHOICE%"=="0" goto opt_exit

echo.
echo [CANH BAO] Lua chon khong hop le, vui long chon lai!
timeout /t 2 >nul
goto menu

:check_node
where node >nul 2>&1
if !errorlevel! neq 0 (
    echo.
    echo [LOI] Khong tim thay Node.js trong he thong!
    echo Vui long tai va cai dat Node.js (phien ban 18+): https://nodejs.org/
    echo Sau khi cai dat xong, vui long khoi dong lai cua so dong lenh.
    pause
    goto menu
)
if not exist "node_modules\" (
    echo.
    echo [THONG BAO] Thu muc 'node_modules' chua ton tai. Dang tu dong cai dat dependency...
    call npm install
)
exit /b 0

:: -------------------------------------------------------------
:: Chuc nang 1: Cao du lieu
:: -------------------------------------------------------------
:opt_crawl
call :check_node
cls
echo =====================================================================
echo [BAT DAU] DANG CAO DU LIEU TTHC...
echo =====================================================================
node tthc_crawler.js
echo.
echo ---------------------------------------------------------------------
echo Tien trinh da dung hoac hoan tat. Nhan phim bat ky de quay lai menu...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 2: So sanh bien dong
:: -------------------------------------------------------------
:opt_compare
call :check_node
cls
echo =====================================================================
echo [BAT DAU] DANG PHAN TICH SO SANH BIEN DONG DU LIEU TTHC...
echo =====================================================================
echo [1/2] So sanh toan quoc...
node scripts/compare.js
echo.
echo [2/2] So sanh cap tinh...
node scripts/compare_Province.js
echo.
echo ---------------------------------------------------------------------
echo Phan tich hoan tat. Nhan phim bat ky de quay lai menu...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 3: Chay toan bo quy trinh
:: -------------------------------------------------------------
:opt_all
call :check_node
cls
call "%~dp0scripts\crawl_and_publish.bat"
goto menu

:: -------------------------------------------------------------
:: Chuc nang 4: Thu nghiem Telegram
:: -------------------------------------------------------------
:opt_test_tele
call :check_node
cls
echo =====================================================================
echo [KIEM TRA] DANG THU NGHIEM GUI THONG BAO QUA TELEGRAM...
echo =====================================================================
node scripts/notify_telegram.js --status success --uploadStatus "Thu nghiem gui tin nhan tu run.bat"
echo.
echo ---------------------------------------------------------------------
echo Neu chua nhan duoc tin nhan, hay kiem tra TELEGRAM_BOT_TOKEN va TELEGRAM_CHAT_ID trong .env!
echo Nhan phim bat ky de quay lai menu...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 5: Cai dat npm dependencies
:: -------------------------------------------------------------
:opt_install
cls
echo =====================================================================
echo [BAT DAU] DANG CAI DAT DEPENDENCIES BANG NPM...
echo =====================================================================
call npm install
echo.
echo ---------------------------------------------------------------------
echo Hoan tat cai dat. Nhan phim bat ky de quay lai menu...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 6: Kiem tra trang thai Git
:: -------------------------------------------------------------
:opt_git_status
cls
echo =====================================================================
echo [KIEM TRA] TRANG THAI GIT REPOSITORY
echo =====================================================================
git status
echo.
echo ---------------------------------------------------------------------
echo Nhan phim bat ky de quay lai menu...
pause >nul
:: -------------------------------------------------------------
:: Chuc nang 7: Xuat file Excel TTHC Gia Lai
:: -------------------------------------------------------------
:opt_excel
call :check_node
cls
echo =====================================================================
echo [BAT DAU] DANG XUAT FILE EXCEL TTHC GIA LAI...
echo =====================================================================
node scripts/export_excel.js
echo.
echo ---------------------------------------------------------------------
echo File Excel da duoc luu tai: data\Bao_cao_TTHC_Gia_Lai.xlsx
echo Nhan phim bat ky de quay lai menu...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 8: Cao & Dong bo TTHC Gia Lai
:: -------------------------------------------------------------
:opt_crawl_gl
call :check_node
cls
echo =====================================================================
echo [BAT DAU] DANG THU THAP VA LOC DU LIEU TTHC GIA LAI (data-gl)...
echo =====================================================================
node tthc_crawler_gl.js
echo.
echo ---------------------------------------------------------------------
echo Tien trinh hoan tat. Nhan phim bat ky de quay lai menu...
pause >nul
goto menu

:opt_exit
echo.
echo Tam biet!
exit /b 0
