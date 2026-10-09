"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { browserSupabase } from "@/lib/supabase/client";
import { ProjectEditor } from "./project-editor";
import { AgreementView } from "./agreement-view";
import { EscrowPanel } from "./escrow-panel";
import { EvidencePanel } from "./evidence-panel";
import { OperationsDashboard } from "./operations-dashboard";
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
  const {
    publicKey,
    signMessage,
    signIn: walletSignIn,
    disconnect,
  } = useWallet();
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
  const [evidenceIndex, setEvidenceIndex] = useState(0);
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
      const statement =
        "Sign in to Pactlance. This verifies wallet ownership and does not authorize a payment.";
      const url = new URL(window.location.href);
      const nonce = crypto.randomUUID().replaceAll("-", "");
      const issuedAt = new Date().toISOString();
      const credentials = walletSignIn
        ? await (async () => {
            const result = await walletSignIn({
              domain: url.host,
              address: publicKey.toBase58(),
              uri: url.href,
              version: "1",
              nonce,
              issuedAt,
              statement,
            });
            if (result.account.address !== publicKey.toBase58()) {
              throw new Error(
                "Wallet account changed. Reconnect and sign in again.",
              );
            }
            return {
              chain: "solana" as const,
              message: new TextDecoder().decode(result.signedMessage),
              signature: new Uint8Array(result.signature),
            };
          })()
        : await (async () => {
            const message = [
              `${url.host} wants you to sign in with your Solana account:`,
              publicKey.toBase58(),
              "",
              statement,
              "",
              `URI: ${url.href}`,
              "Version: 1",
              `Nonce: ${nonce}`,
              `Issued At: ${issuedAt}`,
            ].join("\n");
            return {
              chain: "solana" as const,
              message,
              signature: await signMessage(new TextEncoder().encode(message)),
            };
          })();
      const { error } = await supabase.auth.signInWithWeb3(credentials);
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
    <div className="live-workspace dapp-workspace">
      <header>
        <Link className="brand" href="/">
          <span className="workspace-brand-icon" aria-hidden="true">
            p
          </span>
          pactlance<span className="brand-dot">.</span>
        </Link>
        <nav className="dapp-nav" aria-label="Workspace navigation">
          <button
            type="button"
            aria-current={!detail ? "page" : undefined}
            onClick={() => {
              setDetail(null);
              setCreating(false);
              setEditing(false);
            }}
          >
            Projects
          </button>
          {detail ? (
            <>
              <a href="#project-escrow">Escrow</a>
              <a href="#project-evidence">Evidence</a>
            </>
          ) : null}
          <Link href="/">Demo</Link>
        </nav>
        <div className="wallet-actions">
          {session?.configured ? <WalletButton /> : null}
        </div>
      </header>
      <main className="workspace-content">
        <div className="workspace-heading workspace-hero">
          <div>
            <p className="eyebrow">PACTLANCE / WORKSPACE</p>
            <h1>
              {detail
                ? "Project workspace"
                : authenticated
                  ? "Your projects"
                  : "Milestone payments. On chain."}
            </h1>
            <p className="subtitle">
              Agree on terms. Fund one milestone at a time. Settle on Solana.
            </p>
          </div>
          <div className="workspace-hero-note">
            <span className="network">
              <i aria-hidden="true" />
              Solana devnet
            </span>
            <span>TEST tokens · no monetary value</span>
          </div>
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
              Wallet sign-in and private project storage are implemented.
              Complete the backend setup to use this workspace.
            </p>
            <Link className="secondary" href="/">
              Explore the sample project
            </Link>
            <details>
              <summary>Setup requirements for the project owner</summary>
              <ol>
                <li>Apply the repository database migrations in Supabase.</li>
                <li>
                  Enable Solana Web3 sign-in and allow this site’s origin.
                </li>
                <li>
                  Set the Supabase URL, publishable key and server-only
                  service-role key in the app environment, then restart or
                  redeploy.
                </li>
              </ol>
              <p>Never paste secret keys or wallet seed phrases into chat.</p>
            </details>
          </section>
        ) : null}
        {session?.configured && !authenticated ? (
          <section className="workspace-card sign-in-panel">
            <span className="signin-emblem" aria-hidden="true">
              ↗
            </span>
            <p className="eyebrow">WALLET AUTHENTICATION</p>
            <h2>Connect. Verify. Get to work.</h2>
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
              <span className="session-identity">
                <span className="session-avatar" aria-hidden="true">
                  {(name.trim() || "W").slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{name.trim() || "Wallet workspace"}</strong>
                  <code title={session.user.wallet}>
                    {session.user.wallet.slice(0, 6)}…
                    {session.user.wallet.slice(-6)}
                  </code>
                </span>
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
              <>
                <AgreementView
                  key={`${detail.project.id}-${detail.project.current_version}`}
                  detail={detail}
                  wallet={session.user.wallet}
                  onAccept={accept}
                  onEdit={() => setEditing(true)}
                  onBack={() => setDetail(null)}
                />
                <section id="project-evidence" className="workspace-card">
                  <label>
                    Milestone evidence
                    <select
                      value={Math.min(
                        evidenceIndex,
                        detail.agreement.terms.milestones.length - 1,
                      )}
                      onChange={(e) => setEvidenceIndex(Number(e.target.value))}
                    >
                      {detail.agreement.terms.milestones.map((m, i) => (
                        <option key={m.id} value={i}>
                          {i + 1}. {m.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <EvidencePanel
                  key={`${detail.project.id}:${detail.agreement.version}:${evidenceIndex}`}
                  projectId={detail.project.id}
                  version={detail.agreement.version}
                  index={Math.min(
                    evidenceIndex,
                    detail.agreement.terms.milestones.length - 1,
                  )}
                  canUpload={true}
                  freelancer={
                    session.user.wallet === detail.project.freelancer_wallet
                  }
                />
                <EscrowPanel
                  key={`${detail.project.id}:${session.user.wallet}`}
                  projectId={detail.project.id}
                />
                <OperationsDashboard
                  key={detail.project.id}
                  wallet={session.user.wallet}
                  projectId={detail.project.id}
                />
              </>
            ) : (
              <>
                <div
                  className="workspace-metrics"
                  aria-label="Project overview"
                >
                  <div>
                    <span>YOUR PROJECTS</span>
                    <strong>{projects.length}</strong>
                    <small>Private agreements in your workspace</small>
                  </div>
                  <div>
                    <span>AS FREELANCER</span>
                    <strong>
                      {projects
                        .filter((p) => p.freelancer_wallet === address)
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                    <small>Work you deliver</small>
                  </div>
                  <div>
                    <span>AS CLIENT</span>
                    <strong>
                      {projects
                        .filter((p) => p.client_wallet === address)
                        .length.toString()
                        .padStart(2, "0")}
                    </strong>
                    <small>Work you commission</small>
                  </div>
                </div>
                <section className="workspace-card project-list-card">
                  <div className="workspace-heading">
                    <div>
                      <p className="eyebrow">WORKSPACE OVERVIEW</p>
                      <h2>Your projects</h2>
                    </div>
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
                        <span className="project-row-main">
                          <span className="project-row-icon" aria-hidden="true">
                            {project.title.slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <strong>{project.title}</strong>
                            <small>
                              {project.freelancer_wallet === address
                                ? "Freelancer"
                                : "Client"}{" "}
                              · version {project.current_version}
                            </small>
                          </span>
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
                <OperationsDashboard
                  key={session.user.wallet}
                  wallet={session.user.wallet}
                />
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
          Private agreements and evidence. Escrow actions use Solana devnet TEST
          tokens.
        </footer>
      </main>
    </div>
  );
}
