import { describe, expect, it } from "vitest";
import {
  canAutomaticallyRetry,
  retryDelayMs,
  systemClock,
} from "../src/domain/model";
import { makeSuccessDecision } from "../src/application/tick";

const policy = {
  maxAttempts: 3,
  delaysSeconds: [60, 300],
  retryOnUnknown: false,
};

describe("retry policy", () => {
  it("persists bounded Worker output with the success summary", () => {
    const decision = makeSuccessDecision(
      {
        protocolVersion: 1,
        executionId: "execution-1",
        attemptId: "attempt-1",
        ok: true,
        summary: "Processed two records",
        output: { processed: 2, ids: ["a", "b"] },
        targetBuildId: "worker-build-1",
      },
      "attempt-1",
      1000,
    );

    expect(JSON.parse(decision.resultJson!)).toEqual({
      summary: "Processed two records",
      output: { processed: 2, ids: ["a", "b"] },
      attemptId: "attempt-1",
    });
    expect(decision.targetBuildId).toBe("worker-build-1");
  });

  it("uses the delay following the completed attempt", () => {
    expect(retryDelayMs(policy, 1)).toBe(60_000);
    expect(retryDelayMs(policy, 2)).toBe(300_000);
    expect(retryDelayMs(policy, 3)).toBeNull();
    expect(retryDelayMs({ ...policy, delaysSeconds: [] }, 1)).toBeNull();
    expect(systemClock.nowMs()).toBeGreaterThan(0);
  });

  it("requires both snapshot and current capability to be idempotent", () => {
    const base = {
      policy,
      snapshotIdempotent: true,
      currentIdempotent: true,
      completedAttemptNumber: 1,
      retryable: true,
      outcomeUnknown: false,
      nowMs: 1000,
      retryDeadlineAt: 2000,
    };
    expect(canAutomaticallyRetry(base)).toBe(true);
    expect(canAutomaticallyRetry({ ...base, currentIdempotent: false })).toBe(
      false,
    );
    expect(canAutomaticallyRetry({ ...base, snapshotIdempotent: false })).toBe(
      false,
    );
    expect(canAutomaticallyRetry({ ...base, completedAttemptNumber: 3 })).toBe(
      false,
    );
  });

  it("does not retry unknown outcomes unless explicitly enabled", () => {
    const input = {
      policy,
      snapshotIdempotent: true,
      currentIdempotent: true,
      completedAttemptNumber: 1,
      retryable: false,
      outcomeUnknown: true,
      nowMs: 1000,
      retryDeadlineAt: 2000,
    };
    expect(canAutomaticallyRetry(input)).toBe(false);
    expect(
      canAutomaticallyRetry({
        ...input,
        policy: { ...policy, retryOnUnknown: true },
      }),
    ).toBe(true);
    expect(
      canAutomaticallyRetry({
        ...input,
        policy: { ...policy, retryOnUnknown: true },
        nowMs: 2000,
      }),
    ).toBe(false);
  });
});
