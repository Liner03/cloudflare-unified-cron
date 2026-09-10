import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Check,
  Clipboard,
  KeyRound,
  Plus,
  RotateCw,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ActionConfirm } from "@/components/shared/action-confirm";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from "@/components/shared/page-states";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/form-controls";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import {
  issuedRegistrationTokenSchema,
  registrationTokensSchema,
  stateMutationSchema,
  targetsSchema,
} from "@/lib/api-schemas";
import { formatTime, shortId } from "@/lib/format";

interface RevealedToken {
  token: string;
  targetId: string;
  label: string;
  expiresAt: string;
  rotatedFromId?: string | undefined;
}

const issueTokenFormSchema = z.object({
  targetId: z.string().min(1, "请选择 Target").max(128),
  label: z
    .string()
    .trim()
    .min(1, "请输入用途标签")
    .max(100, "标签不能超过 100 个字符"),
  expiresInDays: z.enum(["30", "90", "180", "365"]),
});
type IssueTokenFormValues = z.infer<typeof issueTokenFormSchema>;

export function RegistrationsPage() {
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [revealed, setRevealed] = useState<RevealedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const issueForm = useForm<IssueTokenFormValues>({
    resolver: zodResolver(issueTokenFormSchema),
    defaultValues: { targetId: "", label: "", expiresInDays: "90" },
  });
  const tokens = useQuery({
    queryKey: ["registration-tokens"],
    queryFn: ({ signal }) =>
      apiGet("/api/v1/registration-tokens", registrationTokensSchema, signal),
  });
  const targets = useQuery({
    queryKey: ["targets"],
    queryFn: ({ signal }) => apiGet("/api/v1/targets", targetsSchema, signal),
  });
  const issue = useMutation({
    mutationFn: (values: IssueTokenFormValues) =>
      apiMutate(
        "/api/v1/registration-tokens",
        {
          targetId: values.targetId,
          label: values.label,
          expiresInDays: Number(values.expiresInDays),
        },
        issuedRegistrationTokenSchema,
      ),
    onSuccess: async ({ data }) => {
      setIssueOpen(false);
      issueForm.reset({ targetId: "", label: "", expiresInDays: "90" });
      setRevealed(data);
      setCopied(false);
      await queryClient.invalidateQueries({
        queryKey: ["registration-tokens"],
      });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiMutate(
        `/api/v1/registration-tokens/${id}/revoke`,
        {},
        stateMutationSchema,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["registration-tokens"],
      });
      toast.success("Registration Token 已撤销");
    },
    onError: (error) =>
      toast.error("无法撤销 Token", { description: errorMessage(error) }),
  });
  const rotate = useMutation({
    mutationFn: (id: string) =>
      apiMutate(
        `/api/v1/registration-tokens/${id}/rotate`,
        { expiresInDays: 90 },
        issuedRegistrationTokenSchema,
      ),
    onSuccess: async ({ data }) => {
      setRevealed(data);
      setCopied(false);
      await queryClient.invalidateQueries({
        queryKey: ["registration-tokens"],
      });
    },
    onError: (error) =>
      toast.error("无法轮换 Token", { description: errorMessage(error) }),
  });
  const submitIssue = issueForm.handleSubmit((values) => issue.mutate(values));
  const copy = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.token);
      setCopied(true);
    } catch {
      toast.error("浏览器未允许复制，请手动选择 Token");
    }
  };

  const isLoading = tokens.isLoading || targets.isLoading;
  const hasError = tokens.isError || targets.isError;
  const targetValues = (targets.data?.data ?? []).filter(
    (target) => !target.isDemo,
  );
  const realTargetIds = new Set(targetValues.map((target) => target.id));
  const tokenValues = (tokens.data?.data ?? []).filter((token) =>
    realTargetIds.has(token.targetId),
  );
  const now = Date.now();

  return (
    <>
      <PageHeader
        action={
          <Dialog
            onOpenChange={(open) => {
              setIssueOpen(open);
              if (open) {
                issue.reset();
                issueForm.reset({
                  targetId: targetValues[0]?.id ?? "",
                  label: "",
                  expiresInDays: "90",
                });
              }
            }}
            open={issueOpen}
          >
            <DialogTrigger asChild>
              <Button disabled={targetValues.length === 0}>
                <Plus size={16} /> 签发 Token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>签发 Registration Token</DialogTitle>
              <DialogDescription>
                Token 只允许一个预授权 Target 发布完整
                Registration，不能访问管理员接口。
              </DialogDescription>
              <form
                className="mt-5 grid gap-4"
                noValidate
                onSubmit={(event) => void submitIssue(event)}
              >
                <div className="grid gap-2">
                  <Label htmlFor="token-target">Target</Label>
                  <Select
                    aria-describedby={
                      issueForm.formState.errors.targetId
                        ? "token-target-error"
                        : undefined
                    }
                    aria-invalid={Boolean(issueForm.formState.errors.targetId)}
                    aria-required="true"
                    id="token-target"
                    {...issueForm.register("targetId")}
                  >
                    {targetValues.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label} ({target.id})
                      </option>
                    ))}
                  </Select>
                  {issueForm.formState.errors.targetId ? (
                    <p
                      className="text-sm text-destructive"
                      id="token-target-error"
                      role="alert"
                    >
                      {issueForm.formState.errors.targetId.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="token-label">用途标签</Label>
                  <Input
                    aria-describedby={
                      issueForm.formState.errors.label
                        ? "token-label-error"
                        : undefined
                    }
                    aria-invalid={Boolean(issueForm.formState.errors.label)}
                    aria-required="true"
                    id="token-label"
                    maxLength={100}
                    placeholder="例如：production deployment"
                    {...issueForm.register("label")}
                  />
                  {issueForm.formState.errors.label ? (
                    <p
                      className="text-sm text-destructive"
                      id="token-label-error"
                      role="alert"
                    >
                      {issueForm.formState.errors.label.message}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="token-expiry">有效期</Label>
                  <Select
                    aria-required="true"
                    id="token-expiry"
                    {...issueForm.register("expiresInDays")}
                  >
                    <option value="30">30 天</option>
                    <option value="90">90 天</option>
                    <option value="180">180 天</option>
                    <option value="365">365 天</option>
                  </Select>
                </div>
                {issue.isError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errorMessage(issue.error)}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2 pt-2">
                  <DialogClose asChild>
                    <Button type="button" variant="ghost">
                      取消
                    </Button>
                  </DialogClose>
                  <Button disabled={issue.isPending}>
                    <KeyRound size={15} />
                    {issue.isPending ? "正在签发" : "签发一次性 Token"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        }
        description="低频的网站接入与凭据维护；日常运行状态请从网站和业务总览查看。"
        title="网站接入"
      />

      {isLoading ? (
        <LoadingState label="正在读取 Registration 状态" />
      ) : hasError || !tokens.data || !targets.data ? (
        <ErrorState
          error={tokens.error ?? targets.error}
          retry={() => {
            void tokens.refetch();
            void targets.refetch();
          }}
        />
      ) : (
        <div className="grid gap-5">
          <section className="registration-strip" aria-label="Worker 注册状态">
            {targetValues.map((target) => (
              <article className="registration-strip-item" key={target.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold">{target.label}</h2>
                    <StatusBadge
                      status={
                        target.registration ? "registered" : "unregistered"
                      }
                    />
                  </div>
                  <p className="mono mt-1 truncate text-xs text-muted-foreground">
                    {target.id} · {target.binding}
                  </p>
                </div>
                <dl className="registration-strip-meta">
                  <div>
                    <dt>Revision</dt>
                    <dd className="mono">
                      {target.registration?.revision ?? "尚未注册"}
                    </dd>
                  </div>
                  <div>
                    <dt>最近发布</dt>
                    <dd>
                      {formatTime(target.registration?.registeredAt ?? null)}
                    </dd>
                  </div>
                  <div>
                    <dt>Actions</dt>
                    <dd className="tabular">{target.actions.length}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </section>

          <section className="ledger-section">
            <div className="ledger-heading">
              <div>
                <h2 className="text-sm font-semibold">Registration Tokens</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  原始 Token 永不保存；这里只显示生命周期和最后使用时间。
                </p>
              </div>
            </div>
            {tokenValues.length === 0 ? (
              <EmptyState
                description="为预授权的网站 Worker 签发 Token，并将它作为 Worker Secret 分发。"
                title="尚无 Registration Token"
              />
            ) : (
              <div className="table-wrap">
                <Table className="min-w-[900px] table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[22%]">凭据</TableHead>
                      <TableHead className="w-[35%]">
                        Target / Registration
                      </TableHead>
                      <TableHead className="w-[12%]">最近使用</TableHead>
                      <TableHead className="w-[12%]">到期</TableHead>
                      <TableHead className="w-[9%]">状态</TableHead>
                      <TableHead className="w-[10%] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tokenValues.map((token) => {
                      const status = token.revokedAt
                        ? "revoked"
                        : Date.parse(token.expiresAt) <= now
                          ? "expired"
                          : "active";
                      return (
                        <TableRow key={token.id}>
                          <TableCell>
                            <div className="font-semibold">{token.label}</div>
                            <div className="mono mt-1 text-xs text-muted-foreground">
                              {shortId(token.id)} · {token.scope}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="mono text-xs">{token.targetId}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {token.registration?.revision ?? "尚未发布"}
                            </div>
                          </TableCell>
                          <TableCell className="tabular text-xs">
                            {formatTime(token.lastUsedAt)}
                          </TableCell>
                          <TableCell className="tabular text-xs">
                            {formatTime(token.expiresAt)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={status} />
                          </TableCell>
                          <TableCell className="text-right">
                            {status === "active" ? (
                              <div className="flex justify-end gap-0.5">
                                <ActionConfirm
                                  confirmLabel="轮换并撤销旧 Token"
                                  description="平台会原子签发替换 Token 并撤销旧值；新值仍只显示一次。"
                                  onConfirm={() => rotate.mutate(token.id)}
                                  title="轮换这个 Registration Token？"
                                  trigger={
                                    <Button
                                      aria-label={`轮换 ${token.label} ${shortId(token.id)}`}
                                      disabled={
                                        rotate.isPending || revoke.isPending
                                      }
                                      className="size-8"
                                      size="icon"
                                      title={`轮换 ${token.label}`}
                                      variant="ghost"
                                    >
                                      <RotateCw aria-hidden="true" size={14} />
                                    </Button>
                                  }
                                />
                                <ActionConfirm
                                  confirmLabel="撤销 Token"
                                  danger
                                  description="撤销立即阻止后续 Registration；不会删除当前声明或管理员 Session。"
                                  onConfirm={() => revoke.mutate(token.id)}
                                  title="撤销这个 Registration Token？"
                                  trigger={
                                    <Button
                                      aria-label={`撤销 ${token.label} ${shortId(token.id)}`}
                                      disabled={
                                        revoke.isPending || rotate.isPending
                                      }
                                      className="size-8"
                                      size="icon"
                                      title={`撤销 ${token.label}`}
                                      variant="ghost"
                                    >
                                      <Ban aria-hidden="true" size={14} />
                                    </Button>
                                  }
                                />
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog
        onOpenChange={(open) => {
          if (!open) setRevealed(null);
        }}
        open={revealed !== null}
      >
        <DialogContent
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle>
            {revealed?.rotatedFromId
              ? "立即保存替换 Token"
              : "立即保存这个 Token"}
          </DialogTitle>
          <DialogDescription>
            这是唯一一次显示原始值。关闭后平台只能看到哈希，无法恢复。
          </DialogDescription>
          {revealed ? (
            <div className="mt-5 grid gap-4">
              <div className="token-reveal-warning">
                <ShieldAlert aria-hidden="true" size={18} />
                将它保存为 {revealed.targetId} Worker 的
                Secret，不要写入源码、日志或 CI 输出。
              </div>
              <code className="token-reveal-value">{revealed.token}</code>
              <dl className="detail-list">
                <dt>标签</dt>
                <dd>{revealed.label}</dd>
                <dt>到期</dt>
                <dd>{formatTime(revealed.expiresAt)}</dd>
              </dl>
              <div className="flex flex-wrap justify-end gap-2">
                <Button onClick={() => void copy()} variant="outline">
                  {copied ? <Check size={15} /> : <Clipboard size={15} />}
                  {copied ? "已复制" : "复制 Token"}
                </Button>
                <DialogClose asChild>
                  <Button>我已安全保存</Button>
                </DialogClose>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
