import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, RadioTower } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form-controls";
import { apiGet, apiMutate, errorMessage } from "@/lib/api-client";
import { authSessionSchema } from "@/lib/api-schemas";

const SESSION_QUERY_KEY = ["auth", "session"] as const;

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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    mutationFn: () =>
      apiMutate(
        "/api/v1/auth/login",
        { username, password },
        authSessionSchema,
      ),
    onSuccess: onAuthenticated,
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!login.isPending) login.mutate();
  };
  return (
    <main className="login-page">
      <section className="login-signal" aria-hidden="true">
        <div className="login-signal-grid">
          <RadioTower size={30} strokeWidth={1.5} />
          <span>ONE CLOCK / VERIFIED INTENT</span>
        </div>
        <div className="login-signal-copy">
          <h1>每一次派发，先有可信身份。</h1>
          <p>
            管理员 Session 与 Worker Registration Token 分开授权；浏览器不能替
            Worker 声明业务计划。
          </p>
        </div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-form-wrap">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true" />
            <span>Unified Cron</span>
          </div>
          <div>
            <h2 id="login-title">管理员登录</h2>
            <p>使用部署时配置的本地管理员凭据。</p>
          </div>
          <form className="login-form" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="admin-username">用户名</Label>
              <Input
                autoComplete="username"
                autoFocus
                id="admin-username"
                maxLength={128}
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="admin-password">密码</Label>
              <Input
                autoComplete="current-password"
                id="admin-password"
                maxLength={1024}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
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
