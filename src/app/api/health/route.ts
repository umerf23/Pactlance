export function GET() {
  return Response.json({
    service: "pactlance",
    phase: 3,
    mode: "preview",
    paymentsEnabled: false,
  });
}
