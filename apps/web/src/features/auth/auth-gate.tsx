import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, RadioTower } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import { authSessionSchema } from "@/lib/api-schemas";

const SESSION_QUERY_KEY = ["auth", "session"] as const;
const loginFormSchema = z.object({
  username: z.string().trim().min(1, "请输入用户名").max(128),
  password: z.string().min(1, "请输入密码").max(1024),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

interface AuthContextValue {
  username: string;
  logout: () => void;
  loggingOut: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthGate");
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: ({ signal }) =>
      apiGet("/api/v1/auth/session", authSessionSchema, signal),
    retry: false,
    staleTime: 30_000,
  });
  useEffect(() => {
    const requireAuthentication = () => {
      queryClient.setQueryData(SESSION_QUERY_KEY, {
        data: { authenticated: false, username: null },
      });
    };
    window.addEventListener(
      "unified-cron:auth-required",
      requireAuthentication,
    );
    return () =>
      window.removeEventListener(
        "unified-cron:auth-required",
        requireAuthentication,
      );
  }, [queryClient]);

  const logout = useMutation({
    mutationFn: () => apiMutate("/api/v1/auth/logout", {}, authSessionSchema),
    onSuccess: (value) => {
      queryClient.clear();
      queryClient.setQueryData(SESSION_QUERY_KEY, value);
    },
  });

  if (session.isLoading) return <AuthLoading />;
  if (session.isError || !session.data) {
    return (
      <AuthUnavailable
        error={session.error}
        retry={() => void session.refetch()}
      />
    );
  }
  if (!session.data.data.authenticated || !session.data.data.username) {
    return (
      <LoginPage
        onAuthenticated={() =>
          void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY })
        }
      />
    );
  }
  return (
    <AuthContext
      value={{
        username: session.data.data.username,
        logout: () => logout.mutate(),
        loggingOut: logout.isPending,
      }}
    >
      {children}
    </AuthContext>
  );
}

function LoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { username: "", password: "" },
  });
  const login = useMutation({
    mutationFn: (values: LoginFormValues) =>
      apiMutate("/api/v1/auth/login", values, authSessionSchema),
    onSuccess: onAuthenticated,
  });
  const submit = form.handleSubmit((values) => login.mutate(values));
  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-form-wrap">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <span>Worker 控制台</span>
          </div>
          <div className="login-heading">
            <RadioTower aria-hidden="true" size={22} />
            <h1 id="login-title">管理员登录</h1>
            <p>登录后查看所有 Worker 网站的自动任务与运行异常。</p>
          </div>
          <form
            className="login-form"
            noValidate
            onSubmit={(event) => void submit(event)}
          >
            <div className="grid gap-2">
              <Label htmlFor="admin-username">用户名</Label>
              <Input
                autoComplete="username"
                autoFocus
                aria-describedby={
                  form.formState.errors.username
                    ? "admin-username-error"
                    : undefined
                }
                aria-invalid={Boolean(form.formState.errors.username)}
                aria-required="true"
                id="admin-username"
                maxLength={128}
                {...form.register("username")}
              />
              {form.formState.errors.username ? (
                <p
                  className="login-error"
                  id="admin-username-error"
                  role="alert"
                >
                  {form.formState.errors.username.message}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-password">密码</Label>
              <Input
                autoComplete="current-password"
                aria-describedby={
                  form.formState.errors.password
                    ? "admin-password-error"
                    : undefined
                }
                aria-invalid={Boolean(form.formState.errors.password)}
                aria-required="true"
                id="admin-password"
                maxLength={1024}
                type="password"
                {...form.register("password")}
              />
              {form.formState.errors.password ? (
                <p
                  className="login-error"
                  id="admin-password-error"
                  role="alert"
                >
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </div>
            {login.isError ? (
              <p className="login-error" role="alert">
                {errorMessage(login.error)}
              </p>
            ) : null}
            <Button className="w-full" disabled={login.isPending} size="lg">
              {login.isPending ? (
                <LoaderCircle className="animate-spin" size={17} />
              ) : (
                <KeyRound size={17} />
              )}
              {login.isPending ? "正在验证" : "登录控制台"}
            </Button>
          </form>
          <p className="login-footnote">
            本地管理员会话与网站 Registration Token 分开授权。
          </p>
        </div>
      </section>
    </main>
  );
}

function AuthLoading() {
  return (
    <main
      className="auth-state"
      aria-busy="true"
      aria-label="正在验证管理员会话"
    >
      <LoaderCircle className="animate-spin" size={24} />
      <span>正在验证管理员会话</span>
    </main>
  );
}

function AuthUnavailable({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="auth-state" role="alert">
      <h1>暂时无法连接控制平面</h1>
      <p>{errorMessage(error)}</p>
      <Button onClick={retry} variant="outline">
        重新连接
      </Button>
    </main>
  );
}
