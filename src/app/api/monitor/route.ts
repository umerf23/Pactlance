import { failure, json } from "@/lib/api";
import { requireOperator } from "@/lib/operations/server/authorization";
import { operationalHealth } from "@/lib/operations/server/health";
export async function GET(request: Request) {
  try {
    requireOperator(request);
    const health = await operationalHealth();
    return json(health, health.status === "unavailable" ? 503 : 200);
  } catch (error) {
    return failure(error);
  }
}
