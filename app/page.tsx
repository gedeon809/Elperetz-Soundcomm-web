"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { io, Socket } from "socket.io-client";

// SoundComm – Musicians ↔ Sound System (Socket-enabled)
// - Two panels: Musicians (A) and Sound System (B)
// - Multi-device via Socket.IO (rooms). Choose role and room.
// - Server broadcasts levels (source of truth) + message log.

// --- Config ------------------------------------------------------------
const SOCKET_URL: string =
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  "https://elperetz-soundcomm-production.up.railway.app"; // fallback

const INITIAL_LEVEL = 5;

// Instruments shown to both sides
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
  variant?: "ghost" | "primary";
}) {
  const base =
    "group inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-medium active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition";
  const styles =
    variant === "primary"
      ? "border-emerald-400/50 bg-emerald-500/20 hover:bg-emerald-500/30"
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
      {icon ? (
        <span className="text-lg" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </div>
  );
}

// --- Page --------------------------------------------------------------
export default function SoundCommPanel() {
  // Network
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [mySocketId, setMySocketId] = useState<string | null>(null);

  // Sound (only for messages coming from the other side)
  const soundRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      soundRef.current = new Audio("/notification.wav");
    }
  }, []);

  // Notification permission (browser only)
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission !== "granted") {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Session
  const [role, setRole] = useState<"A" | "B">("A"); // A=Musicians, B=Sound System
  const [room, setRoom] = useState<string>("main");

  // Optional comments per side
  const [commentA, setCommentA] = useState<string>("");
  const [commentB, setCommentB] = useState<string>("");

  // Shared state
  const [levels, setLevels] = useState<Record<string, number>>(
    () => INSTRUMENTS.reduce((acc, it) => ((acc[it.key] = INITIAL_LEVEL), acc), {} as Record<string, number>)
  );

  type Msg = { id: string; at: string; from: "A" | "B"; text: string; senderId?: string };
  const [log, setLog] = useState<Msg[]>([]);

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
      setLog((l) => [{ ...m }, ...l].slice(0, 200));

      // 🔔 Only the receiver should hear/see notifications
      const opposite: "A" | "B" = role === "A" ? "B" : "A";
      if (m.from === opposite) {
        if (soundRef.current) {
          try {
            soundRef.current.currentTime = 0;
            void soundRef.current.play();
          } catch {
            /* ignore */
          }
        }
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("New SoundComm Message", { body: m.text, icon: "/icon.png" });
          } catch {
            /* ignore */
          }
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
  }, [room, role]);

  // Local push (no sound here)
  const pushLocal = (from: "A" | "B", text: string) => {
    setLog((l) => [{ id: crypto.randomUUID(), at: nowTime(), from, text, senderId: mySocketId || undefined }, ...l].slice(0, 200));
  };

  // Emitters
  const emitARequest = (instrumentKey: string, kind: "VLK" | "VLH" | "SOUND_OK", labelForText?: string) => {
    const s = socketRef.current;
    if (!s) return;
    const suffix = commentA.trim() ? ` • ${commentA.trim()}` : "";
    const text =
      kind === "SOUND_OK"
        ? `Sound Perfect ✅${suffix}`
        : `${labelForText} – ${kind === "VLK" ? "Volume Low" : "Volume High"} (${kind})${suffix}`;
    pushLocal("A", text);
    s.emit("a:request", { room, instrumentKey, action: kind, text });
    setCommentA("");
  };

  const emitBAdjust = (instrumentKey: string, delta: -1 | 1, labelForText: string) => {
    const s = socketRef.current;
    if (!s) return;
    const code = delta > 0 ? "IC" : "LV";
    const suffix = commentB.trim() ? ` • ${commentB.trim()}` : "";
    const text = `${labelForText} – ${delta > 0 ? "Increase" : "Lower"} (${code})${suffix}`;
    s.emit("b:adjust", { room, instrumentKey, delta, text });
    pushLocal("B", text);
    setCommentB("");
  };

  const emitBAck = (instrumentKey?: string, labelForText?: string) => {
    const s = socketRef.current;
    if (!s) return;
    const suffix = commentB.trim() ? ` • ${commentB.trim()}` : "";
    const text = instrumentKey && labelForText ? `${labelForText} – Received ✅${suffix}` : `RECEIVED ✅${suffix}`;
    pushLocal("B", text);
    s.emit("b:ack", { room, instrumentKey, text });
    setCommentB("");
  };

  const emitResetLevels = () => {
    const s = socketRef.current;
    if (!s) return;
    s.emit("reset-levels", { room });
  };

  // Legend
  const legend = useMemo(
    () => [
      { code: "VLK", desc: "Volume Low (request)" },
      { code: "VLH", desc: "Volume High (request)" },
      { code: "LV", desc: "Lower Volume (action)" },
      { code: "IC", desc: "Increase Volume (action)" },
    ],
    []
  );

  // Layout: only show my panel + messages
  const showA = role === "A";
  const showB = role === "B";

  // If one panel is visible → 2 cols on xl; if both → 3 cols. Mobile stays single column.
  const colClasses = showA !== showB ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 xl:grid-cols-3";

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Role switch */}
        <div className="flex flex-wrap items-center gap-3">
          <PillButton
            label="SOUND SYSTEM"
            title="Switch to Sound System"
            onClick={() => setRole("B")}
            variant={role === "B" ? "primary" : "ghost"}
          />
          <PillButton
            label="MUSICIANS"
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
          </div>
        </div>

        <div className={`grid gap-6 ${colClasses}`}>
          {/* MUSICIANS (A) */}
          {showA && (
            <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 order-2">
              <SectionTitle icon="🎤">Musicians (A) – Requests</SectionTitle>
              <p className="text-white/70 text-sm mt-1">Send quick requests to the Sound System (B).</p>

              {/* Comment (A) */}
              <div className="mt-3">
                <label className="text-xs text-white/70">Comment (optional)</label>
                <textarea
                  value={commentA}
                  onChange={(e) => setCommentA(e.target.value)}
                  placeholder="Add context to your request…"
                  className="mt-1 w-full min-h-20 bg-black/30 border border-white/15 rounded-lg px-2 py-2 text-sm outline-none"
                />
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {INSTRUMENTS.map((it) => (
                  <div key={it.key} className="rounded-2xl bg-white/5 border border-white/10 p-4">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{it.label}</div>
                      <Badge>A</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {it.aActions.includes("VLK") && (
                        <PillButton
                          label="Volume Low"
                          code="VLK"
                          onClick={() => emitARequest(it.key, "VLK", it.label)}
                          disabled={!connected || role !== "A"}
                          variant="primary"
                        />
                      )}
                      {it.aActions.includes("VLH") && (
                        <PillButton
                          label="Volume High"
                          code="VLH"
                          onClick={() => emitARequest(it.key, "VLH", it.label)}
                          disabled={!connected || role !== "A"}
                          variant="primary"
                        />
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
                    <PillButton
                      label="Send 'Sound Perfect'"
                      onClick={() => emitARequest("", "SOUND_OK")}
                      disabled={!connected || role !== "A"}
                      variant="primary"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Live Messages (sticky + left column on desktop) */}
          <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 flex flex-col xl:sticky xl:top-4 xl:h-[calc(100vh-5rem)] order-1 xl:order-1">
            <SectionTitle icon="📡">Live Messages</SectionTitle>
            <div className="mt-3 flex gap-2">
              <PillButton label="Clear Log (local)" onClick={() => setLog([])} />
              <PillButton label="Reset Levels (all)" onClick={emitResetLevels} disabled={!connected || role !== "B"} />
            </div>

            {/* Legend */}
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-white/80">
              {legend.map((l) => (
                <div key={l.code} className="flex items-center gap-2">
                  <Badge>{l.code}</Badge>
                  <span>{l.desc}</span>
                </div>
              ))}
            </div>

            {/* Larger log for attention */}
            <div className="mt-4 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-3 space-y-3">
              {log.length === 0 ? (
                <div className="text-white/70 text-base">No messages yet.</div>
              ) : (
                log.map((m) => (
                  <div key={m.id} className="flex items-start gap-3">
                    <span
                      className={
                        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                        (m.from === "A" ? "bg-indigo-500/30 border border-indigo-400/40" : "bg-emerald-500/30 border border-emerald-400/40")
                      }
                    >
                      {m.from}
                    </span>
                    <div className="flex-1">
                      <div className="text-[15px] md:text-base lg:text-lg leading-tight">{m.text}</div>
                      <div className="text-[10px] text-white/50 mt-1">{m.at}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* SOUND SYSTEM (B) */}
          {showB && (
            <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 order-2">
              <SectionTitle icon="🎚️">Sound System (B) – Actions</SectionTitle>
              <p className="text-white/70 text-sm mt-1">Adjust levels and acknowledge.</p>

              {/* Comment (B) */}
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
                      <Badge>B</Badge>
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-xs text-white/70">Level</div>
                      <div className="text-base font-semibold tabular-nums">{levels[it.key] ?? INITIAL_LEVEL}</div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <PillButton
                        label="Lower Volume"
                        code="LV"
                        onClick={() => emitBAdjust(it.key, -1, it.label)}
                        disabled={!connected || role !== "B"}
                        variant="primary"
                      />
                      <PillButton
                        label="Increase Volume"
                        code="IC"
                        onClick={() => emitBAdjust(it.key, +1, it.label)}
                        disabled={!connected || role !== "B"}
                        variant="primary"
                      />
                      {/* Received = active primary button */}
                      <PillButton
                        label="Received"
                        onClick={() => emitBAck(it.key, it.label)}
                        disabled={!connected || role !== "B"}
                        variant="primary"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick global ack */}
              <div className="mt-4 flex flex-wrap gap-2">
                <PillButton label="Quick: RECEIVED" onClick={() => emitBAck()} disabled={!connected || role !== "B"} variant="primary" />
                <PillButton
                  label="All Good"
                  onClick={() => emitBAck(undefined, "All systems OK")}
                  disabled={!connected || role !== "B"}
                  variant="primary"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mx-auto max-w-7xl text-center text-xs text-white/60">
          Tip: Use the big buttons to switch between <span className="font-semibold">SOUND SYSTEM</span> and{" "}
          <span className="font-semibold">MUSICIANS</span>. Only your panel shows alongside the Live Messages.
        </div>
      </div>
    </div>
  );
}
