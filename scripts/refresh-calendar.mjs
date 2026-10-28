import { loadLocalEnv } from "./lib/load-local-env.mjs";
import { refreshCalendar } from "./lib/calendar-refresh.mjs";
import { syncEarningsDaily } from "./lib/earnings-sync.mjs";
import { syncCalendarLogos, syncEwDaily } from "./lib/ew-sync.mjs";

loadLocalEnv();

// 보유 종목 실적 발표일(하루 한 번). 실패해도 기존 일정의 결과 수집은 그대로 진행한다.
try {
  const result = await syncEarningsDaily({ force: process.argv.includes("--earnings") });
  if (result) console.log(`실적 발표일 확인: 보유 종목 일정 ${result.found}건, 새로 추가 ${result.added}건`);
} catch (error) {
  console.error(`실적 발표일 확인 실패: ${error.message}`);
}

// Earnings Whispers 주요 기업 실적(하루 한 번, 이번 주부터 4주). 실패해도 계속 진행한다.
try {
  const result = await syncEwDaily({ force: process.argv.includes("--earnings") });
  if (result) console.log(`주요 기업 실적: 읽은 일정 ${result.found}건, 새로 추가 ${result.added}건`);
} catch (error) {
  console.error(`주요 기업 실적 확인 실패: ${error.message}`);
}

try {
  const logos = await syncCalendarLogos();
  if (logos.saved || logos.none) console.log(`회사 로고: 새로 저장 ${logos.saved}건, 로고 없음 ${logos.none}건`);
} catch (error) {
  console.error(`회사 로고 저장 실패: ${error.message}`);
}

try {
  const result = await refreshCalendar();
  console.log(`캘린더 수집: 대상 ${result.total}건, 원천 확인 ${result.updated}건, 실패 ${result.errors}건`);
  if (result.errors) process.exitCode = 1;
} catch (error) {
  console.error(`캘린더 수집 실패: ${error.message}`);
  process.exitCode = 1;
}
