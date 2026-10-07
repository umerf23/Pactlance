"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { browserSupabase } from "@/lib/supabase/client";
import { ProjectEditor } from "./project-editor";
import { AgreementView } from "./agreement-view";
import { agreementCommitment } from "@/lib/agreements/crypto";
import {
  acceptanceMessage,
  type AgreementInput,
  type ProjectDetail,
  type ProjectRecord,
} from "@/lib/agreements/schema";
import { formatTokenAmount } from "@/lib/domain";
const WalletButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);
type Session = {
  configured: boolean;
  user: null | { id: string; wallet: string };
};
async function api(path: string, body?: unknown, method = "POST") {
  const response = await fetch(path, {
    cache: "no-store",
    ...(body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function inputFromDetail(detail: ProjectDetail): AgreementInput {
  const t = detail.agreement.terms;
  return {
    title: t.title,
    scope: t.scope,
    clientWallet: t.clientWallet,
    freelancerWallet: t.freelancerWallet,
    reviewerWallet: t.reviewerWallet,
    backupReviewerWallet: t.backupReviewerWallet,
    reviewHours: t.reviewHours,
    backupDelayHours: t.backupDelayHours,
    milestones: t.milestones.map((m) => ({
      title: m.title,
      scope: m.scope,
      acceptanceCriteria: m.acceptanceCriteria,
      amount: formatTokenAmount(BigInt(m.amountUnits)),
      fundingDeadline: m.fundingDeadline,
      deliveryDeadline: m.deliveryDeadline,
    })),
  };
}
export function Workspace() {
  const { publicKey, signMessage, disconnect } = useWallet();
  const address = publicKey?.toBase58();
  const [session, setSession] = useState<Session | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const authenticated = !!session?.user && session.user.wallet === address;
  const refreshSession = useCallback(async () => {
    const response = await fetch("/api/session", { cache: "no-store" });
    const data = await response.json();
    if (response.status === 401) {
      setSession({ configured: true, user: null });
      return;
    }
    if (!response.ok) throw new Error(data.error);
    setSession(data);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (response.status === 401) return { configured: true, user: null };
        if (!response.ok) throw new Error(data.error);
        return data;
      })
      .then((data) => {
        if (!cancelled) setSession(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    Promise.all([api("/api/projects"), api("/api/profile")])
      .then(([p, profile]) => {
        if (!cancelled) {
          setProjects(p.projects);
          setName(profile.displayName);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, address]);
  async function signIn() {
    setError("");
    if (!publicKey || !signMessage) {
      setError("Connect a wallet that supports message signing.");
      return;
    }
    setBusy(true);
    try {
      const supabase = browserSupabase();
      const { error } = await supabase.auth.signInWithWeb3({
        chain: "solana",
        wallet: { publicKey, signMessage },
        statement:
          "Sign in to Pactlance. This verifies wallet ownership and does not authorize a payment.",
      });
      if (error) throw error;
      await refreshSession();
      setDetail(null);
      setCreating(false);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setError("");
    try {
      const { error } = await browserSupabase().auth.signOut();
      if (error) throw error;
      await disconnect();
      setSession({ configured: true, user: null });
      setProjects([]);
      setDetail(null);
      setCreating(false);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function openProject(id: string) {
    setBusy(true);
    setError("");
    try {
      setDetail(await api(`/api/projects/${id}`));
      setCreating(false);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(agreement: AgreementInput) {
    const result = await api(
      editing && detail
        ? `/api/projects/${detail.project.id}`
        : "/api/projects",
      {
        agreement,
        ...(editing && detail
          ? { expectedVersion: detail.project.current_version }
          : {}),
      },
      editing ? "PATCH" : "POST",
    );
    setProjects((await api("/api/projects")).projects);
    await openProject(result.id);
  }
  async function accept() {
    if (!detail || !address || !signMessage)
      throw new Error("Connect your signed-in wallet.");
    const a = detail.agreement;
    const hash = await agreementCommitment(a.terms, a.salt);
    if (hash !== a.commitment)
      throw new Error(
        "Agreement fingerprint mismatch. Do not sign; reload the project.",
      );
    const message = acceptanceMessage(
      window.location.origin,
      a.project_id,
      a.version,
      hash,
    );
    const signature = bs58.encode(
      await signMessage(new TextEncoder().encode(message)),
    );
    await api(`/api/projects/${a.project_id}/accept`, {
      version: a.version,
      commitment: hash,
      signature,
    });
    setDetail(await api(`/api/projects/${a.project_id}`));
  }
  async function saveProfile() {
    setProfileNotice("");
    try {
      await api("/api/profile", { displayName: name }, "PATCH");
      setProfileNotice("Display name saved.");
    } catch (e) {
      setProfileNotice((e as Error).message);
    }
  }
  const filtered = projects.filter(
    (p) =>
      filter === "all" ||
      (filter === "client" ? p.client_wallet : p.freelancer_wallet) === address,
  );
  return (
    <div className="live-workspace">
      <header>
        <Link className="brand" href="/">
          pactlance<span className="brand-dot">.</span>
        </Link>
        <div className="wallet-actions">
          <Link href="/">Sample project</Link>
          {session?.configured ? <WalletButton /> : null}
        </div>
      </header>
      <main className="workspace-content">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">PHASE 03 · SHARED WORKSPACE</p>
            <h1>Agree before you begin.</h1>
            <p className="subtitle">
              Private projects. Clear milestones. Two signatures on the same
              terms.
            </p>
          </div>
          <span className="network">Solana devnet</span>
        </div>
        {error ? (
          <p className="error-message" role="alert">
            {error}
          </p>
        ) : null}
        {!session && !error ? (
          <p role="status">Checking workspace configuration…</p>
        ) : null}
        {session && !session.configured ? (
          <section className="workspace-card setup-panel">
            <span className="spark">✳</span>
            <h2>Your workspace is being connected.</h2>
            <p>
              Wallet sign-in and shared project storage need the Supabase
              backend. They are not active on this deployment yet.
            </p>
            <p>
              The Phase 3 interface and API are built. Until setup is complete,
              no sign-in or project save is simulated.
            </p>
            <Link className="secondary" href="/">
              Explore the sample project
            </Link>
            <details>
              <summary>Setup requirements for the project owner</summary>
              <ol>
                <li>Apply the Phase 3 database migration in Supabase.</li>
                <li>
                  Enable Solana Web3 sign-in and allow this site’s origin.
                </li>
                <li>
                  Set the Supabase URL, publishable key and server-only
                  service-role key in Vercel, then redeploy.
                </li>
              </ol>
              <p>Never paste secret keys or wallet seed phrases into chat.</p>
            </details>
          </section>
        ) : null}
        {session?.configured && !authenticated ? (
          <section className="workspace-card sign-in-panel">
            <h2>Sign in with your wallet</h2>
            <p>
              First connect a Solana wallet, then sign a message to verify
              ownership. Connecting alone does not sign you in.
            </p>
            {session.user ? (
              <p className="notice">
                Your session belongs to {session.user.wallet}. Connect that
                wallet or sign in again with the newly selected wallet.
              </p>
            ) : null}
            <button
              className="primary"
              disabled={!address || busy || !signMessage}
              onClick={signIn}
            >
              {busy ? "Waiting for wallet…" : "Sign in to Pactlance"}
            </button>
            <p className="muted">
              This action does not transfer tokens or accept a project
              agreement.
            </p>
          </section>
        ) : null}
        {authenticated && session?.user ? (
          <>
            <div className="session-strip">
              <span>
                Signed in: <code>{session.user.wallet}</code>
              </span>
              <button className="text-button" onClick={signOut}>
                Sign out
              </button>
            </div>
            {creating || editing ? (
              <ProjectEditor
                key={
                  editing
                    ? `edit-${detail?.project.id}-${detail?.project.current_version}`
                    : "create"
                }
                wallet={session.user.wallet}
                initial={
                  editing && detail ? inputFromDetail(detail) : undefined
                }
                onSave={save}
                onCancel={() => {
                  setCreating(false);
                  setEditing(false);
                }}
              />
            ) : detail ? (
              <AgreementView
                key={`${detail.project.id}-${detail.project.current_version}`}
                detail={detail}
                wallet={session.user.wallet}
                onAccept={accept}
                onEdit={() => setEditing(true)}
                onBack={() => setDetail(null)}
              />
            ) : (
              <>
                <section className="workspace-card">
                  <div className="workspace-heading">
                    <h2>Your projects</h2>
                    <button
                      className="primary compact"
                      onClick={() => setCreating(true)}
                    >
                      + New project
                    </button>
                  </div>
                  <label className="filter-label">
                    Your role
                    <select
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="all">All projects</option>
                      <option value="freelancer">Freelancer</option>
                      <option value="client">Client</option>
                    </select>
                  </label>
                  {filtered.length ? (
                    filtered.map((project) => (
                      <button
                        disabled={busy}
                        className="project-row"
                        key={project.id}
                        onClick={() => openProject(project.id)}
                      >
                        <span>
                          <strong>{project.title}</strong>
                          <small>
                            {project.freelancer_wallet === address
                              ? "Freelancer"
                              : "Client"}{" "}
                            · version {project.current_version}
                          </small>
                        </span>
                        <span>Review agreement ↗</span>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      <h3>No projects in this view yet.</h3>
                      <p>
                        Create your first agreement with a counterparty’s wallet
                        address. Both participants will see it when they sign
                        in.
                      </p>
                    </div>
                  )}
                </section>
                <section className="workspace-card">
                  <h2>Your profile</h2>
                  <label>
                    Display name
                    <input
                      maxLength={80}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={!name.trim()}
                    onClick={saveProfile}
                  >
                    Save display name
                  </button>
                  <p role="status">{profileNotice}</p>
                </section>
              </>
            )}
          </>
        ) : null}
        <footer>
          Off-chain test agreements only. Escrow funding begins in Phase 4.
        </footer>
      </main>
    </div>
  );
}
