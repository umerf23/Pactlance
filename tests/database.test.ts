import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";
const db = new PGlite();
const wallets = [1, 2, 3].map((n) =>
  Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey.toBase58(),
);
const users = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const project = "10000000-0000-4000-8000-000000000001";
const terms = (version: number) => ({
  projectId: project,
  version,
  title: "Private project",
  network: "devnet",
  clientWallet: wallets[0],
  freelancerWallet: wallets[1],
  milestones: [{ sequence: 1 }, { sequence: 2 }],
});
async function asUser(n: number) {
  await db.exec("reset role;set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    users[n],
  ]);
}
async function save(version: number) {
  await db.exec("reset role;set role service_role");
  return db.query(
    "select public.save_agreement_version($1,$2,$3,$4::jsonb,$5,$6)",
    [
      project,
      wallets[0],
      version - 1,
      JSON.stringify(terms(version)),
      "a".repeat(64),
      String(version).repeat(64),
    ],
  );
}
async function accept(
  actor: number,
  version: number,
  hash = String(version).repeat(64),
) {
  await db.exec("reset role;set role service_role");
  return db.query(
    "select public.record_agreement_acceptance($1,$2,$3,$4,$5,$6)",
    [
      project,
      wallets[actor],
      version,
      hash,
      "verified-message",
      "s".repeat(88),
    ],
  );
}
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table auth.identities(user_id uuid,provider text,provider_id text);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;`,
  );
  for (let i = 0; i < users.length; i++) {
    await db.query("insert into auth.users values($1)", [users[i]]);
    await db.query("insert into auth.identities values($1,'web3',$2)", [
      users[i],
      `web3:solana:${wallets[i]}`,
    ]);
  }
  await db.exec(
    readFileSync("supabase/migrations/202610070001_phase3.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261007050111_private_auth_helpers.sql",
      "utf8",
    ),
  );
  await save(1);
}, 30000);
afterAll(async () => {
  await db.close();
});
it("enforces real PostgreSQL participant RLS and mutation permissions", async () => {
  for (const n of [0, 1]) {
    await asUser(n);
    expect((await db.query("select * from projects")).rows).toHaveLength(1);
    expect((await db.query("select * from agreements")).rows).toHaveLength(1);
  }
  await asUser(2);
  for (const table of [
    "projects",
    "agreements",
    "project_members",
    "agreement_acceptances",
  ])
    expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
  await expect(db.exec("update projects set title='Hacked'")).rejects.toThrow(
    /permission denied/,
  );
  await expect(
    db.query("select public.save_agreement_version($1,$2,0,$3::jsonb,$4,$5)", [
      project,
      wallets[2],
      JSON.stringify(terms(1)),
      "a".repeat(64),
      "1".repeat(64),
    ]),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role;set role anon");
  await expect(db.exec("select * from agreements")).rejects.toThrow(
    /permission denied/,
  );
});
it("isolates profiles and rejects forged profile ownership", async () => {
  await asUser(0);
  await db.query("insert into profiles values($1,'Alice')", [users[0]]);
  await expect(
    db.query("insert into profiles values($1,'Forged')", [users[1]]),
  ).rejects.toThrow(/row-level security/);
  await asUser(1);
  expect((await db.query("select * from profiles")).rows).toHaveLength(0);
});
it("preserves history, requires fresh acceptance and rejects stale writes", async () => {
  await accept(0, 1);
  await accept(0, 1);
  await accept(1, 1);
  await asUser(0);
  expect(
    (await db.query("select * from agreement_acceptances")).rows,
  ).toHaveLength(2);
  await save(2);
  await expect(accept(1, 1)).rejects.toThrow(/version conflict/);
  await expect(accept(1, 2, "f".repeat(64))).rejects.toThrow(
    /commitment mismatch/,
  );
  await expect(accept(2, 2)).rejects.toThrow(/not participant/);
  await expect(save(2)).rejects.toThrow(/version conflict/);
  await asUser(0);
  expect((await db.query("select * from agreements")).rows).toHaveLength(2);
  expect(
    (await db.query("select * from agreement_acceptances where version=2"))
      .rows,
  ).toHaveLength(0);
  await accept(0, 2);
  await accept(1, 2);
  await db.exec("reset role;update projects set locked=true");
  await expect(save(3)).rejects.toThrow(/locked/);
  await expect(accept(0, 2)).rejects.toThrow(/locked/);
});
