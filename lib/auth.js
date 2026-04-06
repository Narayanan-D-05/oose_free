import { supabaseAdmin } from "./supabase.js";
import { sendJson } from "./response.js";

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.slice("Bearer ".length).trim();
}

export async function requireUser(req, res) {
  const token = getBearerToken(req);

  if (!token) {
    sendJson(res, 401, { error: "Missing bearer token" });
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    sendJson(res, 401, { error: "Invalid token" });
    return null;
  }

  return data.user;
}

export async function requireRole(req, res, allowedRoles) {
  const user = await requireUser(req, res);

  if (!user) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, role, email")
    .eq("id", user.id)
    .single();

  if (error || !data) {
    sendJson(res, 403, { error: "User role not found" });
    return null;
  }

  if (!allowedRoles.includes(data.role)) {
    sendJson(res, 403, { error: "Insufficient permissions" });
    return null;
  }

  return data;
}
