import { it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/escrow/server/reconcile", () => ({
  reconcileProject: f.reconcile,
  reconcileHistory: vi.fn(),
}));
vi.mock("../src/lib/supabase/server", () => ({
  adminSupabase: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        order: () => q,
        range: async () => ({
          data: [{ id: "pap", current_version: 2 }],
          error: null,
        }),
        eq: () => q,
        maybeSingle: async () => ({
          data:
            table === "agreements"
              ? { terms: { protocol: { execution: "offchain_workflow" } } }
              : null,
          error: null,
        }),
      };
      return q;
    },
  }),
}));
import { runWorker } from "../src/lib/escrow/server/worker";
it("does not send PAP projects to the legacy escrow claim worker", async () => {
  expect(await runWorker()).toEqual([
    { projectId: "pap", reconciled: false, claims: "pap_offchain_workflow" },
  ]);
  expect(f.reconcile).not.toHaveBeenCalled();
});
