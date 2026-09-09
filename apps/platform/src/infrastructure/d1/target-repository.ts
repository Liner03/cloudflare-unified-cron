import { z } from "zod";
import { TARGETS } from "../../targets.manifest";
import { RegisteredTargetCatalog } from "./registered-target-catalog";
import { ApiError } from "../../api/errors";
import type { MutationPlan } from "./idempotent-mutation";

const targetStateSchema = z.object({
  id: z.string(),
  enabled: z.number(),
  last_check_at: z.number().nullable(),
  last_check_status: z
    .enum(["compatible", "incompatible", "unreachable"])
    .nullable(),
  last_check_message: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

const registrationRowSchema = z.object({
  target_id: z.string(),
  registration_revision: z.string(),
  worker_label: z.string(),
  registered_at: z.number(),
});

/** Assembles physical target configuration with its latest registered state. */
export class TargetRepository {
  constructor(
    private readonly db: D1Database,
    private readonly catalog = new RegisteredTargetCatalog(db),
  ) {}

  async list() {
    const [statesResult, registrationsResult, actions] = await Promise.all([
      this.db.prepare("SELECT * FROM targets ORDER BY id").all(),
      this.db
        .prepare(
          `SELECT target_id, registration_revision, worker_label, registered_at
           FROM registrations ORDER BY target_id`,
        )
        .all(),
      this.catalog.listAllActions(),
    ]);
    const states = new Map(
      statesResult.results.map((value) => {
        const row = targetStateSchema.parse(value);
        return [row.id, row] as const;
      }),
    );
    const registrations = new Map(
      registrationsResult.results.map((value) => {
        const row = registrationRowSchema.parse(value);
        return [
          row.target_id,
          {
            revision: row.registration_revision,
            workerLabel: row.worker_label,
            registeredAt: new Date(row.registered_at).toISOString(),
          },
        ] as const;
      }),
    );
    const actionsByTarget = new Map<string, typeof actions>();
    for (const action of actions) {
      const values = actionsByTarget.get(action.targetId) ?? [];
      values.push(action);
      actionsByTarget.set(action.targetId, values);
    }
    return TARGETS.map((target) => ({
      ...target,
      actions: (actionsByTarget.get(target.id) ?? []).map((action) => ({
        name: action.name,
        version: action.version,
        label: action.label,
        description: action.description,
        idempotent: action.idempotent,
        examplePayload: action.examplePayload,
      })),
      state: states.get(target.id) ?? null,
      registration: registrations.get(target.id) ?? null,
    }));
  }

  async detail(targetId: string) {
    const target = TARGETS.find((value) => value.id === targetId);
    if (!target) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
    }
    const [state, schedules, registrationValue, actions] = await Promise.all([
      this.db
        .prepare("SELECT * FROM targets WHERE id = ? LIMIT 1")
        .bind(targetId)
        .first(),
      this.db
        .prepare(
          `SELECT id, registration_key, name, action, action_version,
                  enabled, declared_enabled, operator_paused, next_run_at
           FROM schedules
           WHERE target_id = ? AND managed_by_registration = 1
             AND retired_at IS NULL
           ORDER BY name LIMIT 50`,
        )
        .bind(targetId)
        .all(),
      this.db
        .prepare(
          `SELECT target_id, registration_revision, worker_label, registered_at
           FROM registrations WHERE target_id = ? LIMIT 1`,
        )
        .bind(targetId)
        .first(),
      this.catalog.listActions(targetId),
    ]);
    const registration = registrationValue
      ? registrationRowSchema.parse(registrationValue)
      : null;
    return {
      ...target,
      actions,
      state,
      registration:
        registration === null
          ? null
          : {
              revision: registration.registration_revision,
              workerLabel: registration.worker_label,
              registeredAt: new Date(registration.registered_at).toISOString(),
            },
      schedules: schedules.results,
    };
  }

  planRecordCheck(input: {
    targetId: string;
    status: "compatible" | "incompatible" | "unreachable";
    message: string;
    now: number;
  }): MutationPlan {
    return {
      statement: this.db
        .prepare(
          `UPDATE targets SET last_check_at = ?, last_check_status = ?,
                              last_check_message = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.now,
          input.status,
          input.message,
          input.now,
          input.targetId,
        ),
      response: {
        data: {
          targetId: input.targetId,
          status: input.status,
          message: input.message,
          checkedAt: new Date(input.now).toISOString(),
        },
      },
      status: 200,
      action: "target.checked",
      entityType: "target",
      entityId: input.targetId,
      changes: { status: input.status },
      conflictCode: "TARGET_NOT_SYNCED",
      conflictMessage: "Target manifest 尚未同步到 D1",
    };
  }

  planEnabledState(
    targetId: string,
    operation: "enable" | "disable",
    now: number,
  ): MutationPlan {
    const target = TARGETS.find((value) => value.id === targetId);
    if (!target) {
      throw new ApiError(404, "TARGET_NOT_FOUND", "Target 不在部署白名单中");
    }
    const enabled = operation === "enable";
    return {
      statement: this.db
        .prepare(
          `UPDATE targets SET enabled = ?, updated_at = ?
           WHERE id = ? AND enabled <> ?`,
        )
        .bind(enabled ? 1 : 0, now, target.id, enabled ? 1 : 0),
      response: { data: { targetId: target.id, enabled } },
      status: 200,
      action: `target.${operation}d`,
      entityType: "target",
      entityId: target.id,
      changes: { enabled },
      conflictCode: "TARGET_STATE_CONFLICT",
      conflictMessage: "Target 状态已变化或尚未同步",
    };
  }
}
