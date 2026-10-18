@echo off
setlocal enabledelayedexpansion

:: Dam bao thu muc lam viec luon la thu muc chua file run.bat
cd /d "%~dp0"
title CRAWLER THU TUC HANH CHINH (DVCQG)

:: Ho tro chay truc tiep voi tham so:
:: run.bat crawl | compare | all | auto | cron | schedule | daemon | env | setup-env | test-tele | install | excel | crawl-gl
if /i "%~1"=="crawl" goto opt_crawl
if /i "%~1"=="compare" goto opt_compare
if /i "%~1"=="all" goto opt_all
if /i "%~1"=="publish" goto opt_all
if /i "%~1"=="auto" goto opt_auto
if /i "%~1"=="cron-run" goto opt_auto
if /i "%~1"=="cron" goto menu_schedule
if /i "%~1"=="schedule" goto menu_schedule
if /i "%~1"=="schedule-add" goto opt_schedule_create
if /i "%~1"=="schedule-create" goto opt_schedule_create
if /i "%~1"=="schedule-delete" goto opt_schedule_delete
if /i "%~1"=="schedule-remove" goto opt_schedule_delete
if /i "%~1"=="schedule-status" goto opt_schedule_status
if /i "%~1"=="schedule-query" goto opt_schedule_status
if /i "%~1"=="schedule-run" goto opt_schedule_run
if /i "%~1"=="daemon" goto opt_cron_daemon
if /i "%~1"=="loop" goto opt_cron_daemon
if /i "%~1"=="env" goto opt_env_check
if /i "%~1"=="check-env" goto opt_env_check
if /i "%~1"=="setup-env" goto opt_env_wizard
if /i "%~1"=="wizard" goto opt_env_wizard
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
echo   [5] Quan ly & Cai dat moi truong (.env, Node, Git, Thu vien NPM)
echo   [6] Kiem tra trang thai Git (git status)
echo   [7] Xuat file Excel TTHC Cap Tinh, Cap Xa va Bien dong Gia Lai
echo   [8] Cao va loc du lieu TTHC Gia Lai rieng biet (node tthc_crawler_gl.js)
echo   [9] Quan ly lich chay tu dong (Crontab / Windows Task Scheduler)
echo   [10] Che do Cron Daemon (Vong lap tu dong chay dinh ky)
echo   [0] Thoat
echo.
echo =====================================================================
set /p "CHOICE=>> Vui long nhap lua chon (0-10) roi nhan Enter: "

if "%CHOICE%"=="1" goto opt_crawl
if "%CHOICE%"=="2" goto opt_compare
if "%CHOICE%"=="3" goto opt_all
if "%CHOICE%"=="4" goto opt_test_tele
if "%CHOICE%"=="5" goto menu_env
if "%CHOICE%"=="6" goto opt_git_status
if "%CHOICE%"=="7" goto opt_excel
if "%CHOICE%"=="8" goto opt_crawl_gl
if "%CHOICE%"=="9" goto menu_schedule
if "%CHOICE%"=="10" goto opt_cron_daemon
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
if not exist ".env" (
    if exist ".env.example" (
        echo.
        echo [THONG BAO] File '.env' chua ton tai. Dang tu dong khoi tao tu '.env.example'...
        copy ".env.example" ".env" >nul
        echo [THANH CONG] Da tao file '.env'. Vui long kiem tra va cap nhat thong tin neu can!
    )
)
exit /b 0

:check_node_silent
where node >nul 2>&1
if !errorlevel! neq 0 exit /b 1
if not exist "node_modules\" (
    call npm install --silent
)
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul 2>&1
    )
)
exit /b 0

:: -------------------------------------------------------------
:: Chuc nang Chay tu dong (khong pause - danh cho Task Scheduler / Cron)
:: -------------------------------------------------------------
:opt_auto
call :check_node_silent
if !errorlevel! neq 0 (
    echo [LOI] Node.js chua san sang de chay tu dong!
    exit /b 1
)
set "AUTO_MODE=1"
call "%~dp0scripts\crawl_and_publish.bat" auto
exit /b !errorlevel!

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
echo Nhan phim bat ky de quay lai...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 5: Quan ly & Cai dat moi truong ung dung
:: -------------------------------------------------------------
:menu_env
call :check_node
cls
echo =====================================================================
echo            QUAN LY & CAI DAT MOI TRUONG UNG DUNG
echo =====================================================================
echo.
echo   [1] Kiem tra tong the moi truong (Node.js, Git, .env, Thu vien)
echo   [2] Trinh huong dan thiet lap cau hinh tuong tac (.env Wizard)
echo   [3] Khoi tao / Dat lai file .env tu file mau .env.example
echo   [4] Mo file .env bang Notepad de xem hoac sua truc tiep
echo   [5] Cai dat / Cap nhat thu vien NPM (npm install)
echo   [6] Kiem tra ket noi va thu nghiem gui tin nhan Telegram
echo   [7] Kiem tra trang thai Git Repository (git status)
echo   [0] Quay lai Menu chinh
echo.
echo =====================================================================
set /p "ENV_CHOICE=>> Vui long nhap lua chon (0-7) roi nhan Enter: "

if "%ENV_CHOICE%"=="1" goto opt_env_check
if "%ENV_CHOICE%"=="2" goto opt_env_wizard
if "%ENV_CHOICE%"=="3" goto opt_env_init
if "%ENV_CHOICE%"=="4" goto opt_env_edit
if "%ENV_CHOICE%"=="5" goto opt_install
if "%ENV_CHOICE%"=="6" goto opt_test_tele
if "%ENV_CHOICE%"=="7" goto opt_git_status
if "%ENV_CHOICE%"=="0" goto menu

echo.
echo [CANH BAO] Lua chon khong hop le!
timeout /t 2 >nul
goto menu_env

:opt_env_check
call :check_node
cls
node scripts/setup_env.js --check
echo ---------------------------------------------------------------------
echo Nhan phim bat ky de tiep tuc...
pause >nul
if "%~1"=="env" exit /b 0
if "%~1"=="check-env" exit /b 0
goto menu_env

:opt_env_wizard
call :check_node
cls
node scripts/setup_env.js --wizard
echo.
echo ---------------------------------------------------------------------
echo Nhan phim bat ky de quay lai...
pause >nul
if "%~1"=="setup-env" exit /b 0
if "%~1"=="wizard" exit /b 0
goto menu_env

:opt_env_init
cls
echo =====================================================================
echo [KHOI TAO] TAO FILE .env TU .env.example
echo =====================================================================
if exist ".env" (
    echo [CANH BAO] File .env da ton tai!
    set /p "OVERWRITE_ENV=Ban co chac chan muon ghi de file .env hien tai? (Y/N): "
    if /i not "!OVERWRITE_ENV!"=="Y" (
        echo Da huy thao tac.
        timeout /t 2 >nul
        goto menu_env
    )
)
copy ".env.example" ".env" >nul
echo [THANH CONG] Da khoi tao file .env tu .env.example!
echo Ban co the chon muc [2] de cau hinh cac tham so hoac mo Notepad de sua.
echo.
pause
goto menu_env

:opt_env_edit
cls
echo =====================================================================
echo [CHINH SUA] DANG MO FILE .env BANG NOTEPAD...
echo =====================================================================
if not exist ".env" (
    echo File .env chua ton tai, dang tao tu .env.example...
    copy ".env.example" ".env" >nul
)
start notepad.exe ".env"
echo Da mo Notepad. Sau khi sua va luu file (Ctrl + S), dong Notepad roi quay lai day.
echo.
pause
goto menu_env

:: -------------------------------------------------------------
:: Cai dat npm dependencies
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
goto menu_env

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
echo Nhan phim bat ky de quay lai...
pause >nul
goto menu

:: -------------------------------------------------------------
:: Chuc nang 7: Xuat file Excel TTHC Gia Lai
:: -------------------------------------------------------------
:opt_excel
call :check_node
cls
echo =====================================================================
echo [BAT DAU] DANG XUAT FILE EXCEL TTHC DVCQG TOAN QUOC VA GIA LAI...
echo =====================================================================
node scripts/export_excel.js
echo.
echo ---------------------------------------------------------------------
echo File Excel da duoc luu tai:
echo   - Toan quoc: data\Bao_cao_TTHC_DVCQG.xlsx
echo   - Gia Lai:   data-gl\Bao_cao_TTHC_Gia_Lai.xlsx
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

:: -------------------------------------------------------------
:: Chuc nang 9: Quan ly lich chay tu dong (Crontab / Task Scheduler)
:: -------------------------------------------------------------
:menu_schedule
cls
echo =====================================================================
echo          QUAN LY LICH CHAY TU DONG (CRONTAB / TASK SCHEDULER)
echo =====================================================================
echo.
echo   [1] Tao / Cap nhat lich chay tu dong hang ngay (Windows Task Scheduler)
echo   [2] Xem trang thai & lich trinh hien tai (schtasks query)
echo   [3] Chay thu nghiem tac vu da lap lich ngay lap tuc (schtasks run)
echo   [4] Xoa lich chay tu dong da tao (schtasks delete)
echo   [5] Chay che do Cron Daemon (Vong lap lien tuc trong cua so nay)
echo   [0] Quay lai Menu chinh
echo.
echo =====================================================================
set /p "SCH_CHOICE=>> Vui long nhap lua chon (0-5) roi nhan Enter: "

if "%SCH_CHOICE%"=="1" goto opt_schedule_create
if "%SCH_CHOICE%"=="2" goto opt_schedule_status
if "%SCH_CHOICE%"=="3" goto opt_schedule_run
if "%SCH_CHOICE%"=="4" goto opt_schedule_delete
if "%SCH_CHOICE%"=="5" goto opt_cron_daemon
if "%SCH_CHOICE%"=="0" goto menu

echo.
echo [CANH BAO] Lua chon khong hop le!
timeout /t 2 >nul
goto menu_schedule

:opt_schedule_create
cls
echo =====================================================================
echo [THIET LAP] TAO LICH CHAY TU DONG BANG WINDOWS TASK SCHEDULER
echo =====================================================================
echo Tac vu nay se tu dong kich hoat quy trinh cao va dong bo du lieu moi ngay.
echo (Tuong duong crontab tren Linux, chay ngam ngay ca khi tat cua so Terminal)
echo.
set "TASK_NAME=Crawler_TTHC_Daily"
set "DEFAULT_TIME=23:30"
if not "%~2"=="" (
    set "RUN_TIME=%~2"
) else (
    set /p "RUN_TIME=>> Nhap gio chay hang ngay [HH:mm] (Nhan Enter de dung mac dinh 23:30): "
)
if "!RUN_TIME!"=="" set "RUN_TIME=%DEFAULT_TIME%"

echo.
echo Dang thiet lap Task Scheduler "%TASK_NAME%" chay vao luc !RUN_TIME! moi ngay...
schtasks /create /tn "%TASK_NAME%" /tr "\"%~dp0run.bat\" auto" /sc daily /st !RUN_TIME! /f
if !errorlevel! equ 0 (
    echo.
    echo =====================================================================
    echo [THANH CONG] Da thiet lap lich chay tu dong thanh cong!
    echo - Ten tac vu: %TASK_NAME%
    echo - Tan suat:   Hang ngay vao luc !RUN_TIME!
    echo - Lenh thuc thi: "%~dp0run.bat" auto
    echo =====================================================================
) else (
    echo.
    echo =====================================================================
    echo [CANH BAO] Khong the tao tac vu trong Windows Task Scheduler!
    echo Neu gap loi Access Denied, vui long:
    echo   1. Chuot phai vao file run.bat
    echo   2. Chon "Run as administrator" (Chay voi quyen quan tri vien)
    echo =====================================================================
)
echo.
pause
if "%~1"=="schedule-add" exit /b !errorlevel!
if "%~1"=="schedule-create" exit /b !errorlevel!
goto menu_schedule

:opt_schedule_status
cls
echo =====================================================================
echo [KIEM TRA] TRANG THAI TAC VU TASK SCHEDULER
echo =====================================================================
set "TASK_NAME=Crawler_TTHC_Daily"
schtasks /query /tn "%TASK_NAME%" /fo LIST /v 2>nul
if !errorlevel! neq 0 (
    echo [THONG BAO] Chua tim thay tac vu "%TASK_NAME%" trong Task Scheduler.
    echo Ban co the chon muc [1] de thiet lap lich chay moi.
)
echo.
pause
if "%~1"=="schedule-status" exit /b 0
if "%~1"=="schedule-query" exit /b 0
goto menu_schedule

:opt_schedule_run
cls
echo =====================================================================
echo [KICH HOAT] CHAY THU NGHIEM TAC VU TASK SCHEDULER NGAY BAY GIO
echo =====================================================================
set "TASK_NAME=Crawler_TTHC_Daily"
schtasks /run /tn "%TASK_NAME%"
if !errorlevel! equ 0 (
    echo.
    echo [THANH CONG] Da phat lenh khoi chay tac vu "%TASK_NAME%".
    echo Tac vu dang chay ngam theo lich trinh cua Windows.
) else (
    echo.
    echo [LOI] Khong the khoi chay tac vu. Vui long kiem tra tac vu da ton tai chua!
)
echo.
pause
if "%~1"=="schedule-run" exit /b 0
goto menu_schedule

:opt_schedule_delete
cls
echo =====================================================================
echo [XOA] HUY LICH CHAY TU DONG TASK SCHEDULER
echo =====================================================================
set "TASK_NAME=Crawler_TTHC_Daily"
set /p "CONFIRM=Ban co chac chan muon xoa tac vu '%TASK_NAME%'? (Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo Da huy thao tac.
    timeout /t 2 >nul
    goto menu_schedule
)
schtasks /delete /tn "%TASK_NAME%" /f
if !errorlevel! equ 0 (
    echo.
    echo [THANH CONG] Da xoa tac vu "%TASK_NAME%" khoi Task Scheduler!
) else (
    echo.
    echo [LOI] Khong the xoa tac vu (co the tac vu chua duoc tao truoc do).
)
echo.
pause
if "%~1"=="schedule-delete" exit /b 0
if "%~1"=="schedule-remove" exit /b 0
goto menu_schedule

:: -------------------------------------------------------------
:: Chuc nang 10: Che do Cron Daemon (Vong lap lien tuc)
:: -------------------------------------------------------------
:opt_cron_daemon
call :check_node
cls
echo =====================================================================
echo             CHE DO CRON DAEMON (VONG LAP CHAY DINH KY)
echo =====================================================================
echo Che do nay se duy tri cua so Terminal va tu dong lap lai quy trinh
echo sau moi khoang thoi gian quy dinh (Interval).
echo.
echo   [1] Chay lap lai moi X gio (Mac dinh: 12 gio)
echo   [2] Chay lap lai moi X phut (Mac dinh: 60 phut)
echo   [0] Quay lai Menu
echo.
echo =====================================================================
set /p "DAEMON_OPT=>> Vui long nhap lua chon (0-2): "

if "%DAEMON_OPT%"=="0" goto menu
if "%DAEMON_OPT%"=="1" goto opt_daemon_hours
if "%DAEMON_OPT%"=="2" goto opt_daemon_mins

echo [CANH BAO] Lua chon khong hop le!
timeout /t 2 >nul
goto opt_cron_daemon

:opt_daemon_hours
echo.
set /p "HOURS=>> Nhap so gio giua moi lan chay (Mac dinh 12): "
if "%HOURS%"=="" set "HOURS=12"
set /a INTERVAL_SEC=%HOURS%*3600
set "INTERVAL_DESC=%HOURS% gio"
goto run_daemon_loop

:opt_daemon_mins
echo.
set /p "MINS=>> Nhap so phut giua moi lan chay (Mac dinh 60): "
if "%MINS%"=="" set "MINS=60"
set /a INTERVAL_SEC=%MINS%*60
set "INTERVAL_DESC=%MINS% phut"
goto run_daemon_loop

:run_daemon_loop
cls
echo =====================================================================
echo [CRON DAEMON] DANG HOAT DONG (Chu ky lap: %INTERVAL_DESC%)
echo Ghi chu: Nhan to hop phim Ctrl + C de dung tien trinh bat cu luc nao.
echo =====================================================================

:daemon_loop_cycle
echo.
echo =====================================================================
echo [CRON RUN] KHOI CHAY QUY TRINH LUC: %DATE% %TIME%
echo =====================================================================
set "AUTO_MODE=1"
call "%~dp0scripts\crawl_and_publish.bat" auto
echo.
echo =====================================================================
echo [CRON SLEEP] Quy trinh hoan tat luc %TIME%.
echo Dang cho %INTERVAL_DESC% cho lan chay tiep theo...
echo =====================================================================
timeout /t %INTERVAL_SEC% /nobreak
goto daemon_loop_cycle

:opt_exit
echo.
echo Tam biet!
exit /b 0
