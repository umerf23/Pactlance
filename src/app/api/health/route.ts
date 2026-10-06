export function GET() {
  return Response.json({
    service: "pactlance",
    phase: 2,
    mode: "preview",
    paymentsEnabled: false,
  });
}
