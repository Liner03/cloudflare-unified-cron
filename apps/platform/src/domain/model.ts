import type { JsonValue, RetryPolicy } from "@unified-cron/contracts";

export type ExecutionStatus =
  | "pending"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "unknown"
  | "skipped"
  | "cancelled";

export type DispatchReason = "initial" | "automatic_retry" | "operator_retry";
export type ExecutionSource = "cron" | "manual" | "rerun";

export interface ScheduleSnapshot {
  scheduleId: string;
  scheduleRevision: number;
  targetId: string;
  action: string;
  actionVersion: number;
  targetManifestRevision: string;
  targetActionIdempotent: boolean;
  payload: JsonValue;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
  cronExpression: string;
  timezone: string;
}

export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

export const ACTIVE_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "pending",
  "running",
  "retry_wait",
  "unknown",
];

export function retryDelayMs(policy: RetryPolicy, completedAttemptNumber: number): number | null {
  if (completedAttemptNumber >= policy.maxAttempts) return null;
  const seconds = policy.delaysSeconds[completedAttemptNumber - 1];
  return seconds === undefined ? null : seconds * 1000;
}

export function canAutomaticallyRetry(input: {
  policy: RetryPolicy;
  snapshotIdempotent: boolean;
  currentIdempotent: boolean;
  completedAttemptNumber: number;
  retryable: boolean;
  outcomeUnknown: boolean;
  nowMs: number;
  retryDeadlineAt: number;
}): boolean {
  if (!input.snapshotIdempotent || !input.currentIdempotent) return false;
  if (input.completedAttemptNumber >= input.policy.maxAttempts) return false;
  if (input.nowMs >= input.retryDeadlineAt) return false;
  return input.outcomeUnknown ? input.policy.retryOnUnknown : input.retryable;
}
