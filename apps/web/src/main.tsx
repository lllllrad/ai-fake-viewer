import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicMessage } from "../../../packages/contracts";
import "./style.css";
const disclosure =
  "실제 플랫폼 채팅과 AI 캐릭터의 메시지가 함께 표시되는 실험 채팅입니다. 게임 캐릭터 수는 실제 시청자 수가 아닙니다.";
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
  const [identities, setIdentities] = useState<any[]>([]);
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
          setIdentities(m.identities);
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
          else if (v.type === "identity.revealed") setIdentities(v.payload);
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
                <span className={`badge ${m.attribution}`}>
                  {m.attribution === "experiment"
                    ? "Experiment"
                    : m.attribution.toUpperCase()}
                </span>
                <time>
                  {new Date(m.displayTime).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p>{m.text}</p>
              {identities.find((a) => a.actorId === m.actorId) && (
                <small>
                  {identities.find((a) => a.actorId === m.actorId).kind ===
                  "system_generated"
                    ? "System generated"
                    : "Platform received"}
                </small>
              )}
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error((await r.json()).error);
    return r.json();
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
    if (session !== "signed_in" || !status?.capture.lastFrameAt) return;
    let cancelled = false,
      url = "";
    void api("preview")
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return;
        url = URL.createObjectURL(b);
        setPreview(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [session, status?.capture.lastFrameAt]);
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
        <button className="stop" onClick={() => void action("ai/stop")}>
          ■ Stop AI now
        </button>
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
                    status.setup.youtube.videoConfigured
                    ? "ready to test"
                    : "add API key or access token and live video ID"
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
              <p>
                SOOP:{" "}
                {status.setup.soop.mode === "disabled"
                  ? "disabled"
                  : status.setup.soop.streamerConfigured
                    ? status.setup.soop.mode
                    : "add streamer ID"}
              </p>
              <p>
                Groq speech:{" "}
                {status.setup.audio.enabled
                  ? status.setup.audio.credentialsConfigured &&
                    status.setup.audio.reviewed
                    ? "ready to transcribe"
                    : "add GROQ_API_KEY and review audio sharing"
                  : "disabled in config.yaml"}
              </p>
              <p>
                Program camera:{" "}
                {status.setup.capture.enabled
                  ? status.setup.capture.maskConfigured
                    ? "review masked preview"
                    : "configure privacy masks"
                  : "disabled in config.yaml"}
              </p>
              <p>
                AI:{" "}
                {status.setup.ai.connected && status.setup.ai.modelSelected
                  ? "model connected"
                  : status.setup.ai.provider === "chatgpt_subscription"
                    ? "connect ChatGPT and select a model below"
                    : "set OPENAI_API_KEY and OPENAI_MODEL"}
                {status.setup.ai.providerReviewed
                  ? ""
                  : "; provider review required"}
              </p>
              <p className="hint">
                Save config.yaml and .env locally, then restart the server.
                Never paste Client Secrets or tokens into chat.
              </p>
            </section>
          )}
          <div className="grid connections">
            {Object.entries(status.connectors).map(([p, s]: [string, any]) => (
              <section className="card" key={p}>
                <div className="eyebrow">
                  {p.toUpperCase()}
                  {p === "soop" ? " / CHECK PATH" : ""}
                </div>
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
              onClick={() =>
                void api("chzzk/authorize", "POST")
                  .then((r) => r.json())
                  .then((b) => {
                    location.href = b.url;
                  })
                  .catch((e) => setError(e.message))
              }
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
                {preview ? (
                  <img
                    alt="Masked Program input. Verify all private areas and chat are hidden."
                    src={preview}
                  />
                ) : (
                  <p>No frame yet. Start OBS Virtual Camera in Program mode.</p>
                )}
              </div>
              <p>
                {status.capture.dimensions || "No input"} ·{" "}
                {status.capture.masks.length} masks ·{" "}
                {status.capture.confirmed
                  ? "Preview confirmed"
                  : "Review required"}
              </p>
              <p className="hint">
                Set device and normalized mask rectangles in config.yaml, then
                restart. Verify Program output and all chat areas in every scene
                before confirming. Recheck after scene changes.
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
              <p>{status.audio.loggedCount} retained transcripts</p>
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
                <h2>AI characters</h2>
                <span className="status">{status.ai.state}</span>
              </div>
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
              <button
                disabled={busy || status.closed}
                onClick={() => void action("ai/start")}
              >
                Start AI
              </button>
              {!status.demo && !status.setup.ai.providerReviewed && (
                <p className="hint">
                  Start AI is blocked: review AI-provider sharing of
                  transcripts, permitted chat and masked frames, then set
                  policy.providerReviewed: true in config.yaml and restart.
                </p>
              )}
              <p className="hint">
                AI always starts manually. In on-request mode, transcription or
                permitted chat starts a text-only decision; a fresh, confirmed
                masked frame is sent only if AI requests visual inspection.
                Receivers and transcription continue when AI stops.
              </p>
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
                  YouTube: {String(status.policy.youtubeAiContextApproved)} ·
                  CHZZK: {String(status.policy.chzzkAiContextApproved)} · SOOP:{" "}
                  {String(status.policy.soopAiContextApproved)}
                </p>
                <p>
                  Review:{" "}
                  {status.policy.reviewReference ||
                    "Not recorded. Platform text excluded from model context."}
                </p>
                <p>
                  Provider review: {String(status.policy.providerReviewed)}.
                  Groq audio review: {String(status.policy.groqAudioReviewed)}.
                  Record the applicable terms review in config.yaml; operator
                  consent alone does not establish platform permission.
                </p>
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
                    <span className={`badge ${m.attribution}`}>
                      {m.attribution}
                    </span>
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
                Stop AI & reveal origins
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
                      "Permanently delete all local chat, transcripts, identities, usage and history? Receivers will stop.",
                    )
                  )
                    void action("data/delete");
                }}
              >
                Delete all local data
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
