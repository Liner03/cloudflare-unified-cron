import { describe, expect, it } from "vitest";
import { normalizeCronDialect } from "./cron-dialect";
describe("L2-030 Cloudflare Cron conversion", () => {
  it.each([
    ["0 9 * * 1", "0 9 * * 0"],
    ["0 9 * * 2-6", "0 9 * * 1,2,3,4,5"],
    ["0 9 * JAN MON-FRI", "0 9 * 1 1,2,3,4,5"],
    ["0 9 * * */2", "0 9 * * 0,2,4,6"],
    ["0 0 1 * *", "0 0 1 * *"],
  ])("%s becomes %s", (input, output) =>
    expect(normalizeCronDialect(input, "cloudflare")).toBe(output),
  );
  it("preserves existing Unix semantics", () =>
    expect(normalizeCronDialect("0 9 * * 1")).toBe("0 9 * * 1"));
  it.each([
    "0 9 * * 0",
    "0 9 * * 1L",
    "0 9 * * MON#2",
    "0 9 1 * 2",
    "0 9 * * 7-1",
  ])("rejects unsupported or ambiguous %s", (value) =>
    expect(() => normalizeCronDialect(value, "cloudflare")).toThrow(),
  );
});
