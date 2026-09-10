import type { WorkerRegistrationV1 } from "@unified-cron/contracts";
import { describe, expect, it } from "vitest";
import {
  canonicalRegistrationDocument,
  canonicalScheduleConfiguration,
} from "../src/domain/registration-canonical";

const schedule: WorkerRegistrationV1["schedules"][number] = {
  key: "second",
  name: "Second",
  description: "",
  action: "sync",
  actionVersion: 1,
  cronExpression: "0 * * * *",
  timezone: "UTC",
  enabled: true,
  payload: { alpha: 1, nested: { first: true, second: false } },
  retryPolicy: { maxAttempts: 1, delaysSeconds: [], retryOnUnknown: false },
  timeoutMs: 30_000,
  misfirePolicy: "coalesce",
  misfireGraceSeconds: 300,
};

describe("Registration canonicalization", () => {
  it("ignores object, Action, and Schedule ordering", () => {
    const declaration: WorkerRegistrationV1 = {
      protocolVersion: 1,
      registrationRevision: "build-1",
      worker: { label: "Worker" },
      actions: [
        {
          name: "sync",
          version: 2,
          label: "Sync v2",
          description: "",
          idempotent: true,
        },
        {
          name: "sync",
          version: 1,
          label: "Sync v1",
          description: "",
          idempotent: true,
        },
      ],
      schedules: [schedule, { ...schedule, key: "first", name: "First" }],
    };
    const reordered: WorkerRegistrationV1 = {
      ...declaration,
      actions: [...declaration.actions].reverse(),
      schedules: [
        {
          ...schedule,
          key: "first",
          name: "First",
          payload: { nested: { second: false, first: true }, alpha: 1 },
        },
        {
          ...schedule,
          payload: { nested: { second: false, first: true }, alpha: 1 },
        },
      ],
    };

    expect(canonicalRegistrationDocument(reordered)).toBe(
      canonicalRegistrationDocument(declaration),
    );
  });

  it("preserves meaningful array order in Schedule payloads", () => {
    const ascending = canonicalScheduleConfiguration({
      ...schedule,
      payload: { values: [1, 2] },
    });
    const descending = canonicalScheduleConfiguration({
      ...schedule,
      payload: { values: [2, 1] },
    });

    expect(ascending).not.toBe(descending);
  });
});
