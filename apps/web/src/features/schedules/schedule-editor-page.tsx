import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, Info, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import { ErrorState, LoadingState, PageHeader } from "@/components/shared/page-states";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import { idMutationSchema, previewSchema, scheduleDetailSchema, targetsSchema } from "@/lib/api-schemas";

const formSchema = z.object({
  name: z.string().trim().min(1, "请输入计划名称").max(100),
  description: z.string().max(500),
  targetId: z.string().min(1, "请选择 Target"),
  action: z.string().min(1, "请选择 Action"),
  cronExpression: z.string().min(1, "请输入 Cron").max(128),
  timezone: z.string().min(1, "请输入 IANA 时区"),
  payloadText: z.string().min(1),
  maxAttempts: z.number().int().min(1).max(5),
  delaysText: z.string(),
  retryOnUnknown: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(30_000),
  misfirePolicy: z.enum(["coalesce", "skip"]),
  misfireGraceSeconds: z.number().int().min(0).max(86_400),
  enabled: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

const presets = [
  { label: "每 5 分钟", value: "*/5 * * * *" },
  { label: "每小时", value: "0 * * * *" },
  { label: "每天 08:00", value: "0 8 * * *" },
  { label: "每周一 09:00", value: "0 9 * * 1" },
];

export function ScheduleEditorPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = id !== undefined;
  const initialized = useRef(false);
  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
  });
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      targetId: "DATA",
      action: "healthCheck",
      cronExpression: "*/5 * * * *",
      timezone: "UTC",
      payloadText: "{}",
      maxAttempts: 1,
      delaysText: "",
      retryOnUnknown: false,
      timeoutMs: 30_000,
      misfirePolicy: "coalesce",
      misfireGraceSeconds: 300,
      enabled: false,
    },
  });
  const existing = useQuery({
    queryKey: ["schedule", id],
    queryFn: ({ signal }) => apiGet(`/api/v1/schedules/${id ?? ""}`, scheduleDetailSchema, signal),
    enabled: editing,
  });
  const expression = watch("cronExpression");
  const timezone = watch("timezone");
  const targetId = watch("targetId");
  const actionName = watch("action");
  const maxAttempts = watch("maxAttempts");
  const [previewInput, setPreviewInput] = useState({ expression, timezone });

  useEffect(() => {
    const schedule = existing.data?.data;
    if (!schedule || initialized.current) return;
    initialized.current = true;
    reset({
      name: schedule.name,
      description: schedule.description,
      targetId: schedule.targetId,
      action: schedule.action,
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      payloadText: JSON.stringify(schedule.payload, null, 2),
      maxAttempts: schedule.retryPolicy.maxAttempts,
      delaysText: schedule.retryPolicy.delaysSeconds.join(", "),
      retryOnUnknown: schedule.retryPolicy.retryOnUnknown,
      timeoutMs: schedule.timeoutMs,
      misfirePolicy: schedule.misfirePolicy === "skip" ? "skip" : "coalesce",
      misfireGraceSeconds: schedule.misfireGraceSeconds,
      enabled: schedule.enabled,
    });
  }, [existing.data, reset]);

  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewInput({ expression, timezone }), 500);
    return () => window.clearTimeout(timer);
  }, [expression, timezone]);

  const target = targets.data?.data.find((value) => value.id === targetId);
  const action = target?.actions.find((value) => value.name === actionName);
  const preview = useQuery({
    queryKey: ["cron-preview", previewInput.expression, previewInput.timezone],
    queryFn: () =>
      apiMutate(
        "/api/v1/cron/preview",
        { cronExpression: previewInput.expression, timezone: previewInput.timezone, count: 5 },
        previewSchema,
      ),
    enabled: previewInput.expression.length > 0 && previewInput.timezone.length > 0,
    retry: false,
  });

  useEffect(() => {
    if (target && !target.actions.some((value) => value.name === actionName)) {
      setValue("action", target.actions[0]?.name ?? "", { shouldValidate: true });
    }
  }, [actionName, setValue, target]);

  useEffect(() => {
    if (action?.examplePayload !== undefined) {
      setValue("payloadText", JSON.stringify(action.examplePayload, null, 2));
    }
    if (action && !action.idempotent) {
      setValue("maxAttempts", 1);
      setValue("retryOnUnknown", false);
      setValue("delaysText", "");
    }
  }, [action, setValue]);

  const submit = useMutation({
    mutationFn: (value: FormValues) => {
      let payload: unknown;
      try {
        payload = JSON.parse(value.payloadText);
      } catch {
        throw new Error("Payload 不是有效 JSON");
      }
      const delays = value.delaysText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .map(Number);
      if (delays.length !== value.maxAttempts - 1 || delays.some((delay) => !Number.isInteger(delay) || delay < 60 || delay > 86_400)) {
        throw new Error(`重试延迟需要 ${value.maxAttempts - 1} 项，每项为 60..86400 秒`);
      }
      const selectedAction = target?.actions.find((candidate) => candidate.name === value.action);
      if (!selectedAction) throw new Error("请重新选择有效 Action");
      const revision = existing.data?.data.revision;
      if (editing && revision === undefined) throw new Error("Schedule revision 尚未加载");
      const mutationOptions: { method?: "PATCH"; revision?: number } = {};
      if (editing && revision !== undefined) {
        mutationOptions.method = "PATCH";
        mutationOptions.revision = revision;
      }
      return apiMutate(
        editing ? `/api/v1/schedules/${id ?? ""}` : "/api/v1/schedules",
        {
          name: value.name,
          description: value.description,
          targetId: value.targetId,
          action: value.action,
          actionVersion: selectedAction.version,
          cronExpression: value.cronExpression,
          timezone: value.timezone,
          ...(editing ? {} : { enabled: value.enabled }),
          payload,
          retryPolicy: {
            maxAttempts: value.maxAttempts,
            delaysSeconds: delays,
            retryOnUnknown: value.retryOnUnknown,
          },
          timeoutMs: value.timeoutMs,
          misfirePolicy: value.misfirePolicy,
          misfireGraceSeconds: value.misfireGraceSeconds,
        },
        idMutationSchema,
        mutationOptions,
      );
    },
    onSuccess: ({ data }) => {
      toast.success(editing ? "Schedule 已更新" : "Schedule 已创建", {
        description: editing ? "新的 revision 已保存；既有 Execution 快照不会改变。" : "默认暂停的计划可在详情页确认后恢复。",
      });
      void navigate(`/schedules/${data.id}`);
    },
    onError: (error) => {
      setError("root", { message: errorMessage(error) });
    },
  });

  const actions = useMemo(() => target?.actions ?? [], [target]);

  if (targets.isLoading || (editing && existing.isLoading)) return <LoadingState label="正在读取 Schedule 与 Target manifest" />;
  if (targets.isError || !targets.data || (editing && (existing.isError || !existing.data))) {
    return <ErrorState error={targets.error ?? existing.error} retry={() => void Promise.all([targets.refetch(), existing.refetch()])} />;
  }

  return (
    <>
      <PageHeader
        action={
          <Button asChild variant="ghost">
            <Link to="/schedules"><ArrowLeft size={15} /> 返回计划</Link>
          </Button>
        }
        description={editing ? "修改会生成新的 Schedule revision；已经存在的 Execution 继续使用不可变快照。" : "先以暂停状态保存并核对未来时间。立即安排与定时派发都由后续 Tick 统一领取。"}
        title={editing ? "编辑 Schedule" : "新建 Schedule"}
      />
      <form className="grid gap-5" onSubmit={(event) => void handleSubmit((value) => submit.mutateAsync(value))(event)}>
        <Card>
          <CardHeader><CardTitle>任务与目标</CardTitle></CardHeader>
          <CardContent className="form-grid">
            <Field error={errors.name?.message} label="名称" required>
              <Input {...register("name")} aria-label="名称 *" autoFocus placeholder="例如：同步用户" />
            </Field>
            <Field error={errors.description?.message} label="说明">
              <Input {...register("description")} aria-label="说明" placeholder="给当值人员的简短说明" />
            </Field>
            <Field error={errors.targetId?.message} label="Target" required>
              <Select {...register("targetId")} aria-label="Target *">
                {targets.data.data.map((value) => (
                  <option key={value.id} value={value.id}>{value.id} · {value.label}</option>
                ))}
              </Select>
            </Field>
            <Field error={errors.action?.message} label="Action" required>
              <Select {...register("action")} aria-label="Action *">
                {actions.map((value) => (
                  <option key={`${value.name}:${value.version}`} value={value.name}>
                    {value.name} · v{value.version}{value.idempotent ? " · 幂等" : " · 非幂等"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="field-span-2" error={errors.payloadText?.message} label="Payload JSON" required>
              <Textarea {...register("payloadText")} aria-label="Payload JSON *" className="mono min-h-36" spellCheck={false} />
              <p className="field-help">不得包含 Secret；上限 16 KiB。业务 schema 由目标 Worker 再次校验。</p>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>时间与漏跑</CardTitle></CardHeader>
          <CardContent className="form-grid">
            <div className="field-span-2 flex flex-wrap gap-2" aria-label="Cron 预设">
              {presets.map((preset) => (
                <Button key={preset.value} onClick={() => setValue("cronExpression", preset.value, { shouldValidate: true })} size="sm" type="button" variant="outline">
                  {preset.label}
                </Button>
              ))}
            </div>
            <Field error={errors.cronExpression?.message} label="Unix 五字段 Cron" required>
              <Input {...register("cronExpression")} aria-label="Unix 五字段 Cron *" className="mono" />
              <p className="field-help">星期 1 表示 Monday；不要直接复制 Cloudflare 原生数字星期。</p>
            </Field>
            <Field error={errors.timezone?.message} label="IANA 时区" required>
              <Input {...register("timezone")} aria-label="IANA 时区 *" className="mono" placeholder="Asia/Shanghai" />
            </Field>
            <Field error={errors.misfirePolicy?.message} label="漏跑策略">
              <Select {...register("misfirePolicy")} aria-label="漏跑策略">
                <option value="coalesce">coalesce · 合并为一次</option>
                <option value="skip">skip · 超宽限跳过</option>
              </Select>
            </Field>
            <Field error={errors.misfireGraceSeconds?.message} label="漏跑宽限（秒）">
              <Input {...register("misfireGraceSeconds", { valueAsNumber: true })} aria-label="漏跑宽限（秒）" min={0} max={86400} type="number" />
            </Field>
            <div className="field-span-2 rounded-[12px] border border-border bg-muted/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <CalendarCheck size={16} /> 未来 5 次
              </div>
              {preview.isFetching ? <div className="skeleton h-28" /> : preview.isError ? (
                <p className="text-sm text-destructive" role="alert">{errorMessage(preview.error)}</p>
              ) : (
                <ul className="preview-list">
                  {preview.data?.data.map((value) => (
                    <li key={value.utc}><span>{value.local}</span><code className="mono text-xs text-muted-foreground">{value.utc}</code></li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>重试与执行边界</CardTitle></CardHeader>
          <CardContent className="form-grid">
            <Field error={errors.maxAttempts?.message} label="总尝试次数（含首次）">
              <Input {...register("maxAttempts", { valueAsNumber: true })} aria-label="总尝试次数（含首次）" disabled={action?.idempotent === false} min={1} max={5} type="number" />
            </Field>
            <Field error={errors.delaysText?.message} label="重试延迟（秒，逗号分隔）">
              <Input {...register("delaysText")} aria-label="重试延迟（秒，逗号分隔）" disabled={action?.idempotent === false || maxAttempts <= 1} placeholder={maxAttempts > 1 ? "60, 300" : "无需填写"} />
            </Field>
            <Field error={errors.timeoutMs?.message} label="RPC deadline（毫秒）">
              <Input {...register("timeoutMs", { valueAsNumber: true })} aria-label="RPC deadline（毫秒）" min={1000} max={30000} step={1000} type="number" />
            </Field>
            <label className="flex min-h-10 items-center gap-3 rounded-[10px] border border-border px-3 text-sm">
              <input {...register("retryOnUnknown")} disabled={action?.idempotent === false || maxAttempts <= 1} type="checkbox" />
              unknown 时允许自动重试（仅幂等 Action）
            </label>
            {editing ? null : <label className="field-span-2 flex items-start gap-3 rounded-[12px] border border-border bg-muted/35 p-4 text-sm">
              <input {...register("enabled")} className="mt-1" type="checkbox" />
              <span><strong className="block">创建后立即启用</strong><span className="mt-1 block text-muted-foreground">建议先保持暂停，核对 preview 并执行一次受控的 Run now。</span></span>
            </label>}
            {action?.idempotent === false ? (
              <div className="field-span-2 flex gap-2 rounded-[12px] border border-border p-4 text-sm text-muted-foreground">
                <Info className="mt-0.5 shrink-0" size={16} /> 此 Action 声明为非幂等，自动重试选项已关闭；失败和 unknown 需要人工判断。
              </div>
            ) : null}
          </CardContent>
        </Card>

        {errors.root ? <p className="text-sm text-destructive" role="alert">{errors.root.message}</p> : null}
        <div className="flex justify-end gap-3">
          <Button asChild variant="outline"><Link to="/schedules">取消</Link></Button>
          <Button disabled={isSubmitting || submit.isPending || preview.isError || preview.isFetching} type="submit">
            {submit.isPending ? "正在保存…" : editing ? <><Pencil size={15} /> 保存修改</> : "保存 Schedule"}
          </Button>
        </div>
      </form>
    </>
  );
}

function Field({
  label,
  error,
  required,
  className,
  children,
}: {
  label: string;
  error?: string | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className={`field ${className ?? ""}`}>
      <Label>{label}{required ? <span aria-hidden="true"> *</span> : null}</Label>
      {children}
      {error ? <span className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}
