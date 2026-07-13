// ChronoCompose — Google Calendar durable sign-in (persistent-logins work, 2026-07-13).
//
// Two actions, both authenticated by the caller's Supabase JWT (verify_jwt is on):
//   { action: "exchange", code, clientId } — swap a one-time OAuth auth code (from the browser's
//        popup code-client) for tokens; store the refresh_token server-side scoped to auth.uid();
//        return the first { access_token, expires_in }.
//   { action: "token" }                    — mint a fresh access_token from the stored refresh_token;
//        return { access_token, expires_in }, or { connected:false } (404) if none is stored.
//
// The OAuth client SECRET lives only here (GCAL_CLIENT_SECRET, set via `supabase secrets set`), never
// in the public config.js (rule 7). The refresh_token lives only in public.gcal_tokens, which RLS
// hides from every client — this function reaches it with the service_role key. The browser never
// sees the refresh token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const clientSecret = Deno.env.get("GCAL_CLIENT_SECRET");
  if (!clientSecret) return json({ error: "server not configured: GCAL_CLIENT_SECRET is unset" }, 500);

  // Identify the caller from their JWT (verify_jwt already rejected anonymous requests).
  const authHeader = req.headers.get("Authorization") || "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "not authenticated" }, 401);
  const uid = userData.user.id;

  const admin = createClient(url, service); // bypasses RLS to touch gcal_tokens

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = body.action;

  const postToGoogle = async (params: Record<string, string>) => {
    const r = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  };

  if (action === "exchange") {
    const code = body.code;
    const clientId = body.clientId || Deno.env.get("GCAL_CLIENT_ID");
    if (!code || !clientId) return json({ error: "missing code or clientId" }, 400);
    const { ok, status, j } = await postToGoogle({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: "postmessage", grant_type: "authorization_code",
    });
    if (!ok) return json({ error: "google exchange failed", detail: j }, status || 400);
    // A refresh_token is only returned on first consent (or with prompt=consent). If Google didn't
    // send one this time, keep whatever we already had rather than wiping durable access.
    if (j.refresh_token) {
      const up = await admin.from("gcal_tokens")
        .upsert({ owner_id: uid, refresh_token: j.refresh_token, updated_at: new Date().toISOString() });
      if (up.error) return json({ error: "store failed", detail: up.error.message }, 500);
    }
    return json({ access_token: j.access_token, expires_in: j.expires_in, stored: !!j.refresh_token });
  }

  if (action === "token") {
    const clientId = body.clientId || Deno.env.get("GCAL_CLIENT_ID");
    const { data: row, error } = await admin.from("gcal_tokens")
      .select("refresh_token").eq("owner_id", uid).maybeSingle();
    if (error) return json({ error: "lookup failed", detail: error.message }, 500);
    if (!row) return json({ connected: false }, 404);
    if (!clientId) return json({ error: "missing clientId" }, 400);
    const { ok, status, j } = await postToGoogle({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: row.refresh_token, grant_type: "refresh_token",
    });
    if (!ok) {
      // A revoked/expired refresh token is dead — drop it so the client prompts a fresh sign-in.
      if (status === 400 || status === 401) await admin.from("gcal_tokens").delete().eq("owner_id", uid);
      return json({ error: "google refresh failed", detail: j, connected: false }, status || 400);
    }
    return json({ access_token: j.access_token, expires_in: j.expires_in });
  }

  return json({ error: "unknown action" }, 400);
});
