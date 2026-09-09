import { describe, expect, it, vi } from "vitest";
import { cronResultV1Schema } from "@unified-cron/contracts";
import { z } from "zod";
import {
  CronError,
  RegistrationError,
  createCronHandler,
  createRegistrationClient,
  defineAction,
} from "./index";

const baseRequest = {
  protocolVersion: 1 as const,
  executionId: "execution-1",
  attemptId: "attempt-1",
  scheduleId: "schedule-1",
  targetId: "DATA",
  action: "sync",
  actionVersion: 1,
  source: "manual" as const,
  dispatchReason: "initial" as const,
  attemptNumber: 1,
  scheduledFor: null,
  requestedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  idempotencyKey: "ucp:v1:platform:execution-1",
  payload: { source: "crm" },
};

describe("worker sdk", () => {
  it("publishes a complete registration with a scoped bearer token", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          data: {
            targetId: "DATA",
            registrationRevision: "build-123",
            unchanged: false,
            actions: 1,
            schedules: 0,
            retiredSchedules: 0,
            registeredAt: "2026-09-09T00:00:00.000Z",
          },
        }),
      ),
    );
    const client = createRegistrationClient({
      endpoint: "https://cron.example.com/api/v1/registration",
      token: `ucrt_${"a".repeat(43)}`,
      fetcher,
    });
    await expect(
      client.register({
        protocolVersion: 1,
        registrationRevision: "build-123",
        worker: { label: "Data Worker" },
        actions: [
          { name: "sync", version: 1, label: "Sync", idempotent: true },
        ],
        schedules: [],
      }),
    ).resolves.toMatchObject({ targetId: "DATA", unchanged: false });
    expect(fetcher).toHaveBeenCalledOnce();
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe("https://cron.example.com/api/v1/registration");
    expect(request?.[1]?.headers).toMatchObject({
      Authorization: `Bearer ucrt_${"a".repeat(43)}`,
      "Content-Type": "application/json",
    });
  });

  it("surfaces structured registration failures without leaking the token", async () => {
    const client = createRegistrationClient({
      endpoint: "https://cron.example.com/api/v1/registration",
      token: `ucrt_${"b".repeat(43)}`,
      fetcher: () =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "REGISTRATION_REVISION_CONFLICT",
                message: "conflict",
                requestId: "request-1",
              },
            },
            { status: 409 },
          ),
        ),
    });
    await expect(
      client.register({
        protocolVersion: 1,
        registrationRevision: "build-123",
        worker: { label: "Data Worker" },
        actions: [],
        schedules: [],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "REGISTRATION_REVISION_CONFLICT",
      requestId: "request-1",
    } satisfies Partial<RegistrationError>);
  });

  it("wraps successful actions with current attempt identity", async () => {
    const run = vi.fn(() =>
      Promise.resolve({ summary: "synchronized", output: { count: 2 } }),
    );
    const handler = createCronHandler<Record<string, never>>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        run,
      }),
    });
    const result = await handler.cron(baseRequest, {
      env: {},
      ctx: {} as ExecutionContext,
    });

    expect(result).toMatchObject({
      ok: true,
      executionId: "execution-1",
      attemptId: "attempt-1",
    });
    expect(run).toHaveBeenCalledOnce();
  });

  it("turns explicit CronError into a declared failure", async () => {
    const handler = createCronHandler<Record<string, never>>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        run() {
          return Promise.reject(
            CronError.retryable("UPSTREAM_503", "temporary failure"),
          );
        },
      }),
    });
    await expect(
      handler.cron(baseRequest, { env: {}, ctx: {} as ExecutionContext }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_503", retryable: true },
    });
  });

  it("normalizes invalid explicit CronError codes into a valid failure", async () => {
    for (const code of ["", "X".repeat(129)]) {
      const handler = createCronHandler<Record<string, never>>({
        sync: defineAction({
          version: 1,
          idempotent: true,
          payloadSchema: z.object({ source: z.string() }),
          run() {
            return Promise.reject(CronError.permanent(code, "invalid code"));
          },
        }),
      });
      const result = await handler.cron(baseRequest, {
        env: {},
        ctx: {} as ExecutionContext,
      });
      expect(result).toMatchObject({
        ok: false,
        error: { code: "INVALID_CRON_ERROR_CODE", retryable: false },
      });
      expect(() => cronResultV1Schema.parse(result)).not.toThrow();
    }
  });

  it("returns a permanent failure envelope when payload exceeds the limit", async () => {
    const run = vi.fn(() => Promise.resolve({ summary: "unreachable" }));
    const handler = createCronHandler<Record<string, never>>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        run,
      }),
    });

    await expect(
      handler.cron(
        { ...baseRequest, payload: { source: "x".repeat(17 * 1024) } },
        { env: {}, ctx: {} as ExecutionContext },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PAYLOAD_TOO_LARGE", retryable: false },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("rethrows unknown exceptions so the platform records unknown", async () => {
    const handler = createCronHandler<Record<string, never>>({
      sync: defineAction({
        version: 1,
        idempotent: true,
        payloadSchema: z.object({ source: z.string() }),
        run() {
          return Promise.reject(new Error("connection lost"));
        },
      }),
    });
    await expect(
      handler.cron(baseRequest, { env: {}, ctx: {} as ExecutionContext }),
    ).rejects.toThrow("connection lost");
  });

  it("routes multiple supported versions of the same action name", async () => {
    const versionOne = defineAction<Record<string, never>, { source: string }>({
      version: 1,
      idempotent: true,
      payloadSchema: z.object({ source: z.string() }),
      run: () => Promise.resolve({ summary: "v1" }),
    });
    const versionTwo = defineAction<Record<string, never>, { source: string }>({
      version: 2,
      idempotent: true,
      payloadSchema: z.object({ source: z.string() }),
      run: () => Promise.resolve({ summary: "v2" }),
    });
    const handler = createCronHandler<Record<string, never>>({
      sync: [versionOne, versionTwo],
    });

    expect(handler.describe().actions).toEqual([
      { name: "sync", version: 1, idempotent: true },
      { name: "sync", version: 2, idempotent: true },
    ]);
    await expect(
      handler.cron(
        { ...baseRequest, actionVersion: 2 },
        { env: {}, ctx: {} as ExecutionContext },
      ),
    ).resolves.toMatchObject({ ok: true, summary: "v2" });
  });

  it("rejects empty and duplicate version registrations at startup", () => {
    expect(() =>
      createCronHandler<Record<string, never>>({ sync: [] }),
    ).toThrow("must register at least one version");
    const action = defineAction<Record<string, never>, { source: string }>({
      version: 1,
      idempotent: true,
      payloadSchema: z.object({ source: z.string() }),
      run: () => Promise.resolve({ summary: "done" }),
    });
    expect(() =>
      createCronHandler<Record<string, never>>({ sync: [action, action] }),
    ).toThrow("Duplicate action registration");
  });
});
