import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleOff,
  CirclePause,
  CirclePlay,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
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
  healthy: "心跳正常",
  stale: "心跳陈旧",
  dispatch_paused: "派发已暂停",
  dispatch_active: "派发已开启",
  enabled: "已启用",
  schedule_paused: "已暂停",
  disabled: "已禁用",
  not_synced: "未同步",
  neutral: "尚未检查",
  dispatch_unavailable: "派发状态不可用",
  heartbeat_unavailable: "心跳不可用",
  registered: "已注册",
  unregistered: "待注册",
  active: "有效",
  attention: "需要处理",
  revoked: "已撤销",
  expired: "已过期",
};

const icons: Record<string, LucideIcon> = {
  pending: LoaderCircle,
  running: LoaderCircle,
  retry_wait: LoaderCircle,
  succeeded: CircleCheck,
  failed: CircleAlert,
  unknown: CircleDashed,
  skipped: CircleOff,
  cancelled: CircleOff,
  compatible: CircleCheck,
  incompatible: CircleAlert,
  unreachable: CircleAlert,
  healthy: CircleCheck,
  stale: CircleDashed,
  dispatch_paused: CirclePause,
  dispatch_active: CirclePlay,
  enabled: CircleCheck,
  schedule_paused: CirclePause,
  disabled: CircleOff,
  not_synced: CircleDashed,
  neutral: CircleDashed,
  dispatch_unavailable: CircleDashed,
  heartbeat_unavailable: CircleDashed,
  registered: CircleCheck,
  unregistered: CircleDashed,
  active: CircleCheck,
  attention: CircleAlert,
  revoked: CircleOff,
  expired: CircleAlert,
};

export function StatusBadge({ status }: { status: string }) {
  const Icon = icons[status] ?? CircleOff;
  return (
    <Badge className={`status-${status}`}>
      <Icon aria-hidden="true" size={13} strokeWidth={2} />
      {labels[status] ?? status}
    </Badge>
  );
}
