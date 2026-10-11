import Link from "next/link";
export default function GuidePage() {
  return (
    <div className="dapp-workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header>
        <Link className="brand" href="/">
          pactlance.
        </Link>
        <Link className="primary" href="/workspace">
          Open workspace
        </Link>
      </header>
      <main className="workspace-content guide-page" id="main-content">
        <p className="eyebrow">HELP & PAYMENT RULES</p>
        <h1>Know what to do at every step.</h1>
        <p className="subtitle">
          Use a compatible Solana wallet with devnet SOL for fees. TEST tokens
          are test assets, not USDC or money.
        </p>
        <section className="workspace-card">
          <h2>Choose your role</h2>
          <div className="landing-columns">
            <div>
              <h3>I’m a client</h3>
              <ol className="rules-list">
                <li>
                  Create or open the shared agreement and accept the terms.
                </li>
                <li>
                  Confirm payment terms in your wallet and fund the next
                  milestone.
                </li>
                <li>Review submitted work and give feedback.</li>
                <li>
                  Accept the work, then approve the separate wallet payment.
                </li>
              </ol>
              <Link className="secondary" href="/workspace?role=client">
                Open client workspace →
              </Link>
            </div>
            <div>
              <h3>I’m a freelancer</h3>
              <ol className="rules-list">
                <li>
                  Accept the agreement with the wallet named in its terms.
                </li>
                <li>
                  Confirm payment terms and verify funding before starting.
                </li>
                <li>
                  Start work, upload files or links, and submit the required
                  delivery.
                </li>
                <li>
                  Record the validated delivery in escrow and track client
                  payment.
                </li>
              </ol>
              <Link className="secondary" href="/workspace?role=freelancer">
                Open freelancer workspace →
              </Link>
            </div>
            <div>
              <h3>I’m a reviewer</h3>
              <p>
                Sign in with the named reviewer wallet. Assigned disputes appear
                in Activity. Inspect acceptance criteria and private evidence
                before allocating funds. Primary authority switches to the
                backup at the agreed escalation time.
              </p>
            </div>
          </div>
        </section>
        <section className="workspace-card">
          <h2>1. Create and share the agreement</h2>
          <p>
            Choose your role, enter the other participant’s Solana address and
            define each deliverable and its acceptance criteria. Name two
            distinct reviewers who have agreed to serve. Agree with them on
            availability, response time and any fee outside the app; Pactlance
            does not recruit or pay reviewers.
          </p>
          <p>
            Save the project and share its workspace link. Only the participant
            wallets can open the private agreement. A copied link does not grant
            access.
          </p>
        </section>
        <section className="workspace-card">
          <h2>2. Accept the deployed payment terms</h2>
          <p>
            Review the scope, TEST amount, funding and delivery deadlines,
            review period, and reviewers. An off-chain agreement signature
            records acceptance of that document; it does not deposit tokens. In
            Payments, choose Set up secure payment. Both people then use Confirm
            payment terms in wallet before the client adds funds. If structured
            rules (PAP) are enabled, activate the jointly accepted version in
            Work & delivery first.
          </p>
          <p>
            Sign-in proves wallet ownership. Agreement signatures accept terms.
            Transaction signatures authorize the specific on-chain action shown.
            Reject a prompt labelled Solana mainnet.
          </p>
        </section>
        <section className="workspace-card">
          <h2>3. Fund, deliver and review</h2>
          <p>
            The client funds the exact next milestone with the configured TEST
            token and pays the transaction’s devnet SOL fee. The freelancer
            verifies funding before starting, uploads private evidence or a
            delivery link, and submits the delivery before the deadline.
          </p>
          <p>
            Saving a file alone does not submit the milestone on chain. The
            client reviews the evidence, then approves payment or opens an
            eligible dispute before the review deadline. A hash verifies bytes,
            not quality or authorship.
          </p>
          <p>
            For structured PAP agreements, start the milestone, save
            attachments, select them for every required deliverable, then choose
            Submit work for review. Saving a file alone does not submit it. The
            client accepts work or requests an available revision. Revisions do
            not extend the original delivery or review deadline.
          </p>
          <p>
            The freelancer records the validated delivery in Payments. The
            client then chooses Approve and pay freelancer when eligible.
            Accepting work does not send tokens: payment is a separate
            authorized wallet transaction. Only verified finalized settlements
            are marked paid.
          </p>
        </section>
        <section className="workspace-card">
          <h2>4. Understand alternate outcomes</h2>
          <p>
            Open Resolve a problem in Work & delivery or Payments. Available
            actions depend on your role, agreement, deadlines, and current
            status.
          </p>
          <dl className="term-list">
            <div>
              <dt>Agreed payment split</dt>
              <dd>
                Propose the exact client refund and freelancer payment. Both
                people must accept the same recorded proposal, then authorize
                Send agreed payment split. Editing the refund field does not
                change an existing proposal.
              </dd>
            </div>
            <div>
              <dt>No client response</dt>
              <dd>
                PAP may require human review or establish payment eligibility
                according to the accepted rules. Its timers never transfer
                funds; a wallet must authorize payment. For basic agreements
                without PAP, an eligible claim pays the fixed freelancer after
                review expiry if no dispute is open. A user or worker must
                submit the transaction.
              </dd>
            </div>
            <div>
              <dt>No recorded delivery</dt>
              <dd>
                PAP deadline rules can propose a refund or require review,
                followed by an authorized allocation. In a basic agreement
                without PAP, the client can request an eligible non-delivery
                refund at or after the delivery deadline if no dispute is open.
              </dd>
            </div>
            <div>
              <dt>Dispute</dt>
              <dd>
                Ordinary payout stops. Before backup activation only the primary
                reviewer is eligible; afterwards only the backup is eligible.
                Parties can also authorize the same mutual settlement.
              </dd>
            </div>
            <div>
              <dt>Unavailable reviewers</dt>
              <dd>
                If both reviewers and participants never act, funds can remain
                locked indefinitely. There is no guaranteed resolution service
                or automatic judgment of work.
              </dd>
            </div>
            <div>
              <dt>Changed future scope</dt>
              <dd>
                Funded terms cannot silently change. Future-work revision or
                cancellation requires the prescribed joint authorization.
              </dd>
            </div>
          </dl>
        </section>
        <section className="workspace-card">
          <h2>5. Recover without paying twice</h2>
          <p>
            If a transaction’s outcome is unknown, recover the saved signed
            transaction using Check pending transaction before requesting
            another signature. Refresh payment status reads chain state and does
            not ask for a wallet signature. The program prevents duplicate
            settlement. Verify finalized history and recipient balances before
            calling a payment complete.
          </p>
          <p>
            The database and private storage can become unavailable. Keep the
            accepted terms and public transaction references. The program is
            upgradeable; its upgrade authority remains a trust dependency.
          </p>
        </section>
        <section className="workspace-card">
          <h2>A few terms, in plain language</h2>
          <dl className="term-list">
            <div>
              <dt>Escrow</dt>
              <dd>
                Payment held for a milestone until an agreed authorization
                releases or refunds it.
              </dd>
            </div>
            <div>
              <dt>Milestone</dt>
              <dd>
                A batch of work with its own amount, requirements, and
                deadlines.
              </dd>
            </div>
            <div>
              <dt>PAP</dt>
              <dd>
                Programmable Agreement Protocol: structured delivery, evidence,
                review, revision, and payment eligibility rules.
              </dd>
            </div>
            <div>
              <dt>Finalized</dt>
              <dd>
                A chain transaction checked at the finalized confirmation level.
              </dd>
            </div>
            <div>
              <dt>Fingerprint / commitment</dt>
              <dd>
                A verification value linking exact agreement terms or evidence
                to the recorded version. Available in Technical details.
              </dd>
            </div>
          </dl>
        </section>
        <section className="workspace-card">
          <h2>What is available today?</h2>
          <p>
            The application provides agreements, devnet escrow actions, evidence
            and assigned reviewer tools. Card funding, real stablecoin payments,
            PKR cash-out and guaranteed dispute services are future work.
            Customer research and complete live verification are still required
            before a real-money launch.
          </p>
          <Link className="primary" href="/workspace">
            Continue to workspace
          </Link>
        </section>
      </main>
    </div>
  );
}
