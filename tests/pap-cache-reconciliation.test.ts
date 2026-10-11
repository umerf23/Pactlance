import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

it("reconciles timerless PAP delivery while preserving legacy deadlines and settlement checks", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated,service_role;
      grant execute on function auth.uid() to authenticated;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to anon,authenticated,service_role;
      grant all on storage.objects,storage.buckets to service_role;
      grant select,insert,update,delete on storage.objects to authenticated;`);

    const migration = "20261011074159_pap_submitted_cache.sql";
    for (const f of readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && f < migration)
      .sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    const ids = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
    ];
    const snapshots = ids.map((id, i) => {
      const terms = {
        projectId: id,
        version: 1,
        network: "devnet",
        title: "Cache regression",
        clientWallet: "client",
        freelancerWallet: "freelancer",
        reviewerWallet: "reviewer",
        backupReviewerWallet: "backup",
        escrowProgram: "program",
        token: { mint: "mint" },
        milestones: [{ sequence: 1 }],
        ...(i === 0 ? { protocol: { schemaVersion: 1 } } : {}),
      };
      const binding = { terms, commitment: "a".repeat(64) };
      return {
        slot: 100,
        bindings: [binding],
        agreement: binding,
        state: {
          clientAccepted: true,
          freelancerAccepted: true,
          next: 0,
          active: true,
          cancelled: false,
        },
        milestones: [
          {
            index: 0,
            agreementVersion: 1,
            chainAddress: `chain-${i}`,
            status: 1,
            amount: "250000000",
            clientRefunded: "0",
            freelancerPaid: "0",
            deliveryDeadline: "2000000000",
            reviewDeadline: "0",
            backupAt: "0",
            submissionCommitment: "b".repeat(64),
            disputeCommitment: "0".repeat(64),
          },
        ],
      };
    });
    for (const s of snapshots) {
      const id = s.agreement.terms.projectId;
      await db.query(
        "insert into public.projects(id,title,client_wallet,freelancer_wallet,current_version) values($1,'Cache regression','client','freelancer',1)",
        [id],
      );
      await db.query(
        "insert into public.agreements(project_id,version,terms,salt,commitment) values($1,1,$2::jsonb,$3,$3)",
        [id, JSON.stringify(s.agreement.terms), "a".repeat(64)],
      );
    }
    await db.exec("set role service_role");
    const reconcile = (s: (typeof snapshots)[number]) =>
      db.query("select public.reconcile_escrow($1,$2::jsonb)", [
        s.agreement.terms.projectId,
        JSON.stringify(s),
      ]);
    for (const s of snapshots) await reconcile(s);
    const pap = snapshots[0];
    pap.slot = 101;
    pap.milestones[0].status = 2;
    // The exact production failure: PAP's on-chain reviewDeadline is zero.
    await expect(reconcile(pap)).rejects.toThrow(/milestone_cache_check2/);
    await db.exec("reset role");
    await db.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    expect(
      (
        await db.query(
          "select is_pap from public.milestone_cache order by project_id",
        )
      ).rows,
    ).toEqual([{ is_pap: true }, { is_pap: false }]);
    await db.exec("set role service_role");
    await reconcile(pap);
    expect(
      (
        await db.query(
          "select state,review_deadline,is_pap from public.milestone_cache where project_id=$1",
          [ids[0]],
        )
      ).rows,
    ).toEqual([{ state: "submitted", review_deadline: null, is_pap: true }]);
    // Covers the fresh INSERT path, not just ON CONFLICT updates/backfill.
    await db.query("delete from public.milestone_cache where project_id=$1", [
      ids[0],
    ]);
    await reconcile(pap);
    const legacy = snapshots[1];
    legacy.slot = 101;
    legacy.milestones[0].status = 2;
    await expect(reconcile(legacy)).rejects.toThrow(
      /milestone_cache_review_deadline/,
    );
    legacy.milestones[0].reviewDeadline = "2000001000";
    await reconcile(legacy);
    const stale = structuredClone(pap);
    stale.slot = 99;
    stale.milestones[0].status = 1;
    await reconcile(stale);
    expect(
      (
        await db.query(
          "select state from public.milestone_cache where project_id=$1",
          [ids[0]],
        )
      ).rows,
    ).toEqual([{ state: "submitted" }]);
    const forged = structuredClone(pap);
    forged.slot = 102;
    delete (forged.agreement.terms as { protocol?: unknown }).protocol;
    await expect(reconcile(forged)).rejects.toThrow(
      /immutable binding conflict/,
    );
    pap.slot = 102;
    pap.milestones[0].status = 3;
    await expect(reconcile(pap)).rejects.toThrow(/milestone_cache_check1/);
    pap.milestones[0].freelancerPaid = "250000000";
    await reconcile(pap);
    expect(
      (
        await db.query(
          "select state,freelancer_paid from public.milestone_cache where project_id=$1",
          [ids[0]],
        )
      ).rows,
    ).toEqual([{ state: "settled", freelancer_paid: "250000000" }]);
    await db.exec("reset role;set role authenticated");
    await expect(reconcile(pap)).rejects.toThrow(/permission denied/);
  } finally {
    await db.close();
  }
}, 30000);
