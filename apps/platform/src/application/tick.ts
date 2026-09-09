import type { CronRequestV1, CronResultV1 } from "@unified-cron/contracts";
import type { Clock } from "../domain/model";
import {
  ExecutionRepository,
  makeFailureDecision,
  parseSnapshot,
  type ClaimedExecution,
  type FinalizeDecision,
} from "../infrastructure/d1/execution-repository";
import { ServiceBindingAdapter } from "../infrastructure/rpc/service-binding-adapter";
import { RegisteredTargetCatalog } from "../infrastructure/d1/registered-target-catalog";

const MAX_MATERIALIZE_PER_TICK = 2;
const MAX_ATTEMPTS_PER_TICK = 2;
const MAX_RECOVERIES_PER_TICK = 2;
const TICK_SOFT_WALL_BUDGET_MS = 45_000;
const FINALIZE_RESERVE_MS = 2_000;

export interface TickResult {
  tickId: string;
  outcome: "succeeded" | "degraded" | "failed" | "paused";
  materialized: number;
  dispatched: number;
  recovered: number;
  errors: number;
}

export class TickApplication {
  constructor(
    private readonly repository: ExecutionRepository,
    private readonly targets: RegisteredTargetCatalog,
    private readonly adapter: ServiceBindingAdapter,
    private readonly clock: Clock,
    private readonly instanceId: string,
    private readonly buildVersion: string,
  ) {}

  async run(scheduledAt: number): Promise<TickResult> {
    const tickId = crypto.randomUUID();
    const startedAt = this.clock.nowMs();
    let materialized = 0;
    let dispatched = 0;
    let recovered = 0;
    let errors = 0;
    let outcome: TickResult["outcome"] = "succeeded";
    try {
      const state = await this.repository.beginTick({
        tickId,
        scheduledAt,
        startedAt,
        buildVersion: this.buildVersion,
      });
      recovered = await this.repository.recoverExpiredLeases(
        this.clock.nowMs(),
        MAX_RECOVERIES_PER_TICK,
      );
      await this.repository.expireAutomaticRetryWindows(this.clock.nowMs());
      if (state.dispatchPaused) {
        outcome = "paused";
      } else {
        const due = await this.repository.listDue(
          this.clock.nowMs(),
          MAX_MATERIALIZE_PER_TICK,
        );
        for (const schedule of due) {
          if (
            await this.repository.materializeDue(schedule, this.clock.nowMs())
          )
            materialized += 1;
        }

        const ready = await this.repository.listReady(
          this.clock.nowMs(),
          MAX_ATTEMPTS_PER_TICK,
        );
        const tasks: Array<Promise<boolean>> = [];
        for (const execution of ready) {
          const remaining =
            TICK_SOFT_WALL_BUDGET_MS - (this.clock.nowMs() - startedAt);
          const snapshot = parseSnapshot(execution.snapshot_json);
          if (remaining < snapshot.timeoutMs + FINALIZE_RESERVE_MS) break;
          const claimed = await this.repository.claim(
            execution,
            this.clock.nowMs(),
          );
          if (claimed) tasks.push(this.dispatch(claimed));
        }
        const results = await Promise.allSettled(tasks);
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) dispatched += 1;
          else errors += 1;
        }
        if (errors > 0) outcome = "degraded";
      }
      if (
        this.clock.nowMs() - startedAt <
        TICK_SOFT_WALL_BUDGET_MS - FINALIZE_RESERVE_MS
      ) {
        await this.repository.cleanupHistory(this.clock.nowMs());
      }
    } catch (error) {
      errors += 1;
      outcome = "failed";
      console.error(
        JSON.stringify({
          event: "tick_failed",
          tickId,
          platformInstanceId: this.instanceId,
          errorCode: safeErrorCode(error),
        }),
      );
    }

    const finishedAt = this.clock.nowMs();
    try {
      await this.repository.finishTick({
        tickId,
        finishedAt,
        outcome,
        error: errors > 0 ? `${errors} platform operation(s) failed` : null,
      });
    } catch (error) {
      outcome = "failed";
      errors += 1;
      console.error(
        JSON.stringify({
          event: "tick_heartbeat_finalize_failed",
          tickId,
          errorCode: safeErrorCode(error),
        }),
      );
    }
    return { tickId, outcome, materialized, dispatched, recovered, errors };
  }

  private async dispatch(claim: ClaimedExecution): Promise<boolean> {
    const snapshot = parseSnapshot(claim.snapshot_json);
    const capability = await this.targets.findCapability(
      claim.target_id,
      snapshot.action,
      snapshot.actionVersion,
    );
    const nowMs = this.clock.nowMs();
    if (!capability) {
      return this.repository.finalize(
        claim,
        makeFailureDecision({
          snapshot,
          attemptNumber: claim.attempt_count,
          nowMs,
          retryDeadlineAt: nowMs,
          currentIdempotent: false,
          retryable: false,
          unknown: false,
          errorJson: JSON.stringify({
            code: "TARGET_CAPABILITY_REMOVED",
            message: "目标 Action 或版本已移除",
          }),
        }),
        nowMs,
      );
    }
    const { target, action } = capability;
    const request: CronRequestV1 = {
      protocolVersion: 1,
      executionId: claim.id,
      attemptId: claim.attempt_id,
      scheduleId: claim.schedule_id,
      targetId: claim.target_id,
      action: snapshot.action,
      actionVersion: snapshot.actionVersion,
      source: claim.source,
      dispatchReason: claim.next_attempt_reason,
      attemptNumber: claim.attempt_count,
      scheduledFor:
        claim.scheduled_for === null
          ? null
          : new Date(claim.scheduled_for).toISOString(),
      requestedAt: new Date(nowMs).toISOString(),
      deadlineAt: new Date(claim.deadline_at).toISOString(),
      idempotencyKey: `ucp:v1:${this.instanceId}:${claim.id}`,
      payload: snapshot.payload,
    };

    let decision: FinalizeDecision;
    try {
      const result = await withDeadline(
        this.adapter.execute(target, request),
        claim.deadline_at - nowMs,
      );
      decision = result.ok
        ? successDecision(result, claim.attempt_id, this.clock.nowMs())
        : makeFailureDecision({
            snapshot,
            attemptNumber: claim.attempt_count,
            nowMs: this.clock.nowMs(),
            retryDeadlineAt: claim.retry_deadline_at,
            currentIdempotent: action.idempotent,
            retryable: result.error.retryable,
            unknown: false,
            errorJson: JSON.stringify(result.error),
          });
    } catch (error) {
      decision = makeFailureDecision({
        snapshot,
        attemptNumber: claim.attempt_count,
        nowMs: this.clock.nowMs(),
        retryDeadlineAt: claim.retry_deadline_at,
        currentIdempotent: action.idempotent,
        retryable: false,
        unknown: true,
        errorJson: JSON.stringify({
          code: safeErrorCode(error),
          message: "RPC 结果无法确认",
        }),
      });
    }
    const finalized = await this.repository.finalize(
      claim,
      decision,
      this.clock.nowMs(),
    );
    if (!finalized) {
      console.warn(
        JSON.stringify({
          event: "late_result_ignored",
          executionId: claim.id,
          attemptId: claim.attempt_id,
          targetId: claim.target_id,
        }),
      );
    }
    return finalized;
  }
}

function successDecision(
  result: Extract<CronResultV1, { ok: true }>,
  attemptId: string,
  nowMs: number,
): FinalizeDecision {
  return {
    executionStatus: "succeeded",
    attemptStatus: "succeeded",
    availableAt: nowMs,
    nextAttemptReason: "initial",
    resultJson: JSON.stringify({ summary: result.summary, attemptId }),
    errorJson: null,
    targetBuildId: result.targetBuildId ?? null,
  };
}

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (timeoutMs <= 0) throw new Error("RPC_TIMEOUT");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("RPC_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function safeErrorCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,127}$/.test(error.message))
    return error.message;
  return "RPC_OUTCOME_UNKNOWN";
}
