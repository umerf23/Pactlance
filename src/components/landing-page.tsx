import Link from "next/link";

export function LandingPage() {
  return (
    <div className="dapp-workspace landing-page">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header>
        <Link className="brand" href="/">
          pactlance<span className="brand-dot">.</span>
        </Link>
        <nav className="dapp-nav" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/guide">Payment rules</Link>
        </nav>
        <Link className="primary" href="/workspace">
          Open workspace ↗
        </Link>
      </header>
      <main id="main-content" className="workspace-content">
        <section className="landing-hero">
          <div>
            <p className="eyebrow">
              DIRECT CLIENTS. AGREED WORK. VISIBLE FUNDING.
            </p>
            <h1>
              Know the milestone is funded.
              <br />
              Then get to work.
            </h1>
            <p className="landing-lead">
              Payment protection for Pakistani freelance video editors and
              overseas clients. Agree on each batch, verify its escrow, and
              settle against the terms you both accepted.
            </p>
            <div className="operational-actions">
              <Link className="primary" href="/workspace">
                Create or open a project
              </Link>
              <Link className="secondary" href="/guide">
                Understand the payment rules
              </Link>
            </div>
            <p className="muted">
              Current network: Solana devnet. TEST tokens have no monetary
              value. Card funding and PKR withdrawals are not available.
            </p>
          </div>
          <aside className="landing-contract" aria-label="The payment workflow">
            <p className="eyebrow">ONE MILESTONE AT A TIME</p>
            <ol>
              <li>
                <strong>Agree</strong>
                <span>
                  Scope, acceptance criteria, deadlines and reviewers.
                </span>
              </li>
              <li>
                <strong>Verify funding</strong>
                <span>
                  The client deposits into a dedicated on-chain vault.
                </span>
              </li>
              <li>
                <strong>Deliver</strong>
                <span>
                  Share private evidence and record a submission commitment.
                </span>
              </li>
              <li>
                <strong>Settle</strong>
                <span>
                  Approval, eligible timeout, refund or agreed dispute
                  resolution.
                </span>
              </li>
            </ol>
            <p>
              Only one funded milestone is active. The next batch unlocks after
              settlement.
            </p>
          </aside>
        </section>
        <section id="how-it-works" className="workspace-card">
          <p className="eyebrow">TWO SIDES OF THE SAME AGREEMENT</p>
          <h2>A shared payment workflow for work you source yourself.</h2>
          <div className="landing-columns">
            <div>
              <h3>For freelancers</h3>
              <p>
                Check committed funding before starting. Keep scope and delivery
                evidence together. Claim an eligible payout when the agreed
                review period ends without a dispute.
              </p>
            </div>
            <div>
              <h3>For clients</h3>
              <p>
                Fund the next batch rather than the whole project. Review
                deliverables before approving. Use the accepted refund and
                dispute rules when something goes wrong.
              </p>
            </div>
            <div>
              <h3>For reviewers</h3>
              <p>
                Inspect private evidence for assigned disputes. An eligible
                reviewer can allocate the funded amount only between the
                original client and freelancer.
              </p>
            </div>
          </div>
        </section>
        <section className="workspace-card">
          <h2>Clear rules before any deposit.</h2>
          <p>
            The Solana program enforces token recipients, deadlines and
            settlement permissions. People still judge work quality. Choose
            reviewers who have agreed to serve; if neither reviewers nor
            participants act, disputed funds can remain locked.
          </p>
          <p>
            The program is upgradeable. This release uses devnet test assets and
            does not establish readiness for real-money payments.
          </p>
          <div className="operational-actions">
            <Link className="secondary" href="/guide">
              Read the full workflow
            </Link>
            <Link className="text-button" href="/preview">
              Explore an explicitly labelled sample
            </Link>
          </div>
        </section>
        <footer>
          <span>Pactlance · milestone payment protection</span>
          <Link href="https://github.com/umerf23/Pactlance">
            Source and verification
          </Link>
        </footer>
      </main>
    </div>
  );
}
