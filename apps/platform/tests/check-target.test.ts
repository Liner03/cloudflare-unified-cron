import { describe, expect, it } from "vitest";
import {
  TargetCheckApplication,
  type RegisteredActionReader,
  type TargetDescriptionPort,
} from "../src/application/check-target";

const actions: RegisteredActionReader = {
  listActions: () =>
    Promise.resolve([
      {
        name: "sync",
        version: 1,
        idempotent: true,
      },
    ]),
};

describe("TargetCheckApplication", () => {
  it("reports exact registered and deployed capabilities as compatible", async () => {
    const target: TargetDescriptionPort = {
      describe: () =>
        Promise.resolve({
          protocolVersion: 1,
          actions: [{ name: "sync", version: 1, idempotent: true }],
        }),
    };
    await expect(
      new TargetCheckApplication(actions, target).run("DATA"),
    ).resolves.toMatchObject({ status: "compatible" });
  });

  it("reports a capability mismatch separately from an unreachable target", async () => {
    const mismatch: TargetDescriptionPort = {
      describe: () =>
        Promise.resolve({
          protocolVersion: 1,
          actions: [{ name: "sync", version: 2, idempotent: true }],
        }),
    };
    const unreachable: TargetDescriptionPort = {
      describe: () => Promise.reject(new Error("RPC unavailable")),
    };
    await expect(
      new TargetCheckApplication(actions, mismatch).run("DATA"),
    ).resolves.toMatchObject({ status: "incompatible" });
    await expect(
      new TargetCheckApplication(actions, unreachable).run("DATA"),
    ).resolves.toMatchObject({ status: "unreachable" });
  });

  it("rejects a Target outside the physical deployment manifest", async () => {
    const target: TargetDescriptionPort = {
      describe: () => Promise.reject(new Error("must not be called")),
    };
    await expect(
      new TargetCheckApplication(actions, target).run("MISSING"),
    ).rejects.toMatchObject({
      kind: "not_found",
      code: "TARGET_NOT_FOUND",
    });
  });
});
