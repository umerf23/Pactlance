"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseConfig } from "./config";
export function browserSupabase() {
  const config = publicSupabaseConfig();
  if (!config)
    throw new Error("The shared workspace is awaiting Supabase setup.");
  return createBrowserClient(config.url, config.key);
}
