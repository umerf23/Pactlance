import { failure, json, requireWallet } from "@/lib/api";
import { publicSupabaseConfig } from "@/lib/supabase/config";
export async function GET() {
  if (!publicSupabaseConfig() || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return json({ configured: false, user: null });
  try {
    const { userId, wallet } = await requireWallet();
    return json({ configured: true, user: { id: userId, wallet } });
  } catch (e) {
    return failure(e);
  }
}
