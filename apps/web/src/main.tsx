import { dispatchFixedNotice } from "./soop-notice-sender";
import { PrivacyPanel } from "./privacy-panel";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicMessage } from "../../../packages/contracts";
import "./style.css";
import {
  OperationsDashboard,
  normalizeAdminStatus,
} from "./operations-dashboard";
const disclosure = "실시간 채팅과 합성 참여자 반응이 함께 표시됩니다.";
function TokenForm({
  title,
  onSubmit,
  error,
}: {
  title: string;
  onSubmit: (t: string) => void;
  error?: string;
}) {
  const [token, setToken] = useState("");
  return (
    <main className="login">
      <div className="eyebrow">MIXED CHAT / LOCAL STUDIO</div>
      <h1>{title}</h1>
      <p>Enter your access token from the local .env file.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(token.trim());
        }}
      >
        <label>
          Access token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <button>Connect</button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}
function PublicChat() {
  const overlay = location.pathname === "/overlay";
  const [token, setToken] = useState(() =>
    decodeURIComponent(location.hash.slice(1)),
  );
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [state, setState] = useState("Connecting");
  const [demo, setDemo] = useState(false);
  const [consentNoticeAt, setConsentNoticeAt] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  useEffect(() => {
    document.body.classList.toggle("overlay", overlay);
    document.documentElement.classList.toggle("overlay", overlay);
    return () => {
      document.body.classList.remove("overlay");
      document.documentElement.classList.remove("overlay");
    };
  }, [overlay]);
  useEffect(() => {
    if (!token) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>,
      ws: WebSocket;
    const connect = () => {
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/stream`,
      );
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "auth", token, afterSeq: seq.current }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "snapshot") {
          seq.current = m.lastSeq;
          setMessages(m.messages);
          setDemo(m.demo);
          setConsentNoticeAt(null);
          setState(m.closed ? "Session closed" : "Connected");
        } else if (m.type === "event") {
          const v = m.event;
          if (v.seq <= seq.current) return;
          seq.current = v.seq;
          if (v.type === "message.hidden")
            setMessages((a) => a.filter((x) => x.id !== v.payload.id));
          else if (v.type === "message.added" || v.type === "message.updated")
            setMessages((a) =>
              [...a.filter((x) => x.id !== v.payload.id), v.payload]
                .sort((x, y) => x.seq - y.seq)
                .slice(-300),
            );
          else if (v.type === "session.closed") setState("Session closed");
        }
        if (m.type === "consent_notice") setConsentNoticeAt(m.occurredAt);
      };
      ws.onclose = (e) => {
        if (disposed) return;
        setState(
          e.code === 1008
            ? "Access denied — update the reader token"
            : "Reconnecting",
        );
        if (e.code !== 1008) timer = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [token]);
  useEffect(() => {
    if (consentNoticeAt === null) return;
    const timer = setTimeout(() => setConsentNoticeAt(null), 12000);
    return () => clearTimeout(timer);
  }, [consentNoticeAt]);
  useEffect(() => {
    if (follow && !overlay) end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, follow, overlay]);
  if (!token)
    return (
      <TokenForm
        title="Open the shared conversation"
        onSubmit={(t) => {
          location.hash = t;
          setToken(t);
        }}
      />
    );
  return (
    <main className={overlay ? "chat-overlay" : "reader"}>
      {!overlay && (
        <header>
          <div>
            <div className="eyebrow">MIXED CHAT</div>
            <h1>The conversation</h1>
          </div>
          <span className="status">● {state}</span>
        </header>
      )}
      <aside className="disclosure">
        {demo && <strong>DEMO · ARTIFICIAL INPUTS — </strong>}
        {disclosure}
      </aside>
      <section className="messages" aria-live="polite">
        {consentNoticeAt !== null && (
          <aside className="disclosure consent-notice" role="status">
            개인정보 처리에 동의한 시청자의 채팅만 화면에 표시됩니다. 참여하려면
            채팅에 <strong>!동의</strong>를 입력하고 안내된 각 동의 단계를
            완료해 주세요. 동의는 현재 방송 세션에서 유효하며, 철회하려면{" "}
            <strong>!철회</strong>를 입력하세요.
          </aside>
        )}
        {messages.length === 0 && (
          <p className="empty">Waiting for messages…</p>
        )}
        {(overlay ? messages.slice(-12) : messages).map((m) => (
          <article className="message" key={m.id} data-message-id={m.id}>
            <div className="avatar">{m.displayName.slice(0, 1)}</div>
            <div className="message-main">
              <div className="message-meta">
                <strong>{m.displayName}</strong>
                {m.attribution !== "mixed" && (
                  <span className={`badge ${m.attribution}`}>
                    {m.attribution === "experiment"
                      ? "AI 생성"
                      : m.attribution.toUpperCase()}
                  </span>
                )}
                <time>
                  {new Date(m.displayTime).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p>{m.text}</p>
            </div>
          </article>
        ))}
        <div ref={end} />
      </section>
      {!overlay && (
        <footer>
          <label>
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => setFollow(e.target.checked)}
            />{" "}
            Follow new messages
          </label>
          <button
            className="secondary"
            onClick={() => {
              setFollow(true);
              end.current?.scrollIntoView();
            }}
          >
            Jump to latest ↓
          </button>
        </footer>
      )}
    </main>
  );
}
function SoopConnector({
  setup,
  state,
  refresh,
}: {
  setup: any;
  state: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sdk = useRef<any>(undefined);
  const verified = useRef(false);
  const ready = useRef(false);
  const roomVerified = useRef(false);
  const post = async (path: string, body?: unknown) => {
    const response = await fetch(`/api/admin/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw Error((await response.json()).error);
    return response.json();
  };
  useEffect(
    () => () => {
      verified.current = false;
      try {
        sdk.current?.disconnect();
      } catch {
        /* already closed */
      }
    },
    [],
  );
  useEffect(() => {
    let active = true,
      polling = false;
    const timer = setInterval(() => {
      if (polling || !active || !verified.current) return;
      polling = true;
      void dispatchFixedNotice(
        () => post("soop/notices/next"),
        () => active && verified.current && !!sdk.current,
        (text) => sdk.current.sendMessage(text),
        (id) => post("soop/notices/failed", { id }),
      )
        .catch(() =>
          setMessage(
            "자동 안내 상태를 확인할 수 없습니다. 연결 상태를 확인해 주세요.",
          ),
        )
        .finally(() => {
          polling = false;
        });
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const authorize = async () => {
    setBusy(true);
    setMessage("");
    try {
      const { url } = await post("soop/authorize");
      location.assign(url);
    } catch (error: any) {
      setMessage(error.message);
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setMessage("Loading SOOP chat SDK…");
    try {
      const response = await fetch("/api/admin/soop/chat-session", {
        credentials: "same-origin",
      });
      if (!response.ok) throw Error((await response.json()).error);
      const auth = await response.json();
      if (!(window as any).SOOP?.ChatSDK) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src =
            "https://static.sooplive.com/asset/app/chat-sdk/sooplive-chat-sdk.js";
          script.onload = () => resolve();
          script.onerror = () =>
            reject(Error("Could not load the SOOP chat SDK."));
          document.head.appendChild(script);
        });
      }
      const chat = new (window as any).SOOP.ChatSDK(auth.clientId);
      sdk.current = chat;
      verified.current = false;
      ready.current = false;
      roomVerified.current = false;
      chat.setAuth(auth.accessToken);
      chat.handleReady(() => {
        ready.current = true;
        verified.current = roomVerified.current;
        if (!verified.current) return;
        void post("soop/status", { state: "subscribed" }).then(refresh);
        setMessage(
          "Connected to your SOOP broadcast. Keep this admin tab open.",
        );
        setBusy(false);
      });
      chat.handleMessageReceived((action: string, data: any) => {
        if (
          action !== "MESSAGE" ||
          !verified.current ||
          !data ||
          typeof data !== "object"
        )
          return;
        void post("soop/message", {
          userId: data.userId,
          userNickname: data.userNickname,
          message: data.message,
        }).catch(() => {});
      });
      chat.handleChatClosed(() => {
        verified.current = false;
        void post("soop/status", { state: "disconnected" })
          .then(refresh)
          .catch(() => {});
        setMessage("SOOP chat disconnected. Reconnect from this page.");
      });
      chat.handleError(() => {
        verified.current = false;
        void post("soop/status", { state: "failed" })
          .then(refresh)
          .catch(() => {});
        setMessage(
          "SOOP could not connect. Check your live broadcast and app permissions.",
        );
        setBusy(false);
      });
      await chat.connect();
      const room = await chat.getRoomInfo();
      if (room.bjId !== auth.streamerId) {
        verified.current = false;
        chat.disconnect();
        sdk.current = undefined;
        await post("soop/status", { state: "failed" });
        throw Error(
          "The connected SOOP account does not match soop.streamerId.",
        );
      }
      roomVerified.current = true;
      verified.current = ready.current;
      if (verified.current) {
        await post("soop/status", { state: "subscribed" });
        setBusy(false);
      }
      setMessage(
        ready.current
          ? "Connected to your SOOP broadcast. Keep this admin tab open."
          : "Connected to the configured broadcast; waiting for SDK ready signal…",
      );
    } catch (error: any) {
      verified.current = false;
      try {
        sdk.current?.disconnect();
      } catch {
        /* not connected */
      }
      sdk.current = undefined;
      void post("soop/status", { state: "failed" })
        .then(refresh)
        .catch(() => {});
      setMessage(error.message);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    verified.current = false;
    try {
      sdk.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    sdk.current = undefined;
    await post("soop/status", { state: "disconnected" });
    setMessage("SOOP chat disconnected.");
    await refresh();
  };
  return (
    <section className="card">
      <div className="eyebrow">SOOP CHAT / OFFICIAL SDK</div>
      <h2>
        <span className="dot" />
        {state}
      </h2>
      <p>
        {setup.mode === "disabled"
          ? "Set soop.mode: official in config.yaml."
          : !setup.streamerConfigured
            ? "Set your SOOP streamer ID in config.yaml."
            : setup.credentialsConfigured
              ? "SOOP developer app credentials are configured."
              : "Add SOOP_CLIENT_ID and SOOP_CLIENT_SECRET to .env after app approval."}
      </p>
      <p className="hint">Registered callback: {setup.redirectUri}</p>
      <p className="hint">
        The official SDK runs in this browser and only connects to your own live
        broadcast. Keep this admin tab open while receiving chat.
      </p>
      <div className="toolbar">
        <button
          disabled={
            busy || setup.mode !== "official" || !setup.credentialsConfigured
          }
          onClick={() => void authorize()}
        >
          Authorize SOOP
        </button>
        <button
          className="secondary"
          disabled={
            busy ||
            !setup.tokenConfigured ||
            !setup.streamerConfigured ||
            setup.mode !== "official"
          }
          onClick={() => void connect()}
        >
          Connect SOOP chat
        </button>
        <button
          className="secondary"
          disabled={busy || !sdk.current}
          onClick={() => void disconnect()}
        >
          Disconnect SOOP
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function Admin() {
  const [session, setSession] = useState<
    "checking" | "signed_in" | "signed_out"
  >("checking");
  const [status, setStatus] = useState<any>();
  const [statusFailed, setStatusFailed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [links, setLinks] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [chatgptModels, setChatgptModels] = useState<
    { slug: string; name: string }[]
  >([]);
  const api = async (path: string, method = "GET") => {
    const r = await fetch(`/api/admin/${path}`, {
      method,
      credentials: "same-origin",
    });
    if (!r.ok) {
      const b = await r.json();
      throw Error(
        typeof b.error === "string"
          ? b.error
          : (b.error?.message ?? b.error?.code ?? "요청 실패"),
      );
    }
    return r;
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`/api/admin/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error((await r.json()).error);
    return r.json();
  };
  const personaAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const loadChatgptModels = async () => {
    try {
      setChatgptModels((await (await api("chatgpt/models")).json()).models);
    } catch (e: any) {
      setError(e.message);
    }
  };
  const authorizeChatgpt = async (clientId?: string) => {
    try {
      const { url } = await post(
        "chatgpt/authorize",
        clientId ? { clientId } : {},
      );
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e.message);
    }
  };
  const refresh = async () => {
    try {
      const r = await api("status");
      setStatus(normalizeAdminStatus(await r.json()));
      setStatusFailed(false);
    } catch (e: any) {
      setStatusFailed(true);
      if (e.message === "Administrator token required") {
        setStatus(undefined);
        setSession("signed_out");
      } else setError(e.message);
    }
  };
  useEffect(() => {
    void api("status")
      .then(async (r) => {
        setStatus(normalizeAdminStatus(await r.json()));
        setStatusFailed(false);
        setSession("signed_in");
      })
      .catch(() => setSession("signed_out"));
  }, []);
  useEffect(() => {
    if (session !== "signed_in") return;
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (session !== "signed_in") return;
    let cancelled = false;
    let currentUrl = "";
    const loadPreview = async () => {
      if (
        !status?.capture?.lastFrameAt ||
        status.capture.lastFrameAgeMs > 10000
      ) {
        setPreview("");
        return;
      }
      try {
        const blob = await (await api("preview")).blob();
        if (cancelled) return;
        const nextUrl = URL.createObjectURL(blob);
        setPreview(nextUrl);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        currentUrl = nextUrl;
      } catch {
        if (!cancelled) setPreview("");
      }
    };
    void loadPreview();
    const timer = setInterval(() => void loadPreview(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [session, status?.capture?.lastFrameAt, status?.capture?.lastFrameAgeMs]);
  const action = async (path: string) => {
    setBusy(true);
    setError("");
    try {
      await api(path, "POST");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const startPipeline = () => action("ai/start");
  const revealOrigins = () => {
    if (
      window.confirm(
        "AI 생성을 중지하고 누가 AI인지 리더와 오버레이에 공개할까요? 이 세션에서는 되돌릴 수 없습니다.",
      )
    )
      void action("reveal");
  };
  const stale =
    statusFailed ||
    status?.incomplete ||
    !status?.generatedAt ||
    now - status.generatedAt > 10000;
  if (session === "checking")
    return (
      <main className="login">
        <p>Checking local session…</p>
      </main>
    );
  if (session === "signed_out")
    return (
      <TokenForm
        title="Your broadcast, in one place."
        error={error}
        onSubmit={(token) => {
          void fetch("/api/admin/login", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          })
            .then(async (r) => {
              if (!r.ok) throw Error((await r.json()).error);
              setError("");
              setSession("signed_in");
            })
            .catch((e) => setError(e.message));
        }}
      />
    );
  return (
    <main
      className="admin"
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
          'a[href^="#"]',
        );
        if (!link) return;
        const target = document.getElementById(link.hash.slice(1));
        for (
          let parent = target?.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
        }
      }}
    >
      <header>
        <div>
          <div className="eyebrow">MIXED CHAT / CONTROL ROOM</div>
          <h1>Broadcast studio</h1>
          <p>Platform chat and screen-aware characters, together.</p>
        </div>
        {status?.ai?.state === "running" && (
          <button className="stop" onClick={() => void action("ai/stop")}>
            ■ Stop AI now
          </button>
        )}
      </header>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
      {!status ? (
        <p>Loading…</p>
      ) : (
        <>
          <OperationsDashboard
            status={status}
            stale={stale}
            now={now}
            preview={preview}
            busy={busy}
            onAction={(path) => void action(path)}
            onRefresh={() => void refresh()}
            onToggle={() =>
              void action(
                status.ai.state === "running" ? "ai/stop" : "ai/start",
              )
            }
            onReveal={revealOrigins}
            onNotice={(platform, enabled) =>
              void personaAction(async () => {
                await post(`consent-notices/${platform}`, { enabled });
              })
            }
          />
          {!status.demo && <PrivacyPanel />}
          <section className="card" aria-label="익명 채팅 요약">
            <h2>채팅 분위기·주제 요약</h2>
            <p className="hint">
              현재 세션의 동의한 채팅에서 여러 참여자에게 공통으로 나타난 표현만
              요약합니다. 원문·닉네임은 포함하지 않습니다. 철회 전에 승인된 익명
              범주만 현재 세션 동안 유지하고 종료 시 삭제합니다.
            </p>
            {status.chatSummary?.state === "available" ? (
              <>
                <p>
                  주제:{" "}
                  {status.chatSummary.topics.join(" · ") ||
                    "뚜렷한 공통 주제 없음"}
                </p>
                <p>
                  분위기:{" "}
                  {status.chatSummary.atmosphere.join(" · ") ||
                    "뚜렷한 공통 표현 없음"}
                </p>
              </>
            ) : (
              <p>공통 분위기를 요약할 채팅이 아직 부족합니다.</p>
            )}
            <button
              className="secondary"
              disabled={busy || stale}
              onClick={() => void action("chat-summary/clear")}
            >
              채팅 요약 초기화
            </button>
          </section>
          <section className="card persona-studio">
            <h2>자동 시청자 페르소나</h2>
            <p>
              AI 채팅을 켜면 시청 동기와 참여 방식이 다른 페르소나가 자동으로
              구성됩니다. 직접 생성하거나 승인할 필요가 없습니다.
            </p>
            {!status.personas?.length ? (
              <p className="hint">AI 채팅을 켜면 자동으로 준비됩니다.</p>
            ) : (
              <details>
                <summary>페르소나 {status.personas.length}명 보기</summary>
                <div className="persona-candidates">
                  {status.personas.map((p: any) => (
                    <article className="persona-candidate" key={p.id}>
                      <h3>{p.name}</h3>
                      <p>{p.motive}</p>
                      <p className="hint">{p.participation}</p>
                    </article>
                  ))}
                </div>
              </details>
            )}
          </section>
          <details className="advanced-settings" id="advanced-settings">
            <summary>연결 및 AI 상세 설정</summary>
            {status.demo && (
              <aside className="demo">
                DEMO SESSION · Artificial platform messages, generated test
                frames and a mock model. No live services are connected.
              </aside>
            )}
            {!status.demo && (
              <section className="card">
                <div className="section-title">
                  <h2>Live setup</h2>
                </div>
                <p>
                  YouTube:{" "}
                  {status.setup?.youtube?.enabled
                    ? status.setup.youtube.credentialsConfigured &&
                      (status.setup.youtube.videoConfigured ||
                        status.setup.youtube.channelConfigured)
                      ? "ready to test"
                      : "add API key or access token and video or channel ID"
                    : "disabled in config.yaml"}
                </p>
                <p>
                  CHZZK:{" "}
                  {status.setup?.chzzk?.enabled
                    ? status.setup.chzzk.credentialsConfigured
                      ? status.setup.chzzk.tokenConfigured
                        ? "인증 저장됨 · 키 변경 시 다시 인증"
                        : "키 설정 완료 · 아래 버튼으로 계정 연결"
                      : ".env에 Client ID와 Client Secret 설정 필요"
                    : "config.yaml에서 치지직 사용 설정 필요"}
                </p>
                <p className="hint">
                  Registered callback:{" "}
                  {status.setup?.chzzk?.redirectUri ?? "not available"}
                </p>
                <button
                  className="secondary"
                  disabled={
                    busy ||
                    !status.setup?.chzzk?.enabled ||
                    !status.setup?.chzzk?.credentialsConfigured
                  }
                  onClick={() => {
                    setError("");
                    setBusy(true);
                    void api("chzzk/authorize", "POST")
                      .then((r) => r.json())
                      .then((b) => {
                        location.href = b.url;
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  치지직 계정 연결 / 다시 인증
                </button>
                <p className="hint">
                  Client ID·Secret 또는 권한을 바꿨다면 서버 재시작 후 위
                  버튼으로 방송 계정을 다시 인증하세요. 기존 연결이 있어도
                  재인증할 수 있습니다.
                </p>
                <p>음성·영상 입력은 현재 운영 프로필에서 사용하지 않습니다.</p>
                <p>
                  AI:{" "}
                  {status.setup?.ai?.connected && status.setup.ai.modelSelected
                    ? "model connected"
                    : status.setup?.ai?.provider === "chatgpt_subscription"
                      ? "connect ChatGPT and select a model below"
                      : "set OPENAI_API_KEY and OPENAI_MODEL"}
                </p>
                <p className="hint">
                  Save config.yaml and .env locally, then restart the server.
                  Never paste Client Secrets or tokens into chat.
                </p>
              </section>
            )}
            {status.setup?.soop && status.connectors?.soop && (
              <SoopConnector
                setup={status.setup.soop}
                state={status.connectors.soop.state}
                refresh={refresh}
              />
            )}
            {!status.demo && (
              <section className="card">
                <h2>YouTube 자동 안내 연결</h2>
                <p>
                  {status.setup?.youtube?.connected
                    ? `계정 연결됨 · ${status.setup.youtube.channelId}`
                    : "방송 채널 계정으로 연결해 주세요."}
                </p>
                <p className="hint">
                  발송하려는 방송의 채널을 선택하세요. 연결 후 수신기를 시작하면
                  승인된 고정 동의 안내만 자동 발송합니다.
                </p>
                <button
                  disabled={
                    busy ||
                    !status.setup?.youtube?.enabled ||
                    !status.setup?.youtube?.oauthConfigured
                  }
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void api("youtube/authorize", "POST")
                      .then((r) => r.json())
                      .then((b) => {
                        location.href = b.url;
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  YouTube 계정 연결
                </button>
                {status.setup?.youtube?.connected && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action("youtube/disconnect")}
                  >
                    YouTube 연결 해제
                  </button>
                )}
                {!status.setup?.youtube?.oauthConfigured && (
                  <p className="hint">
                    .env에 YOUTUBE_CLIENT_ID와 YOUTUBE_CLIENT_SECRET을 설정하고
                    서버를 재시작하세요.
                  </p>
                )}
              </section>
            )}
            <div className="grid connections" id="connection-details">
              {Object.entries(status.connectors).map(
                ([p, s]: [string, any]) => (
                  <section className="card" key={p}>
                    <div className="eyebrow">{p.toUpperCase()}</div>
                    <h2>
                      <span className="dot" />
                      {s.state}
                    </h2>
                    <p>
                      {s.received} received · {s.recoveries} recoveries
                    </p>
                  </section>
                ),
              )}
            </div>
            <div className="toolbar">
              <button
                disabled={busy}
                onClick={() => void action("connectors/start")}
              >
                Start receivers
              </button>
              <button
                className="secondary"
                onClick={() => void action("connectors/stop")}
              >
                Stop receivers
              </button>

              <button
                className="secondary"
                onClick={() =>
                  void api("links")
                    .then((r) => r.json())
                    .then(setLinks)
                    .catch((e) => setError(e.message))
                }
              >
                Reader & OBS links
              </button>
            </div>
            {links && (
              <section className="card">
                <h2>Private read-only links</h2>
                <p>
                  Anyone with these links can read the chat. OBS Browser Source:
                  600 × 900, transparent background.
                </p>
                {["reader", "overlay"].map((k) => (
                  <label key={k}>
                    {k}
                    <input
                      readOnly
                      value={links[k]}
                      onFocus={(e) => e.target.select()}
                    />
                    <a href={links[k]} target="_blank" rel="noreferrer">
                      Open {k} ↗
                    </a>
                  </label>
                ))}
              </section>
            )}
            <div className="grid workspace">
              <section className="card" id="program-details">
                <div className="section-title">
                  <h2>Program input</h2>
                  <span className="status">{status.capture.state}</span>
                </div>
                <div className="preview">
                  {preview && status.capture.lastFrameAgeMs <= 10000 ? (
                    <img alt="Live Program video input." src={preview} />
                  ) : (
                    <p>
                      {status.capture.state === "config_required"
                        ? status.capture.lastError ||
                          "Capture is not configured."
                        : status.capture.state === "connecting" ||
                            status.capture.state === "reconnecting"
                          ? "Connecting to video input…"
                          : status.capture.lastError ||
                            "No fresh frame received. Check the video input below."}
                    </p>
                  )}
                </div>
                <p>
                  Source: {status.capture.backend}
                  {status.capture.device
                    ? ` · ${status.capture.device}`
                    : ""} · {status.capture.dimensions || "no dimensions yet"} ·{" "}
                  {status.capture.lastFrameAgeMs === null
                    ? "no frames received"
                    : `last frame ${Math.floor(status.capture.lastFrameAgeMs / 1000)}s ago`}{" "}
                  · {status.capture.framesInLastMinute} frames / last minute
                </p>
                {status.capture.lastError && (
                  <p className="error" role="status">
                    {status.capture.lastError}
                  </p>
                )}
                <p className="hint">
                  Config: capture · FFmpeg {status.capture.ffmpeg}. For OBS
                  Virtual Camera, select Program output in OBS, then use Start
                  capture here. For remote OBS, configure capture.backend: rtmp
                  and its private reader URL. Start streaming/virtual camera
                  before expecting frames. Recent video is available to AI
                  automatically.
                </p>
                <div className="toolbar">
                  <button
                    disabled={!status.demo}
                    onClick={() => void action("capture/start")}
                  >
                    Start capture
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void action("capture/stop")}
                  >
                    Stop capture
                  </button>
                </div>
              </section>
              <section className="card" id="audio-details">
                <div className="section-title">
                  <h2>Groq speech transcription</h2>
                  <span className="status">{status.audio.state}</span>
                </div>
                <p>
                  {status.audio.requests} / {status.audio.maxRequests} requests
                  this process
                </p>
                <p>
                  {status.audio.latestText || "No recent speech transcript"}
                </p>
                <p className="hint">
                  {status.privacy?.audioEnabled || status.demo
                    ? "설정된 방송 음성을 Groq로 전사하고 최근 전사문을 AI 입력에 사용합니다. 기록은 현재 세션의 메모리에 보관하며 종료·재시작·동의 철회 시 삭제합니다."
                    : "음성 입력을 사용하지 않습니다. config.yaml의 privacy.audioEnabled에서 켤 수 있습니다."}
                </p>
                {status.audio.history.length > 0 && (
                  <ol>
                    {status.audio.history.map((entry: any) => (
                      <li key={entry.id}>
                        <time
                          dateTime={new Date(entry.capturedAt).toISOString()}
                        >
                          {new Date(entry.capturedAt).toLocaleString()}
                        </time>{" "}
                        {entry.text}
                      </li>
                    ))}
                  </ol>
                )}
                <div className="toolbar">
                  <button
                    disabled={!status.demo && !status.privacy?.audioEnabled}
                    onClick={() => void action("audio/start")}
                  >
                    Start audio
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void action("audio/stop")}
                  >
                    Stop audio
                  </button>
                  {(status.demo || status.privacy?.audioEnabled) && (
                    <a
                      href="/api/admin/transcripts/export"
                      download="transcripts.jsonl"
                    >
                      전사문 내보내기
                    </a>
                  )}
                </div>
              </section>
              <section className="card" id="ai-details">
                <div className="section-title">
                  <h2>AI pipeline · 전체 상태 및 제어</h2>
                  <span className="status">
                    {status.ai.state === "running"
                      ? "AI running"
                      : "AI stopped"}{" "}
                    · {status.ai.phase}
                  </span>
                </div>
                <ul className="readiness-list">
                  {status.ai.readiness.checks.map((check: any) => (
                    <li
                      key={check.id}
                      className={check.ready ? "ready" : "not-ready"}
                    >
                      {check.ready ? "●" : "○"} {check.label}
                      {check.optional ? " (선택)" : ""}
                    </li>
                  ))}
                </ul>
                <div className="toolbar">
                  <button
                    disabled={
                      busy || status.closed || status.ai.state === "running"
                    }
                    onClick={() => void action("pipeline/start")}
                  >
                    입력 시작
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void action("pipeline/stop")}
                  >
                    전체 중지 (AI·영상·오디오·수신기)
                  </button>
                </div>
                <p>
                  {status.ai.state === "running"
                    ? status.ai.phase === "waiting_for_input"
                      ? "Waiting for a new transcript or permitted chat message."
                      : status.ai.phase === "random_wait"
                        ? "Waiting for the next randomized reply interval."
                        : status.ai.phase === "jev_timing_filter"
                          ? "Jev is checking whether this is clearly a bad time to speak."
                          : status.ai.phase === "generating_draft" ||
                              status.ai.phase === "generating_draft_with_frame"
                            ? "The answer model is preparing a reply."
                            : status.ai.phase === "ai_review"
                              ? "The answer model is reviewing its draft."
                              : status.ai.phase === "awaiting_human_review"
                                ? "A draft is waiting for your approval."
                                : status.ai.phase === "published_local"
                                  ? "Reply published to this app's local chat."
                                  : `AI is running: ${status.ai.phase}.`
                    : `AI is stopped (${status.ai.phase}). Start AI to begin processing.`}
                </p>
                <div className="metric">
                  {status.ai.usage.calls}
                  <small> / {status.ai.maxCalls} calls</small>
                </div>
                <p>
                  {status.ai.costEstimate === "unavailable"
                    ? "Cost estimate unavailable · call limit enforced"
                    : `Estimated / reserved: $${status.ai.usage.reservedUsd.toFixed(4)}`}
                </p>
                <p>
                  {status.ai.model} ·{" "}
                  {status.ai.visualMode === "on_request"
                    ? "text first; AI requests video when needed"
                    : "continuous video"}{" "}
                  · {status.ai.skips} skipped · {status.ai.rejects} rejected
                </p>
                <p className="hint">
                  Replies wait a random {status.ai.pacing.minSeconds}–
                  {status.ai.pacing.maxSeconds}s after each decision; context
                  covers the previous {status.ai.contextWindowSeconds}s.
                </p>
                {status.ai.gate.enabled && (
                  <p>
                    Jev filter: {status.ai.gate.state} ·{" "}
                    {status.ai.gate.requests} / {status.ai.gate.maxRequests}{" "}
                    checks · {status.ai.gate.filtered} bad-timing vetoes ·{" "}
                    {status.ai.gate.errors} errors
                    {status.ai.gate.probability !== null &&
                      ` · bad-timing probability ${Math.round(status.ai.gate.probability * 100)}% (veto at ${Math.round(status.ai.gate.suppressThreshold * 100)}%)`}
                  </p>
                )}
                {status.ai.provider === "chatgpt_subscription" &&
                  !status.demo && (
                    <div className="pending">
                      <strong>ChatGPT plan connection</strong>
                      <p>
                        {status.chatgpt.accounts.find(
                          (a: any) => a.clientId === status.chatgpt.active,
                        )?.email || "No active account"}
                      </p>
                      <div className="toolbar">
                        <button onClick={() => void authorizeChatgpt()}>
                          Continue with ChatGPT
                        </button>
                        <button
                          className="secondary"
                          onClick={() => void loadChatgptModels()}
                        >
                          Load available models
                        </button>
                      </div>
                      {status.chatgpt.accounts.map((a: any) => (
                        <div key={a.clientId} className="toolbar">
                          <span>
                            {a.email || a.clientId}{" "}
                            {a.connected ? "· connected" : "· signed out"}
                          </span>
                          <button
                            className="secondary"
                            onClick={() =>
                              void post("chatgpt/select-account", {
                                clientId: a.clientId,
                              })
                                .then(refresh)
                                .catch((e: any) => setError(e.message))
                            }
                          >
                            Use
                          </button>
                          <button
                            className="secondary"
                            onClick={() => void authorizeChatgpt(a.clientId)}
                          >
                            Sign in
                          </button>
                        </div>
                      ))}
                      {chatgptModels.length > 0 && (
                        <label>
                          Model
                          <select
                            value={
                              status.ai.model === "not selected"
                                ? ""
                                : status.ai.model
                            }
                            onChange={(e) =>
                              void post("chatgpt/select-model", {
                                slug: e.target.value,
                              })
                                .then(refresh)
                                .catch((err: any) => setError(err.message))
                            }
                          >
                            <option value="">Select a model</option>
                            {chatgptModels.map((m) => (
                              <option key={m.slug} value={m.slug}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <p>
                        <a
                          href="https://chatgpt.com/settings/usage"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Review ChatGPT plan usage and app access
                        </a>
                      </p>
                      <button
                        className="secondary"
                        onClick={() => void action("chatgpt/disconnect")}
                      >
                        Disconnect active account
                      </button>
                    </div>
                  )}
                <div className="toolbar">
                  <button
                    disabled={
                      busy ||
                      status.closed ||
                      status.ai.state === "running" ||
                      !status.ai.readiness.ready ||
                      stale
                    }
                    onClick={() => void startPipeline()}
                  >
                    Start AI
                  </button>
                  {status.ai.state === "running" && (
                    <button
                      className="stop"
                      disabled={busy}
                      onClick={() => void action("ai/stop")}
                    >
                      Stop AI now
                    </button>
                  )}
                </div>
                <p className="hint">
                  AI는 직접 켜야 생성됩니다. 서버 재시작 후 이전 참여·실행
                  상태를 복구하지 않습니다. 방송 종료 시 세션 정보를 삭제합니다.
                  운영 프로필과 모델 준비 상태를 확인한 뒤 시작하세요.
                </p>
                <p className="hint">
                  {status.ai.manualApproval
                    ? "Messages wait for your approval before publication."
                    : "Messages publish automatically. Open Reader to watch without generation details; origins stay hidden until you reveal them."}
                </p>
                <details>
                  <summary>AI inputs, tools and review</summary>
                  <p>
                    현재 동의가 유효한 채팅, 공개 방송 설명, 자동 페르소나
                    정의와 승인된 익명 범주를 사용합니다. 라이브에서는
                    화면·음성을 전송하지 않습니다. 철회 시 원문·식별 가능한 파생
                    문맥을 지우고 진행 중 응답도 취소합니다.
                  </p>
                  <p>
                    Available model tools: none. The model cannot call tools,
                    access files, control capture, or post to a platform. The
                    application validates each decision and publishes approved
                    messages only to this app's local conversation.
                  </p>
                  <p>
                    Draft review:{" "}
                    {status.ai.reviewDraft
                      ? `enabled · ${status.ai.reviewCount} review calls`
                      : "disabled"}
                    . The selected answer model gets a second call to reject or
                    refine each proposed message. Each pass counts toward
                    ai.maxCalls.{" "}
                    {status.ai.manualApproval
                      ? "A person must then approve publication."
                      : "Human approval is off."}
                  </p>
                </details>
                {status.ai.pending && (
                  <div className="pending">
                    <span className="eyebrow">AWAITING REVIEW</span>
                    <p>{status.ai.pending.text}</p>
                    <button onClick={() => void action("ai/approve")}>
                      Publish locally
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void action("ai/reject")}
                    >
                      Discard
                    </button>
                  </div>
                )}
                <details>
                  <summary>Data processing review</summary>
                  <p>
                    현재 운영 프로필은 단계별 동의가 완료된 채팅과 검증된 익명
                    요약만 선택한 OpenAI 서비스에 전달합니다. 영상·음성·다른
                    제공자는 사용하지 않습니다.
                  </p>
                  <p>
                    응답 저장은 요청하지 않지만 제공자 측 모든 로그가 삭제된다는
                    의미는 아닙니다. 실제 보존 조건은 운영 프로필의 확인 내용을
                    따릅니다.
                  </p>
                </details>
              </section>
            </div>
          </details>
          <section className="card">
            <div className="section-title">
              <h2>Local conversation</h2>
              <span className="status">
                {status.closed ? "Session closed" : "Session active"}
              </span>
            </div>
            <p className="hint">
              Hide removes text from this application, including reconnects. It
              does not moderate the original platform.
            </p>
            <div className="moderation">
              {status.messages
                .slice(-30)
                .reverse()
                .map((m: PublicMessage) => (
                  <div className="moderation-row" key={m.id}>
                    <strong>{m.displayName}</strong>
                    <p>{m.text}</p>
                    <button
                      className="secondary"
                      onClick={() => void action(`messages/${m.id}/hide`)}
                    >
                      Hide
                    </button>
                  </div>
                ))}
            </div>
          </section>
          <section className="card">
            <h2>Session controls</h2>
            <div className="toolbar">
              <button
                className="secondary"
                onClick={() => void action("session/close")}
              >
                Close session
              </button>
              <button
                className="secondary"
                onClick={() => void action("session/new")}
              >
                New session
              </button>
              <button
                className="secondary"
                onClick={() => {
                  if (confirm("Invalidate all current reader and OBS links?"))
                    void action("reader-token/rotate").then(() =>
                      setLinks(undefined),
                    );
                }}
              >
                Rotate reader token
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (
                    confirm(
                      "방송 데이터, 대화, 자막, AI 신원, 사용량과 기록을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
                    )
                  )
                    void action("data/delete");
                }}
              >
                {status.broadcastEnded || status.closed
                  ? "방송 종료 후 데이터 삭제"
                  : "로컬 데이터 전체 삭제"}
              </button>
            </div>
            <p className="hint">
              메모리 전용: 세션 종료·재시작 시 채팅과 전사문을 삭제합니다.
              Frames, raw audio and prompts are not written to disk. SOOP에는
              고정 참여 안내만 자동 발송하며 AI 채팅은 발송하지 않습니다.
            </p>
          </section>
        </>
      )}
      <footer>
        LOCAL STUDIO · source-labeled conversation ·{" "}
        <button
          className="secondary"
          onClick={() =>
            void api("logout", "POST")
              .then(() => {
                setStatus(undefined);
                setPreview("");
                setLinks(undefined);
                setSession("signed_out");
              })
              .catch((e) => setError(e.message))
          }
        >
          Sign out
        </button>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  location.pathname === "/reader" || location.pathname === "/overlay" ? (
    <PublicChat />
  ) : (
    <Admin />
  ),
);
