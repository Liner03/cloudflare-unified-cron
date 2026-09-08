import { expect, test } from "@playwright/test";

test("shows real scheduler state and navigates the control center", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "一个真实时钟，驱动所有关键计划。" })).toBeVisible();
  await expect(page.getByText("当前运行态，不做推测。")).toBeVisible();
  await page.getByRole("link", { name: "Schedules" }).click();
  await expect(page.getByRole("heading", { name: "Schedules" })).toBeVisible();
  await expect(page.getByText("示例健康检查")).toBeVisible();
});

test("creates a paused schedule and persists a Run now intent", async ({ page }) => {
  await page.goto("/schedules/new");
  await page.getByLabel("名称 *").fill(`E2E Health ${Date.now()}`);
  await expect(page.getByText("未来 5 次")).toBeVisible();
  await expect(page.locator(".preview-list li").first()).toBeVisible();
  await page.getByRole("button", { name: "保存 Schedule" }).click();
  await expect(page.getByRole("button", { name: "立即安排" })).toBeVisible();
  await page.getByRole("button", { name: "立即安排" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("button", { name: "立即安排", exact: true }).last().click();
  await expect(page.getByRole("heading", { name: /执行/ })).toBeVisible();
  await expect(page.getByText("执行意图尚未被 Tick 领取。")).toBeVisible();
});

test("keeps unknown API paths JSON and exposes mobile navigation", async ({ page, isMobile }) => {
  const response = await page.request.get("/api/v1/not-a-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");

  if (isMobile) {
    await page.goto("/");
    await page.getByRole("button", { name: "打开导航" }).click();
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await page.getByRole("link", { name: "System" }).click();
    await expect(page.getByRole("heading", { name: "System" })).toBeVisible();
  }
});
