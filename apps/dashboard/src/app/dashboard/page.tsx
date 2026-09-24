"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface Action {
  id: string;
  type: string;
  status: string;
  retryCount: number;
  error: string | null;
}

interface Interaction {
  id: string;
  interactionId: string;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  username: string;
  commandName: string;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  actions: Action[];
}

interface InteractionsResponse {
  interactions: Interaction[];
  total: number;
  page: number;
  pages: number;
}

interface Stats {
  total: number;
  processed: number;
  failed: number;
  dlq: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    PROCESSED: "badge-success",
    FAILED: "badge-error",
    DLQ: "badge-error",
    PENDING: "badge-pending",
    RETRYING: "badge-pending",
    SUCCESS: "badge-success",
    DEDUPLICATED: "badge-default",
  };
  return `badge ${map[status] ?? "badge-default"}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, processed: 0, failed: 0, dlq: 0 });
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"log" | "config">("log");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/interactions?page=${page}&limit=20`);
      const json = await res.json() as { success: boolean; data: InteractionsResponse };
      if (json.success) {
        setInteractions(json.data.interactions);
        setPages(json.data.pages);

        // Compute stats from current page (ideally a separate /api/stats endpoint)
        const all = json.data.interactions;
        setStats({
          total: json.data.total,
          processed: all.filter(i => i.status === "PROCESSED").length,
          failed: all.filter(i => i.status === "FAILED").length,
          dlq: all.flatMap(i => i.actions).filter(a => a.status === "DLQ").length,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    if (page > 1 || activeTab !== "log") {
      void fetchData();
      return;
    }

    // SSE Live Stream for page 1
    const eventSource = new EventSource(`${API_BASE}/api/logs/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "INITIAL") {
          // Initialize with LRU cache from Redis
          // Map Redis cache format to our UI format
          const mapped = data.logs.map((l: any) => ({
            id: l.id,
            interactionId: l.id,
            guildId: l.payload.guildId,
            channelId: l.payload.channelId,
            userId: l.payload.userId,
            username: l.payload.username,
            commandName: l.payload.commandName,
            status: l.result.error ? "FAILED" : "PROCESSED",
            receivedAt: l.payload.receivedAt,
            processedAt: l.timestamp,
            actions: [
              { id: l.id + "1", type: "DISCORD_REPLY", status: l.result.discordSent ? "SUCCESS" : "FAILED", retryCount: 0, error: l.result.error },
              { id: l.id + "2", type: "SLACK_MIRROR", status: l.result.slackSent ? "SUCCESS" : "FAILED", retryCount: 0, error: l.result.error },
            ].filter(a => a.status === "SUCCESS" || a.error)
          }));
          setInteractions(mapped.slice(0, 20));
          setLoading(false);
        } else if (data.type === "NEW_EVENT") {
          // Prepend new event
          const l = data.log;
          const mappedItem = {
            id: l.id,
            interactionId: l.id,
            guildId: l.payload.guildId,
            channelId: l.payload.channelId,
            userId: l.payload.userId,
            username: l.payload.username,
            commandName: l.payload.commandName,
            status: l.result.error ? "FAILED" : "PROCESSED",
            receivedAt: l.payload.receivedAt,
            processedAt: l.timestamp,
            actions: [
              { id: l.id + "1", type: "DISCORD_REPLY", status: l.result.discordSent ? "SUCCESS" : "FAILED", retryCount: 0, error: l.result.error },
              { id: l.id + "2", type: "SLACK_MIRROR", status: l.result.slackSent ? "SUCCESS" : "FAILED", retryCount: 0, error: l.result.error },
            ].filter(a => a.status === "SUCCESS" || a.error)
          };
          setInteractions((prev) => [mappedItem, ...prev].slice(0, 20));
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE error", err);
      eventSource.close();
      // Fallback to db fetch on SSE error
      void fetchData();
    };

    return () => {
      eventSource.close();
    };
  }, [page, activeTab, fetchData]);

  async function handleLogout() {
    await fetch(`${API_BASE}/api/auth`, { method: "DELETE" });
    router.push("/login");
  }

  return (
    <div className="page-root">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">
            <span>⚡</span> automate
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            id="nav-log"
            className={`nav-item ${activeTab === "log" ? "active" : ""}`}
            onClick={() => setActiveTab("log")}
          >
            <span className="nav-dot" />
            Interaction Log
          </button>
          <button
            id="nav-config"
            className={`nav-item ${activeTab === "config" ? "active" : ""}`}
            onClick={() => setActiveTab("config")}
          >
            <span className="nav-dot" />
            Command Config
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button
            id="nav-logout"
            className="nav-item"
            onClick={handleLogout}
            style={{ color: "var(--red)" }}
          >
            <span className="nav-dot" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        {activeTab === "log" && (
          <>
            <div className="page-header animate-in">
              <h1 className="page-title">Interaction Log</h1>
              <p className="page-subtitle">
                <span className="live-dot" style={{ marginRight: 8 }} />
                Live · refreshes every 15s
              </p>
            </div>

            {/* Stats */}
            <div className="stats-grid">
              {[
                { label: "Total Commands", value: stats.total, cls: "" },
                { label: "Processed", value: stats.processed, cls: "animate-in-delay-1" },
                { label: "Failed", value: stats.failed, cls: "animate-in-delay-2" },
                { label: "DLQ Events", value: stats.dlq, cls: "animate-in-delay-3" },
              ].map(({ label, value, cls }) => (
                <div key={label} className={`stat-card animate-in ${cls}`}>
                  <div className="stat-value">{value}</div>
                  <div className="stat-label">{label}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <h2 className="section-title animate-in animate-in-delay-4">Recent Commands</h2>

            {loading ? (
              <p style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                Loading…
              </p>
            ) : (
              <div className="table-wrap animate-in animate-in-delay-5">
                <table>
                  <thead>
                    <tr>
                      <th>Command</th>
                      <th>User</th>
                      <th>Guild</th>
                      <th>Status</th>
                      <th>Received</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interactions.map((item) => (
                      <>
                        <tr
                          key={item.id}
                          onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                          style={{ cursor: "pointer" }}
                        >
                          <td className="primary">/{item.commandName}</td>
                          <td>{item.username}</td>
                          <td>{item.guildId ?? "DM"}</td>
                          <td>
                            <span className={statusBadge(item.status)}>{item.status}</span>
                          </td>
                          <td>{fmtDate(item.receivedAt)}</td>
                          <td>{item.actions.length}</td>
                        </tr>
                        {expanded === item.id && (
                          <tr key={`${item.id}-detail`}>
                            <td colSpan={6} style={{ background: "var(--bg-elevated)", padding: "16px" }}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 4 }}>
                                  INTERACTION ID: {item.interactionId}
                                </div>
                                {item.actions.map((action) => (
                                  <div key={action.id} style={{
                                    display: "flex", alignItems: "center", gap: 12,
                                    background: "var(--bg-card)", borderRadius: 6, padding: "8px 12px"
                                  }}>
                                    <span className={statusBadge(action.status)}>{action.status}</span>
                                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                                      {action.type}
                                    </span>
                                    {action.retryCount > 0 && (
                                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--yellow)" }}>
                                        retries: {action.retryCount}
                                      </span>
                                    )}
                                    {action.error && (
                                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--red)", flex: 1 }}>
                                        {action.error}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {pages > 1 && (
              <div style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  id="page-prev"
                >
                  ← Prev
                </button>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {page} / {pages}
                </span>
                <button
                  className="btn btn-ghost"
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  id="page-next"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}

        {activeTab === "config" && <CommandConfigPanel />}
      </main>
    </div>
  );
}

// ─── Command Config Panel ─────────────────────────────────────────────────────

interface CommandConfig {
  id: string;
  guildId: string;
  commandName: string;
  isEnabled: boolean;
  mirrorEnabled: boolean;
  aiEnabled: boolean;
  customResponse: string | null;
}

function CommandConfigPanel() {
  const [guildId, setGuildId] = useState("");
  const [configs, setConfigs] = useState<CommandConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function fetchConfigs() {
    if (!guildId.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/config?guildId=${guildId}`);
      const json = await res.json() as { success: boolean; data: CommandConfig[] };
      if (json.success) setConfigs(json.data);
    } finally {
      setLoading(false);
    }
  }

  async function updateConfig(cfg: CommandConfig, field: keyof CommandConfig, value: boolean | string | null) {
    setSaving(cfg.id);
    const updated = { ...cfg, [field]: value };
    setConfigs((prev) => prev.map((c) => c.id === cfg.id ? updated : c));

    await fetch(`${API_BASE}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });

    setSaving(null);
  }

  return (
    <>
      <div className="page-header animate-in">
        <h1 className="page-title">Command Config</h1>
        <p className="page-subtitle">Configure per-guild command behavior</p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
        <input
          id="guild-id-input"
          className="input"
          placeholder="Enter Guild ID…"
          value={guildId}
          onChange={(e) => setGuildId(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <button
          id="fetch-config-btn"
          className="btn btn-primary"
          onClick={fetchConfigs}
          disabled={loading}
        >
          {loading ? "Loading…" : "Fetch"}
        </button>
      </div>

      {configs.length === 0 && !loading && (
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-muted)" }}>
          {guildId ? "No configs found for this guild." : "Enter a Guild ID to manage command settings."}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {configs.map((cfg) => (
          <div key={cfg.id} className="card animate-in">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1rem" }}>
                /{cfg.commandName}
              </span>
              {saving === cfg.id && (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--accent)" }}>
                  Saving…
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { key: "isEnabled", label: "Enabled" },
                { key: "mirrorEnabled", label: "Mirror to Slack" },
                { key: "aiEnabled", label: "AI Summary" },
              ].map(({ key, label }) => (
                <label
                  key={key}
                  className="toggle-wrap"
                  htmlFor={`toggle-${cfg.id}-${key}`}
                >
                  <div
                    id={`toggle-${cfg.id}-${key}`}
                    className={`toggle ${cfg[key as keyof CommandConfig] ? "on" : ""}`}
                    onClick={() => updateConfig(cfg, key as keyof CommandConfig, !cfg[key as keyof CommandConfig])}
                    role="switch"
                    aria-checked={!!cfg[key as keyof CommandConfig]}
                    tabIndex={0}
                  />
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {label}
                  </span>
                </label>
              ))}

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor={`custom-resp-${cfg.id}`}>
                  Custom Response
                </label>
                <input
                  id={`custom-resp-${cfg.id}`}
                  className="input"
                  placeholder="Leave empty to use default"
                  value={cfg.customResponse ?? ""}
                  onChange={(e) => updateConfig(cfg, "customResponse", e.target.value || null)}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
