import { expect, test, type Page } from "@playwright/test";

test("authenticates and navigates the registered control plane", async ({
  page,
}, testInfo) => {
  const expectedViewports = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
  } as const;
  expect(page.viewportSize()).toEqual(
    expectedViewports[testInfo.project.name as keyof typeof expectedViewports],
  );
  await login(page, "/");
  await bootstrapRegistration(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "业务总览", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("24 小时运行信号")).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) < 900) {
    await page.getByRole("button", { name: "打开导航" }).click();
  }
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "所有 Cron", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "所有 Cron", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("E2E Health", { exact: true })).toBeVisible();

  await page.goto("/targets");
  await expect(
    page.getByRole("heading", { name: "网站", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("已注册", { exact: true })).toBeVisible();
  await expect(page.getByText(/e2e-/).first()).toBeVisible();
  await page.getByRole("button", { name: "退出管理员登录" }).click();
  await expect(
    page.getByRole("heading", { name: "管理员登录", exact: true }),
  ).toBeVisible();
});

test("reveals a Registration Token once and never lists its raw value", async ({
  page,
}) => {
  await login(page, "/registrations");
  const label = `browser-e2e-${Date.now()}`;
  await page.getByRole("button", { name: "签发 Token" }).click();
  await page.getByLabel("用途标签").fill(label);
  await page.getByLabel("有效期").selectOption("30");
  await page.getByRole("button", { name: "签发一次性 Token" }).click();

  const secretDialog = page.getByRole("dialog", {
    name: "立即保存这个 Token",
  });
  await expect(secretDialog).toBeVisible();
  const rawToken = await secretDialog
    .locator(".token-reveal-value")
    .innerText();
  expect(rawToken).toMatch(/^ucrt_[A-Za-z0-9_-]{43}$/);
  await secretDialog.getByRole("button", { name: "我已安全保存" }).click();
  await expect(secretDialog).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "操作" })).toBeVisible();
  const tokenRow = page.getByRole("row").filter({ hasText: label });
  await tokenRow.getByRole("button", { name: /轮换/ }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "轮换并撤销旧 Token" })
    .click();
  const replacementDialog = page.getByRole("dialog", {
    name: "立即保存替换 Token",
  });
  await expect(replacementDialog).toBeVisible();
  const replacementToken = await replacementDialog
    .locator(".token-reveal-value")
    .innerText();
  expect(replacementToken).toMatch(/^ucrt_[A-Za-z0-9_-]{43}$/);
  expect(replacementToken).not.toBe(rawToken);
  await replacementDialog.getByRole("button", { name: "我已安全保存" }).click();
  await page.reload();
  await expect(page.getByText(rawToken, { exact: true })).toHaveCount(0);
  await expect(page.getByText(replacementToken, { exact: true })).toHaveCount(
    0,
  );
});

test("shows and clears Operator Override separately from Worker intent", async ({
  page,
}) => {
  await login(page, "/schedules");
  await bootstrapRegistration(page);
  const schedule = await ensureOperatorOverrideCleared(page);
  await page.goto(`/schedules/${schedule.id}`);

  await page.getByRole("button", { name: "暂停" }).click();
  await page.getByRole("button", { name: "暂停计划" }).last().click();
  await expect(page.getByText(/管理员暂停/).first()).toBeVisible();

  await page.getByRole("button", { name: "恢复" }).click();
  await page.getByRole("button", { name: "恢复计划" }).last().click();
  await expect(page.getByText(/无管理员覆盖/).first()).toBeVisible();
});

test("keeps unknown API paths JSON and exposes mobile navigation", async ({
  page,
}) => {
  await login(page, "/");
  const response = await page.request.get("/api/v1/not-a-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");

  if ((page.viewportSize()?.width ?? 0) < 900) {
    const sidebar = page.locator(".sidebar");
    const main = page.locator("main");
    const openNavigation = page.getByRole("button", { name: "打开导航" });
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(main).not.toHaveAttribute("inert", "");
    await openNavigation.click();
    await expect(sidebar).not.toHaveAttribute("inert", "");
    await expect(main).toHaveAttribute("inert", "");
    await expect(
      sidebar.getByRole("button", { name: "关闭导航" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("inert", "");
    await expect(main).not.toHaveAttribute("inert", "");
    await expect(openNavigation).toBeFocused();
  }
});

test("shows dispatch pause separately from stale heartbeat", async ({
  page,
}) => {
  await login(page, "/system");
  await page.route("**/api/v1/system", (route) =>
    route.fulfill({
      json: {
        data: {
          dispatch_paused: 1,
          last_tick_id: null,
          last_tick_scheduled_at: null,
          last_tick_started_at: null,
          last_tick_finished_at: null,
          last_successful_tick_at: null,
          last_tick_outcome: null,
          last_tick_error: null,
          build_version: "test",
          protocolVersion: 1,
          budgets: {},
        },
        meta: { serverTime: new Date().toISOString() },
      },
    }),
  );
  await page.reload();
  await expect(page.getByText("心跳陈旧", { exact: true })).toBeVisible();
  await expect(page.getByText("派发已暂停", { exact: true })).toBeVisible();

  await page.route("**/api/v1/overview", (route) =>
    route.fulfill({
      json: {
        data: {
          schedules: { active_schedules: 0, total_schedules: 0 },
          executions24h: [],
          recentExecutions: [],
          successRates: rateWindows(),
          system: {
            dispatch_paused: 1,
            last_successful_tick_at: null,
            last_tick_outcome: null,
            last_tick_scheduled_at: null,
            build_version: "test",
          },
        },
        meta: { serverTime: new Date().toISOString() },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByText("调度心跳需要检查", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("派发已暂停", { exact: true })).toBeVisible();
});

async function login(page: Page, path: string) {
  await page.goto(path);
  const heading = page.getByRole("heading", { name: "管理员登录" });
  const logout = page.getByRole("button", { name: "退出管理员登录" });
  await expect(heading.or(logout)).toBeVisible();
  if (await heading.isVisible()) {
    await page.getByLabel("用户名").fill("admin");
    await page.getByLabel("密码").fill("test-password");
    await page.getByRole("button", { name: "登录控制台" }).click();
  }
  await expect(logout).toBeVisible();
}

async function bootstrapRegistration(page: Page) {
  const issued = await page.request.post("/api/v1/registration-tokens", {
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Idempotency-Key": `e2e:${crypto.randomUUID()}`,
    },
    data: { targetId: "DATA", label: "Playwright", expiresInDays: 1 },
  });
  if (!issued.ok()) {
    throw new Error(
      `Registration Token issuance failed (${issued.status()}): ${await issued.text()}`,
    );
  }
  const token = readDataString(await issued.json(), "token");
  const registrationRevision = `e2e-${Date.now()}-${crypto.randomUUID()}`;
  const scheduleKey = `e2e-health-${crypto.randomUUID()}`;
  const registered = await page.request.put("/api/v1/registration", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": `e2e:${crypto.randomUUID()}`,
    },
    data: registration(registrationRevision, scheduleKey),
  });
  expect(registered.ok()).toBe(true);
}

async function ensureOperatorOverrideCleared(page: Page) {
  const response = await page.request.get("/api/v1/schedules");
  const body = (await response.json()) as {
    data: Array<{ id: string; revision: number; operatorPaused: boolean }>;
  };
  const schedule = body.data[0];
  if (!schedule) throw new Error("Registration did not create a Schedule");
  if (schedule.operatorPaused) {
    const resumed = await page.request.post(
      `/api/v1/schedules/${schedule.id}/resume`,
      {
        headers: {
          Origin: "http://127.0.0.1:5173",
          "If-Match": `"${schedule.revision}"`,
          "Idempotency-Key": `e2e:${crypto.randomUUID()}`,
        },
        data: {},
      },
    );
    expect(resumed.ok()).toBe(true);
  }
  return schedule;
}

function registration(registrationRevision: string, scheduleKey: string) {
  return {
    protocolVersion: 1,
    registrationRevision,
    worker: { label: "Data Worker" },
    actions: [
      {
        name: "healthCheck",
        version: 1,
        label: "健康检查",
        description: "E2E registered action",
        idempotent: true,
        examplePayload: {},
      },
    ],
    schedules: [
      {
        key: scheduleKey,
        name: "E2E Health",
        description: "Published by the test Worker",
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
        timeoutMs: 30_000,
        misfirePolicy: "coalesce",
        misfireGraceSeconds: 300,
      },
    ],
  };
}

function readDataString(value: unknown, key: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    key in value.data
  ) {
    const result = value.data[key as keyof typeof value.data];
    if (typeof result === "string") return result;
  }
  throw new Error(`response did not contain data.${key}`);
}

function rateWindows() {
  return (["24h", "7d", "30d"] as const).map((window) => ({
    window,
    from: new Date().toISOString(),
    to: new Date().toISOString(),
    execution: { numerator: 0, denominator: 0, rate: null },
    firstAttempt: { numerator: 0, denominator: 0, rate: null },
  }));
}
