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
});
