# Development setup

## Web

Node 24.19.0 and npm 11.9.0. Dependencies are pinned exactly in package.json;
package-lock.json pins the transitive dependency graph. `npm ci` reproduces the install.
The preview intentionally runs without Supabase credentials, wallet extensions or RPC requests.

## Program

Selected baseline: Rust 1.90.0 (native tests), Anchor CLI/crate 0.32.2, Solana CLI 2.3.0.
The SBF toolchain's bundled compiler is managed separately by Solana tooling.

Official references checked during setup:

- https://www.anchor-lang.com/docs/updates/release-notes/0-32-2
- https://www.anchor-lang.com/docs/clients/typescript
- https://www.anchor-lang.com/docs/installation
- https://nextjs.org/docs/app/getting-started/installation

Install Rust through https://rustup.rs, use the official Solana installation route,
and install the selected Anchor release through AVM. On Windows use WSL2 for the
contract toolchain. `npm run doctor` reports tools without reading wallet files or secrets.

```sh
cd contracts
cargo test --workspace --locked
# With Anchor and Solana installed:
anchor build
anchor keys sync
anchor build
```

A first build may generate a local program keypair. `anchor keys sync` updates the
scaffold ID to that generated identity; rebuild before deploying. Local wallet setup
and validator transactions belong in a controlled local test environment. Do not
use real-money keys or deploy the scaffold to mainnet.

The initial CI jobs validate the web app and native Rust program tests. They do not
claim validator integration coverage or a successful devnet deployment.

## Configuration and secrets

`.env.example` documents the intended variables. `.env.local`, target directories,
ledger data and keypairs are ignored. Only public endpoint/anonymous client values
may use NEXT_PUBLIC_. Service-role keys stay server-side. The development preview
has payments disabled and no action signs or submits a transaction.

## Phase 3 integration boundary

Add wallet authentication and Supabase only once configuration is supplied through
local environment variables. Use server-verified sessions and database/storage policies;
a connected wallet or a guessed project ID must not confer private data access.
