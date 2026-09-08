import { expect, test } from "@playwright/test";

test("shows real scheduler state and navigates the control center", async ({
  page,
  isMobile,
}, testInfo) => {
  const expectedViewports = {
    desktop: { width: 1440, height: 900 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
  } as const;
  expect(page.viewportSize()).toEqual(
    expectedViewports[testInfo.project.name as keyof typeof expectedViewports],
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /一个真实时钟.*驱动所有关键计划/ }),
  ).toBeVisible();
  await expect(page.getByText("当前运行态，不做推测。")).toBeVisible();
  await expect(page.locator(".sidebar-foot .status-succeeded")).toHaveCount(0);
  const initialViewport = page.viewportSize();
  if (initialViewport && initialViewport.width < 860) {
    const firstCard = page.locator(".execution-stack-card").first();
    await expect(page.locator(".pin-spacer")).toHaveCount(0);
    await expect(firstCard).toHaveCSS("transform", "none");
    await expect(firstCard).toHaveCSS("opacity", "1");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(".pin-spacer")).toHaveCount(1);
    await page.setViewportSize(initialViewport);
    await expect(page.locator(".pin-spacer")).toHaveCount(0);
    await expect(firstCard).toHaveCSS("transform", "none");
    await expect(firstCard).toHaveCSS("opacity", "1");
  }
  if (isMobile) await page.getByRole("button", { name: "打开导航" }).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "计划", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "计划", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("示例健康检查")).toBeVisible();
  await page.goto("/executions");
  await expect(
    page.getByRole("heading", { name: "执行记录", exact: true }),
  ).toBeVisible();
  await page.goto("/targets");
  await expect(
    page.getByRole("heading", { name: "目标服务", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("已启用", { exact: true })).toBeVisible();
  await expect(page.getByText("尚未检查", { exact: true })).toBeVisible();
});

test("creates a paused schedule and persists a Run now intent", async ({
  page,
}) => {
  await page.goto("/schedules/new");
  const nameInput = page.getByLabel("名称 *");
  const nameField = nameInput.locator("xpath=..");
  const controlId = await nameInput.getAttribute("id");
  expect(controlId).toBeTruthy();
  if (!controlId) throw new Error("名称控件缺少 id");
  await expect(nameField.locator("label")).toHaveAttribute("for", controlId);
  await expect(page.getByText("未来 5 次")).toBeVisible();
  await expect(page.locator(".preview-list li").first()).toBeVisible();
  await nameInput.fill(" ");
  await page.getByRole("button", { name: "保存 Schedule" }).click();
  const nameError = page.getByText("请输入计划名称", { exact: true });
  await expect(nameError).toBeVisible();
  const errorId = await nameError.getAttribute("id");
  expect(errorId).toBeTruthy();
  if (!errorId) throw new Error("名称错误缺少 id");
  await expect(nameInput).toHaveAttribute("aria-describedby", errorId);
  await nameInput.fill(`E2E Health ${Date.now()}`);
  await page.getByRole("button", { name: "保存 Schedule" }).click();
  await expect(page.getByRole("button", { name: "立即安排" })).toBeVisible();
  await expect(page.getByText("已暂停", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "编辑" }).click();
  await expect(
    page.getByRole("heading", { name: "编辑 Schedule" }),
  ).toBeVisible();
  await page.getByLabel("说明").fill("E2E revision update");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("button", { name: "立即安排" })).toBeVisible();
  await page.getByRole("button", { name: "立即安排" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page
    .getByRole("button", { name: "立即安排", exact: true })
    .last()
    .click();
  await expect(page.getByRole("heading", { name: /执行/ })).toBeVisible();
  await expect(page.getByText("执行意图尚未被 Tick 领取。")).toBeVisible();
});

test("keeps unknown API paths JSON and exposes mobile navigation", async ({
  page,
  isMobile,
}) => {
  const response = await page.request.get("/api/v1/not-a-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");

  if (isMobile) {
    await page.goto("/");
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
    await openNavigation.click();
    const primaryNavigation = page.getByRole("navigation", { name: "主导航" });
    await expect(primaryNavigation).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "总览页脚导航" }),
    ).toHaveCount(0);
    await primaryNavigation.getByRole("link", { name: "系统" }).click();
    await expect(
      page.getByRole("heading", { name: "系统", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("心跳陈旧", { exact: true })).toBeVisible();
    await expect(page.getByText("派发已开启", { exact: true })).toBeVisible();
  }
});

test("preserves an edited Schedule's Action version and payload", async ({
  page,
}) => {
  const customPayload = { source: "warehouse", batchSize: 42 };
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/targets", (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: "DATA",
            label: "Data Worker",
            binding: "CRON_DATA",
            service: "worker-data",
            entrypoint: "CronEntrypoint",
            protocolVersion: 1,
            manifestRevision: "data-v2",
            actions: [
              {
                name: "syncUsers",
                version: 1,
                label: "同步用户 v1",
                idempotent: true,
                examplePayload: { source: "crm-v1" },
              },
              {
                name: "syncUsers",
                version: 2,
                label: "同步用户 v2",
                idempotent: true,
                examplePayload: { source: "crm-v2" },
              },
            ],
            state: {
              enabled: 1,
              last_check_at: null,
              last_check_status: null,
              last_check_message: null,
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/schedules/multi-version", async (route) => {
    if (route.request().method() === "PATCH") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        json: { data: { id: "multi-version", revision: 8 } },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: {
          id: "multi-version",
          name: "Versioned sync",
          description: "Original description",
          targetId: "DATA",
          action: "syncUsers",
          actionVersion: 2,
          cronExpression: "*/5 * * * *",
          timezone: "UTC",
          enabled: false,
          revision: 7,
          nextRunAt: null,
          archivedAt: null,
          payload: customPayload,
          retryPolicy: {
            maxAttempts: 1,
            delaysSeconds: [],
            retryOnUnknown: false,
          },
          timeoutMs: 30_000,
          misfirePolicy: "coalesce",
          misfireGraceSeconds: 300,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          recentExecutions: [],
        },
      },
    });
  });

  await page.goto("/schedules/multi-version/edit");
  await expect(
    page.getByLabel("Action *").locator("option:checked"),
  ).toHaveText(/syncUsers · v2/);
  await expect(page.getByLabel("Payload JSON *")).toHaveValue(
    JSON.stringify(customPayload, null, 2),
  );
  await page.getByLabel("说明").fill("Description only");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect.poll(() => submitted).toBeDefined();
  expect(submitted).toMatchObject({
    action: "syncUsers",
    actionVersion: 2,
    payload: customPayload,
    description: "Description only",
  });
});

test("shows dispatch pause separately from stale heartbeat", async ({
  page,
}) => {
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

  await page.goto("/system");
  await expect(page.getByText("心跳陈旧", { exact: true })).toBeVisible();
  await expect(page.getByText("派发已暂停", { exact: true })).toBeVisible();

  await page.route("**/api/v1/overview", (route) =>
    route.fulfill({
      json: {
        data: {
          schedules: { active_schedules: 0, total_schedules: 0 },
          executions24h: [],
          recentExecutions: [],
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
    page.getByRole("heading", { name: "心跳陈旧或尚未建立" }),
  ).toBeVisible();
  await expect(page.getByText("派发已暂停", { exact: true })).toBeVisible();

  await page.unroute("**/api/v1/overview");
  await page.route("**/api/v1/overview", (route) =>
    route.fulfill({
      json: {
        data: {
          schedules: { active_schedules: 0, total_schedules: 0 },
          executions24h: [],
          recentExecutions: [],
          system: null,
        },
        meta: { serverTime: new Date().toISOString() },
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "平台心跳状态不可用" }),
  ).toBeVisible();
  await expect(page.getByText("派发状态不可用", { exact: true })).toBeVisible();
  await expect(page.getByText("派发已开启", { exact: true })).toHaveCount(0);
});
