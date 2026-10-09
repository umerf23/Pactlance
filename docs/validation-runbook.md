# Controlled devnet validation runbook

Do not close a gate without its actual evidence. TEST tokens have no monetary value. Use two independently controlled wallets, synthetic evidence and disposable devnet fee funding. Do not collect seeds, private keys or service credentials in the worksheet. Review the exact commit and deployment before testing.

## Record each attempt

| Field         | What to record                                                                    |
| ------------- | --------------------------------------------------------------------------------- |
| Build         | Git commit, deployment URL, date, wallet/provider/version and viewport            |
| Actor         | Anonymous role code; public wallet only with consent                              |
| Terms         | Project ID, version, bound commitment, program/mint/network                       |
| Action        | Intended state transition and expected authorization/deadline rule                |
| Result        | Actual UI/API/chain result; error text with secrets removed                       |
| Chain         | Signature, devnet Explorer link, finalized slot, original recipient balance delta |
| Evidence kind | Browser/live-chain, scripted-live-chain, LiteSVM, unit test, or simulation        |
| Decision      | Passed / failed / not run / blocked; issue and reproduction if failed             |

## Main browser journey (required)

1. In separate browser profiles, client and freelancer connect separate Solana wallets and sign in. Check network labels and wrong-account/sign-out behavior.
2. Create two milestones, review both wallets, deadlines, reviewer/backup and TEST mint. Record the same agreement version/commitment in both profiles. Off-chain message signatures are not on-chain acceptance.
3. Create the escrow and independently finalize both on-chain acceptances. Record both signatures and refresh from both profiles.
4. Fund milestone 1 for its exact TEST amount. Inspect the vault/program/mint. Attempt to fund milestone 2 while milestone 1 is active; record safe rejection.
5. Upload synthetic evidence, complete the hash/type check, submit its commitment on chain. Compare the saved manifest/commitment with finalized milestone state.
6. Approve as client. Record freelancer token balance before/after, exact amount and finalized payout signature. Try a second approval and confirm no second payout.
7. Fund and settle milestone 2. Confirm separate vault, correct order, exact payout, terminal state and history after reload in both profiles.

## Additional chain paths

Use independent synthetic projects for each case so a terminal transition cannot hide another result. Map to A01–A15 in `build-phases.md`.

- Before/exactly at/after funding, delivery and review boundaries, using chain time. Browser tests cannot manipulate chain time; shorter test fixtures must still respect program limits. Use LiteSVM to prove exact timestamps, then record eligible/ineligible live observations honestly.
- No delivery: only the client gets the refund; delivery after expiry fails. Submitted delivery: refund fails; timeout claim pays the fixed freelancer after review expiry.
- Dispute before expiry: approval/refund/timeout release fails. Outsider reviewer fails. Primary is exclusive before escalation; backup exclusive from escalation. Split total equals the recorded escrow obligation. Explain indefinite lock if nobody authorized acts.
- Mutual proposals: mismatched allocation, stale nonce, replay and missing second approval fail. Joint cancellation/revision requires both signatures and current version; active and settled history cannot be rewritten.
- Reload after signing/broadcast; lost response; RPC timeout/429; worker stopped across expiry; worker restart; two workers racing; missed/backfilled/duplicate events. Record exact signature/bytes recovery and finalized balances. Never replace an ambiguous pending transaction without expiry plus fresh finalized reconciliation.
- Evidence outsider/guessed ID denied; reviewer gets only assigned, current disputed milestone; support cannot fetch evidence or settle. Signed URL expires after 60 seconds. Test wrong-size/hash/MIME and immutable completed files.

## Wallet and browser checklist

For each claimed provider: Phantom and any compatible Solana Wallet Standard MetaMask provider must be tested separately. Ethereum-only MetaMask is unsupported. No mobile deep-link compatibility claim without observation.

At 375px, 768px and desktop check homepage, sign-in, empty projects, project editor, agreement, escrow, evidence, reviewer/support views and wallet dialog. Record screenshots with secrets/private details hidden.

Check Tab/Shift+Tab order, Enter/Space activation, focus visibility, field labels, heading hierarchy, contrast, error announcements, loading/success/pending/rejected/failed states, readable addresses and `document.documentElement.scrollWidth <= window.innerWidth`. Include long titles, addresses, validation errors and pending recovery packages. Automated checks do not establish human usability.

## Observed trials

Recruit at least five freelancers and two clients. Use anonymous participant codes and informed consent. Ask them to create/review a project, explain sequential funding and silent review release, identify reviewer authority, submit/view synthetic evidence and find payout history without coaching. Record completion, time, assistance, misunderstanding severity and exact feedback. Do not invent outcomes, savings or adoption.

## Scripts and limits

```sh
npm run check
npm run test:program
cargo-build-sbf --tools-version v1.56 --manifest-path contracts/programs/pactlance/Cargo.toml -- --locked
npm run test:escrow
npm run devnet:preflight -- --report validation-results/devnet-preflight.json
```

`npm run test:devnet` performs writes/spends devnet fees and mints TEST tokens with a configured authority. Run only when explicitly authorized. It writes public signatures and progress to `validation-results/devnet-workflow.json`; a failed run stays `in_progress`, not passed. Generated signers prove a program path, not the browser/Supabase/wallet journey. Review output before sharing. These reports are ignored by Git by default.

## Release and demo gates

Apply the quota migration before deploying this code. Run CI on the exact patch commit, check all steps, then smoke-test hosted sign-in, reads, edits, escrow refresh and evidence completion. Roll back the app if a quota RPC mismatch makes authenticated requests unavailable; keeping the new isolated counter table is safe.

Only record a complete live demo after the browser journey and relevant alternate paths have actual evidence. Until then, label the app an exploratory devnet prototype and identify which actions remain unverified. Before any real funds: independent security/source-to-deployment review, upgrade/key governance, operational monitoring/recovery drills, retention/deletion and applicable product/legal arrangements are separate gates.
