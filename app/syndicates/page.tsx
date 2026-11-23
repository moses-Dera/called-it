"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav, Img } from "@/components/ui";
import { SignInPill } from "@/components/account";
import { cloudRpc, useCloud } from "@/lib/cloud";

type Syndicate = { id: string; name: string; description: string | null; member_count: number; is_owner: boolean; invite_code: string | null };
type SyndicateRank = { rank: number; syndicate_id: string; name: string; member_count: number; total_points: number };
type SyndicateDetail = { id: string; name: string; description: string | null; owner: string; max_members: number; invite_code: string | null; is_member: boolean; members: { user_id: string; name: string; avatar: number; points: number }[] };

export default function SyndicatesPage() {
  const [tab, setTab] = useState<"mine" | "board">("board");
  const session = useCloud().session;
  const signedIn = !!session;
  const [mine, setMine] = useState<Syndicate[] | null>(null);
  const [board, setBoard] = useState<SyndicateRank[] | null>(null);
  const [detail, setDetail] = useState<SyndicateDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    cloudRpc<SyndicateRank[]>("syndicate_leaderboard", { p_period: "all" }).then(setBoard).catch(() => setBoard([]));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    cloudRpc<Syndicate[]>("my_syndicates").then(setMine).catch(() => setMine([]));
  }, [signedIn]);

  async function create() {
    if (!name.trim()) return setMsg("Give your syndicate a name.");
    setMsg("");
    try {
      const r = await cloudRpc<{ id: string; name: string; invite_code: string }>("create_syndicate", { p_name: name, p_description: desc || null });
      setMsg(`Created "${r.name}"! Share code: ${r.invite_code}`);
      setCreating(false); setName(""); setDesc("");
      cloudRpc<Syndicate[]>("my_syndicates").then(setMine).catch(() => {});
      cloudRpc<SyndicateRank[]>("syndicate_leaderboard", { p_period: "all" }).then(setBoard).catch(() => {});
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  async function join() {
    if (!code.trim()) return setMsg("Paste an invite code.");
    setMsg("");
    try {
      const r = await cloudRpc<{ joined: boolean; syndicate: string }>("join_syndicate", { p_invite_code: code.trim() });
      setMsg(`Joined "${r.syndicate}"!`);
      setJoining(false); setCode("");
      cloudRpc<Syndicate[]>("my_syndicates").then(setMine).catch(() => {});
      cloudRpc<SyndicateRank[]>("syndicate_leaderboard", { p_period: "all" }).then(setBoard).catch(() => {});
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  async function leave(id: string) {
    try {
      await cloudRpc("leave_syndicate", { p_id: id });
      setMine((m) => m?.filter((s) => s.id !== id) ?? null);
      setDetail(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  async function deleteSyndicate(id: string) {
    try {
      await cloudRpc("delete_syndicate", { p_id: id });
      setMine((m) => m?.filter((s) => s.id !== id) ?? null);
      setDetail(null);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  }

  async function openDetail(id: string) {
    try {
      const d = await cloudRpc<SyndicateDetail>("syndicate_detail", { p_id: id });
      setDetail(d);
    } catch { setMsg("Could not load syndicate."); }
  }

  function copyCode(c: string) {
    navigator.clipboard?.writeText(c);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="screen wide hub" style={{ padding: "18px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 className="display" style={{ margin: 0, fontSize: 34 }}>Syndicates</h1>
        <span className="chip" style={{ background: "var(--sky)", transform: "rotate(2deg)", padding: "6px 10px" }}>GROUP PLAY</span>
      </div>

      <div role="tablist" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginBottom: 14 }}>
        {([["board", "Leaderboard"], ["mine", "My syndicates"]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ height: 44, borderRadius: 12, border: `2px solid ${tab === k ? "#111" : "var(--line)"}`, background: tab === k ? "var(--lime)" : "var(--panel)", color: tab === k ? "#111" : "#c9d3de", fontWeight: 800, fontSize: 13 }}>{t}</button>
        ))}
      </div>

      {msg && <div role="status" style={{ fontSize: 13, fontWeight: 700, padding: "8px 12px", borderRadius: 12, background: "var(--panel)", border: "2px solid var(--line)", marginBottom: 10 }}>{msg}</div>}

      {detail && (
        <section className="paper" style={{ borderWidth: 3, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
            <div>
              <h2 className="display" style={{ margin: 0, fontSize: 24, color: "#111" }}>{detail.name}</h2>
              {detail.description && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#423820", fontWeight: 600 }}>{detail.description}</p>}
            </div>
            <button onClick={() => setDetail(null)} style={{ width: 32, height: 32, borderRadius: 10, border: "2px solid #111", background: "#fff", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6b6455" }}>{detail.members.length} / {detail.max_members} members</div>
          {detail.invite_code && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#6b6455" }}>Invite:</span>
              <code className="mono" style={{ fontSize: 13, color: "#111", background: "#f3ede0", padding: "4px 8px", borderRadius: 8 }}>{detail.invite_code}</code>
              <button onClick={() => copyCode(detail.invite_code!)} style={{ border: 0, background: "transparent", fontWeight: 800, fontSize: 12, color: "#111", cursor: "pointer" }}>{copied ? "✓" : "Copy"}</button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {detail.members.map((m) => (
              <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px dashed #d8cfb8" }}>
                <Img n={`avatar_${m.avatar}`} size={32} style={{ borderRadius: 10, border: "2px solid #111" }} />
                <b style={{ flex: 1, fontSize: 13 }}>{m.name}</b>
                <span className="display" style={{ fontSize: 16 }}>{Number(m.points).toLocaleString()}</span>
              </div>
            ))}
          </div>
          {detail.is_member && detail.owner !== session?.user.id && (
            <button onClick={() => leave(detail.id)} style={{ marginTop: 4, minHeight: 40, borderRadius: 12, border: "2px solid #111", background: "transparent", color: "#111", fontWeight: 800, fontSize: 13 }}>Leave syndicate</button>
          )}
          {detail.owner === session?.user.id && (
            <button onClick={() => deleteSyndicate(detail.id)} style={{ marginTop: 4, minHeight: 40, borderRadius: 12, border: "2px solid #c0392b", background: "transparent", color: "#c0392b", fontWeight: 800, fontSize: 13 }}>Delete syndicate</button>
          )}
        </section>
      )}

      {tab === "board" && (
        <section style={{ background: "var(--paper)", color: "#111", border: "3px solid #111", borderRadius: 26, padding: "14px 20px", display: "flex", flexDirection: "column" }}>
          <h2 className="display" style={{ margin: "4px 0 10px", fontSize: 20 }}>Top syndicates</h2>
          {board === null && <div style={{ padding: "10px 0", fontSize: 14, color: "#4a4436" }}>Loading…</div>}
          {board?.length === 0 && <div style={{ padding: "10px 0", fontSize: 14, color: "#4a4436", lineHeight: 1.5 }}>No syndicates ranked yet. Create one and start earning together.</div>}
          {board?.map((r) => (
            <button key={r.syndicate_id} onClick={() => openDetail(r.syndicate_id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "2px dashed #d8cfb8", background: "transparent", border: 0, borderBottomWidth: 2, borderBottomStyle: "dashed", borderBottomColor: "#d8cfb8", width: "100%", textAlign: "left", cursor: "pointer", color: "#111" }}>
              <span className="display" style={{ width: 26, fontSize: 20 }}>{r.rank}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14 }}>{r.name}</b>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b6455" }}>{r.member_count} member{Number(r.member_count) === 1 ? "" : "s"}</div>
              </div>
              <span className="display" style={{ fontSize: 20 }}>{Number(r.total_points).toLocaleString()}</span>
            </button>
          ))}
        </section>
      )}

      {tab === "mine" && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!signedIn && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>
              <span style={{ flex: 1 }}>Sign in to create or join a syndicate.</span><SignInPill />
            </div>
          )}
          {signedIn && mine === null && <div style={{ padding: "10px 0", fontSize: 14, color: "var(--muted)" }}>Loading…</div>}
          {signedIn && mine?.length === 0 && !creating && !joining && (
            <div style={{ padding: "10px 0", fontSize: 14, color: "var(--muted)", lineHeight: 1.5 }}>
              You&apos;re not in any syndicates yet. Create one or join with an invite code.
            </div>
          )}
          {mine?.map((s) => (
            <button key={s.id} onClick={() => openDetail(s.id)} className="paper" style={{ borderWidth: 2, borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", width: "100%", textAlign: "left", color: "#111" }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 14 }}>{s.name}</b>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b6455" }}>{s.member_count} member{Number(s.member_count) === 1 ? "" : "s"}{s.is_owner ? " · Owner" : ""}</div>
              </div>
              <span style={{ color: "#111", fontWeight: 800 }}>→</span>
            </button>
          ))}

          {signedIn && !creating && !joining && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setCreating(true); setJoining(false); }} className="btn" style={{ flex: 1, background: "var(--lime)", color: "#111", border: "2px solid #111", fontSize: 14 }}>Create</button>
              <button onClick={() => { setJoining(true); setCreating(false); }} className="btn" style={{ flex: 1, background: "var(--panel)", color: "var(--text)", border: "2px solid var(--line)", fontSize: 14 }}>Join with code</button>
            </div>
          )}

          {creating && (
            <div className="paper" style={{ borderWidth: 2, borderRadius: 18, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <b style={{ fontSize: 14, color: "#111" }}>Create a syndicate</b>
              <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Syndicate name" style={{ padding: "8px 12px", borderRadius: 12, border: "2px solid #111", fontSize: 13, fontWeight: 600, background: "#fff", color: "#111" }} />
              <input type="text" maxLength={200} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)" style={{ padding: "8px 12px", borderRadius: 12, border: "2px solid #d8cfb8", fontSize: 13, fontWeight: 600, background: "#fff", color: "#111" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={create} className="btn" style={{ flex: 1, background: "#111", color: "var(--lime)", border: 0, fontSize: 14 }}>Create</button>
                <button onClick={() => setCreating(false)} style={{ padding: "8px 16px", borderRadius: 12, border: "2px solid #111", background: "transparent", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}

          {joining && (
            <div className="paper" style={{ borderWidth: 2, borderRadius: 18, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <b style={{ fontSize: 14, color: "#111" }}>Join with invite code</b>
              <input type="text" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste invite code" className="mono" style={{ padding: "8px 12px", borderRadius: 12, border: "2px solid #111", fontSize: 13, fontWeight: 600, background: "#fff", color: "#111" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={join} className="btn" style={{ flex: 1, background: "#111", color: "var(--sky)", border: 0, fontSize: 14 }}>Join</button>
                <button onClick={() => setJoining(false)} style={{ padding: "8px 16px", borderRadius: 12, border: "2px solid #111", background: "transparent", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}

      <div style={{ padding: "18px 0 16px" }}>
        <Link href="/ranks" style={{ display: "flex", alignItems: "center", gap: 12, background: "#111", color: "var(--paper)", borderRadius: 18, padding: "12px 14px" }}>
          <Img n="seal" size={40} /><div style={{ flex: 1 }}><b style={{ fontSize: 14 }}>Compete solo too</b><div style={{ fontSize: 12, color: "#c9d3de" }}>Your points count for both individual and syndicate ranks.</div></div><span style={{ color: "var(--lime)", fontWeight: 800 }}>→</span>
        </Link>
      </div>

      <BottomNav active="/ranks" />
    </main>
  );
}
