import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { syncLogos } from "../logo-sync.mjs";
import { upcomingSymbols } from "../ew-sync.mjs";

describe("syncLogos", () => {
  const opts = (dir, lookupLogo) => ({ dataDir: dir, apiKey: "k", throttleMs: 0, fetchImage: async () => Buffer.from("img"), lookupLogo });

  it("saves new logos, marks missing ones, skips known ones and stops at the rate limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logos-"));
    mkdirSync(join(dir, "logos"));
    writeFileSync(join(dir, "logos", "OLD.jpg"), "x");
    const asked = [];
    const lookup = async (s) => {
      asked.push(s);
      if (s === "NOPE") return { code: 404, status: "error" };
      if (s === "LIMIT") return { code: 429 };
      return { url: `https://x/${s}` };
    };
    const out = await syncLogos(["OLD", "AAA", "NOPE", "LIMIT", "AFTER"], opts(dir, lookup));
    expect(out).toEqual({ saved: 1, none: 1 });
    expect(asked).toEqual(["AAA", "NOPE", "LIMIT"]);
    expect(existsSync(join(dir, "logos", "AAA.jpg"))).toBe(true);
    expect(existsSync(join(dir, "logos", "NOPE.none"))).toBe(true);
    expect(existsSync(join(dir, "logos", "LIMIT.none"))).toBe(false);
  });

  it("honors the per-run limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "logos-"));
    const out = await syncLogos(["A", "B", "C"], { ...opts(dir, async (s) => ({ url: s })), limit: 2 });
    expect(out.saved).toBe(2);
  });
});

describe("upcomingSymbols", () => {
  it("lists future earnings symbols, soonest first, without repeats", () => {
    const e = (id, date, symbolId, kind = "earnings") => ({ id, date, symbolId, kind, title: "" });
    expect(upcomingSymbols([e("1", "2026-11-05", "B"), e("2", "2026-11-03", "A"), e("3", "2026-11-04", "A"), e("4", "2026-10-01", "OLD"), e("5", "2026-11-03", "X", "macro")], "2026-11-02")).toEqual(["A", "B"]);
  });
});
