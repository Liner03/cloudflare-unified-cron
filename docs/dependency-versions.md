# 依赖版本

锁定日期：2026-09-09。准确解析见 `pnpm-lock.yaml`。

| 依赖                      |         版本 | 用途                                  |
| ------------------------- | -----------: | ------------------------------------- |
| wrangler                  |      4.129.1 | Worker 开发、类型、migration、dry-run |
| @cloudflare/workers-types | 5.20260908.1 | Worker 平台类型                       |
| @cloudflare/vitest-plugin |        1.1.5 | workerd/D1/RPC 集成测试               |
| TypeScript                |        6.0.3 | strict 类型检查                       |
| Vitest                    |       4.1.11 | 单元与 Workers 集成测试               |
| Hono                      |       4.13.7 | 管理 API                              |
| Zod                       |        4.5.4 | 协议、API 与表单校验                  |
| cron-parser               |       5.10.0 | 五字段 Cron、IANA timezone、DST       |
| React / React DOM         |       19.2.8 | 控制台                                |
| React Hook Form           |       7.87.0 | 表单状态与可访问错误                  |
| @hookform/resolvers       |        5.9.1 | React Hook Form / Zod 适配            |
| Vite                      |        8.2.2 | SPA 构建与开发代理                    |
| Tailwind CSS              |        4.3.3 | shadcn 语义样式                       |
| TanStack Query            |      5.102.8 | 缓存、轮询与失效                      |
| TanStack Table            |       8.21.3 | Schedule 表格                         |
| Outfit Variable           |        5.3.0 | 本地自托管人机界面字体                |
| Geist Mono Variable       |        5.3.0 | 本地自托管机器证据字体                |
| Playwright                |       1.63.0 | 桌面与移动 E2E                        |

Wrangler、compatibility date 和关键依赖升级必须单独提交，并重新运行 Cron DST、D1 CAS、RPC、本地认证、Registration 和浏览器回归。
