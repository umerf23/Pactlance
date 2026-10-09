import { z } from "zod";

// Sharing an identifier conveys no permission. The API still enforces RLS.
export function projectIdFromLink(value: unknown): string | null {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function projectLink(origin: string, id: string): string {
  const validated = projectIdFromLink(id);
  if (!validated) throw new Error("Invalid project identifier.");
  const url = new URL("/workspace", origin);
  url.searchParams.set("project", validated);
  return url.href;
}
