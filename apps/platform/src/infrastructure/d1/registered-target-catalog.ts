import { z } from "zod";
import type { TargetManifest } from "@unified-cron/contracts";
import { getTargetManifest } from "../../targets.manifest";

const registeredActionRowSchema = z.object({
  name: z.string(),
  version: z.number().int().min(1),
  label: z.string(),
  description: z.string(),
  idempotent: z.number().int().min(0).max(1),
  example_payload_json: z.string().nullable(),
});

const registeredActionWithTargetRowSchema = registeredActionRowSchema.extend({
  target_id: z.string(),
});

export interface RegisteredActionCapability {
  name: string;
  version: number;
  label: string;
  description: string;
  idempotent: boolean;
  examplePayload: unknown;
}

export interface RegisteredTargetCapability {
  target: TargetManifest;
  action: RegisteredActionCapability;
}

/**
 * The single read boundary for registration-owned target capabilities.
 * Callers never need to know how physical bindings and declared actions are joined.
 */
export class RegisteredTargetCatalog {
  constructor(private readonly db: D1Database) {}

  async findCapability(
    targetId: string,
    actionName: string,
    actionVersion: number,
  ): Promise<RegisteredTargetCapability | null> {
    const target = getTargetManifest(targetId);
    if (!target) return null;
    const value = await this.db
      .prepare(
        `SELECT name, version, label, description, idempotent,
                example_payload_json
         FROM registered_actions
         WHERE target_id = ? AND name = ? AND version = ?`,
      )
      .bind(targetId, actionName, actionVersion)
      .first();
    if (!value) return null;
    return { target, action: serializeAction(value) };
  }

  async listActions(targetId: string): Promise<RegisteredActionCapability[]> {
    const result = await this.db
      .prepare(
        `SELECT name, version, label, description, idempotent,
                example_payload_json
         FROM registered_actions
         WHERE target_id = ?
         ORDER BY name, version`,
      )
      .bind(targetId)
      .all();
    return result.results.map(serializeAction);
  }

  async listAllActions(): Promise<
    Array<RegisteredActionCapability & { targetId: string }>
  > {
    const result = await this.db
      .prepare(
        `SELECT target_id, name, version, label, description, idempotent,
                example_payload_json
         FROM registered_actions
         ORDER BY target_id, name, version`,
      )
      .all();
    return result.results.map((value) => {
      const row = registeredActionWithTargetRowSchema.parse(value);
      return { targetId: row.target_id, ...serializeAction(row) };
    });
  }
}

function serializeAction(value: unknown): RegisteredActionCapability {
  const row = registeredActionRowSchema.parse(value);
  return {
    name: row.name,
    version: row.version,
    label: row.label,
    description: row.description,
    idempotent: row.idempotent === 1,
    examplePayload:
      row.example_payload_json === null
        ? undefined
        : JSON.parse(row.example_payload_json),
  };
}
