import { expect, test } from "@playwright/test";

for (const kind of ["runs", "deliveries"] as const) {
  test(`${kind} retains adjacent pages through loading, refresh and browser history`, async ({
    page,
  }) => {
    const at = new Date().toISOString();
    const path = kind === "runs" ? "/executions" : "/deliveries";
    const origin = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "管理员登录" }),
    ).toBeVisible();
    await page.getByLabel("用户名", { exact: true }).fill("admin");
    await page.getByLabel("密码", { exact: true }).fill("test-password");
    await page.getByRole("button", { name: "登录控制台", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "退出管理员登录" }),
    ).toBeVisible();
    await page.route(`**/api/v1/${kind}?*`, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const cursor = params.get("cursor");
      const previous = params.get("direction") === "previous";
      const index =
        cursor === null
          ? 0
          : previous
            ? Number(cursor) - 1
            : Number(cursor) + 1;
      if (index < 0 || index > 2)
        throw new Error(`Unexpected page ${index} at ${route.request().url()}`);
      const run = {
        id: `page-${index}`,
        scheduleId: "page-plan",
        targetId: "DATA",
        targetLabel: "分页测试网站",
        scheduleName: `第 ${index + 1} 页任务`,
        mode: "queue",
        source: "cron",
        status: "succeeded",
        deliveryStatus: "queued",
        attemptCount: 1,
        summary: "完成",
        reasonCode: null,
        scheduledFor: at,
        createdAt: at,
        startedAt: at,
        finishedAt: at,
      };
      const row =
        kind === "runs"
          ? run
          : {
              ...run,
              status: "queued",
              attempts: 1,
              businessAttempts: 1,
              lastError: null,
              consumerError: null,
              queuedAt: at,
              businessResult: { status: "succeeded", summary: "完成" },
            };
      await route.fulfill({
        json: {
          data: [row],
          summary: [
            {
              status: kind === "runs" ? "succeeded" : "queued",
              count: 3,
              oldest: Date.parse(at),
            },
          ],
          outcomes: [{ status: "succeeded", count: 3 }],
          meta: {
            total: 3,
            previousCursor: index === 0 ? null : String(index),
            nextCursor: index === 2 ? null : String(index),
            serverTime: at,
          },
        },
      });
    });
    await page.goto(`${origin}${path}?window=all`);
    const row = (index: number) =>
      page.getByRole("link", { name: `第 ${index} 页任务`, exact: true });
    const next = page.getByRole("button", { name: "下一页", exact: true });
    const previous = page.getByRole("button", { name: "上一页", exact: true });
    await expect(row(1)).toBeVisible();
    await next.click();
    await expect(row(2)).toBeVisible();
    await next.click();
    await expect(row(3)).toBeVisible();
    await page.reload();
    await expect(row(3)).toBeVisible();
    await previous.click();
    await expect(row(2)).toBeVisible();
    await page.goBack();
    await expect(row(3)).toBeVisible();
    await previous.click();
    await expect(row(2)).toBeVisible();
    await previous.click();
    await expect(row(1)).toBeVisible();
    await expect(previous).toBeDisabled();
    await page
      .getByLabel("状态筛选", { exact: true })
      .selectOption(kind === "runs" ? "succeeded" : "queued");
    await expect(page).not.toHaveURL(/cursor=|direction=/);
    await expect(row(1)).toBeVisible();
  });
}
