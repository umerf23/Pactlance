export function GET() {
  return Response.json(
    {
      service: "pactlance",
      mode: "devnet-prototype",
      network: "devnet",
      devnetEscrowConfigured:
        !!process.env.NEXT_PUBLIC_ESCROW_PROGRAM_ID &&
        !!process.env.NEXT_PUBLIC_TEST_TOKEN_MINT,
      realMoneyPaymentsEnabled: false,
      revision: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      // Configuration/liveness only; use preflight for chain/deployment verification.
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
