import { CircleAlert, CircleCheck, CircleDashed, CircleOff, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const labels: Record<string, string> = {
  pending: "待领取",
  running: "运行中",
  retry_wait: "重试等待",
  succeeded: "成功",
  failed: "失败",
  unknown: "结果未知",
  skipped: "已跳过",
  cancelled: "已取消",
  compatible: "兼容",
  incompatible: "不兼容",
  unreachable: "不可达",
};

export function StatusBadge({ status }: { status: string }) {
  const Icon =
    status === "succeeded" || status === "compatible"
      ? CircleCheck
      : status === "failed" || status === "unreachable" || status === "incompatible"
        ? CircleAlert
        : status === "unknown"
          ? CircleDashed
          : status === "running" || status === "pending" || status === "retry_wait"
            ? LoaderCircle
            : CircleOff;
  return (
    <Badge className={`status-${status}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2} />
      {labels[status] ?? status}
    </Badge>
  );
}
