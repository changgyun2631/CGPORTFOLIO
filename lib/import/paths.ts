import "server-only";

import { homedir } from "node:os";
import { join } from "node:path";

export const dataDir = join(process.cwd(), "data");
export const backupRoot = join(homedir(), "cgportfolio-backups");
