import {
  Activity,
  CalendarClock,
  Clock3,
  Menu,
  Moon,
  RadioTower,
  ServerCog,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";

const nav = [
  { to: "/", label: "Overview", icon: Activity },
  { to: "/schedules", label: "Schedules", icon: CalendarClock },
  { to: "/executions", label: "Executions", icon: Clock3 },
  { to: "/targets", label: "Targets", icon: RadioTower },
  { to: "/system", label: "System", icon: ServerCog },
];

const titles: Record<string, string> = {
  "/": "运行总览",
  "/schedules": "计划",
  "/executions": "执行记录",
  "/targets": "目标服务",
  "/system": "系统",
};

export function AppShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("ucp-theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("ucp-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const title =
    Object.entries(titles)
      .filter(([path]) => (path === "/" ? location.pathname === "/" : location.pathname.startsWith(path)))
      .at(-1)?.[1] ?? "Cron Control Center";

  return (
    <div className="app-shell">
      {menuOpen ? (
        <button aria-label="关闭导航" className="sidebar-scrim" onClick={() => setMenuOpen(false)} type="button" />
      ) : null}
      <aside aria-label="主导航" className="sidebar" data-open={menuOpen}>
        <div className="sidebar-brand">
          <div aria-hidden="true" className="brand-mark" />
          <div>
            <div className="text-sm font-semibold leading-tight">Cron Control</div>
            <div className="mt-0.5 text-[11px] text-[var(--sidebar-muted)]">Unified scheduler</div>
          </div>
          <Button
            aria-label="关闭导航"
            className="ml-auto text-[var(--sidebar-muted)] md:hidden"
            onClick={() => setMenuOpen(false)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X size={17} />
          </Button>
        </div>
        <nav className="sidebar-nav">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              className="nav-link"
              end={to === "/"}
              key={to}
              to={to}
            >
              <Icon aria-hidden="true" size={17} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="mb-1 flex items-center gap-2 font-semibold text-[var(--sidebar-foreground)]">
            <span className="status-dot status-succeeded" />
            单账号控制面
          </div>
          一个原生 Cron · D1 · RPC
        </div>
      </aside>
      <main className="app-main w-full max-w-full overflow-x-hidden">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="打开导航"
              className="mobile-menu"
              onClick={() => setMenuOpen(true)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Menu size={18} />
            </Button>
            <span className="truncate text-sm font-semibold">{title}</span>
          </div>
          <Button
            aria-label={dark ? "切换浅色模式" : "切换深色模式"}
            onClick={() => setDark((value) => !value)}
            size="icon"
            type="button"
            variant="ghost"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
