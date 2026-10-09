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
        <p className="eyebrow">BEFORE YOU FUND A MILESTONE</p>
        <h1>Your work. Your payment rules.</h1>
        <p className="subtitle">
          Use a compatible Solana wallet with devnet SOL for fees. TEST tokens
          are test assets, not USDC or money.
        </p>
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
            records acceptance of that document; it does not deposit tokens.
            Create the escrow, then both participants accept the program-bound
            terms on chain before funding.
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
            delivery link, and submits its commitment before the delivery
            deadline.
          </p>
          <p>
            Saving a file alone does not submit the milestone on chain. The
            client reviews the evidence, then approves payment or opens an
            eligible dispute before the review deadline. A hash verifies bytes,
            not quality or authorship.
          </p>
        </section>
        <section className="workspace-card">
          <h2>4. Understand alternate outcomes</h2>
          <dl className="term-list">
            <div>
              <dt>No client response</dt>
              <dd>
                After review expiry, an eligible claim pays the fixed freelancer
                recipient if no dispute is open. A user or worker must submit
                the transaction.
              </dd>
            </div>
            <div>
              <dt>No recorded delivery</dt>
              <dd>
                At or after the delivery deadline, the client can request an
                eligible non-delivery refund.
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
            transaction before requesting another signature. Refresh reads chain
            state and does not ask for a wallet signature. The program prevents
            duplicate settlement. Verify finalized history and recipient
            balances before calling a payment complete.
          </p>
          <p>
            The database and private storage can become unavailable. Keep the
            accepted terms and public transaction references. The program is
            upgradeable; its upgrade authority remains a trust dependency.
          </p>
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
