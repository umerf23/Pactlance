# Phase 4 — sequential milestone escrow

Status: contract implementation in progress. Not deployed; no payment UI is enabled.

## Implemented contract instructions

- `initialize_config`: only the deployed program’s upgrade authority can set the immutable six-decimal test mint once.
- `create_project`: records the client, freelancer, test mint, agreement commitment and version, reviewers, review/escalation periods, and an ordered schedule of up to 32 milestones. Only a participant can create it. The project PDA uses client + project UUID; changing a version cannot create a second escrow under the same project identity.
- `accept_project`: each participant signs on chain against the stored agreement commitment. Phase 3 signatures alone cannot authorize funding. Client code must compare every stored field with the reviewed agreement before asking for acceptance; the program stores the opaque off-chain commitment and cannot interpret private scope text.
- `fund_milestone`: the client transfers the recorded integer amount using the classic SPL Token program. Mint and source authority are constrained. Creates a milestone PDA and separate vault PDA; the writable project account serializes competing funding attempts.
- `submit_delivery`: the freelancer records a nonzero salted evidence commitment once before the delivery deadline. No private link or file is published on chain. Review expiry uses chain time.
- `approve_milestone`: client approval pays the recorded amount to a token account owned by the original freelancer, then marks settlement and advances the project sequence in the same transaction. Unsolicited deposits do not increase the obligation; excess-token recovery is deferred.

The accepted project mint must match the immutable global configuration and have six decimals. Configuration initialization checks the deployed program’s ProgramData and upgrade authority. Token-2022 support is compiled only to satisfy Anchor account-derive dependencies; the instruction accounts restrict invocation to the classic Token program.

## Remaining Phase 4 gates

- Generate and validate the IDL and client account decoding/instruction builders.
- Execute token transfers and adversarial transactions in a Solana runtime: wrong participant, wrong mint/program/vault/recipient, missing acceptance, simultaneous funding, duplicate delivery and duplicate payout, and milestone 1 settlement followed by milestone 2 funding.
- Bind the on-chain agreement to the full reviewed Phase 3 terms, including actual program and mint addresses. Fresh signatures are required.
- Record full transaction-level test evidence before claiming Phase 4 complete.

The current program ID remains the foundation placeholder. Phase 5 adds timeout claims, refunds, disputes, reviewer settlement, mutual cancellation and accepted revisions for expired future deadlines. Until those protections are implemented and tested, use only disposable local test tokens. Phase 7 adds devnet deployment, reconciliation, and the complete hosted flow.

## Validation so far

The final contract compiles with Rust 1.90.0 and Anchor 0.32.2. All seven native tests pass, including acceptance, sequencing, deadline and participant-validation cases. Rust formatting passes. Native tests do not execute token CPIs; the SBF build and runtime integration remain pending.
