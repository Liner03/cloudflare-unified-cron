import { useQuery } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { SelectMenu } from "@/components/ui/select-menu";
import { StatusBadge } from "@/components/shared/status-badge";
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
import { apiGet } from "@/lib/api-client";
import {
  schedulesSchema,
  targetsSchema,
  type ScheduleSummary,
} from "@/lib/api-schemas";
import { formatScheduleBlockingReasons, formatTime } from "@/lib/format";

const columnHelper = createColumnHelper<ScheduleSummary>();
const ALL_FILTER_VALUE = "__all__";

export function SchedulesPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const enabled = params.get("enabled") ?? "";
  const target = params.get("target") ?? "";
  const query = useQuery({
    queryKey: ["schedules", search, enabled, target],
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/schedules?search=${encodeURIComponent(search)}&enabled=${encodeURIComponent(enabled)}&target=${encodeURIComponent(target)}`,
        schedulesSchema,
        signal,
      ),
  });
  const targets = useQuery({
    queryKey: ["targets", "schedule-filter"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
  });
  const columns = [
    columnHelper.accessor("name", {
      header: "计划",
      cell: ({ row }) => (
        <div className="min-w-44">
          <Link
            className="font-semibold hover:underline"
            to={`/schedules/${row.original.id}`}
          >
            {row.original.name}
          </Link>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {row.original.description || "无说明"}
          </div>
        </div>
      ),
    }),
    columnHelper.display({
      id: "cron",
      header: "Cron / 时区",
      cell: ({ row }) => (
        <div>
          <code className="mono text-xs font-semibold">
            {row.original.cronExpression}
          </code>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.original.timezone}
          </div>
        </div>
      ),
    }),
    columnHelper.display({
      id: "target",
      header: "目标 / Action",
      cell: ({ row }) => (
        <div>
          <span className="mono text-xs">{row.original.targetId}</span>
          <div className="mt-1 text-xs text-muted-foreground">
            {row.original.action} · v{row.original.actionVersion}
          </div>
        </div>
      ),
    }),
    columnHelper.accessor("nextRunAt", {
      header: "下一次",
      cell: ({ getValue }) => (
        <span className="tabular text-xs">{formatTime(getValue())}</span>
      ),
    }),
    columnHelper.display({
      id: "status",
      header: "最近 / 状态",
      cell: ({ row }) => (
        <div className="grid justify-items-start gap-1.5">
          <StatusBadge
            status={
              row.original.effectiveEnabled ? "enabled" : "schedule_paused"
            }
          />
          {row.original.lastExecution ? (
            <StatusBadge status={row.original.lastExecution.status} />
          ) : (
            <span className="text-xs text-muted-foreground">尚未运行</span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatScheduleBlockingReasons(row.original.blockingReasons)}
          </span>
        </div>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: "操作",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to={`/schedules/${row.original.id}`}>查看</Link>
          </Button>
        </div>
      ),
    }),
  ];
  const table = useReactTable({
    data: query.data?.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <PageHeader
        description="跨网站查看所有自动任务；配置来自网站 Worker，控制台只负责运行证据与安全暂停。"
        title="所有 Cron"
      />
      <div className="toolbar schedule-toolbar" role="search">
        <label className="schedule-search relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={15}
          />
          <Input
            aria-label="搜索计划名称"
            className="pl-9"
            onChange={(event) => {
              const next = new URLSearchParams(params);
              if (event.target.value) next.set("search", event.target.value);
              else next.delete("search");
              setParams(next, { replace: true });
            }}
            placeholder="搜索计划名称"
            value={search}
          />
        </label>
        <SelectMenu
          ariaLabel="筛选网站"
          className="schedule-filter"
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            if (value !== ALL_FILTER_VALUE) next.set("target", value);
            else next.delete("target");
            setParams(next, { replace: true });
          }}
          options={[
            { label: "全部网站", value: ALL_FILTER_VALUE },
            ...(targets.data?.data ?? []).map((item) => ({
              label: item.label,
              value: item.id,
            })),
          ]}
          value={target || ALL_FILTER_VALUE}
        />
        <SelectMenu
          ariaLabel="筛选启用状态"
          className="schedule-filter schedule-status-filter"
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            if (value !== ALL_FILTER_VALUE) next.set("enabled", value);
            else next.delete("enabled");
            setParams(next, { replace: true });
          }}
          options={[
            { label: "全部状态", value: ALL_FILTER_VALUE },
            { label: "当前可派发", value: "true" },
            { label: "当前被阻止", value: "false" },
          ]}
          value={enabled || ALL_FILTER_VALUE}
        />
      </div>
      <section className="ledger-section">
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState label="正在读取计划" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : table.getRowModel().rows.length === 0 ? (
          <EmptyState
            action={
              <Button asChild size="sm" variant="outline">
                <Link to="/registrations">查看注册状态</Link>
              </Button>
            }
            description={
              search || enabled || target
                ? "调整筛选条件，或检查 Worker 最新 Registration。"
                : "网站 Worker 发布 Registration 后，自动任务会出现在这里。"
            }
            title={search || enabled || target ? "没有匹配的任务" : "尚无 Cron"}
          />
        ) : (
          <div className="table-wrap">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
