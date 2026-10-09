# Phase 4 — sequential milestone escrow

Status: Phase 4 contract and client implementation verified locally. Not deployed; no payment UI is enabled.

## Implemented contract instructions

- `initialize_config`: only the deployed program’s upgrade authority can set the immutable six-decimal test mint once.
- `create_project`: records the client, freelancer, test mint, agreement commitment and version, reviewers, review/escalation periods, and an ordered schedule of up to 20 milestones. Only a participant can create it. The project PDA uses client + project UUID; changing a version cannot create a second escrow under the same project identity.
- `accept_project`: each participant signs on chain against the stored agreement commitment. Phase 3 signatures alone cannot authorize funding. Client code must compare every stored field with the reviewed agreement before asking for acceptance; the program stores the opaque off-chain commitment and cannot interpret private scope text.
- `fund_milestone`: the client transfers the recorded integer amount using the classic SPL Token program. Mint and source authority are constrained. Creates a milestone PDA and separate vault PDA; the writable project account serializes competing funding attempts.
- `submit_delivery`: the freelancer records a nonzero salted evidence commitment once before the delivery deadline. No private link or file is published on chain. Review expiry uses chain time.
- `approve_milestone`: client approval pays the recorded amount to a token account owned by the original freelancer, then marks settlement and advances the project sequence in the same transaction. Unsolicited deposits do not increase the obligation; excess-token recovery is deferred.

The accepted project mint must match the immutable global configuration and have six decimals. Configuration initialization checks the deployed program’s ProgramData and upgrade authority. Token-2022 support is compiled only to satisfy Anchor account-derive dependencies; the instruction accounts restrict invocation to the classic Token program.

## Client integration

`src/lib/escrow/terms.ts` binds the reviewed agreement to the actual program and mint addresses and computes a new salted commitment with schema version 2. Phase 3 acceptance cannot authorize funding. `src/lib/escrow/client.ts` derives PDAs, encodes exact integer amounts, constructs participant instructions and verifies every stored project term before acceptance or funding.

The declared local-test program address is `3oh6fZaHMsHY176Kbb2LGRsqW1nRq7UBpJaWirMNioxP`. It is not deployed on devnet. Generate your own deployment keypair and update the program ID, Anchor configuration and generated IDL together before deployment. Private keys are excluded from Git.

## Verification

The restored application/client suite passes all 30 tests and the native contract suite passes all seven tests. ESLint, TypeScript checking, Rust formatting and the Next.js production build pass. The SBF program compiles successfully and all seven LiteSVM transaction tests pass. Coverage includes restricted configuration, missing/stale acceptance, unauthorized signers, substituted mint/program/vault/recipient accounts, duplicate and out-of-order funding, duplicate submission and payout, exact deadline boundaries and two sequential settlements. Each payout transfers exactly 250,000,000 base units. A seven-unit donation remains in the first vault and does not inflate payment.

`contracts/idl/pactlance.json` was generated and validated with Anchor's IDL builder. It contains all six instructions. Regenerate it with Anchor 0.32.2 using `anchor idl build` from the `contracts` directory, then copy its output into the committed IDL path.

The runtime CI job has been added; local success does not imply the GitHub Actions job has run yet.

Reproduce with Node 24, Rust 1.90.0, Agave 2.3.0 and platform-tools v1.56:

```sh
npm ci
npm run check
cargo +1.90.0 test --manifest-path contracts/Cargo.toml --locked
cargo-build-sbf --tools-version v1.56 --manifest-path contracts/programs/pactlance/Cargo.toml -- --locked
npm run test:escrow
```

LiteSVM 1.5.0 is pinned. The test harness uses its internal legacy-transaction API for compatibility with web3.js. It sets ProgramData's upgrade authority as a deployment fixture; all escrow and token state is created through transactions. Tests fail if the compiled binary is absent. These checks run in an in-process Solana runtime; they do not verify devnet or browser wallets. A separate runtime CI job builds the program and executes this suite.

## Later phases

Phase 5 adds timeout claims, refunds, disputes, reviewer settlement, mutual cancellation and accepted revisions for expired future deadlines. Excess-token recovery is also deferred. Use only disposable local test tokens until those protections exist. Phase 7 adds devnet deployment, reconciliation and the hosted flow. Vercel deployment remains paused.
