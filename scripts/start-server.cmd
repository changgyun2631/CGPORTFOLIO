@echo off
rem CGPORTFOLIO 서버를 이 저장소 경로에서 띄운다. 작업 스케줄러가 이 파일을 직접 호출한다.
rem npm start가 끝나면(죽든 정상 종료든) 10초 뒤 다시 띄운다 - 2026-09-16 원인 불명
rem 재시작을 두 번 겪은 뒤 추가했다 (WORK_ORDER.md B-0 참고).
rem 로그 메시지는 한글 대신 영문으로 쓴다: 이 cmd 파일이 UTF-8로 저장되는데,
rem cmd.exe 기본 코드페이지와 안 맞으면 REM/ECHO 줄이 깨져서 스크립트 자체가
rem "Input redirection is not supported" 로 죽는 걸 실제로 겪었다.
cd /d "%~dp0.."
if not exist "%USERPROFILE%\cgportfolio-logs" mkdir "%USERPROFILE%\cgportfolio-logs"

:loop
echo %date% %time% server starting >> "%USERPROFILE%\cgportfolio-logs\server.log"
call npm start
echo %date% %time% server exited, restarting in 10s >> "%USERPROFILE%\cgportfolio-logs\server.log"
rem Use ping instead of timeout to wait. timeout needs a real console and fails with
rem "Input redirection is not supported" when the task runs at boot without a logged
rem on user. That failure returns instantly, which would turn this into a busy restart
rem loop. ping always waits, console or not.
ping -n 11 127.0.0.1 >nul
goto loop
