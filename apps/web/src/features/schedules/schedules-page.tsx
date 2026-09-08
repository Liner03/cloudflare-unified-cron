import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { CalendarPlus, Play, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-controls";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/shared/page-states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import {
  executionMutationSchema,
  schedulesSchema,
  type ScheduleSummary,
} from "@/lib/api-schemas";
import { formatTime } from "@/lib/format";

const columnHelper = createColumnHelper<ScheduleSummary>();

export function SchedulesPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const enabled = params.get("enabled") ?? "";
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["schedules", search, enabled],
    queryFn: ({ signal }) =>
      apiGet(
        `/api/v1/schedules?search=${encodeURIComponent(search)}&enabled=${encodeURIComponent(enabled)}`,
        schedulesSchema,
        signal,
      ),
  });
  const run = useMutation({
    mutationFn: (id: string) => apiMutate(`/api/v1/schedules/${id}/run`, {}, executionMutationSchema),
    onSuccess: async ({ data }) => {
      await queryClient.invalidateQueries({ queryKey: ["schedules"] });
      toast.success("执行意图已保存", { description: `将在可用 Tick 中领取：${data.executionId}` });
    },
    onError: (error) => toast.error("无法立即安排", { description: errorMessage(error) }),
  });

  const columns = [
    columnHelper.accessor("name", {
      header: "计划",
      cell: ({ row }) => (
        <div className="min-w-44">
          <Link className="font-semibold hover:underline" to={`/schedules/${row.original.id}`}>
            {row.original.name}
          </Link>
          <div className="mt-1 truncate text-xs text-muted-foreground">{row.original.description || "无说明"}</div>
        </div>
      ),
    }),
    columnHelper.display({
      id: "cron",
      header: "Cron / 时区",
      cell: ({ row }) => (
        <div>
          <code className="mono text-xs font-semibold">{row.original.cronExpression}</code>
          <div className="mt-1 text-xs text-muted-foreground">{row.original.timezone}</div>
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
      cell: ({ getValue }) => <span className="tabular text-xs">{formatTime(getValue())}</span>,
    }),
    columnHelper.display({
      id: "status",
      header: "最近 / 状态",
      cell: ({ row }) => (
        <div className="grid justify-items-start gap-1.5">
          {row.original.lastExecution ? <StatusBadge status={row.original.lastExecution.status} /> : <span className="text-xs text-muted-foreground">尚未运行</span>}
          <span className="text-xs text-muted-foreground">{row.original.enabled ? "已启用" : "已暂停"}</span>
        </div>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link to={`/schedules/${row.original.id}`}>查看</Link>
          </Button>
          <Button
            aria-label={`立即安排 ${row.original.name}`}
            disabled={run.isPending}
            onClick={() => run.mutate(row.original.id)}
            size="sm"
            variant="outline"
          >
            <Play size={13} />
            安排
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
        action={
          <Button asChild>
            <Link to="/schedules/new">
              <CalendarPlus size={16} />
              新建计划
            </Link>
          </Button>
        }
        description="每个计划绑定一个白名单 Action。暂停只停止新的 cron 发生，已有执行意图不会被删除。"
        title="Schedules"
      />
      <div className="toolbar" role="search">
        <label className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={15} />
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
        <Select
          aria-label="筛选启用状态"
          onChange={(event) => {
            const next = new URLSearchParams(params);
            if (event.target.value) next.set("enabled", event.target.value);
            else next.delete("enabled");
            setParams(next, { replace: true });
          }}
          value={enabled}
        >
          <option value="">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已暂停</option>
        </Select>
      </div>
      <section className="ledger-section">
        {query.isLoading ? (
          <div className="p-5"><LoadingState label="正在读取计划" /></div>
        ) : query.isError ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : table.getRowModel().rows.length === 0 ? (
          <EmptyState
            action={
              <Button asChild size="sm" variant="outline">
                <Link to="/schedules/new">创建第一个计划</Link>
              </Button>
            }
            description={search || enabled ? "调整筛选条件，或创建新的逻辑计划。" : "Target manifest 同步后即可建立暂停计划并预览时间。"}
            title={search || enabled ? "没有匹配的计划" : "尚无 Schedule"}
          />
        ) : (
          <div className="table-wrap">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
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
