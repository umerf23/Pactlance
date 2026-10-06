"use client";
import Link from "next/link";
import { useState } from "react";
import { demoProject } from "@/lib/fixtures";
import { formatTokenAmount } from "@/lib/domain";
export function ProjectPreview() {
  const [selected, setSelected] = useState("batch-1");
  const [tab, setTab] = useState<"overview" | "agreement">("overview");
  const milestone = demoProject.milestones.find(
    (item) => item.id === selected,
  )!;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Pactlance home">
          <span className="brand-mark">P</span>pactlance
          <span className="brand-dot">.</span>
        </Link>
        <p className="workspace-label">YOUR WORKSPACE</p>
        <nav>
          <a className="nav-active" href="#project">
            ◫ <span>Projects</span>
            <span className="count">1</span>
          </a>
          <a href="#roadmap">
            ↗ <span>Build progress</span>
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="spark">✳</span>
          <h3>
            Good work.
            <br />
            Clear agreements.
          </h3>
          <p>Build trust, one milestone at a time.</p>
        </div>
        <div className="profile">
          <span className="avatar">DF</span>
          <div>
            Demo freelancer<small>Preview workspace</small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            Workspace <span className="slash">/</span> Projects
          </span>
          <span className="network">
            <i /> Devnet preview
          </span>
        </header>
        <div className="content" id="project">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR PROJECTS, IN SYNC</p>
              <h1>Work with confidence.</h1>
              <p className="subtitle">
                Clear milestones. Shared expectations. A better way to work
                together.
              </p>
            </div>
            <span className="phase-label">PHASE 02 / FOUNDATION</span>
          </div>
          <div className="notice">
            <strong>Development preview</strong>
            <span>
              Sample data only. Wallet sign-in and escrow payments are not
              connected.
            </span>
          </div>
          <section className="stats" aria-label="Sample project totals">
            <div>
              <span>Agreed project value</span>
              <strong>
                500 <small>TEST</small>
              </strong>
              <p>Across 2 sequential milestones</p>
            </div>
            <div>
              <span>In escrow</span>
              <strong>
                0 <small>TEST</small>
              </strong>
              <p>No funds deposited</p>
            </div>
            <div>
              <span>Milestones completed</span>
              <strong>
                0 <small>/ 2</small>
              </strong>
              <p>Ready to agree on the first batch</p>
            </div>
          </section>
          <section className="project-card">
            <div className="project-heading">
              <div className="project-icon">↗</div>
              <div>
                <p className="eyebrow">VIDEO EDITING · SAMPLE PROJECT</p>
                <h2>{demoProject.title}</h2>
                <p>With {demoProject.client}</p>
              </div>
              <span className="pill">Not funded</span>
            </div>
            <div className="tabs" role="tablist" aria-label="Project sections">
              <button
                role="tab"
                aria-selected={tab === "overview"}
                onClick={() => setTab("overview")}
              >
                Milestones
              </button>
              <button
                role="tab"
                aria-selected={tab === "agreement"}
                onClick={() => setTab("agreement")}
              >
                Agreement outline
              </button>
            </div>
            {tab === "overview" ? (
              <div className="milestone-layout">
                <div className="milestone-list">
                  <p className="section-label">PROJECT TIMELINE</p>
                  {demoProject.milestones.map((item) => (
                    <button
                      className={`milestone ${selected === item.id ? "selected" : ""}`}
                      key={item.id}
                      onClick={() => setSelected(item.id)}
                      aria-pressed={selected === item.id}
                    >
                      <span className="step">0{item.sequence}</span>
                      <span className="milestone-title">
                        {item.title}
                        <small>
                          {item.sequence === 1
                            ? "First milestone · not funded"
                            : "After milestone 1 settles"}
                        </small>
                      </span>
                      <strong>
                        {formatTokenAmount(item.amountUnits)}
                        <small>TEST</small>
                      </strong>
                    </button>
                  ))}
                  <p className="sequence-note">
                    One funded milestone at a time.
                    <br />
                    Each milestone has its own escrow vault.
                  </p>
                </div>
                <div className="detail">
                  <div className="detail-top">
                    <span className="section-label">
                      MILESTONE 0{milestone.sequence}
                    </span>
                    <span className="outline-pill">Sample terms</span>
                  </div>
                  <h3>{milestone.title}</h3>
                  <p>{milestone.deliverables}</p>
                  <dl>
                    <div>
                      <dt>Milestone amount</dt>
                      <dd>{formatTokenAmount(milestone.amountUnits)} TEST</dd>
                    </div>
                    <div>
                      <dt>Review window</dt>
                      <dd>72 hours after submission</dd>
                    </div>
                    <div>
                      <dt>Funding</dt>
                      <dd>
                        {milestone.sequence === 1
                          ? "Requires accepted terms"
                          : "Requires prior settlement"}
                      </dd>
                    </div>
                  </dl>
                  <div className="action-note">
                    Wallet authentication and funding will be implemented in
                    Phases 3–4.
                  </div>
                  <button
                    className="primary"
                    onClick={() => setTab("agreement")}
                  >
                    Review agreement outline <span>↗</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="agreement">
                <h3>A shared understanding, before work begins.</h3>
                <p>
                  This is an outline, not an accepted agreement. Both wallets
                  must accept the exact version before any milestone can be
                  funded.
                </p>
                <div className="agreement-grid">
                  <div>
                    <h4>Scope & acceptance</h4>
                    <p>
                      Ten short-form videos in two batches. Each batch has
                      explicit file, format, duration and caption requirements.
                    </p>
                  </div>
                  <div>
                    <h4>Payment rules</h4>
                    <p>
                      Approval releases payment. After the agreed review window,
                      an undisputed delivery becomes eligible for a claim
                      transaction.
                    </p>
                  </div>
                  <div>
                    <h4>Dispute review</h4>
                    <p>
                      Both parties agree to primary and backup reviewers before
                      funding. A dispute pauses ordinary payment and refund
                      paths.
                    </p>
                  </div>
                  <div>
                    <h4>Remaining setup</h4>
                    <p>
                      Participant wallets, exact dates, reviewer identities and
                      token mint are not yet configured. No agreement has been
                      signed.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </section>
          <section className="roadmap" id="roadmap">
            <div>
              <p className="eyebrow">BUILDING PACTLANCE</p>
              <h3>A foundation for protected work.</h3>
              <p>
                Multi-milestone projects remain at the heart of the product.
              </p>
            </div>
            <ol>
              <li className="done">
                01 <span>Product specification</span>
              </li>
              <li className="current">
                02 <span>Development foundation</span>
              </li>
              <li>
                03 <span>Wallets & agreements</span>
              </li>
              <li>
                04–08 <span>Escrow, protection & validation</span>
              </li>
            </ol>
          </section>
          <footer>
            Pactlance · Independent work, shared trust.
            <span>TEST tokens have no monetary value.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
