import {
  Activity,
  CalendarClock,
  Clock3,
  Globe2,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  ServerCog,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-gate";

const primaryNav = [
  { to: "/", label: "运行总览", icon: Activity },
  { to: "/targets", label: "网站", icon: Globe2 },
  { to: "/executions", label: "执行记录", icon: Clock3 },
  { to: "/deliveries", label: "触发记录", icon: CalendarClock },
];

const secondaryNav = [
  { to: "/schedules", label: "所有 Cron", icon: CalendarClock },
  { to: "/registrations", label: "网站接入", icon: KeyRound },
  { to: "/system", label: "调度设置", icon: ServerCog },
];

const titles: Record<string, string> = {
  "/": "运行总览",
  "/schedules": "所有 Cron",
  "/executions": "执行记录",
  "/deliveries": "触发记录",
  "/targets": "网站",
  "/registrations": "网站接入",
  "/system": "调度设置",
};

function useMobileViewport(): boolean {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 899px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 899px)");
    const update = (event: MediaQueryListEvent) => setMobile(event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function AppShell() {
  const auth = useAuth();
  const location = useLocation();
  const mobileViewport = useMobileViewport();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(
    () => localStorage.getItem("ucp-theme") === "dark",
  );
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const openedOnMobile = useRef(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ucp-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!mobileViewport) return;
    if (menuOpen) {
      openedOnMobile.current = true;
      closeButton.current?.focus();
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") setMenuOpen(false);
      };
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
    if (openedOnMobile.current) {
      menuButton.current?.focus();
      openedOnMobile.current = false;
    }
  }, [menuOpen, mobileViewport]);

  const title =
    Object.entries(titles)
      .filter(([path]) =>
        path === "/"
          ? location.pathname === "/"
          : location.pathname.startsWith(path),
      )
      .at(-1)?.[1] ?? "Cron Control Center";

  return (
    <div className="app-shell">
      {menuOpen ? (
        <button
          aria-label="关闭导航"
          className="sidebar-scrim"
          onClick={() => setMenuOpen(false)}
          type="button"
        />
      ) : null}
      <aside
        aria-hidden={mobileViewport ? !menuOpen : undefined}
        aria-label="应用侧栏"
        className="sidebar"
        data-open={menuOpen}
        inert={mobileViewport ? !menuOpen : undefined}
      >
        <div className="sidebar-brand">
          <div aria-hidden="true" className="brand-mark" />
          <div>
            <div className="text-sm font-semibold leading-tight">
              Worker 控制台
            </div>
            <div className="mt-0.5 text-[11px] text-[var(--sidebar-muted)]">
              网站自动任务
            </div>
          </div>
          <Button
            aria-label="关闭导航"
            className="ml-auto size-11 text-[var(--sidebar-muted)] min-[900px]:hidden"
            onClick={() => setMenuOpen(false)}
            ref={closeButton}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X size={17} />
          </Button>
        </div>
        <nav aria-label="主导航" className="sidebar-nav">
          {primaryNav.map(({ to, label, icon: Icon }) => (
            <NavLink className="nav-link" end={to === "/"} key={to} to={to}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
          <div className="sidebar-nav-label">管理</div>
          {secondaryNav.map(({ to, label, icon: Icon }) => (
            <NavLink className="nav-link" key={to} to={to}>
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="mb-1 flex items-center gap-2 font-semibold text-[var(--sidebar-foreground)]">
            一个时钟，多站运行
          </div>
          Cloudflare Cron · D1 · RPC
        </div>
      </aside>
      <main
        aria-hidden={mobileViewport && menuOpen ? true : undefined}
        className="app-main w-full max-w-full overflow-x-hidden"
        inert={mobileViewport && menuOpen ? true : undefined}
      >
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="打开导航"
              className="mobile-menu size-11"
              onClick={() => setMenuOpen(true)}
              ref={menuButton}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Menu size={18} />
            </Button>
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-2 hidden text-xs text-muted-foreground sm:inline">
              {auth.username}
            </span>
            <Button
              aria-label={dark ? "切换浅色模式" : "切换深色模式"}
              className="size-11"
              onClick={() => setDark((value) => !value)}
              size="icon"
              type="button"
              variant="ghost"
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </Button>
            <Button
              aria-label="退出管理员登录"
              className="size-11"
              disabled={auth.loggingOut}
              onClick={() => auth.logout()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <LogOut size={17} />
            </Button>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
