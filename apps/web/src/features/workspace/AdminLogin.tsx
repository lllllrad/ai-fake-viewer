import { Button, Input } from "../../components/ui";
import { useState } from "react";
import { adminClient } from "../../lib/admin-client";
import { useAdminActions } from "../../lib/use-admin-actions";

export function AdminLogin({ refresh }: { refresh: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const actions = useAdminActions(refresh);
  return (
    <main className="login">
      <p className="login-brand">Mixed Chat Studio</p>
      <h1>방송 작업 공간에 로그인</h1>
      <p>로컬 .env 파일의 관리자 접속 토큰을 입력해 주세요.</p>
      <form
        aria-busy={actions.pending}
        onSubmit={(event) => {
          event.preventDefault();
          void actions.run("login", async (signal) => {
            await adminClient.request("login", {
              method: "POST",
              body: { token: token.trim() },
              signal,
            });
          });
        }}
      >
        <label>
          관리자 접속 토큰
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={actions.pending}
            autoComplete="off"
            required
          />
        </label>
        <Button disabled={actions.pending}>
          {actions.pending ? "연결 중…" : "연결하기"}
        </Button>
      </form>
      {actions.error && (
        <p role="alert" className="error">
          {actions.error}
        </p>
      )}
    </main>
  );
}
