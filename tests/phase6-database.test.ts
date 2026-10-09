import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
const db = new PGlite();
const users = [1, 2, 3, 4, 5, 6].map(
  (n) => `00000000-0000-4000-8000-00000000000${n}`,
);
const wallets = [1, 2, 3, 4, 5, 6].map((n) =>
  Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58(),
);
const project = "10000000-0000-4000-8000-000000000001";
const evidence = "20000000-0000-4000-8000-000000000001";
const path = `${project}/${evidence}`;
async function user(n: number) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[n],
  ]);
}
async function admin() {
  await db.exec("reset role;set role service_role");
}
async function count(table: string) {
  return (await db.query(`select * from ${table}`)).rows.length;
}
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.identities(user_id uuid,provider text,provider_id text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated,service_role;grant all on storage.objects,storage.buckets to service_role;grant select,insert,update,delete on storage.objects to authenticated;`,
  );
  for (let i = 0; i < users.length; i++) {
    await db.query("insert into auth.users values($1)", [users[i]]);
    await db.query("insert into auth.identities values($1,'web3',$2)", [
      users[i],
      `web3:solana:${wallets[i]}`,
    ]);
  }
  for (const file of [
    "202610070001_phase3.sql",
    "20261007050111_private_auth_helpers.sql",
    "20261008045813_phase6_evidence_operations.sql",
    "20261008054824_phase7_reconciliation.sql",
    "20261008060103_phase7_worker_hardening.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await admin();
  for (const version of [1, 2])
    await db.query(
      "select public.save_agreement_version($1,$2,$3,$4::jsonb,$5,$6)",
      [
        project,
        wallets[0],
        version - 1,
        JSON.stringify({
          projectId: project,
          version,
          title: "Private project",
          network: "devnet",
          clientWallet: wallets[0],
          freelancerWallet: wallets[1],
          milestones: [{ sequence: 1 }, { sequence: 2 }],
        }),
        "a".repeat(64),
        String(version).repeat(64),
      ],
    );
  await db.query(
    `insert into milestone_cache(project_id,agreement_version,milestone_index,chain_address,state,amount_units,delivery_deadline,backup_at,reviewer_wallet,backup_reviewer_wallet,verified_at,finalized_slot) values($1,2,0,'chain','disputed','100',now(),now()+interval '1 hour',$2,$3,now(),1)`,
    [project, wallets[2], wallets[3]],
  );
  await db.query(
    `insert into evidence(id,project_id,agreement_version,milestone_index,uploader_wallet,purpose,title,kind,storage_path,filename,mime_type,byte_size,file_hash) values($1,$2,2,0,$3,'delivery','Delivery file','file',$4,'proof.txt','text/plain',4,$5)`,
    [evidence, project, wallets[1], path, "a".repeat(64)],
  );
  await db.query("insert into support_members values($1)", [users[5]]);
  await db.query(
    "insert into support_notes values('30000000-0000-4000-8000-000000000001',$1,$2,'Internal note',now())",
    [project, users[5]],
  );
}, 30000);
afterAll(() => db.close());
it("allows only registered uploader uploads and immutable completion", async () => {
  await user(0);
  await expect(
    db.query("insert into storage.objects values($1,$2)", [
      "pactlance-evidence",
      path,
    ]),
  ).rejects.toThrow(/row-level security/);
  await user(1);
  await db.query("insert into storage.objects values($1,$2)", [
    "pactlance-evidence",
    path,
  ]);
  await expect(
    db.query("insert into storage.objects values($1,$2)", [
      "pactlance-evidence",
      `${project}/unknown`,
    ]),
  ).rejects.toThrow(/row-level security/);
  await expect(db.exec("update evidence set title='Forged'")).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    db.query("select complete_evidence($1,$2,$3,$4,$5,$6)", [
      evidence,
      wallets[1],
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
      "{}",
    ]),
  ).rejects.toThrow(/permission denied/);
  await admin();
  await expect(
    db.query("select complete_evidence($1,$2,$3,$4,$5,$6)", [
      evidence,
      wallets[1],
      "f".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
      "{}",
    ]),
  ).rejects.toThrow(/file hash mismatch/);
  await db.query("select complete_evidence($1,$2,$3,$4,$5,$6)", [
    evidence,
    wallets[1],
    "a".repeat(64),
    "b".repeat(64),
    "c".repeat(64),
    "{}",
  ]);
  await expect(
    db.query("select complete_evidence($1,$2,$3,$4,$5,$6)", [
      evidence,
      wallets[1],
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
      "{}",
    ]),
  ).rejects.toThrow(/evidence unavailable/);
  await user(1);
  await db.exec(
    "update storage.objects set name='overwritten';delete from storage.objects",
  );
  expect(await count("storage.objects")).toBe(1);
});
it("isolates participants, exact dispute version and primary reviewer", async () => {
  for (const n of [0, 1]) {
    await user(n);
    expect(await count("evidence")).toBe(1);
    expect(await count("agreements")).toBe(2);
    expect(await count("storage.objects")).toBe(1);
  }
  await user(2);
  expect(await count("evidence")).toBe(1);
  expect(await count("agreements")).toBe(1);
  expect(await count("projects")).toBe(0);
  expect(await count("storage.objects")).toBe(1);
  for (const n of [3, 4, 5]) {
    await user(n);
    expect(await count("evidence")).toBe(0);
    expect(await count("agreements")).toBe(0);
    expect(await count("storage.objects")).toBe(0);
  }
});
it("revokes stale reviewer access and switches exclusively at backup boundary", async () => {
  await admin();
  await db.exec(
    "update milestone_cache set verified_at=now()-interval '3 minutes'",
  );
  await user(2);
  expect(await count("evidence")).toBe(0);
  expect(await count("agreements")).toBe(0);
  await admin();
  await db.exec("update milestone_cache set verified_at=now(),backup_at=now()");
  await user(2);
  expect(await count("evidence")).toBe(0);
  await user(3);
  expect(await count("evidence")).toBe(1);
  await admin();
  await db.exec(
    "update milestone_cache set state='settled',client_refunded='100'",
  );
  await user(3);
  expect(await count("evidence")).toBe(0);
  expect(await count("storage.objects")).toBe(0);
});
it("keeps support separate and receipts private; rejects fabricated cache and self-enrollment", async () => {
  await user(4);
  await expect(
    db.query("insert into support_members values($1)", [users[4]]),
  ).rejects.toThrow(/permission denied/);
  expect(await count("support_notes")).toBe(0);
  await expect(
    db.exec("update milestone_cache set state='funded'"),
  ).rejects.toThrow(/permission denied/);
  await db.query(
    "insert into notification_receipts(user_id,notice_key) values($1,$2)",
    [users[4], "f".repeat(64)],
  );
  await expect(
    db.query(
      "insert into notification_receipts(user_id,notice_key) values($1,$2)",
      [users[0], "e".repeat(64)],
    ),
  ).rejects.toThrow(/row-level security/);
  await user(5);
  expect(await count("support_notes")).toBe(1);
  expect(await count("notification_receipts")).toBe(0);
  expect(await count("evidence")).toBe(0);
  await db.exec("reset role;set role anon");
  await expect(db.exec("select * from evidence")).rejects.toThrow(
    /permission denied/,
  );
});
function chainSnapshot(slot: number) {
  const a = {
    terms: {
      projectId: project,
      version: 2,
      escrowProgram: wallets[4],
      token: { mint: wallets[5] },
      reviewerWallet: wallets[2],
      backupReviewerWallet: wallets[3],
    },
    commitment: "2".repeat(64),
  };
  return {
    slot,
    bindings: [a],
    agreement: a,
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
        agreementVersion: 2,
        chainAddress: "verified-chain",
        status: 1,
        amount: "100",
        clientRefunded: "0",
        freelancerPaid: "0",
        deliveryDeadline: "2000000000",
        reviewDeadline: "0",
        backupAt: "0",
        submissionCommitment: null,
        disputeCommitment: null,
      },
    ],
  };
}
it("keeps reconciliation slot-ordered and deployment bindings immutable", async () => {
  await admin();
  const run = (s: unknown) =>
    db.query<{ reconcile_escrow: boolean }>(
      "select reconcile_escrow($1,$2::jsonb)",
      [project, JSON.stringify(s)],
    );
  expect((await run(chainSnapshot(200))).rows[0].reconcile_escrow).toBe(true);
  expect((await run(chainSnapshot(199))).rows[0].reconcile_escrow).toBe(false);
  const changed = chainSnapshot(201);
  changed.bindings[0].commitment = "b".repeat(64);
  await expect(run(changed)).rejects.toThrow(/immutable binding conflict/);
  const rebound = chainSnapshot(201);
  rebound.agreement.terms.escrowProgram = wallets[3];
  await expect(run(rebound)).rejects.toThrow(
    /deployment binding cannot change/,
  );
  expect(
    (
      await db.query<{ finalized_slot: number }>(
        "select finalized_slot from project_chain_cache where project_id=$1",
        [project],
      )
    ).rows[0].finalized_slot,
  ).toBe(200);
});
it("denies browser outbox/cursor access and privileged reconciliation", async () => {
  await user(0);
  expect(await count("escrow_bindings")).toBe(1);
  for (const table of ["claim_outbox", "reconciliation_cursors"])
    await expect(db.exec(`select * from ${table}`)).rejects.toThrow(
      /permission denied/,
    );
  await expect(
    db.query("select reconcile_escrow($1,$2::jsonb)", [
      project,
      JSON.stringify(chainSnapshot(201)),
    ]),
  ).rejects.toThrow(/permission denied/);
  await user(4);
  expect(await count("escrow_bindings")).toBe(0);
});
it("advances history cursors using compare-and-swap without stale regression", async () => {
  await admin();
  const move = (
    expected: string | null,
    before: string | null,
    next: string | null,
    scan: string | null,
    head: string | null,
  ) =>
    db.query<{ advance_history_cursor: boolean }>(
      "select advance_history_cursor($1,$2,$3,$4,$5,$6)",
      [project, expected, before, next, scan, head],
    );
  expect(
    (await move(null, null, null, "page-1", "head-1")).rows[0]
      .advance_history_cursor,
  ).toBe(true);
  expect(
    (await move(null, null, "stale", null, null)).rows[0]
      .advance_history_cursor,
  ).toBe(false);
  expect(
    (await move(null, "page-1", "head-1", null, null)).rows[0]
      .advance_history_cursor,
  ).toBe(true);
  expect(
    (
      await db.query<{ last_signature: string }>(
        "select last_signature from reconciliation_cursors where project_id=$1",
        [project],
      )
    ).rows[0].last_signature,
  ).toBe("head-1");
});
