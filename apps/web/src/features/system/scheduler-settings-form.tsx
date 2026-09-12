import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiMutate, errorMessage } from "@/lib/api-client";
import { stateMutationSchema } from "@/lib/api-schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
const fields = [
  ["max_schedules", "规则总数", 1, 1000],
  ["materialize_budget", "每轮扫描规则数", 1, 1000],
  ["delivery_budget", "每轮投递任务数", 1, 1000],
  ["rpc_budget", "每轮 RPC 次数", 1, 20],
  ["concurrency", "RPC 并发数", 1, 10],
  ["per_target_batch", "每网站单批任务数", 1, 100],
] as const;
export function SchedulerSettingsForm({
  settings,
  revision,
}: {
  settings: Record<string, number>;
  revision: number;
}) {
  const [draft, setDraft] = useState(settings);
  const cache = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiMutate(
        "/api/v1/system/scheduler-settings",
        draft,
        stateMutationSchema,
        { revision },
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ["system"] }),
  });
  return (
    <form
      className="mb-6 rounded-xl border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <h2 className="mb-2 font-semibold">触发容量</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        增大预算需要结合账户额度验证。Queue
        入队不会等待网站业务完成；已入队任务不能通过全局暂停撤回。
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {fields.map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <Input
              type="number"
              required
              min={min}
              max={max}
              value={draft[key] ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, [key]: Number(event.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <Button className="mt-4" disabled={mutation.isPending} type="submit">
        保存触发容量
      </Button>
      {mutation.isError && <p role="alert">{errorMessage(mutation.error)}</p>}
      {mutation.isSuccess && <p role="status">配置已保存</p>}
    </form>
  );
}
