import "server-only";

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { parseRefreshLog, parseServerLog, type RefreshLogSummary, type ServerLogSummary } from "@/lib/domain/log-status";

const logDir = join(homedir(), "cgportfolio-logs");

function readLogFile(name: string): string {
  try {
    return readFileSync(join(logDir, name), "utf8");
  } catch {
    return "";
  }
}

export function readServerLogSummary(now: Date = new Date()): ServerLogSummary {
  return parseServerLog(readLogFile("server.log"), now);
}

export function readRefreshLogSummary(): RefreshLogSummary {
  return parseRefreshLog(readLogFile("refresh.log"));
}
