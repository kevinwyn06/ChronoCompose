// ChronoCompose — B3b: Google Calendar watch-channel registrar (2026-07-15).
//
// JWT-authed (verify_jwt on) — the client asks us to keep its push channels in sync with whichever
// calendars it has selected for import.
//
//   { action: "sync", calendarIds: string[], clientId } — ensure exactly one live events.watch channel
//        per selected calendar: register missing ones, renew ones near expiry, stop ones for calendars
//        that are no longer selected. Idempotent; safe to call on every load. This is the only action:
//        there is no client "disconnect Calendar" flow to hang a bulk `stop` off, and channels die on
//        their own within a week, so a standalone stop would be code with no caller.
//
// Access tokens are NOT re-derived here: we call `gcal-oauth`'s existing `token` action over HTTP with
// the caller's JWT forwarded, so the refresh-token handling (including dropping a revoked token) stays
// in exactly one place. Costs one internal hop; buys one implementation of a security-sensitive path.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CAL_API = "https://www.googleapis.com/calendar/v3";
// Google caps Calendar watch channels at ~1 week and silently returns a smaller expiration if it
// wants one — we ask for the max and trust the value it echoes back rather than assuming.
const WATCH_TTL_SEC = 604800;
// Renew anything expiring within a day, so a client that opens daily never sees a dead channel.
const RENEW_SKEW_MS = 24 * 60 * 60 * 1000;

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

  const authHeader = req.headers.get("Authorization") || "";
  const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "not authenticated" }, 401);
  const uid = userData.user.id;

  const admin = createClient(url, service);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = body.action;
  const clientId = body.clientId || Deno.env.get("GCAL_CLIENT_ID");

  const notifyUrl = `${url}/functions/v1/gcal-notify`;

  // Reuse gcal-oauth's token action (single owner of refresh-token logic — see header).
  const getAccessToken = async (): Promise<string | null> => {
    const r = await fetch(`${url}/functions/v1/gcal-oauth`, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "token", clientId }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.access_token ? j.access_token : null;
  };

  const calFetch = async (path: string, tok: string, payload: unknown) => {
    const r = await fetch(`${CAL_API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let j: any = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* channels/stop returns an empty 204 */ }
    return { ok: r.ok, status: r.status, j, text };
  };

  const stopChannel = async (tok: string, channelId: string, resourceId: string) => {
    // Best-effort: a channel Google already expired 404s here, which is not an error for us.
    await calFetch("/channels/stop", tok, { id: channelId, resourceId }).catch(() => ({}));
    await admin.from("gcal_channels").delete().eq("owner_id", uid).eq("channel_id", channelId);
  };

  if (action === "sync") {
    const calendarIds: string[] = Array.isArray(body.calendarIds) ? body.calendarIds.filter(Boolean) : [];
    const tok = await getAccessToken();
    if (!tok) return json({ error: "google not connected", connected: false }, 404);

    const { data: rows, error: readErr } = await admin.from("gcal_channels")
      .select("calendar_id, channel_id, resource_id, expiration").eq("owner_id", uid);
    if (readErr) return json({ error: "lookup failed", detail: readErr.message }, 500);
    const existing = new Map((rows || []).map((r: any) => [r.calendar_id, r]));

    const now = Date.now();
    const watched: Array<{ calendarId: string; expiration: string }> = [];
    const failed: Array<{ calendarId: string; detail: string }> = [];

    // 1. Drop channels for calendars the user has since deselected.
    for (const r of rows || []) {
      if (!calendarIds.includes(r.calendar_id)) await stopChannel(tok, r.channel_id, r.resource_id);
    }

    // 2. Register/renew for each selected calendar.
    for (const calId of calendarIds) {
      const cur: any = existing.get(calId);
      if (cur && new Date(cur.expiration).getTime() - now > RENEW_SKEW_MS) {
        watched.push({ calendarId: calId, expiration: cur.expiration });
        continue; // still healthy
      }
      // Renewing means a NEW channel; stop the old one first so Google doesn't double-push.
      if (cur) await stopChannel(tok, cur.channel_id, cur.resource_id);

      const channelId = crypto.randomUUID();
      const channelToken = crypto.randomUUID() + crypto.randomUUID(); // 256 bits of webhook secret
      const { ok, j, text } = await calFetch(
        `/calendars/${encodeURIComponent(calId)}/events/watch`, tok,
        { id: channelId, type: "web_hook", address: notifyUrl, token: channelToken, params: { ttl: String(WATCH_TTL_SEC) } },
      );
      if (!ok || !j.resourceId) { failed.push({ calendarId: calId, detail: (j?.error?.message || text || "watch failed").slice(0, 200) }); continue; }

      // Trust Google's expiration (ms epoch string) over our requested TTL — it caps it.
      const expiration = new Date(Number(j.expiration) || (now + WATCH_TTL_SEC * 1000)).toISOString();
      const up = await admin.from("gcal_channels").upsert({
        owner_id: uid, calendar_id: calId, channel_id: channelId,
        resource_id: j.resourceId, token: channelToken, expiration,
        updated_at: new Date().toISOString(),
      });
      if (up.error) { // couldn't record it -> we could never authenticate its pushes; stop it now
        await calFetch("/channels/stop", tok, { id: channelId, resourceId: j.resourceId });
        failed.push({ calendarId: calId, detail: up.error.message.slice(0, 200) });
        continue;
      }
      watched.push({ calendarId: calId, expiration });
    }

    return json({ watched, failed });
  }

  return json({ error: "unknown action" }, 400);
});
