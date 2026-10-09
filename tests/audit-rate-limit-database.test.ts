import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
const db = new PGlite();
const uid = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema private; create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${uid}'); grant usage on schema public to service_role;`,
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261009094002_audit_api_limits.sql",
      "utf8",
    ),
  );
}, 30000);
afterAll(() => db.close());
it("counts concurrent calls atomically and isolates scopes", async () => {
  await db.exec("set role service_role");
  const call = (scope: string) =>
    db.query<{ consume_api_limit: boolean }>(
      "select consume_api_limit($1,$2,3)",
      [uid, scope],
    );
  const results = await Promise.all(
    Array.from({ length: 8 }, () => call("write")),
  );
  expect(results.filter((r) => r.rows[0].consume_api_limit)).toHaveLength(3);
  expect((await call("escrow")).rows[0].consume_api_limit).toBe(true);
  await db.exec(
    "update private.api_limits set window_started=now()-interval '61 seconds' where scope='write'",
  );
  expect((await call("write")).rows[0].consume_api_limit).toBe(true);
});
it("denies quota reset and invocation to browser roles", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await expect(
      db.query("select consume_api_limit($1,'write',120)", [uid]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.exec("update private.api_limits set used=1"),
    ).rejects.toThrow(/permission denied/);
  }
});
it("supports a read-only operator probe that fails before touching counters", async () => {
  await db.exec("reset role; set role service_role");
  const before = await db.query(
    "select * from private.api_limits order by user_id,scope",
  );
  await expect(
    db.query("select consume_api_limit($1,'read',0)", [
      "00000000-0000-4000-8000-000000000000",
    ]),
  ).rejects.toThrow("invalid limit");
  const after = await db.query(
    "select * from private.api_limits order by user_id,scope",
  );
  expect(after.rows).toEqual(before.rows);
});
