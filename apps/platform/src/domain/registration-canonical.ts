import type { WorkerRegistrationV1 } from "@unified-cron/contracts";

type RegistrationAction = WorkerRegistrationV1["actions"][number];
type RegistrationSchedule = WorkerRegistrationV1["schedules"][number];

export function canonicalRegistrationDocument(
  declaration: WorkerRegistrationV1,
): string {
  return canonicalJson({
    ...declaration,
    actions: [...declaration.actions].sort(compareActions),
    schedules: [...declaration.schedules].sort((left, right) =>
      compareText(left.key, right.key),
    ),
  });
}

export function canonicalScheduleConfiguration(
  schedule: RegistrationSchedule,
): string {
  return canonicalJson(schedule);
}

function compareActions(
  left: RegistrationAction,
  right: RegistrationAction,
): number {
  const nameOrder = compareText(left.name, right.name);
  return nameOrder === 0 ? left.version - right.version : nameOrder;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(
    value,
    (_key: string, nested: unknown): unknown => {
      if (
        nested === null ||
        typeof nested !== "object" ||
        Array.isArray(nested)
      ) {
        return nested;
      }
      const record = nested as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    },
  );
  if (serialized === undefined) {
    throw new TypeError("VALUE_NOT_JSON_SERIALIZABLE");
  }
  return serialized;
}
