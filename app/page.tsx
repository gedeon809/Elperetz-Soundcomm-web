"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { io, Socket } from "socket.io-client";

// SoundComm – Musicians (M) ↔ Sound System (S)
// UI shows M/S, socket protocol remains A/B under the hood

// --- Config ------------------------------------------------------------
const SOCKET_URL: string =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  "https://elperetz-soundcomm-production.up.railway.app";

const INITIAL_LEVEL = 5;

const INSTRUMENTS: {
  key: string;
  label: string;
  aActions: ("VLK" | "VLH")[];
  hasBControls?: boolean;
}[] = [
  { key: "keyboard", label: "Keyboard", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "organ", label: "Organ", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "guitar", label: "Guitar", aActions: ["VLK"], hasBControls: true },
  { key: "drum", label: "Drums", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "conga", label: "Conga Drum", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "monitor", label: "Monitor Speaker", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "songleader", label: "Song Leader", aActions: ["VLK", "VLH"], hasBControls: true },
];

/** Quick Translator (common M -> S messages) */
const QUICK_PHRASES: { code: string; text: string; danger?: boolean }[] = [
  { code: "MSBP", text: "Return speaker not positioned correctly" },
  { code: "CHM", text: "I can’t hear myself on return speaker" },
  { code: "CHP", text: "I can’t hear the preacher" },
  { code: "MLV", text: "My mic volume is low" },
  { code: "MVH", text: "My mic volume is too high" },
  { code: "EP",  text: "There is echo" },
  { code: "BSW", text: "The screen on the balcony is not working" },
  { code: "SOS", text: "SECURITY EMERGENCY..", danger: true },
];

// --- UI bits -----------------------------------------------------------
const nowTime = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold tracking-wider uppercase rounded-md px-1.5 py-0.5 border border-white/20 bg-white/10">
      {children}
    </span>
  );
}

function PillButton({
  label,
  code,
  title,
  onClick,
  disabled,
  variant = "ghost",
}: {
  label: string;
  code?: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "danger";
}) {
  const base =
    "group inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition";
  const styles =
    variant === "primary"
      ? "border-emerald-400/50 bg-emerald-500/20 hover:bg-emerald-500/30"
      : variant === "danger"
      ? "border-rose-400/60 bg-rose-500/20 hover:bg-rose-500/30"
      : "border-white/15 bg-white/5 hover:bg-white/10 hover:border-white/25";
  return (
    <button type="button" title={title || label} onClick={onClick} disabled={disabled} className={`${base} ${styles}`}>
      <span>{label}</span>
      {code ? <Badge>{code}</Badge> : null}
    </button>
  );
}

function SectionTitle({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm uppercase tracking-wider text-white/80">
      {icon ? <span className="text-lg" aria-hidden>{icon}</span> : null}
      <span>{children}</span>
    </div>
  );
}

/* =========================
   Toasts (sent/received)
   ========================= */
type Toast = { id: string; kind: "sent" | "received"; text: string };
function ToastHost({ toasts, onClose }: { toasts: Toast[]; onClose: (id: string) => void }) {
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {toasts.length ? `Notification: ${toasts[toasts.length - 1].text}` : ""}
      </div>

      <div className="pointer-events-none fixed left-1/2 top-16 z-[60] -translate-x-1/2 space-y-2 px-4">
        {toasts.map((t) => {
          const color =
            t.kind === "received"
              ? "bg-emerald-500/20 border-emerald-400/60 ring-emerald-400/30"
              : "bg-indigo-500/20 border-indigo-400/60 ring-indigo-400/30";
          const icon = t.kind === "received" ? "✅" : "📨";
          const label = t.kind === "received" ? "Received" : "Sent";
          return (
            <div
              key={t.id}
              className={`pointer-events-auto w-[min(90vw,32rem)] overflow-hidden rounded-2xl border ${color} backdrop-blur-md shadow-xl ring-1
                         animate-[toastIn_.3s_ease-out]`}
              onClick={() => onClose(t.id)}
              title="Dismiss"
            >
              <div className="flex items-start gap-3 p-3">
                <div className="text-lg">{icon}</div>
                <div className="flex-1">
                  <div className="text-xs uppercase tracking-widest opacity-75">{label}</div>
                  <div className="text-sm leading-snug">{t.text}</div>
                </div>
                <button className="opacity-60 hover:opacity-100 text-xs" onClick={() => onClose(t.id)}>Close</button>
              </div>
              <div className="h-1 w-full bg-white/10">
                <div className="h-full w-full bg-white/60 animate-[toastBar_2.4s_linear] origin-left" />
              </div>
            </div>
          );
        })}
      </div>

      <style jsx global>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
        @keyframes toastBar {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </>
  );
}

// --- Page --------------------------------------------------------------
export default function SoundCommPanel() {
  // Network
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [mySocketId, setMySocketId] = useState<string | null>(null);

  // Sound element (autoplay safe)
  const soundRef = useRef<HTMLAudioElement | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      soundRef.current = new Audio("/notification.wav");
      const saved = localStorage.getItem("soundEnabled") === "1";
      setSoundEnabled(saved);
    }
  }, []);

  const tryPlay = () => {
    if (!soundEnabled || !soundRef.current) return;
    try {
      soundRef.current.currentTime = 0;
      void soundRef.current.play()?.catch(() => {});
    } catch {/* ignore */}
  };
  const enableSound = () => {
    setSoundEnabled(true);
    if (typeof window !== "undefined") localStorage.setItem("soundEnabled", "1");
    tryPlay();
  };

  // Notifications permission
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Session (A/B under the hood → M/S in UI)
  const [role, setRole] = useState<"A" | "B">("A");
  const [room, setRoom] = useState<string>("main");

  // Comments
  const [commentA, setCommentA] = useState("");
  const [commentB, setCommentB] = useState("");

  // Shared state
  const [levels, setLevels] = useState<Record<string, number>>(
    () => INSTRUMENTS.reduce((acc, it) => ((acc[it.key] = INITIAL_LEVEL), acc), {} as Record<string, number>)
  );

  type Msg = { id: string; at: string; from: "A" | "B"; text: string; senderId?: string };
  const [log, setLog] = useState<Msg[]>([]);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (kind: Toast["kind"], text: string) => {
    const id = crypto.randomUUID();
    setToasts((t) => [...t, { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  };
  const closeToast = (id: string) => setToasts((t) => t.filter((x) => x.id !== id));

  // Socket wiring
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ["websocket"], autoConnect: true });
    socketRef.current = s;

    const onConnect = () => {
      setConnected(true);
      setMySocketId(s.id || null);
      s.emit("join-room", { room, role });
      s.emit("state:requestLevels", { room });
    };
    const onDisconnect = () => setConnected(false);

    const onLevels = (next: Record<string, number>) => setLevels(next || {});

    const onLog = (m: Msg) => {
      // ✅ Skip our own echo (we already pushed it via pushLocal)
      if (m.senderId && m.senderId === s.id) return;

      setLog((l) => [{ ...m }, ...l].slice(0, 200));

      const opposite: "A" | "B" = role === "A" ? "B" : "A";
      if (m.from === opposite) {
        showToast("received", m.text);
        tryPlay();
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try { new Notification("New SoundComm Message", { body: m.text, icon: "/icon.png" }); } catch {}
        }
      }
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("state:levels", onLevels);
    s.on("log:append", onLog);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("state:levels", onLevels);
      s.off("log:append", onLog);
      s.disconnect();
    };
  }, [room, role, soundEnabled]);


  // Local push (no sound for sender)
  const pushLocal = (from: "A" | "B", text: string) => {
    setLog((l) => [{ id: crypto.randomUUID(), at: nowTime(), from, text, senderId: mySocketId || undefined }, ...l].slice(0, 200));
    showToast("sent", text);
  };

  // Emitters ------------------------------------------------------------
  const emitARequest = (instrumentKey: string, kind: "VLK" | "VLH" | "SOUND_OK", labelForText?: string) => {
    const s = socketRef.current; if (!s) return;
    const suffix = commentA.trim() ? ` • ${commentA.trim()}` : "";
    const text = kind === "SOUND_OK"
      ? `Sound Perfect ✅${suffix}`
      : `${labelForText} – ${kind === "VLK" ? "Volume Low" : "Volume High"} (${kind})${suffix}`;
    pushLocal("A", text);
    s.emit("a:request", { room, instrumentKey, action: kind, text });
    setCommentA("");
  };

  /** Send a Quick Translator message from M → S */
  const emitAQuick = (code: string, phrase: string) => {
    const s = socketRef.current; if (!s) return;
    const suffix = commentA.trim() ? ` • ${commentA.trim()}` : "";
    const text = `[${code}] ${phrase}${suffix}`;
    pushLocal("A", text);
    s.emit("a:request", { room, instrumentKey: "", action: "QUICK", text });
    setCommentA("");
  };

  const emitBAdjust = (instrumentKey: string, delta: -1 | 1, labelForText: string) => {
    const s = socketRef.current; if (!s) return;
    const code = delta > 0 ? "IC" : "LV";
    const suffix = commentB.trim() ? ` • ${commentB.trim()}` : "";
    const text = `${labelForText} – ${delta > 0 ? "Increase" : "Lower"} (${code})${suffix}`;
    s.emit("b:adjust", { room, instrumentKey, delta, text });
    pushLocal("B", text);
    setCommentB("");
  };

  const emitBAck = (instrumentKey?: string, labelForText?: string) => {
    const s = socketRef.current; if (!s) return;
    const suffix = commentB.trim() ? ` • ${commentB.trim()}` : "";
    const text = instrumentKey && labelForText ? `${labelForText} – Received ✅${suffix}` : `RECEIVED ✅${suffix}`;
    pushLocal("B", text);
    s.emit("b:ack", { room, instrumentKey, text });
    setCommentB("");
  };

  const emitResetLevels = () => {
    const s = socketRef.current; if (!s) return;
    s.emit("reset-levels", { room });
  };

  // Legend (existing + quick translator codes)
  const legend = useMemo(
    () => [
      { code: "VLK", desc: "Volume Low (request)" },
      { code: "VLH", desc: "Volume High (request)" },
      { code: "LV",  desc: "Lower Volume (action)" },
      { code: "IC",  desc: "Increase Volume (action)" },
      ...QUICK_PHRASES.map((q) => ({ code: q.code, desc: q.text })),
    ],
    []
  );

  const showA = role === "A";
  const showB = role === "B";
  const colClasses = showA !== showB ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 xl:grid-cols-3";
  const uiRoleLetter = (ab: "A" | "B") => (ab === "A" ? "M" : "S");

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Toasts overlay */}
      <ToastHost toasts={toasts} onClose={closeToast} />

      {/* Top bar with church logo (sticky) */}
      <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-3">
          <img src="/logo.png" alt="Church Logo" className="h-8 w-auto rounded-md" />
          <div className="text-sm tracking-wider uppercase text-white/80">Elperetz Tabernacle SoundComm</div>
          <div className="ml-auto text-xs text-white/50">
            Room: <span className="font-mono">{room}</span>
          </div>
        </div>
      </header>

      <main className="p-6 pt-16">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Role switch */}
          <div className="flex flex-wrap items-center gap-3">
            <PillButton
              label="SOUND SYSTEM (S)"
              title="Switch to Sound System"
              onClick={() => setRole("B")}
              variant={role === "B" ? "primary" : "ghost"}
            />
            <PillButton
              label="MUSICIANS (M)"
              title="Switch to Musicians"
              onClick={() => setRole("A")}
              variant={role === "A" ? "primary" : "ghost"}
            />

            <div className="ml-auto flex items-center gap-2 text-xs">
              <Badge>Room</Badge>
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value.trim() || "main")}
                className="bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-xs outline-none"
                placeholder="main"
              />
              <div
                className={`inline-flex items-center gap-2 rounded-full px-2 py-1 border ${
                  connected ? "border-emerald-400/40 bg-emerald-500/10" : "border-rose-400/40 bg-rose-500/10"
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: connected ? "#34d399" : "#f43f5e" }} />
                <span className="text-[11px]">{connected ? "Connected" : "Offline"}</span>
              </div>

              {/* Enable sound (autoplay policy safe) */}
              <button
                type="button"
                onClick={enableSound}
                className={`ml-2 text-xs rounded-full px-2 py-1 border ${
                  mounted && soundEnabled ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/15 bg-white/5"
                }`}
                title={mounted && soundEnabled ? "Sound enabled" : "Enable notification sound"}
              >
                <span suppressHydrationWarning>🔔 {mounted && soundEnabled ? "Sound ON" : "Enable sound"}</span>
              </button>
            </div>
          </div>

          <div className={`grid gap-6 ${colClasses}`}>
            {/* MUSICIANS (A → M) */}
            {showA && (
              <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 order-2">
                <SectionTitle icon="🎤">Musicians (M) – Requests</SectionTitle>
                <p className="text-white/70 text-sm mt-1">Send quick requests to the Sound System (S).</p>

                {/* Quick Translator */}
                <div className="mt-4">
                  <div className="text-xs uppercase tracking-wider text-white/70 mb-2">Quick Translator</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {QUICK_PHRASES.map((q) => (
                      <PillButton
                        key={q.code}
                        label={q.text}
                        code={q.code}
                        onClick={() => emitAQuick(q.code, q.text)}
                        disabled={!connected || role !== "A"}
                        variant={q.danger ? "danger" : "primary"}
                      />
                    ))}
                  </div>
                </div>

                {/* Optional comment to append */}
                <div className="mt-4">
                  <label className="text-xs text-white/70">Comment (optional)</label>
                  <textarea
                    value={commentA}
                    onChange={(e) => setCommentA(e.target.value)}
                    placeholder="Add context to your request…"
                    className="mt-1 w-full min-h-20 bg-black/30 border border-white/15 rounded-lg px-2 py-2 text-sm outline-none"
                  />
                </div>

                {/* Instrument-specific volume requests */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {INSTRUMENTS.map((it) => (
                    <div key={it.key} className="rounded-2xl bg-white/5 border border-white/10 p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{it.label}</div>
                        <Badge>M</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {it.aActions.includes("VLK") && (
                          <PillButton label="Volume Low" code="VLK" onClick={() => emitARequest(it.key, "VLK", it.label)} disabled={!connected || role !== "A"} variant="primary" />
                        )}
                        {it.aActions.includes("VLH") && (
                          <PillButton label="Volume High" code="VLH" onClick={() => emitARequest(it.key, "VLH", it.label)} disabled={!connected || role !== "A"} variant="primary" />
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Special: Sound Perfect */}
                  <div className="rounded-2xl bg-emerald-600/20 border border-emerald-400/30 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">Sound Perfect</div>
                      <Badge>OK</Badge>
                    </div>
                    <div className="mt-3">
                      <PillButton label="Send 'Sound Perfect'" onClick={() => emitARequest("", "SOUND_OK")} disabled={!connected || role !== "A"} variant="primary" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Live Messages (sticky) */}
            <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 flex flex-col xl:sticky xl:top-4 xl:h-[calc(100vh-7.5rem)] order-1 xl:order-1">
              <SectionTitle icon="📡">Live Messages</SectionTitle>
              <div className="mt-3 flex gap-2">
                <PillButton label="Clear Log (local)" onClick={() => setLog([])} />
                <PillButton label="Reset Levels (all)" onClick={emitResetLevels} disabled={!connected || role !== "B"} />
              </div>


              {/* Chat bubbles: M left (indigo), S right (emerald) */}
              <div className="mt-4 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-3 space-y-3">
                {log.length === 0 ? (
                  <div className="text-white/70 text-base">No messages yet.</div>
                ) : (
                  log.map((m) => {
                    const isLeft = m.from === "A"; // M left, S right
                    const bubble =
                      (isLeft
                        ? "bg-indigo-500/20 border border-indigo-400/30 text-indigo-50"
                        : "bg-emerald-500/20 border border-emerald-400/30 text-emerald-50") +
                      " rounded-2xl px-3 py-2 shadow-sm max-w-[85%]";
                    return (
                      <div key={m.id} className={`w-full flex ${isLeft ? "justify-start" : "justify-end"}`}>
                        <div className={`flex items-start gap-2 ${isLeft ? "flex-row" : "flex-row-reverse"}`}>
                          <span
                            className={
                              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold " +
                              (isLeft ? "bg-indigo-500/30 border border-indigo-400/40" : "bg-emerald-500/30 border border-emerald-400/40")
                            }
                          >
                            {uiRoleLetter(m.from)}
                          </span>
                          <div className={bubble}>
                            <div className="text-[15px] md:text-base leading-snug">{m.text}</div>
                            <div className="text-[10px] opacity-70 mt-1">{m.at}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* SOUND SYSTEM (B → S) */}
            {showB && (
              <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 order-2">
                <SectionTitle icon="🎚️">Sound System (S) – Actions</SectionTitle>
                <p className="text-white/70 text-sm mt-1">Adjust levels and acknowledge.</p>

                <div className="mt-3">
                  <label className="text-xs text-white/70">Comment (optional)</label>
                  <textarea
                    value={commentB}
                    onChange={(e) => setCommentB(e.target.value)}
                    placeholder="Add context to your action…"
                    className="mt-1 w-full min-h-20 bg-black/30 border border-white/15 rounded-lg px-2 py-2 text-sm outline-none"
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {INSTRUMENTS.filter((it) => it.hasBControls).map((it) => (
                    <div key={it.key} className="rounded-2xl bg-white/5 border border-white/10 p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">{it.label}</div>
                        <Badge>S</Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-xs text-white/70">Level</div>
                        <div className="text-base font-semibold tabular-nums">{levels[it.key] ?? INITIAL_LEVEL}</div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <PillButton label="Lower Volume" code="LV" onClick={() => emitBAdjust(it.key, -1, it.label)} disabled={!connected || role !== "B"} variant="primary" />
                        <PillButton label="Increase Volume" code="IC" onClick={() => emitBAdjust(it.key, +1, it.label)} disabled={!connected || role !== "B"} variant="primary" />
                        <PillButton label="Received" onClick={() => emitBAck(it.key, it.label)} disabled={!connected || role !== "B"} variant="primary" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <PillButton label="Quick: RECEIVED" onClick={() => emitBAck()} disabled={!connected || role !== "B"} variant="primary" />
                  <PillButton label="All Good" onClick={() => emitBAck(undefined, "All systems OK")} disabled={!connected || role !== "B"} variant="primary" />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mx-auto max-w-7xl text-center text-xs text-white/60">
            Tip: Switch between <span className="font-semibold">SOUND SYSTEM (S)</span> and{" "}
            <span className="font-semibold">MUSICIANS (M)</span>. Only your panel shows alongside the Live Messages.
          </div>
        </div>
      </main>
    </div>
  );
}
