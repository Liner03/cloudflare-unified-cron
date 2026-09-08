import { describe, expect, it } from "vitest";
import { CronCalculator, validateCronExpression } from "../src/infrastructure/cron/cron-calculator";

const calculator = new CronCalculator();

describe("CronCalculator", () => {
  it("is strictly after the base instant", () => {
    expect(calculator.nextAfter("*/5 * * * *", "UTC", Date.parse("2026-09-08T00:00:00Z"))).toBe(
      Date.parse("2026-09-08T00:05:00Z"),
    );
  });

  it("supports IANA timezones", () => {
    expect(calculator.nextAfter("0 8 * * *", "Asia/Kuala_Lumpur", Date.parse("2026-09-08T00:00:00Z"))).toBe(
      Date.parse("2026-09-09T00:00:00Z"),
    );
  });

  it.each(["0 0 1 * 1", "0 0 * * MON", "0 0 0 * * *", "@daily", "0 0 L * *"])(
    "rejects unsupported cron %s",
    (expression) => expect(() => validateCronExpression(expression)).toThrow(),
  );

  it("uses Unix weekday numbering where 1 is Monday", () => {
    expect(calculator.nextAfter("0 0 * * 1", "UTC", Date.parse("2026-09-06T12:00:00Z"))).toBe(
      Date.parse("2026-09-07T00:00:00Z"),
    );
  });

  it("crosses month, year, leap-day and day-31 boundaries", () => {
    expect(calculator.nextAfter("59 23 31 12 *", "UTC", Date.parse("2026-12-31T23:58:00Z"))).toBe(
      Date.parse("2026-12-31T23:59:00Z"),
    );
    expect(calculator.nextAfter("0 0 31 * *", "UTC", Date.parse("2026-04-01T00:00:00Z"))).toBe(
      Date.parse("2026-05-31T00:00:00Z"),
    );
    expect(calculator.nextAfter("0 0 29 2 *", "UTC", Date.parse("2026-03-01T00:00:00Z"))).toBe(
      Date.parse("2028-02-29T00:00:00Z"),
    );
  });

  it("locks cron-parser 5.10 DST behavior for New York in 2026", () => {
    expect(calculator.nextAfter("30 2 * * *", "America/New_York", Date.parse("2026-03-07T07:30:00Z"))).toBe(
      Date.parse("2026-03-08T07:30:00Z"),
    );
    const fall = calculator.preview("30 1 * * *", "America/New_York", Date.parse("2026-10-31T05:30:00Z"), 2);
    expect(fall).toEqual([Date.parse("2026-11-01T05:30:00Z"), Date.parse("2026-11-02T06:30:00Z")]);
  });

  it("fails within the bounded search window for impossible dates", () => {
    expect(() => calculator.nextAfter("0 0 31 2 *", "UTC", Date.parse("2026-01-01T00:00:00Z"))).toThrow();
    expect(() => calculator.nextAfter("* * * * *", "Not/A_Timezone", Date.now())).toThrow();
  });
});
