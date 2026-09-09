import type { JsonValue } from "@unified-cron/contracts";
import { DomainError } from "../../domain/error";

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MutationPlan {
  statement: D1PreparedStatement;
  response: JsonValue;
  status: 200 | 202;
  action: string;
  entityType: string;
  entityId: string;
  changes: JsonValue;
  conflictCode: string;
  conflictMessage: string;
}

export interface MutationOutcome {
  responseJson: string;
  status: 200 | 202;
}

interface StoredIdempotency {
  request_hash: string;
  status_code: 200 | 202;
  response_json: string;
}

/** Persists one audited mutation and its replay response in a D1 transaction. */
export class IdempotentMutationRepository {
  constructor(private readonly db: D1Database) {}

  async execute(
    input: {
      scope: string;
      key: string;
      actor: string;
      rawBody: Uint8Array;
      now: number;
    },
    createPlan: () => Promise<MutationPlan> | MutationPlan,
  ): Promise<MutationOutcome> {
    const requestHash = await sha256(input.rawBody);
    const stored = await this.readStored(input.scope, input.key, input.now);
    if (stored) return replay(stored, requestHash);

    const plan = await createPlan();
    const responseJson = JSON.stringify(plan.response);
    try {
      await this.db.batch([
        this.db
          .prepare(
            `INSERT INTO api_idempotency (
               scope, key, request_hash, status_code, response_json,
               created_at, expires_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.scope,
            input.key,
            requestHash,
            plan.status,
            responseJson,
            input.now,
            input.now + IDEMPOTENCY_TTL_MS,
          ),
        plan.statement,
        this.db.prepare(
          "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json('') END AS mutation_applied",
        ),
        this.db
          .prepare(
            `INSERT INTO audit_events (
               id, actor, action, entity_type, entity_id, changes_json,
               created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            input.actor,
            plan.action,
            plan.entityType,
            plan.entityId,
            JSON.stringify(plan.changes),
            input.now,
          ),
      ]);
    } catch (error) {
      const raced = await this.readStored(input.scope, input.key, input.now);
      if (raced) return replay(raced, requestHash);
      if (isMutationConflict(error)) {
        throw new DomainError(
          "conflict",
          plan.conflictCode,
          plan.conflictMessage,
        );
      }
      throw error;
    }
    return { responseJson, status: plan.status };
  }

  private readStored(
    scope: string,
    key: string,
    now: number,
  ): Promise<StoredIdempotency | null> {
    return this.db
      .prepare(
        `SELECT request_hash, status_code, response_json
         FROM api_idempotency
         WHERE scope = ? AND key = ? AND expires_at > ?`,
      )
      .bind(scope, key, now)
      .first<StoredIdempotency>();
  }
}

function replay(
  stored: StoredIdempotency,
  requestHash: string,
): MutationOutcome {
  if (stored.request_hash !== requestHash) {
    throw new DomainError(
      "conflict",
      "IDEMPOTENCY_CONFLICT",
      "相同 Idempotency-Key 已用于不同请求体",
    );
  }
  return { responseJson: stored.response_json, status: stored.status_code };
}

async function sha256(value: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(value.byteLength);
  bytes.set(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isMutationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /constraint failed|malformed JSON|UNIQUE constraint/i.test(
    error.message,
  );
}
