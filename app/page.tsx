"use client";
import React, { useMemo, useState, useRef, useEffect } from "react";
import { io, Socket } from "socket.io-client";

// SoundComm – A↔B Volume Control Panel (Socket-enabled)
// - Two panels: Stage (A) and Sound Desk (B)
// - Multi-device via Socket.IO (rooms). Choose role (A or B) and a room code.
// - Server broadcasts levels (source of truth) and message log.
//
// Default Socket URL: http://localhost:4000
// You can override with NEXT_PUBLIC_SOCKET_URL env or set window.__SOCKET_URL__ at runtime.

// --- Config ------------------------------------------------------------
const SOCKET_URL: string =
  (typeof window !== "undefined" && (window as Window & { __SOCKET_URL__?: string }).__SOCKET_URL__) ||
  process.env.NEXT_PUBLIC_SOCKET_URL ||
  "http://localhost:4000"; // Fallback to localhost in development

const INITIAL_LEVEL = 5; // server will enforce too

// Instrument configuration
const INSTRUMENTS: { key: string; label: string; aActions: ("VLK" | "VLH")[]; hasBControls?: boolean }[] = [
  { key: "keyboard", label: "Keyboard", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "organ", label: "Organ", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "guitar", label: "Guitar", aActions: ["VLK"], hasBControls: true },
  { key: "drum", label: "Drums", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "conga", label: "Conga Drum", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "monitor", label: "Monitor Speaker", aActions: ["VLK", "VLH"], hasBControls: true },
  { key: "songleader", label: "Song Leader", aActions: ["VLK", "VLH"], hasBControls: true },
];

// --- Helpers -----------------------------------------------------------
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
}: {
  label: string;
  code?: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title || label}
      onClick={onClick}
      disabled={disabled}
      className="group inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 hover:border-white/25 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition"
    >
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

// --- Main component ----------------------------------------------------
export default function SoundCommPanel() {
  // Network
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [mySocketId, setMySocketId] = useState<string | null>(null);

  // sound 
  const soundRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // only runs in browser
    soundRef.current = new Audio("/notification.wav");
  }, []);

  useEffect(() => {
    if (soundRef.current) {
      soundRef.current.play().catch((err) => {
        console.warn("Audio play blocked:", err);
      });
    }
  }, [soundRef]);

  // Local helper to push our own log instantly (nice UX); server broadcast is skipped by senderId check
  const pushLocal = (from: "A" | "B", text: string) => {
    setLog((l) => [
      { id: crypto.randomUUID(), at: nowTime(), from, text, senderId: mySocketId || undefined },
      ...l,
    ].slice(0, 200));

    // Check if soundRef.current is not null before calling .play()
    if (soundRef.current) {
      soundRef.current.play().catch((err) => {
        console.warn("Audio play blocked:", err);
      });
    }

    // Trigger browser notification if allowed
    if (Notification.permission === "granted") {
      new Notification("New SoundComm Message", {
        body: text,
        icon: "/icon.png",
      });
    }
  };

  useEffect(() => {
    if (Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  }, []);

  // Session
  const [role, setRole] = useState<"A" | "B">("A");
  const [room, setRoom] = useState<string>("main");

  // State
  const [levels, setLevels] = useState<Record<string, number>>(
    () => INSTRUMENTS.reduce((acc, it) => (acc[it.key] = INITIAL_LEVEL, acc), {} as Record<string, number>)
  );

  type Msg = { id: string; at: string; from: "A" | "B"; text: string; senderId?: string };
  const [log, setLog] = useState<Msg[]>([]);

  // Connect socket
  useEffect(() => {
    const s = io(SOCKET_URL, { transports: ["websocket"], autoConnect: true });
    socketRef.current = s;

    const onConnect = () => {
      setConnected(true);
      setMySocketId(s.id || null);
      s.emit("join-room", { room, role });
      // Ask for latest levels on join
      s.emit("state:requestLevels", { room });
    };

    const onDisconnect = () => setConnected(false);
    const onLevels = (next: Record<string, number>) => setLevels(next || {});
    const onLog = (m: Msg) => {
      // Skip echo of our own message (server includes senderId)
      if (m.senderId && m.senderId === s.id) return;
      setLog((l) => [{ ...m }, ...l].slice(0, 200));
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

  // Emitters ------------------------------------------------------------
  const emitARequest = (instrumentKey: string, kind: "VLK" | "VLH" | "SOUND_OK", labelForText?: string) => {
    const s = socketRef.current; if (!s) return;
    const text = kind === "SOUND_OK" ? "Sound Perfect ✅" : `${labelForText} – ${kind === "VLK" ? "Volume Low" : "Volume High"} (${kind})`;
    pushLocal("A", text);
    s.emit("a:request", { room, instrumentKey, action: kind, text });
  };

  const emitBAdjust = (instrumentKey: string, delta: -1 | 1, labelForText: string) => {
    const s = socketRef.current; if (!s) return;
    // No optimistic update; server will broadcast new levels
    const code = delta > 0 ? "IC" : "LV";
    s.emit("b:adjust", { room, instrumentKey, delta, text: `${labelForText} – ${delta > 0 ? "Increase" : "Lower"} (${code})` });
    pushLocal("B", `${labelForText} – ${delta > 0 ? "Increase" : "Lower"} (${code})`);
  };

  const emitBAck = (instrumentKey?: string, labelForText?: string) => {
    const s = socketRef.current; if (!s) return;
    const text = instrumentKey && labelForText ? `${labelForText} – Received ✅` : "RECEIVED ✅";
    pushLocal("B", text);
    s.emit("b:ack", { room, instrumentKey, text });
  };

  const emitResetLevels = () => {
    const s = socketRef.current; if (!s) return;
    s.emit("reset-levels", { room });
  };

  // Legend
  const legend = useMemo(() => ([
    { code: "VLK", desc: "Volume Low (request)" },
    { code: "VLH", desc: "Volume High (request)" },
    { code: "LV", desc: "Lower Volume (action)" },
    { code: "IC", desc: "Increase Volume (action)" },
  ]), []);

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="mx-auto max-w-7xl grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: A Panel */}
        <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5">
          <SectionTitle icon="🎤">Stage (A) – Requests</SectionTitle>
          <p className="text-white/70 text-sm mt-1">Send quick requests to Sound Desk (B).</p>

          {/* Session controls */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Badge>Role</Badge>
              <div className="inline-flex rounded-xl overflow-hidden border border-white/15">
                <button className={`px-3 py-1 ${role === "A" ? "bg-white/15" : "bg-transparent"}`} onClick={() => setRole("A")}>A</button>
                <button className={`px-3 py-1 ${role === "B" ? "bg-white/15" : "bg-transparent"}`} onClick={() => setRole("B")}>B</button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge>Room</Badge>
              <input
                value={room}
                onChange={(e) => setRoom(e.target.value.trim() || "main")}
                className="bg-black/30 border border-white/15 rounded-lg px-2 py-1 text-xs outline-none"
                placeholder="main"
              />
            </div>
            <div className={`ml-auto inline-flex items-center gap-2 rounded-full px-2 py-1 border ${connected ? "border-emerald-400/40 bg-emerald-500/10" : "border-rose-400/40 bg-rose-500/10"}`}>
              <span className="h-2 w-2 rounded-full" style={{ background: connected ? "#34d399" : "#f43f5e" }} />
              <span>{connected ? "Connected" : "Offline"}</span>
            </div>
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
                    />
                  )}
                  {it.aActions.includes("VLH") && (
                    <PillButton
                      label="Volume High"
                      code="VLH"
                      onClick={() => emitARequest(it.key, "VLH", it.label)}
                      disabled={!connected || role !== "A"}
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
                <PillButton label="Send 'Sound Perfect'" onClick={() => emitARequest("", "SOUND_OK")} disabled={!connected || role !== "A"} />
              </div>
            </div>
          </div>
        </div>

        {/* Middle: Message Log */}
        <div className="rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5 flex flex-col">
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

          {/* Log list */}
          <div className="mt-4 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-black/20 p-3 space-y-2">
            {log.length === 0 ? (
              <div className="text-white/60 text-sm">No messages yet.</div>
            ) : (
              log.map((m) => (
                <div key={m.id} className="flex items-start gap-2">
                  <span
                    className={
                      "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold " +
                      (m.from === "A" ? "bg-indigo-500/30 border border-indigo-400/40" : "bg-emerald-500/30 border border-emerald-400/40")
                    }
                  >
                    {m.from}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm leading-tight">{m.text}</div>
                    <div className="text-[10px] text-white/50 mt-0.5">{m.at}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: B Panel */}
        <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 shadow-xl p-5">
          <SectionTitle icon="🎚️">Sound Desk (B) – Actions</SectionTitle>
          <p className="text-white/70 text-sm mt-1">Adjust levels and acknowledge.</p>

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
                  />
                  <PillButton
                    label="Increase Volume"
                    code="IC"
                    onClick={() => emitBAdjust(it.key, +1, it.label)}
                    disabled={!connected || role !== "B"}
                  />
                  <PillButton label="Received" onClick={() => emitBAck(it.key, it.label)} disabled={!connected || role !== "B"} />
                </div>
              </div>
            ))}
          </div>

          {/* Quick global ack */}
          <div className="mt-4 flex flex-wrap gap-2">
            <PillButton label="Quick: RECEIVED" onClick={() => emitBAck()} disabled={!connected || role !== "B"} />
            <PillButton label="All Good" onClick={() => emitBAck(undefined, "All systems OK")} disabled={!connected || role !== "B"} />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mx-auto max-w-7xl mt-6 text-center text-xs text-white/60">
        Tip: Select your role (A or B) and use the same <span className="font-semibold">Room</span> on both devices. A = requests (VLK/VLH). B = actions (LV/IC) & acknowledgements.
      </div>
    </div>
  );
}
