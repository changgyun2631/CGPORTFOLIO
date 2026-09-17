import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { join } from "node:path";

const scrypt = promisify(scryptCallback);
const envPath = join(process.cwd(), ".env.local");

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 4096) throw new Error("입력값이 너무 큽니다.");
  }
  return JSON.parse(input);
}

function upsertEnv(source, values) {
  const lines = source ? source.replace(/\r\n/g, "\n").split("\n") : [];
  const pending = new Map(Object.entries(values));
  const next = lines.map((line) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (next.length && next.at(-1) !== "") next.push("");
  for (const [key, value] of pending) next.push(`${key}=${value}`);
  return `${next.join("\n").replace(/\n+$/, "")}\n`;
}

const { username, password } = await readStdin();
if (!/^[A-Za-z0-9._@-]{1,64}$/.test(username ?? "")) throw new Error("아이디는 영문·숫자·._@- 조합 1~64자로 입력하세요.");
if (typeof password !== "string" || password.length < 8 || password.length > 200) {
  throw new Error("비밀번호는 8~200자로 입력하세요.");
}

const n = 16_384;
const r = 8;
const p = 1;
const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64, { N: n, r, p, maxmem: 128 * 1024 * 1024 });
const passwordHash = `scrypt$v1$${n}$${r}$${p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const updated = upsertEnv(existing, {
  AUTH_USERNAME: username,
  AUTH_PASSWORD_HASH: passwordHash,
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  CRON_SECRET: randomBytes(32).toString("base64url"),
});
writeFileSync(envPath, updated, { encoding: "utf8", mode: 0o600 });
process.stdout.write("로그인 계정·7일 세션·예약 작업 비밀키를 .env.local에 안전하게 저장했습니다.\n");
