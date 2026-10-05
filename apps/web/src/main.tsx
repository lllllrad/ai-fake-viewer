import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicMessage } from "../../../packages/contracts";
import "./style.css";
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
        {messages.length === 0 && (
          <p className="empty">Waiting for messages…</p>
        )}
        {(overlay ? messages.slice(-12) : messages).map((m) => (
          <article className="message" key={m.id} data-message-id={m.id}>
            <div className="avatar">{m.displayName.slice(0, 1)}</div>
            <div className="message-main">
              <div className="message-meta">
                <strong>{m.displayName}</strong>
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
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [links, setLinks] = useState<any>();
  const [busy, setBusy] = useState(false);
  const [chatgptModels, setChatgptModels] = useState<
    { slug: string; name: string }[]
  >([]);
  const [personaBrief, setPersonaBrief] = useState({
    session_title: "",
    topic: "",
    audience_intent: "엔터테인먼트",
    public_context: "",
    private_production_context: "",
    language: "ko-KR",
    tone_policy: "모욕, 사칭, 개인정보 추측 금지",
    cast_mode: "fresh",
    candidate_count: 12,
    cast_size: 6,
    game_mode: true,
  });
  const [personaSession, setPersonaSession] = useState<any>();
  const [personaCandidates, setPersonaCandidates] = useState<any[]>([]);
  const [personaAudition, setPersonaAudition] = useState<any>();
  const [personaGenerationProgress, setPersonaGenerationProgress] = useState<{
    done: number;
    total: number;
  }>();
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [personaLocks, setPersonaLocks] = useState<Record<string, string[]>>(
    {},
  );
  const api = async (path: string, method = "GET") => {
    const r = await fetch(`/api/admin/${path}`, {
      method,
      credentials: "same-origin",
    });
    if (!r.ok) {
      const b = await r.json();
      throw Error(b.error);
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
  const postPatch = async (path: string, body: unknown) => {
    const r = await fetch(`/api/admin/${path}`, {
      method: "PATCH",
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
  const loadPersona = async (id: string) => {
    const s = await (await api(`persona/sessions/${id}`)).json();
    setPersonaSession(s);
    const c = await (await api(`persona/sessions/${id}/candidates`)).json();
    setPersonaCandidates(c);
    setSelectedPersonaIds(c.slice(0, s.brief.cast_size).map((v: any) => v.id));
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
      setStatus(await r.json());
    } catch (e: any) {
      if (e.message === "Administrator token required") {
        setStatus(undefined);
        setSession("signed_out");
      } else setError(e.message);
    }
  };
  useEffect(() => {
    void api("status")
      .then(async (r) => {
        setStatus(await r.json());
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
  const startPipeline = async () => {
    setBusy(true);
    setError("");
    try {
      await api("pipeline/start", "POST");
      for (let attempt = 0; attempt < 60; attempt++) {
        const next = await (await api("status")).json();
        setStatus(next);
        const frameFresh =
          next.capture.lastFrameAgeMs !== null &&
          next.capture.lastFrameAgeMs <= 10000;
        if (frameFresh && !next.capture.confirmed) {
          if (
            !window.confirm(
              "마스킹된 Program 미리보기를 확인했고, 가려야 할 영역이 모두 가려졌나요? 확인 후 AI 입력으로 승인합니다.",
            )
          )
            throw Error("영상 미리보기 확인이 필요합니다.");
          await api("capture/confirm", "POST");
        }
        if (next.ai.readiness.ready) {
          await api("ai/start", "POST");
          await refresh();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw Error("필수 입력 준비 시간 초과. 대시보드 상태를 확인하세요.");
    } catch (e: any) {
      setError(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
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
    <main className="admin">
      <header>
        <div>
          <div className="eyebrow">MIXED CHAT / CONTROL ROOM</div>
          <h1>Broadcast studio</h1>
          <p>Platform chat and screen-aware characters, together.</p>
        </div>
        {status?.ai.state === "running" && (
          <button
            className="stop"
            disabled={busy}
            onClick={() => void action("ai/stop")}
          >
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
          <section className="card persona-studio">
            <div className="section-title">
              <h2>Persona studio · P0</h2>
              <span>세션별 새 출연진 · 로컬 오버레이 전용</span>
            </div>
            {!personaSession ? (
              <>
                <div className="persona-fields">
                  <label>
                    방송 제목
                    <input
                      value={personaBrief.session_title}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          session_title: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    주제
                    <input
                      value={personaBrief.topic}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          topic: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    시청 경험 의도
                    <input
                      value={personaBrief.audience_intent}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          audience_intent: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    공개 맥락
                    <textarea
                      value={personaBrief.public_context}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          public_context: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    비공개 제작 참고
                    <textarea
                      value={personaBrief.private_production_context}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          private_production_context: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    후보 수
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={personaBrief.candidate_count}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          candidate_count: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    선정 인원
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={personaBrief.cast_size}
                      onChange={(e) =>
                        setPersonaBrief({
                          ...personaBrief,
                          cast_size: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
                <p className="hint">
                  비공개 제작 참고는 후보 생성·오디션·실시간 모델 입력에서
                  제외됩니다. audience disclosure를 확인한 뒤 출연진을 동결해야
                  합니다.
                </p>
                <button
                  disabled={
                    busy || !personaBrief.session_title || !personaBrief.topic
                  }
                  onClick={() =>
                    void personaAction(async () => {
                      const s = await post("persona/sessions", personaBrief);
                      setPersonaSession(s);
                      let job = await post(
                        `persona/sessions/${s.id}/candidates`,
                        {},
                      );
                      while (
                        job.status === "queued" ||
                        job.status === "running"
                      ) {
                        await new Promise((r) => setTimeout(r, 1000));
                        job = await (
                          await api(`persona/jobs/${job.id}`)
                        ).json();
                        setPersonaGenerationProgress({
                          done: job.progress,
                          total: job.total,
                        });
                      }
                      if (job.status !== "succeeded")
                        throw Error(job.error ?? "Persona generation failed");
                      const candidates = job.result ?? [];
                      setPersonaCandidates(candidates);
                      setSelectedPersonaIds(
                        candidates
                          .slice(0, personaBrief.cast_size)
                          .map((v: any) => v.id),
                      );
                      setPersonaGenerationProgress(undefined);
                    })
                  }
                >
                  브리프 저장 및 모델로 후보 생성
                </button>
                {personaGenerationProgress && (
                  <p role="status">
                    모델 후보 생성 {personaGenerationProgress.done}/
                    {personaGenerationProgress.total}
                  </p>
                )}
              </>
            ) : (
              <>
                <p>
                  <strong>{personaSession.brief.session_title}</strong> ·{" "}
                  {personaSession.state} · revision {personaSession.revision} ·{" "}
                  {personaSession.armed ? "AI armed" : "AI disarmed"}
                </p>
                {personaSession.state === "draft" && (
                  <>
                    <p className="hint">
                      출연진 {selectedPersonaIds.length}/
                      {personaSession.brief.cast_size} 선택 · 각 후보에서 잠금할
                      차원을 지정한 뒤 행동 또는 닉네임만 다시 생성할 수
                      있습니다.
                    </p>
                    <div className="persona-candidates">
                      {personaCandidates.map((v: any) => (
                        <article className="persona-candidate" key={v.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={selectedPersonaIds.includes(v.id)}
                              onChange={(e) =>
                                setSelectedPersonaIds((ids) =>
                                  e.target.checked
                                    ? [...ids, v.id]
                                    : ids.filter((id) => id !== v.id),
                                )
                              }
                            />{" "}
                            출연 후보에 포함
                          </label>
                          <h3>
                            {v.definition.display_name_suggestion}{" "}
                            <small>{v.status}</small>
                          </h3>
                          <p>{v.definition.core.viewing_motive}</p>
                          <p>
                            <b>관심:</b>{" "}
                            {v.definition.core.interests.join(", ")} ·{" "}
                            <b>관찰:</b>{" "}
                            {v.definition.core.observation_focus.join(", ")}
                          </p>
                          <p>
                            <b>침묵:</b>{" "}
                            {v.definition.participation.stay_silent_when.join(
                              ", ",
                            )}
                          </p>
                          <details>
                            <summary>캐릭터 카드와 예시 보기</summary>
                            <p>
                              <b>지식 경계:</b>{" "}
                              {v.definition.knowledge
                                .map(
                                  (k: any) =>
                                    `${k.topic} (${k.level}): ${k.boundary}`,
                                )
                                .join(" · ")}
                            </p>
                            <p>
                              <b>긍정 예시:</b>{" "}
                              {v.definition.examples
                                .map(
                                  (x: any) =>
                                    `${x.action}: ${x.text ?? x.situation}`,
                                )
                                .join(" / ")}
                            </p>
                            <p>
                              <b>금지 예시:</b>{" "}
                              {v.definition.negative_examples
                                .map(
                                  (x: any) =>
                                    `${x.situation}: ${x.unacceptable_behavior}`,
                                )
                                .join(" / ")}
                            </p>
                          </details>
                          <div className="persona-locks">
                            {[
                              "core.interests",
                              "knowledge",
                              "voice.typical_length",
                              "core.observation_focus",
                            ].map((path) => (
                              <label key={path}>
                                <input
                                  type="checkbox"
                                  checked={(personaLocks[v.id] ?? []).includes(
                                    path,
                                  )}
                                  onChange={(e) =>
                                    setPersonaLocks((old) => ({
                                      ...old,
                                      [v.id]: e.target.checked
                                        ? [...(old[v.id] ?? []), path]
                                        : (old[v.id] ?? []).filter(
                                            (p) => p !== path,
                                          ),
                                    }))
                                  }
                                />{" "}
                                잠금 {path}
                              </label>
                            ))}
                          </div>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void personaAction(async () => {
                                let job = await post(
                                  `persona/versions/${v.id}/regenerate`,
                                  {
                                    session_id: personaSession.id,
                                    source_hash: v.hash,
                                    locked_paths: personaLocks[v.id] ?? [],
                                    dimensions: [
                                      "core.viewing_motive",
                                      "core.interests",
                                      "core.observation_focus",
                                      "knowledge",
                                      "participation.base_propensity",
                                    ],
                                  },
                                );
                                while (
                                  job.status === "queued" ||
                                  job.status === "running"
                                ) {
                                  await new Promise((r) => setTimeout(r, 500));
                                  job = await (
                                    await api(`persona/jobs/${job.id}`)
                                  ).json();
                                }
                                if (job.status !== "succeeded")
                                  throw Error(
                                    job.error ?? "Regeneration failed",
                                  );
                                const next = job.result[0];
                                setPersonaCandidates((cs) => [...cs, next]);
                                setPersonaLocks((old) => ({
                                  ...old,
                                  [next.id]: old[v.id] ?? [],
                                }));
                                setSelectedPersonaIds((ids) => [
                                  ...ids,
                                  next.id,
                                ]);
                                setPersonaAudition(undefined);
                              })
                            }
                          >
                            잠금 차원 유지 후 모델로 재생성
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void personaAction(async () => {
                                let job = await post(
                                  `persona/versions/${v.id}/regenerate`,
                                  {
                                    session_id: personaSession.id,
                                    source_hash: v.hash,
                                    nickname_only: true,
                                  },
                                );
                                while (
                                  job.status === "queued" ||
                                  job.status === "running"
                                ) {
                                  await new Promise((r) => setTimeout(r, 500));
                                  job = await (
                                    await api(`persona/jobs/${job.id}`)
                                  ).json();
                                }
                                if (job.status !== "succeeded")
                                  throw Error(
                                    job.error ?? "Regeneration failed",
                                  );
                                const next = job.result[0];
                                setPersonaCandidates((cs) => [...cs, next]);
                                setPersonaLocks((old) => ({
                                  ...old,
                                  [next.id]: old[v.id] ?? [],
                                }));
                                setSelectedPersonaIds((ids) => [
                                  ...ids,
                                  next.id,
                                ]);
                                setPersonaAudition(undefined);
                              })
                            }
                          >
                            닉네임만 모델로 재생성
                          </button>
                          {personaAudition?.candidates?.find(
                            (x: any) => x.version_id === v.id,
                          ) && (
                            <div className="hint">
                              12개 공통 시나리오 · 결정 검사{" "}
                              {personaAudition.candidates.find(
                                (x: any) => x.version_id === v.id,
                              ).deterministic.passed
                                ? "통과"
                                : "실패"}
                              {personaAudition.candidates
                                .find((x: any) => x.version_id === v.id)
                                .results.map((o: any) => (
                                  <p key={o.key}>
                                    <b>{o.scenario}:</b> {o.action}
                                    {o.output ? ` — ${o.output}` : ""}
                                  </p>
                                ))}
                            </div>
                          )}
                          <label>
                            검토 점수 (일관성 / 차별성 / 자연스러움 / 관련성
                            각각 1–5)
                            <input data-score={v.id} placeholder="4,4,4,4" />
                          </label>
                        </article>
                      ))}
                    </div>
                    <button
                      disabled={busy || selectedPersonaIds.length === 0}
                      onClick={() =>
                        void personaAction(async () => {
                          let job = await post(
                            `persona/sessions/${personaSession.id}/auditions`,
                            { version_ids: selectedPersonaIds },
                          );
                          setPersonaAudition(job);
                          while (
                            job.status === "queued" ||
                            job.status === "running"
                          ) {
                            await new Promise((r) => setTimeout(r, 1000));
                            job = await (
                              await api(`persona/jobs/${job.id}`)
                            ).json();
                            setPersonaAudition(job);
                          }
                          if (job.status !== "succeeded")
                            throw Error(job.error ?? "Audition failed");
                          setPersonaAudition({
                            id: job.id,
                            fixture_set: "p0-v1",
                            candidates: job.result,
                          });
                        })
                      }
                    >
                      선택 후보 공통 오디션 실행
                    </button>
                    <button
                      disabled={busy || !personaAudition}
                      onClick={() =>
                        void personaAction(async () => {
                          for (const v of personaCandidates.filter(
                            (x: any) =>
                              selectedPersonaIds.includes(x.id) &&
                              personaAudition.candidates?.some(
                                (c: any) => c.version_id === x.id,
                              ),
                          )) {
                            const input = document.querySelector(
                              `[data-score="${v.id}"]`,
                            ) as HTMLInputElement;
                            const scores = (input?.value || "")
                              .split(",")
                              .map(Number);
                            if (
                              scores.length !== 4 ||
                              scores.some(
                                (x) => !Number.isInteger(x) || x < 1 || x > 5,
                              )
                            )
                              continue;
                            await post(`persona/versions/${v.id}/approve`, {
                              hash: v.hash,
                              evaluation_id: personaAudition.id,
                              reviewer_decision: {
                                approved: true,
                                coherence: scores[0],
                                distinction: scores[1],
                                naturalness: scores[2],
                                relevance: scores[3],
                              },
                            });
                          }
                          await loadPersona(personaSession.id);
                        })
                      }
                    >
                      기준 충족 후보 승인
                    </button>
                    <label className="persona-approval">
                      <input type="checkbox" id="persona-disclosure" />{" "}
                      시청자에게 합성 참여자가 포함됨을 알렸습니다.
                    </label>
                    <button
                      disabled={
                        busy ||
                        personaCandidates.filter(
                          (v: any) =>
                            v.status === "approved" &&
                            selectedPersonaIds.includes(v.id),
                        ).length !== personaSession.brief.cast_size
                      }
                      onClick={() =>
                        void personaAction(async () => {
                          const selected = personaCandidates.filter(
                            (v: any) =>
                              v.status === "approved" &&
                              selectedPersonaIds.includes(v.id),
                          );
                          const cast = await fetch(
                            `/api/admin/persona/sessions/${personaSession.id}/cast`,
                            {
                              method: "PUT",
                              credentials: "same-origin",
                              headers: {
                                "Content-Type": "application/json",
                                "Idempotency-Key": crypto.randomUUID(),
                              },
                              body: JSON.stringify({
                                expected_revision: personaSession.revision,
                                members: selected.map((v: any) => ({
                                  version_id: v.id,
                                })),
                              }),
                            },
                          );
                          if (!cast.ok) throw Error((await cast.json()).error);
                          const frozen = await post(
                            `persona/sessions/${personaSession.id}/freeze`,
                            {
                              expected_revision: personaSession.revision + 1,
                              disclosure_confirmed: (
                                document.querySelector(
                                  "#persona-disclosure",
                                ) as HTMLInputElement
                              ).checked,
                            },
                          );
                          setPersonaSession(frozen);
                        })
                      }
                    >
                      선정 인원으로 동결
                    </button>
                  </>
                )}
                {personaSession.state === "ready" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void personaAction(async () =>
                        setPersonaSession(
                          await post(
                            `persona/sessions/${personaSession.id}/start`,
                            {
                              expected_revision: personaSession.revision,
                              arm_ai: false,
                            },
                          ),
                        ),
                      )
                    }
                  >
                    AI 비활성으로 라이브 세션 시작
                  </button>
                )}
                {personaSession.state === "live" && (
                  <>
                    <p className="hint">
                      동결된 cast가 기존 모델 및 로컬 overlay publication path를
                      사용합니다. 세션 재시작 후에는 AI가 자동으로 다시 무장되지
                      않습니다.
                    </p>
                    <label>
                      AI 최소 발행 간격 (ms)
                      <input
                        type="number"
                        min={0}
                        max={60000}
                        step={500}
                        value={personaSession.policy.minimum_global_gap_ms}
                        onChange={(e) =>
                          setPersonaSession({
                            ...personaSession,
                            policy: {
                              ...personaSession.policy,
                              minimum_global_gap_ms: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void personaAction(async () =>
                          setPersonaSession(
                            await postPatch(
                              `persona/sessions/${personaSession.id}/policy`,
                              {
                                expected_revision: personaSession.revision,
                                policy: personaSession.policy,
                              },
                            ),
                          ),
                        )
                      }
                    >
                      정책 저장 · 진행 중 반응 무효화
                    </button>
                    {!personaSession.armed && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void personaAction(async () =>
                            setPersonaSession(
                              await post(
                                `persona/sessions/${personaSession.id}/ai/arm`,
                                {
                                  expected_control_epoch:
                                    personaSession.control_epoch,
                                },
                              ),
                            ),
                          )
                        }
                      >
                        AI 발행 무장
                      </button>
                    )}
                    <div className="persona-candidates">
                      {personaSession.cast.map((m: any) => (
                        <article
                          className="persona-candidate"
                          key={m.member_id}
                        >
                          <h3>
                            {m.display_name}{" "}
                            <small>
                              {m.status}
                              {m.muted ? " · muted" : ""}
                            </small>
                          </h3>
                          <p>
                            관심 태그:{" "}
                            {JSON.parse(m.focus_tags || "[]").join(", ") ||
                              "없음"}{" "}
                            · attention {m.attention}
                          </p>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void personaAction(async () =>
                                setPersonaSession(
                                  await postPatch(
                                    `persona/sessions/${personaSession.id}/members/${m.member_id}`,
                                    {
                                      expected_member_epoch: m.epoch,
                                      muted: !m.muted,
                                    },
                                  ),
                                ),
                              )
                            }
                          >
                            {m.muted ? "음소거 해제" : "음소거"}
                          </button>
                          <button
                            disabled={busy || m.status === "departed"}
                            onClick={() =>
                              void personaAction(async () =>
                                setPersonaSession(
                                  await postPatch(
                                    `persona/sessions/${personaSession.id}/members/${m.member_id}`,
                                    {
                                      expected_member_epoch: m.epoch,
                                      presence: "departed",
                                    },
                                  ),
                                ),
                              )
                            }
                          >
                            퇴장
                          </button>
                          <button
                            disabled={busy || m.status === "present"}
                            onClick={() =>
                              void personaAction(async () =>
                                setPersonaSession(
                                  await postPatch(
                                    `persona/sessions/${personaSession.id}/members/${m.member_id}`,
                                    {
                                      expected_member_epoch: m.epoch,
                                      presence: "present",
                                    },
                                  ),
                                ),
                              )
                            }
                          >
                            재입장
                          </button>
                        </article>
                      ))}
                    </div>
                    <button
                      className="stop"
                      onClick={() =>
                        void personaAction(async () =>
                          setPersonaSession(
                            await post(
                              `persona/sessions/${personaSession.id}/ai/stop`,
                              { reason: "operator_stop" },
                            ),
                          ),
                        )
                      }
                    >
                      AI 긴급 정지
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void personaAction(async () =>
                          setPersonaSession(
                            await post(
                              `persona/sessions/${personaSession.id}/pause`,
                              { expected_revision: personaSession.revision },
                            ),
                          ),
                        )
                      }
                    >
                      세션 일시정지
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void personaAction(async () =>
                          setPersonaSession(
                            await post(
                              `persona/sessions/${personaSession.id}/end`,
                              { expected_revision: personaSession.revision },
                            ),
                          ),
                        )
                      }
                    >
                      세션 종료
                    </button>
                    {!personaSession.armed &&
                      personaSession.brief.game_mode && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void personaAction(async () => {
                              await post(
                                `persona/sessions/${personaSession.id}/reveal`,
                                {
                                  confirmed: window.confirm(
                                    "합성 참여자 신원을 공개할까요? 이 작업은 되돌릴 수 없습니다.",
                                  ),
                                },
                              );
                              await loadPersona(personaSession.id);
                            })
                          }
                        >
                          신원 공개
                        </button>
                      )}
                  </>
                )}
                {personaSession.state === "paused" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void personaAction(async () =>
                          setPersonaSession(
                            await post(
                              `persona/sessions/${personaSession.id}/resume`,
                              { expected_revision: personaSession.revision },
                            ),
                          ),
                        )
                      }
                    >
                      세션 재개 (AI 비활성)
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        void personaAction(async () =>
                          setPersonaSession(
                            await post(
                              `persona/sessions/${personaSession.id}/end`,
                              { expected_revision: personaSession.revision },
                            ),
                          ),
                        )
                      }
                    >
                      세션 종료
                    </button>
                  </>
                )}
                {personaSession.state === "ended" && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void personaAction(async () => {
                        const r = await api(
                          `persona/sessions/${personaSession.id}/report`,
                        );
                        setPersonaAudition(await r.json());
                      })
                    }
                  >
                    세션 리뷰 보고서
                  </button>
                )}
                {personaSession.state === "ended" &&
                  personaAudition?.members && (
                    <pre className="persona-report">
                      {JSON.stringify(personaAudition, null, 2)}
                    </pre>
                  )}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void personaAction(async () => {
                      setPersonaSession(undefined);
                      setPersonaCandidates([]);
                      setPersonaAudition(undefined);
                    })
                  }
                >
                  새 브리프
                </button>
              </>
            )}
          </section>
          {status.demo && (
            <aside className="demo">
              DEMO SESSION · Artificial platform messages, generated test frames
              and a mock model. No live services are connected.
            </aside>
          )}
          {!status.demo && (
            <section className="card">
              <div className="section-title">
                <h2>Live setup</h2>
              </div>
              <p>
                YouTube:{" "}
                {status.setup.youtube.enabled
                  ? status.setup.youtube.credentialsConfigured &&
                    (status.setup.youtube.videoConfigured ||
                      status.setup.youtube.channelConfigured)
                    ? "ready to test"
                    : "add API key or access token and video or channel ID"
                  : "disabled in config.yaml"}
              </p>
              <p>
                CHZZK:{" "}
                {status.setup.chzzk.enabled
                  ? status.setup.chzzk.credentialsConfigured
                    ? "ready to authorize"
                    : "add developer app Client ID and Secret to .env"
                  : "disabled in config.yaml"}
              </p>
              <p className="hint">
                Registered callback: {status.setup.chzzk.redirectUri}
              </p>
              <p>
                Groq speech:{" "}
                {status.setup.audio.credentialsConfigured
                  ? "configured"
                  : "add GROQ_API_KEY"}
              </p>
              <p>
                Program camera:{" "}
                {status.setup.capture.maskConfigured
                  ? "review masked preview"
                  : "configure privacy masks"}
              </p>
              <p>
                AI:{" "}
                {status.setup.ai.connected && status.setup.ai.modelSelected
                  ? "model connected"
                  : status.setup.ai.provider === "chatgpt_subscription"
                    ? "connect ChatGPT and select a model below"
                    : "set OPENAI_API_KEY and OPENAI_MODEL"}
              </p>
              <p className="hint">
                Save config.yaml and .env locally, then restart the server.
                Never paste Client Secrets or tokens into chat.
              </p>
            </section>
          )}
          <SoopConnector
            setup={status.setup.soop}
            state={status.connectors.soop.state}
            refresh={refresh}
          />
          <div className="grid connections">
            {Object.entries(status.connectors).map(([p, s]: [string, any]) => (
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
            ))}
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
              disabled={
                busy ||
                !status.setup.chzzk.enabled ||
                !status.setup.chzzk.credentialsConfigured
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
              Authorize CHZZK
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
            <section className="card">
              <div className="section-title">
                <h2>Program input</h2>
                <span className="status">{status.capture.state}</span>
              </div>
              <div className="preview">
                {preview && status.capture.lastFrameAgeMs <= 10000 ? (
                  <img
                    alt="Masked Program input. Verify all private areas and chat are hidden."
                    src={preview}
                  />
                ) : (
                  <p>
                    {status.capture.state === "config_required"
                      ? status.capture.lastError || "Capture is not configured."
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
              <p>
                {status.capture.masks.length} masks ·{" "}
                {status.capture.confirmed
                  ? "Preview confirmed"
                  : "Review required"}
                {status.capture.programConfirmed
                  ? " · Program source configured"
                  : " · config.yaml Program confirmation missing"}
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
                before expecting frames. Verify Program output and masks before
                confirming.
              </p>
              <div className="toolbar">
                <button onClick={() => void action("capture/start")}>
                  Start capture
                </button>
                <button
                  className="secondary"
                  onClick={() => void action("capture/confirm")}
                >
                  Confirm masked Program
                </button>
                <button
                  className="secondary"
                  onClick={() => void action("capture/stop")}
                >
                  Stop capture
                </button>
              </div>
            </section>
            <section className="card">
              <div className="section-title">
                <h2>Groq speech transcription</h2>
                <span className="status">{status.audio.state}</span>
              </div>
              <p>
                {status.audio.requests} / {status.audio.maxRequests} requests
                this process
              </p>
              <p>{status.audio.latestText || "No recent speech transcript"}</p>
              <p className="hint">
                Recent transcripts enter AI context automatically. Successful
                transcripts are logged privately for up to{" "}
                {status.retentionDays}
                days; raw audio is not saved. Near-silent chunks are skipped.
                Configure the RTMP audio URL, Groq API key and audio review
                locally.
              </p>
              <p>
                {status.audio.loggedCount} retained transcripts · input
                language: {status.audio.language}
              </p>
              <div className="toolbar">
                <a
                  href="/api/admin/transcripts/export"
                  download="transcripts.jsonl"
                >
                  Download transcript log (JSONL)
                </a>
              </div>
              {status.audio.history.length > 0 && (
                <ol>
                  {status.audio.history.map((entry: any) => (
                    <li key={entry.id}>
                      <time dateTime={new Date(entry.capturedAt).toISOString()}>
                        {new Date(entry.capturedAt).toLocaleString()}
                      </time>{" "}
                      {entry.text}
                    </li>
                  ))}
                </ol>
              )}
              <div className="toolbar">
                <button onClick={() => void action("audio/start")}>
                  Start audio
                </button>
                <button
                  className="secondary"
                  onClick={() => void action("audio/stop")}
                >
                  Stop audio
                </button>
              </div>
            </section>
            <section className="card">
              <div className="section-title">
                <h2>AI pipeline · 전체 상태 및 제어</h2>
                <span className="status">
                  {status.ai.state === "running" ? "AI running" : "AI stopped"}{" "}
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
                  onClick={() => void startPipeline()}
                >
                  전체 시작 (입력 + AI)
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
                  Jev filter: {status.ai.gate.state} · {status.ai.gate.requests}{" "}
                  / {status.ai.gate.maxRequests} checks ·{" "}
                  {status.ai.gate.filtered} bad-timing vetoes ·{" "}
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
                    !status.ai.readiness.ready
                  }
                  onClick={() => {
                    if (
                      status.ai.visualMode === "continuous" ||
                      status.capture.confirmed
                    ) {
                      void startPipeline();
                    } else if (status.capture.state === "stopped") {
                      void startPipeline();
                    } else {
                      void startPipeline();
                    }
                  }}
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
                AI는 직접 켜야 생성되며 서버 재시작 후 이전 실행 상태가
                복구됩니다. 방송 종료 시 자동 중지됩니다. 필수 입력을 모두 켜고
                영상 마스크를 확인한 뒤 AI를 시작하세요.
              </p>
              <p className="hint">
                {status.ai.manualApproval
                  ? "Messages wait for your approval before publication."
                  : "Messages publish automatically. Open Reader to watch without generation details; origins stay hidden until you reveal them."}
              </p>
              <details>
                <summary>AI inputs, tools and review</summary>
                <p>
                  Audio arrives as {status.ai.input.audioChunkSeconds}s chunks (
                  {status.ai.input.audioLanguage}); transcription text enters
                  AI, raw audio does not. Each decision gets{" "}
                  {status.ai.input.last.newTranscripts} new /{" "}
                  {status.ai.input.last.contextTranscripts} recent transcript
                  chunks and {status.ai.input.last.newMessages} new /{" "}
                  {status.ai.input.last.contextMessages} recent permitted chat
                  messages from a {status.ai.input.contextWindowSeconds}s
                  window.
                </p>
                <p>
                  Visual mode: {status.ai.input.visualMode};{" "}
                  {status.ai.input.last.frames} frames in the last decision. In
                  on-request mode the first call has no image; an inspect
                  decision lets the app send a fresh masked frame in a follow-up
                  call. Jev sees text only.
                </p>
                <p>
                  Platform text context approved: YouTube{" "}
                  {String(status.ai.input.platformTextApproved.youtube)}, CHZZK{" "}
                  {String(status.ai.input.platformTextApproved.chzzk)}, SOOP{" "}
                  {String(status.ai.input.platformTextApproved.soop)}. Other
                  input includes the broadcast description, persona style,
                  pseudonymous speaker labels and recent spectator messages.
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
                  Input source: all configured platform receivers and live
                  speech transcription.
                </p>
                <p>Personal data is processed only while AI is enabled.</p>
                <p>Raw audio and unmasked frames are not sent or retained.</p>
              </details>
            </section>
          </div>
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
                onClick={() => void action("reveal")}
              >
                Stop AI & show who was AI in the overlay
              </button>
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
              Retention: up to {status.retentionDays} days for chat and
              transcripts. Frames, raw audio and prompts are not written to
              disk. No platform chat sending is provided.
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
