import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function LoadingState({
  label = "正在读取平台状态",
}: {
  label?: string;
}) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-3">
      <div className="skeleton h-18" />
      <div className="skeleton h-64" />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div>
        <Inbox aria-hidden="true" size={28} />
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {action === undefined ? null : <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <div>
        <AlertTriangle aria-hidden="true" size={30} />
        <h2 className="text-base font-semibold">平台状态暂时不可用</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          {error instanceof Error
            ? error.message
            : "请稍后重试；调度是否继续以 scheduled handler 与 D1 状态为准。"}
        </p>
        {retry === undefined ? null : (
          <Button className="mt-4" onClick={retry} variant="outline">
            <RotateCw aria-hidden="true" size={15} />
            重新读取
          </Button>
        )}
      </div>
    </div>
  );
}
