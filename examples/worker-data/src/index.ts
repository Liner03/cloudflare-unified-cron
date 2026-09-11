import {
  CronError,
  createCronHandler,
  defineAction,
} from "@unified-cron/worker-sdk";
import { createRegistrationClient } from "@unified-cron/worker-sdk/registration";
import { CronEntrypointBase } from "@unified-cron/worker-sdk/entrypoint";
import {
  cronRequestV1Schema,
  jsonValueSchema,
  type CronRequestV1,
} from "@unified-cron/contracts";
import { z } from "zod";

const scenarioModeSchema = z.enum([
  "success",
  "permanent_failure",
  "retryable_then_success",
  "throw_before_effect",
  "timeout_after_effect",
  "slow_success",
  "malformed_result",
  "identity_mismatch",
  "duplicate_idempotency",
  "non_idempotent_failure",
]);
type ScenarioMode = z.infer<typeof scenarioModeSchema>;

const scenarioPayloadSchema = z.object({
  mode: scenarioModeSchema,
  delayMs: z.number().int().min(0).max(30_000),
  originalPayload: jsonValueSchema,
});

const cronHandler = createCronHandler<Env>({
  healthCheck: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: z.object({}),
    run(_payload, context) {
      return Promise.resolve({
        summary: "Worker data is healthy",
        targetBuildId: context.env.BUILD_ID,
      });
    },
  }),
  syncUsers: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: z.object({ source: z.string().min(1).max(64) }),
    async run(payload, context) {
      if (context.signal.aborted) throw context.signal.reason;
      const stored = JSON.stringify({ processed: 1, source: payload.source });
      await context.env.BUSINESS_DB.prepare(
        `INSERT INTO idempotent_results (idempotency_key, action, result_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
        .bind(
          context.request.idempotencyKey,
          context.request.action,
          stored,
          Date.now(),
        )
        .run();
      const row = await context.env.BUSINESS_DB.prepare(
        `SELECT result_json FROM idempotent_results WHERE idempotency_key = ? AND action = ?`,
      )
        .bind(context.request.idempotencyKey, context.request.action)
        .first<{ result_json: string }>();
      if (!row) throw new Error("Idempotent result was not persisted");
      return {
        summary: "Users synchronized",
        output: jsonValueSchema.parse(JSON.parse(row.result_json)),
        targetBuildId: context.env.BUILD_ID,
      };
    },
  }),
  testScenario: defineAction({
    version: 1,
    idempotent: true,
    payloadSchema: scenarioPayloadSchema,
    async run(payload, context) {
      return runScenario(payload, context);
    },
  }),
  nonIdempotentScenario: defineAction({
    version: 1,
    idempotent: false,
    payloadSchema: scenarioPayloadSchema,
    async run(payload, context) {
      return runScenario(payload, context);
    },
  }),
});

async function runScenario(
  payload: z.infer<typeof scenarioPayloadSchema>,
  context: {
    env: Env;
    request: CronRequestV1;
    signal: AbortSignal;
  },
) {
  switch (payload.mode) {
    case "permanent_failure":
    case "non_idempotent_failure":
      throw CronError.permanent(
        "TEST_PERMANENT_FAILURE",
        "Deterministic Test Target failure",
      );
    case "retryable_then_success":
      throw CronError.retryable(
        "TEST_RETRYABLE_FAILURE",
        "Deterministic retryable Test Target failure",
      );
    case "throw_before_effect":
      throw new Error("Deterministic throw before business effect");
    case "timeout_after_effect":
      await persistScenarioEffect(context.env, context.request);
      await waitForAbort(context.signal);
      throw new Error("Deadline abort did not stop the Test Target");
    case "slow_success": {
      const remaining =
        Date.parse(context.request.deadlineAt) - Date.now() - 100;
      await delay(Math.max(0, Math.min(payload.delayMs || 750, remaining)));
      break;
    }
    case "success":
    case "duplicate_idempotency":
      break;
    case "malformed_result":
    case "identity_mismatch":
      throw new Error("Special result mode must be handled by the Entrypoint");
  }
  await persistScenarioEffect(context.env, context.request);
  return {
    summary: `Test Target ${payload.mode}`,
    output: { mode: payload.mode },
    targetBuildId: context.env.BUILD_ID,
  };
}

async function persistScenarioEffect(
  env: Env,
  request: CronRequestV1,
): Promise<void> {
  await env.BUSINESS_DB.prepare(
    `INSERT INTO test_side_effects (
       idempotency_key, action, payload_hash, created_at
     ) VALUES (?, ?, ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
  )
    .bind(
      request.idempotencyKey,
      request.action,
      await sha256Hex(JSON.stringify(request.payload)),
      Date.now(),
    )
    .run();
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    signal.addEventListener("abort", () => reject(abortReason(signal)), {
      once: true,
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason ?? "Aborted"));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function publishRegistration(env: Env) {
  return createRegistrationClient({
    endpoint: env.PLATFORM_REGISTRATION_URL,
    token: env.REGISTRATION_TOKEN,
  }).register({
    protocolVersion: 1,
    registrationRevision: env.BUILD_ID,
    worker: { label: "Data Worker" },
    actions: [
      {
        name: "healthCheck",
        version: 1,
        label: "健康检查",
        description: "无副作用检查示例 Worker",
        idempotent: true,
        examplePayload: {},
      },
      {
        name: "syncUsers",
        version: 1,
        label: "同步用户",
        description: "展示业务侧持久化幂等的示例 Action",
        idempotent: true,
        examplePayload: { source: "crm" },
      },
      {
        name: "testScenario",
        version: 1,
        label: "测试场景",
        description: "仅写入 Test Target D1 的确定性场景",
        idempotent: true,
        examplePayload: {},
      },
      {
        name: "nonIdempotentScenario",
        version: 1,
        label: "非幂等测试场景",
        description: "验证平台拒绝危险自动重试",
        idempotent: false,
        examplePayload: {},
      },
    ],
    schedules: [
      {
        key: "health-check",
        name: "Worker 健康检查",
        description: "由 Data Worker 完整声明",
        action: "healthCheck",
        actionVersion: 1,
        cronExpression: "*/5 * * * *",
        timezone: "UTC",
        enabled: true,
        payload: {},
        retryPolicy: {
          maxAttempts: 1,
          delaysSeconds: [],
          retryOnUnknown: false,
        },
      },
      {
        key: "sync-users",
        name: "同步用户",
        description: "每小时从 CRM 收敛同步用户",
        action: "syncUsers",
        actionVersion: 1,
        cronExpression: "0 * * * *",
        timezone: "UTC",
        enabled: true,
        payload: { source: "crm" },
        retryPolicy: {
          maxAttempts: 3,
          delaysSeconds: [60, 300],
          retryOnUnknown: true,
        },
      },
      {
        key: "test-scenario",
        name: "Test Target 场景",
        description: "确定性本地与 Staging 故障注入",
        action: "testScenario",
        actionVersion: 1,
        cronExpression: "* * * * *",
        timezone: "UTC",
        enabled: true,
        payload: {},
        retryPolicy: {
          maxAttempts: 2,
          delaysSeconds: [60],
          retryOnUnknown: false,
        },
        timeoutMs: 1_000,
      },
      {
        key: "non-idempotent-scenario",
        name: "Test Target 非幂等场景",
        description: "默认停用，仅用于危险重试守卫验证",
        action: "nonIdempotentScenario",
        actionVersion: 1,
        cronExpression: "0 0 1 1 *",
        timezone: "UTC",
        enabled: false,
        payload: {},
        retryPolicy: {
          maxAttempts: 1,
          delaysSeconds: [],
          retryOnUnknown: false,
        },
        timeoutMs: 1_000,
      },
    ],
  });
}

export class CronEntrypoint extends CronEntrypointBase<Env> {
  async cron(input: unknown): Promise<unknown> {
    const request = cronRequestV1Schema.parse(input);
    if (
      request.action !== "testScenario" &&
      request.action !== "nonIdempotentScenario"
    ) {
      return cronHandler.cron(request, { env: this.env, ctx: this.ctx });
    }

    const startedAt = Date.now();
    const scenario = await takeScenario(this.env.BUSINESS_DB);
    const mode: ScenarioMode =
      request.action === "nonIdempotentScenario"
        ? "non_idempotent_failure"
        : scenario.mode;
    try {
      if (mode === "malformed_result") {
        return { malformed: true };
      }
      if (mode === "identity_mismatch") {
        return {
          protocolVersion: 1,
          executionId: `${request.executionId}-mismatch`,
          attemptId: request.attemptId,
          ok: true,
          summary: "Mismatched identity",
        };
      }
      return await cronHandler.cron(
        {
          ...request,
          payload: {
            mode,
            delayMs: scenario.delayMs,
            originalPayload: request.payload,
          },
        },
        { env: this.env, ctx: this.ctx },
      );
    } finally {
      await recordReceipt(this.env.BUSINESS_DB, request, {
        mode,
        startedAt,
        finishedAt: Date.now(),
      });
    }
  }

  describe(): Promise<unknown> {
    return Promise.resolve(cronHandler.describe());
  }
}

async function takeScenario(
  db: D1Database,
): Promise<{ mode: ScenarioMode; delayMs: number }> {
  const row = await db
    .prepare(
      `DELETE FROM scenario_queue
       WHERE id = 1
       RETURNING mode, delay_ms`,
    )
    .first<{ mode: string; delay_ms: number }>();
  return row
    ? { mode: scenarioModeSchema.parse(row.mode), delayMs: row.delay_ms }
    : { mode: "success", delayMs: 0 };
}

async function recordReceipt(
  db: D1Database,
  request: CronRequestV1,
  timing: {
    mode: ScenarioMode;
    startedAt: number;
    finishedAt: number;
  },
): Promise<void> {
  const payloadHash = await sha256Hex(JSON.stringify(request.payload));
  const effect = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM test_side_effects
       WHERE idempotency_key = ?`,
    )
    .bind(request.idempotencyKey)
    .first<{ count: number }>();
  await db
    .prepare(
      `INSERT INTO rpc_receipts (
         id, execution_id, attempt_id, idempotency_key, action,
         payload_hash, started_at, finished_at, mode, side_effect_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      request.executionId,
      request.attemptId,
      request.idempotencyKey,
      request.action,
      payloadHash,
      timing.startedAt,
      timing.finishedAt,
      timing.mode,
      effect?.count ?? 0,
    )
    .run();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const scenarioControlSchema = z
  .object({
    mode: scenarioModeSchema,
    delayMs: z.number().int().min(0).max(30_000).default(0),
  })
  .strict();

async function handleTestControl(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isTestEnvironment(env.APP_ENV)) {
    return Response.json({ error: "TEST_ENV_REQUIRED" }, { status: 403 });
  }
  if (!env.TEST_CONTROL_SECRET) {
    return Response.json(
      { error: "TEST_CONTROL_UNCONFIGURED" },
      { status: 503 },
    );
  }
  const authorization = request.headers.get("Authorization");
  const provided = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!(await secretsEqual(provided, env.TEST_CONTROL_SECRET))) {
    return Response.json(
      { error: "TEST_CONTROL_UNAUTHORIZED" },
      { status: 401 },
    );
  }

  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === "/__test/scenario") {
    const value = scenarioControlSchema.safeParse(
      JSON.parse(await readBoundedText(request, 4096)),
    );
    if (!value.success) {
      return Response.json({ error: "INVALID_SCENARIO" }, { status: 400 });
    }
    await env.BUSINESS_DB.batch([
      env.BUSINESS_DB.prepare("DELETE FROM scenario_queue"),
      env.BUSINESS_DB.prepare(
        `INSERT INTO scenario_queue (id, mode, delay_ms, created_at)
         VALUES (1, ?, ?, ?)`,
      ).bind(value.data.mode, value.data.delayMs, Date.now()),
    ]);
    return Response.json({ data: { configured: true, mode: value.data.mode } });
  }
  if (request.method === "GET" && path === "/__test/receipts") {
    const result = await env.BUSINESS_DB.prepare(
      `SELECT execution_id, attempt_id, idempotency_key, action, payload_hash,
              started_at, finished_at, mode, side_effect_count
       FROM rpc_receipts ORDER BY started_at, id`,
    ).all();
    return Response.json({ data: result.results });
  }
  if (request.method === "POST" && path === "/__test/register") {
    return Response.json({ data: await publishRegistration(env) });
  }
  if (request.method === "POST" && path === "/__test/reset") {
    await env.BUSINESS_DB.batch([
      env.BUSINESS_DB.prepare("DELETE FROM scenario_queue"),
      env.BUSINESS_DB.prepare("DELETE FROM rpc_receipts"),
      env.BUSINESS_DB.prepare("DELETE FROM test_side_effects"),
      env.BUSINESS_DB.prepare("DELETE FROM idempotent_results"),
    ]);
    return Response.json({ data: { reset: true } });
  }
  return Response.json({ error: "NOT_FOUND" }, { status: 404 });
}

export function isTestEnvironment(value: string): boolean {
  return value === "test" || value === "staging";
}

async function readBoundedText(
  request: Request,
  maximumBytes: number,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("TEST_CONTROL_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function secretsEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

export default {
  async fetch(request, env): Promise<Response> {
    if (new URL(request.url).pathname.startsWith("/__test/")) {
      try {
        return await handleTestControl(request, env);
      } catch (error) {
        const code =
          error instanceof Error ? error.message : "TEST_CONTROL_ERROR";
        return Response.json({ error: code }, { status: 400 });
      }
    }
    console.log(
      JSON.stringify({
        event: "test_target_http",
        buildId: env.BUILD_ID,
        path: new URL(request.url).pathname,
      }),
    );
    return Response.json({
      service: "worker-data",
      websitePreserved: true,
      buildId: env.BUILD_ID,
    });
  },
} satisfies ExportedHandler<Env>;
