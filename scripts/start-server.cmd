@echo off
rem CGPORTFOLIO 프로덕션 서버를 이 저장소 경로에서 띄운다.
rem Windows 작업 스케줄러(로그온 시 실행)가 직접 이 파일을 호출한다 —
rem npm.cmd를 스케줄러 작업 인수에 직접 넣으면 따옴표 중첩 때문에 잘 안 먹혀서
rem 얇은 래퍼로 감쌌다.
cd /d "%~dp0.."
call npm start
