import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { terms, project, wallets } from "./pap-fixture";
import { transition } from "../src/lib/pap/engine";
const db = new PGlite(),
  users = wallets.map((_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`),
  key = "20000000-0000-4000-8000-000000000001",
  t = terms();
const state = transition(
  t,
  null,
  {
    projectId: project,
    version: 1,
    expectedRevision: 0,
    idempotencyKey: key,
    action: "activate",
    reason: "Both signatures verified",
  },
  {
    now: "2026-10-09T00:00:00.000Z",
    actor: wallets[0],
    bothAccepted: true,
    evidence: {},
  },
).state;
async function admin() {
  await db.exec("reset role;set role service_role");
}
async function user(i: number) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[i],
  ]);
}
async function commit(
  revision: number,
  k = key,
  hash = "b".repeat(64),
  next = state,
  action = "activate",
  actor = wallets[0],
  version = 1,
) {
  return db.query<{
    result: { state: unknown; revision: number; duplicate: boolean };
  }>(
    "select public.commit_pap_transition($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb) as result",
    [
      project,
      actor,
      version,
      revision,
      k,
      hash,
      action,
      JSON.stringify(next),
      "Verified protocol transition",
      "[]",
    ],
  );
}
async function save(version: number, change: Record<string, unknown> = {}) {
  return db.query(
    "select public.save_agreement_version($1,$2,$3,$4::jsonb,$5,$6)",
    [
      project,
      wallets[0],
      version - 1,
      JSON.stringify({ ...t, ...change, version }),
      "a".repeat(64),
      "c".repeat(64),
    ],
  );
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
    "20261009111636_programmable_agreements.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await admin();
  await save(1);
}, 30000);
afterAll(() => db.close());
it("activation atomically rejects missing consent", async () => {
  await expect(commit(0)).rejects.toThrow(/Both signatures/);
  expect(
    (await db.query("select * from public.agreement_transitions")).rows,
  ).toHaveLength(0);
  for (const w of wallets.slice(0, 2))
    await db.query(
      "select public.record_agreement_acceptance($1,$2,1,$3,$4,$5)",
      [project, w, "c".repeat(64), "Exact agreement consent", "1".repeat(87)],
    );
  expect((await commit(0)).rows[0].result.revision).toBe(1);
});
it("deduplicates identical retries and rejects mismatched keys", async () => {
  expect((await commit(0)).rows[0].result.duplicate).toBe(true);
  expect(
    (await db.query("select * from public.agreement_transitions")).rows,
  ).toHaveLength(1);
  await expect(commit(0, key, "d".repeat(64))).rejects.toThrow(/Idempotency/);
});
it("permits one winner for simultaneous stale writes", async () => {
  const results = await Promise.allSettled([
    commit(
      1,
      "20000000-0000-4000-8000-000000000002",
      "d".repeat(64),
      state,
      "evaluate",
    ),
    commit(
      1,
      "20000000-0000-4000-8000-000000000003",
      "e".repeat(64),
      state,
      "evaluate",
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
});
it("keeps consent, versions and transitions append-only", async () => {
  for (const table of [
    "agreement_transitions",
    "agreements",
    "agreement_acceptances",
  ])
    await expect(
      db.query(`delete from public.${table} where project_id=$1`, [project]),
    ).rejects.toThrow(/append-only/);
});
it("isolates reads and denies browser execution writes", async () => {
  await user(0);
  expect(
    (await db.query("select * from public.agreement_execution")).rows,
  ).toHaveLength(1);
  await expect(
    commit(2, "20000000-0000-4000-8000-000000000004"),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query("update public.agreement_execution set revision=100"),
  ).rejects.toThrow(/permission denied/);
  await user(4);
  expect(
    (await db.query("select * from public.agreement_execution")).rows,
  ).toHaveLength(0);
  expect(
    (await db.query("select * from public.agreement_transitions")).rows,
  ).toHaveLength(0);
  await admin();
});
it("protects accepted terms and cannot downgrade active PAP", async () => {
  const next = structuredClone(state);
  next.milestones[0] = {
    state: "PAYMENT_PENDING",
    revisions: 0,
    acceptedAt: "2026-10-09T00:00:00.000Z",
  };
  next.status = "COMPLETED";
  await commit(
    2,
    "20000000-0000-4000-8000-000000000005",
    "f".repeat(64),
    next,
    "accept",
  );
  await expect(
    save(2, { milestones: [{ ...t.milestones[0], amountUnits: "1" }] }),
  ).rejects.toThrow(/Completed milestone/);
  await expect(save(2, { protocol: null })).rejects.toThrow(/downgrade/);
  await save(2, { title: "Amendment title" });
  expect(
    (
      await db.query<{ active_version: number }>(
        "select active_version from public.agreement_execution",
      )
    ).rows[0].active_version,
  ).toBe(1);
  await expect(
    commit(
      3,
      "20000000-0000-4000-8000-000000000006",
      "a".repeat(64),
      { ...next, version: 2 },
      "activate",
      wallets[0],
      2,
    ),
  ).rejects.toThrow(/Both signatures/);
});
it("authorizes only the exclusive active reviewer", async () => {
  const disputed = structuredClone(state);
  disputed.status = "DISPUTED";
  disputed.milestones[0] = {
    state: "DISPUTED",
    revisions: 0,
    disputedAt: new Date().toISOString(),
  };
  await commit(
    3,
    "20000000-0000-4000-8000-000000000007",
    "1".repeat(64),
    disputed,
    "dispute",
  );
  await user(2);
  expect((await db.query("select * from public.agreements")).rows).toHaveLength(
    1,
  );
  await user(3);
  expect((await db.query("select * from public.agreements")).rows).toHaveLength(
    0,
  );
  await admin();
  await expect(
    commit(
      4,
      "20000000-0000-4000-8000-000000000008",
      "2".repeat(64),
      disputed,
      "resolve",
      wallets[3],
    ),
  ).rejects.toThrow(/unauthorized/);
  const expired = {
    ...disputed,
    milestones: [
      {
        ...disputed.milestones[0],
        disputedAt: new Date(Date.now() - 25 * 3600000).toISOString(),
      },
    ],
  };
  await commit(
    4,
    "20000000-0000-4000-8000-000000000009",
    "3".repeat(64),
    expired,
    "dispute",
  );
  await user(2);
  expect((await db.query("select * from public.agreements")).rows).toHaveLength(
    0,
  );
  await user(3);
  expect((await db.query("select * from public.agreements")).rows).toHaveLength(
    1,
  );
});
it("restricts reviewer evidence and files to the disputed milestone", async () => {
  await admin();
  for (const index of [0, 1]) {
    const id = `30000000-0000-4000-8000-00000000000${index + 1}`,
      path = `${project}/${id}`;
    await db.query(
      "insert into public.evidence(id,project_id,agreement_version,milestone_index,uploader_wallet,purpose,title,kind,storage_path,filename,mime_type,byte_size,file_hash) values($1,$2,1,$3,$4,'delivery','Private delivery','file',$5,'proof.txt','text/plain',4,$6)",
      [id, project, index, wallets[1], path, "a".repeat(64)],
    );
    await db.query(
      "select public.complete_evidence($1,$2,$3,$4,$5,$6::jsonb)",
      [id, wallets[1], "a".repeat(64), "b".repeat(64), "c".repeat(64), "{}"],
    );
    await db.query(
      "insert into storage.objects values('pactlance-evidence',$1)",
      [path],
    );
  }
  await user(3);
  expect((await db.query("select * from public.evidence")).rows).toHaveLength(
    1,
  );
  expect((await db.query("select * from storage.objects")).rows).toHaveLength(
    1,
  );
  for (const i of [2, 4]) {
    await user(i);
    expect((await db.query("select * from public.evidence")).rows).toHaveLength(
      0,
    );
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
  }
});
