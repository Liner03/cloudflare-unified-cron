import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import "@fontsource-variable/geist";
import { AppShell } from "@/components/shared/app-shell";
import { LoadingState } from "@/components/shared/page-states";
import "./styles.css";

const OverviewPage = lazy(() => import("@/features/overview/overview-page").then((module) => ({ default: module.OverviewPage })));
const SchedulesPage = lazy(() => import("@/features/schedules/schedules-page").then((module) => ({ default: module.SchedulesPage })));
const ScheduleEditorPage = lazy(() => import("@/features/schedules/schedule-editor-page").then((module) => ({ default: module.ScheduleEditorPage })));
const ScheduleDetailPage = lazy(() => import("@/features/schedules/schedule-detail-page").then((module) => ({ default: module.ScheduleDetailPage })));
const ExecutionsPage = lazy(() => import("@/features/executions/executions-page").then((module) => ({ default: module.ExecutionsPage })));
const ExecutionDetailPage = lazy(() => import("@/features/executions/execution-detail-page").then((module) => ({ default: module.ExecutionDetailPage })));
const TargetsPage = lazy(() => import("@/features/targets/targets-page").then((module) => ({ default: module.TargetsPage })));
const SystemPage = lazy(() => import("@/features/system/system-page").then((module) => ({ default: module.SystemPage })));

function load(element: ReactNode) {
  return <Suspense fallback={<LoadingState label="正在加载页面" />}>{element}</Suspense>;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: load(<OverviewPage />) },
      { path: "schedules", element: load(<SchedulesPage />) },
      { path: "schedules/new", element: load(<ScheduleEditorPage />) },
      { path: "schedules/:id/edit", element: load(<ScheduleEditorPage />) },
      { path: "schedules/:id", element: load(<ScheduleDetailPage />) },
      { path: "executions", element: load(<ExecutionsPage />) },
      { path: "executions/:id", element: load(<ExecutionDetailPage />) },
      { path: "targets", element: load(<TargetsPage />) },
      { path: "system", element: load(<SystemPage />) },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster closeButton position="top-right" richColors />
    </QueryClientProvider>
  </StrictMode>,
);
