import { loadLocalEnv } from "./lib/load-local-env.mjs";
import { refreshCalendar } from "./lib/calendar-refresh.mjs";

loadLocalEnv();
try {
  const result = await refreshCalendar();
  console.log(`캘린더 수집: 대상 ${result.total}건, 원천 확인 ${result.updated}건, 실패 ${result.errors}건`);
  if (result.errors) process.exitCode = 1;
} catch (error) {
  console.error(`캘린더 수집 실패: ${error.message}`);
  process.exitCode = 1;
}
