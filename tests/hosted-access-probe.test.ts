import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";

it("runs the rollback-only hosted probe with unchanged permissions before and after policy optimization", async () => {
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
    const files = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const newest = files.pop();
    expect(newest).toBe("20261010104341_access_policy_performance.sql");
    for (const file of files)
      await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
    const run = async () => {
      const output = await db.exec(
        readFileSync("scripts/hosted-access-probe.sql", "utf8"),
      );
      const result = output.flatMap((r) => r.rows).find((r) => "report" in r)
        ?.report as {
        status: string;
        checks: { name: string; passed: boolean }[];
      };
      expect(result.status).toBe("passed");
      expect(result.checks.length).toBeGreaterThanOrEqual(30);
      expect(result.checks.every((c) => c.passed)).toBe(true);
      // The probe must leave no Auth identities, project data, files or helpers.
      for (const table of [
        "auth.users",
        "auth.identities",
        "public.projects",
        "public.evidence",
        "storage.objects",
      ])
        expect((await db.query(`select * from ${table}`)).rows).toHaveLength(0);
      expect(
        (await db.query("select * from pg_proc where proname='probe_assert'"))
          .rows,
      ).toHaveLength(0);
      return result.checks;
    };
    const before = await run();
    await db.exec(readFileSync(`supabase/migrations/${newest}`, "utf8"));
    expect(await run()).toEqual(before);
  } finally {
    await db.close();
  }
}, 30000);
