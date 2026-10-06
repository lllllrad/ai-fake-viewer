import { useState } from "react";
import { adminClient } from "../../lib/admin-client";
import { useAdminActions } from "../../lib/use-admin-actions";

export function AdminLogin({ refresh }: { refresh: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const actions = useAdminActions(refresh);
  return (
    <main className="login">
      <div className="eyebrow">MIXED CHAT / LOCAL STUDIO</div>
      <h1>방송 운영에 연결하기</h1>
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
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            disabled={actions.pending}
            autoComplete="off"
            required
          />
        </label>
        <button disabled={actions.pending}>
          {actions.pending ? "연결 중…" : "연결하기"}
        </button>
      </form>
      {actions.error && (
        <p role="alert" className="error">
          {actions.error}
        </p>
      )}
    </main>
  );
}
