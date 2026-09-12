import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api-client";
import { formatTime } from "@/lib/format";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared/page-states";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const schema = z.object({
  summary: z.array(
    z.object({ status: z.string(), count: z.number(), oldest: z.number() }),
  ),
  data: z.array(
    z.object({
      id: z.string(),
      scheduleId: z.string(),
      targetId: z.string(),
      scheduledFor: z.string(),
      status: z.enum([
        "pending",
        "sending",
        "unknown",
        "queued",
        "skipped",
        "cancelled",
      ]),
      attempts: z.number(),
      lastError: z.string().nullable(),
      businessResult: z
        .object({
          status: z.enum(["succeeded", "failed"]),
          summary: z.string(),
        })
        .nullable(),
    }),
  ),
});
const labels = {
  pending: "等待投递",
  sending: "正在投递",
  unknown: "投递结果未知",
  queued: "已入队",
  skipped: "已跳过",
  cancelled: "已取消",
};
export function DeliveriesPage() {
  const [params] = useSearchParams();
  const scheduleId = params.get("scheduleId") ?? "";
  const query = useQuery({
    queryKey: ["deliveries", scheduleId],
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/deliveries?limit=1000&scheduleId=${encodeURIComponent(scheduleId)}`,
        schema,
        signal,
      ),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageHeader
        title="触发记录"
        description="已入队表示消息可靠接收；网站 Worker 独立执行，未上报结果不会显示业务成功。暂停平台只停止后续投递，不撤回已入队任务。"
      />
      <p className="mb-4 text-sm text-muted-foreground">
        {query.data?.summary
          .map(
            (item) =>
              `${labels[item.status as keyof typeof labels] ?? item.status} ${item.count}`,
          )
          .join(" · ")}{" "}
        · 最近 1000 条记录；完整数量见上方汇总。
      </p>
      {query.isLoading ? (
        <LoadingState label="正在读取触发记录" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : !query.data?.data.length ? (
        <EmptyState
          title="尚无异步触发记录"
          description="Queue 模式的触发在此显示；现有 RPC 任务仍在执行记录中。"
        />
      ) : (
        <div className="table-wrap">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>网站 / 计划</TableHead>
                <TableHead>计划触发时间</TableHead>
                <TableHead>投递</TableHead>
                <TableHead>业务结果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {item.targetId}
                    <br />
                    <Link to={`/schedules/${item.scheduleId}`}>查看计划</Link>
                  </TableCell>
                  <TableCell>{formatTime(item.scheduledFor)}</TableCell>
                  <TableCell>
                    {labels[item.status]} · {item.attempts} 次
                    {item.lastError && <div>{item.lastError}</div>}
                  </TableCell>
                  <TableCell>
                    {item.businessResult ? (
                      <>
                        {item.businessResult.status === "succeeded"
                          ? "成功"
                          : "失败"}
                        <div>{item.businessResult.summary}</div>
                      </>
                    ) : (
                      "未上报"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
