import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "https://example.supabase.co";
const anonKey = process.env.SUPABASE_ANON_KEY || "anon-placeholder-key";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "service-role-placeholder-key";

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.warn("Missing Supabase environment variables. Check SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export const supabaseAnon = createClient(supabaseUrl, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
