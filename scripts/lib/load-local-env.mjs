import { join } from "node:path";

/** Next 밖에서 도는 예약 스크립트도 .env.local의 CRON_SECRET을 읽게 한다. */
export function loadLocalEnv(path = join(process.cwd(), ".env.local")) {
  try {
    process.loadEnvFile(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
