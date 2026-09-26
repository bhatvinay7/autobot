"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
}

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
  commandOptions?: CommandOption[];
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
  const [activeTab, setActiveTab] = useState<"log" | "config" | "fertilizer">("log");
  const [logMode, setLogMode] = useState<"live" | "history">("live");
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
    // Fetch initial data from DB on load/refresh for the current page
    void fetchData();

    if (page > 1 || activeTab !== "log" || logMode !== "live") {
      return;
    }

    // SSE Live Stream for page 1 to append new events client-side
    const eventSource = new EventSource(`${API_BASE}/api/logs/stream`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Ignore "INITIAL" as we now fetch from DB directly
        if (data.type === "NEW_EVENT") {
          // Append new event (ascending order: newest at bottom)
          const l = data.log;
          const mappedItem = {
            id: l.id,
            interactionId: l.id,
            guildId: l.payload.guildId,
            channelId: l.payload.channelId,
            userId: l.payload.userId,
            username: l.payload.username,
            commandName: l.payload.commandName,
            commandOptions: l.payload.commandOptions,
            status: l.result.error ? "FAILED" : "PROCESSED",
            receivedAt: l.payload.receivedAt,
            processedAt: l.timestamp,
            actions: [
              { id: l.id + "1", type: "DISCORD_REPLY", status: l.result.discordSent ? "SUCCESS" : "FAILED", retryCount: 0, error: l.result.error },
              { id: l.id + "2", type: "SLACK_MIRROR", status: l.result.slackSent ? "SUCCESS" : "FAILED", retryCount: 0, error: l.result.error },
            ].filter(a => a.status === "SUCCESS" || a.error)
          };
          setInteractions((prev) => {
            if (prev.some(i => i.id === mappedItem.id)) return prev;
            return [...prev, mappedItem].slice(-20);
          });
        }
      } catch (err) {
        console.error("SSE parse error", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE error", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [page, activeTab, logMode, fetchData]);

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
          <button
            id="nav-fertilizer"
            className={`nav-item ${activeTab === "fertilizer" ? "active" : ""}`}
            onClick={() => setActiveTab("fertilizer")}
          >
            <span className="nav-dot" />
            Fertilizers
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
            <div className="page-header animate-in" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h1 className="page-title">Interaction Log</h1>
                <p className="page-subtitle">
                  {logMode === "live" ? (
                    <><span className="live-dot" style={{ marginRight: 8 }} />Live · appending via SSE</>
                  ) : (
                    <>Old Logs · Historical Data</>
                  )}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-elevated)', padding: '4px', borderRadius: '8px' }}>
                <button 
                  className={`btn ${logMode === 'live' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minHeight: '32px', height: '32px', fontSize: '0.8rem', padding: '0 12px' }}
                  onClick={() => { setLogMode('live'); setPage(1); }}
                >
                  Live Logs
                </button>
                <button 
                  className={`btn ${logMode === 'history' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minHeight: '32px', height: '32px', fontSize: '0.8rem', padding: '0 12px' }}
                  onClick={() => setLogMode('history')}
                >
                  Old Logs
                </button>
              </div>
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
                                {item.commandOptions && item.commandOptions.length > 0 && (
                                  <div style={{ marginTop: 8, background: "var(--bg-card)", padding: "12px", borderRadius: 6 }}>
                                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 8 }}>
                                      COMMAND OPTIONS (PROMPT):
                                    </div>
                                    {item.commandOptions.map((opt: CommandOption, i: number) => (
                                      <div key={i} style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--text-primary)" }}>
                                        <span style={{ color: "var(--accent)" }}>{opt.name}</span>: {opt.value?.toString() ?? "N/A"}
                                      </div>
                                    ))}
                                  </div>
                                )}
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
            {pages > 1 && logMode === "history" && (
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
        {activeTab === "fertilizer" && <FertilizerPanel />}
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

// ─── Fertilizer Panel ─────────────────────────────────────────────────────────

interface Fertilizer {
  id: string;
  name: string;
  price: number;
  description: string | null;
  mainUsage: string | null;
  mainFunctionality: string | null;
  imageUrl: string | null;
}

function FertilizerPanel() {
  const [fertilizers, setFertilizers] = useState<Fertilizer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState<Fertilizer | null>(null);
  const [formData, setFormData] = useState({ name: "", price: "", description: "", mainUsage: "", mainFunctionality: "", imageUrl: "" });

  const fetchFertilizers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/fertilizers`);
      const json = await res.json();
      if (json.success) setFertilizers(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFertilizers();
  }, [fetchFertilizers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = isEditing ? `${API_BASE}/api/fertilizers/${isEditing.id}` : `${API_BASE}/api/fertilizers`;
    const method = isEditing ? "PUT" : "POST";
    
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...formData, price: Number(formData.price) }),
    });
    
    setFormData({ name: "", price: "", description: "", mainUsage: "", mainFunctionality: "", imageUrl: "" });
    setIsEditing(null);
    void fetchFertilizers();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure?")) return;
    await fetch(`${API_BASE}/api/fertilizers/${id}`, { method: "DELETE" });
    void fetchFertilizers();
  };

  const handleEdit = (f: Fertilizer) => {
    setIsEditing(f);
    setFormData({
      name: f.name,
      price: String(f.price),
      description: f.description || "",
      mainUsage: f.mainUsage || "",
      mainFunctionality: f.mainFunctionality || "",
      imageUrl: f.imageUrl || "",
    });
  };

  return (
    <>
      <div className="page-header animate-in">
        <h1 className="page-title">Fertilizer Factory Data</h1>
        <p className="page-subtitle">Manage chemical factory data and products</p>
      </div>

      <div className="card animate-in" style={{ marginBottom: 32 }}>
        <h2 className="section-title" style={{ marginTop: 0 }}>{isEditing ? "Edit Fertilizer" : "Add New Fertilizer"}</h2>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12 }}>
            <input required className="input" placeholder="Name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} style={{ flex: 1 }} />
            <input required type="number" step="0.01" className="input" placeholder="Price ($)" value={formData.price} onChange={(e) => setFormData({...formData, price: e.target.value})} style={{ width: 120 }} />
          </div>
          <input className="input" placeholder="Description" value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} />
          <input className="input" placeholder="Main Usage (e.g. Soil conditioning)" value={formData.mainUsage} onChange={(e) => setFormData({...formData, mainUsage: e.target.value})} />
          <input className="input" placeholder="Main Functionality (e.g. Increases nitrogen)" value={formData.mainFunctionality} onChange={(e) => setFormData({...formData, mainFunctionality: e.target.value})} />
          <input className="input" placeholder="Image URL" value={formData.imageUrl} onChange={(e) => setFormData({...formData, imageUrl: e.target.value})} />
          
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
            {isEditing && (
              <button type="button" className="btn btn-ghost" onClick={() => { setIsEditing(null); setFormData({ name: "", price: "", description: "", mainUsage: "", mainFunctionality: "", imageUrl: "" }); }}>
                Cancel
              </button>
            )}
            <button type="submit" className="btn btn-primary">
              {isEditing ? "Update" : "Save"}
            </button>
          </div>
        </form>
      </div>

      <div className="table-wrap animate-in animate-in-delay-1">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Price</th>
              <th>Description</th>
              <th>Usage</th>
              <th>Functionality</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>Loading...</td></tr>
            ) : fertilizers.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No data available.</td></tr>
            ) : fertilizers.map(f => (
              <tr key={f.id}>
                <td className="primary">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {f.imageUrl && <img src={f.imageUrl} alt={f.name} style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover" }} />}
                    {f.name}
                  </div>
                </td>
                <td>${f.price.toFixed(2)}</td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.description}</td>
                <td>{f.mainUsage}</td>
                <td>{f.mainFunctionality}</td>
                <td>
                  <button className="btn btn-ghost" style={{ padding: "4px 8px", minWidth: "auto", minHeight: "auto", height: 28, fontSize: "0.75rem" }} onClick={() => handleEdit(f)}>Edit</button>
                  <button className="btn btn-ghost" style={{ padding: "4px 8px", minWidth: "auto", minHeight: "auto", height: 28, fontSize: "0.75rem", color: "var(--red)" }} onClick={() => handleDelete(f.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

