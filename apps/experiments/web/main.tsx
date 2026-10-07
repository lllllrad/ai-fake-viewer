import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";
import { ExperimentsPage } from "./features/ExperimentsPage";
import { AdminLogin } from "../../web/src/features/workspace/AdminLogin";
import { Button, Select } from "../../web/src/components/ui";
import { adminClient, AdminRequestError } from "../../web/src/lib/admin-client";
import "../../web/src/style.css";
import "./shell.css";
const sessionSchema = z.object({
  chatgpt: z.object({
    active: z.string().nullable(),
    accounts: z.array(
      z.object({
        clientId: z.string(),
        email: z.string().nullable(),
        connected: z.boolean(),
        model: z.string().nullable(),
      }),
    ),
  }),
});
function TestWorkspace() {
  const [session, setSession] = useState<z.infer<typeof sessionSchema>>();
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<Array<{ slug: string; name: string }>>(
    [],
  );
  const refreshRevision = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++refreshRevision.current;
    try {
      const next = await adminClient.json("session", sessionSchema);
      if (revision !== refreshRevision.current) return;
      setSession(next);
      setSignedOut(false);
      setError("");
    } catch (error) {
      if (revision !== refreshRevision.current) return;
      if (error instanceof AdminRequestError && error.unauthorized) {
        setSignedOut(true);
        setSession(undefined);
      } else
        setError(
          error instanceof Error ? error.message : "연결을 확인해 주세요.",
        );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);
  const action = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "요청에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };
  if (signedOut)
    return (
      <AdminLogin
        refresh={refresh}
        title="AI 테스트에 로그인"
        description=".local/experiments/.env 파일의 EXPERIMENT_ADMIN_TOKEN을 입력해 주세요."
      />
    );
  if (!session)
    return (
      <main className="login">
        <p role="status">{error || "테스트 서버에 연결하고 있습니다."}</p>
        {error && <Button onClick={() => void refresh()}>다시 연결</Button>}
      </main>
    );
  const active = session.chatgpt.accounts.find(
    (account) => account.clientId === session.chatgpt.active,
  );
  return (
    <main className="test-workspace">
      <header className="test-header">
        <div>
          <p className="eyebrow">독립 테스트 작업 공간</p>
          <h1>AI 시청자 테스트</h1>
          <p>
            말하거나 입력하며 반응을 살펴보고, 필요할 때 실행 기록을 확인하세요.
          </p>
        </div>
        <Button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await adminClient.request("logout", { method: "POST" });
              setSession(undefined);
              setSignedOut(true);
            })
          }
        >
          로그아웃
        </Button>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details
        className="card test-account"
        id="ai-connection"
        open={location.hash === "#ai-connection" || undefined}
      >
        <summary>테스트용 AI 연결 · {active?.model || "설정 확인"}</summary>
        <p>
          Responses API와 마이크 키는 테스트 서버의 .env에서 설정합니다. Sign in
          with ChatGPT는 이 작업 공간에서 별도로 연결하세요.
        </p>
        <div className="test-account-actions">
          <Button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                const result = await adminClient.json(
                  "chatgpt/authorize",
                  z.object({ url: z.string().url() }),
                  { method: "POST" },
                );
                location.assign(result.url);
              })
            }
          >
            Sign in with ChatGPT
          </Button>
          {session.chatgpt.accounts.length > 0 && (
            <label>
              테스트 계정
              <Select
                disabled={busy}
                aria-label="테스트 계정"
                value={session.chatgpt.active || ""}
                onChange={(event) => {
                  const clientId = event.target.value;
                  setModels([]);
                  void action(async () => {
                    await adminClient.request("chatgpt/select-account", {
                      method: "POST",
                      body: { clientId },
                    });
                  });
                }}
              >
                {session.chatgpt.accounts.map((account) => (
                  <option key={account.clientId} value={account.clientId}>
                    {account.email || "연결된 계정"}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {active && (
            <>
              <Button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await adminClient.json(
                      "chatgpt/models",
                      z.object({
                        models: z.array(
                          z.object({ slug: z.string(), name: z.string() }),
                        ),
                      }),
                    );
                    setModels(result.models);
                  })
                }
              >
                모델 목록 새로고침
              </Button>
              <Button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await adminClient.request("chatgpt/disconnect", {
                      method: "POST",
                    });
                    setModels([]);
                  })
                }
              >
                테스트 계정 연결 해제
              </Button>
            </>
          )}
          {models.length > 0 && (
            <label>
              테스트 모델
              <Select
                disabled={busy}
                aria-label="테스트 모델"
                value={active?.model || ""}
                onChange={(event) => {
                  const slug = event.target.value;
                  void action(async () => {
                    await adminClient.request("chatgpt/select-model", {
                      method: "POST",
                      body: { slug },
                    });
                  });
                }}
              >
                <option value="" disabled>
                  모델 선택
                </option>
                {models.map((model) => (
                  <option key={model.slug} value={model.slug}>
                    {model.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        <p className="hint">
          계정이나 모델을 바꾸면 진행 중인 테스트가 종료됩니다.
        </p>
      </details>
      <ExperimentsPage
        chatgptReady={!!active?.connected && !!active.model}
        connectionKey={JSON.stringify([
          active?.clientId,
          active?.connected,
          active?.model,
        ])}
        connectionBusy={busy}
      />
      <footer>
        테스트 기록은 이 서버에 보관됩니다. 방송 종료와 별도로 삭제할 수
        있습니다.
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<TestWorkspace />);
