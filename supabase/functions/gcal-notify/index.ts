// ChronoCompose — B3b: Google Calendar push webhook receiver (2026-07-15).
//
// PUBLIC endpoint — deploy with `--no-verify-jwt`. Google's push service cannot present a Supabase
// JWT, so this is the one function anyone on the internet can reach. It is safe to expose because:
//   * it accepts NO body (Google's notifications are header-only) and never trusts one;
//   * it authenticates each hit by the per-channel random token (X-Goog-Channel-Token) that only we
//     and Google know — it lives in gcal_channels, which RLS hides from every client (0006);
//   * its entire effect is bumping the owner's gcal_pings row — a content-free doorbell. It reads no
//     calendar data and writes none, so a forged hit can at worst make a client re-pull its own
//     calendar (which it is already allowed to do, and already does on a 60s poll).
//
// Flow: Google POSTs here on every change to a watched calendar -> we bump gcal_pings -> the open
// client sees it over Realtime and re-runs its own gcalImport/mergeCalendarEvents. Notify-to-pull:
// no calendar credentials or data server-side (roadmap Open question #1).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Length-independent equality — avoids leaking the token a byte at a time via response timing.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  // Compare a fixed-width digest so differing LENGTHS don't short-circuit either.
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  // Google only ever POSTs. Anything else is not a notification.
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const channelId = req.headers.get("X-Goog-Channel-ID") || "";
  const token = req.headers.get("X-Goog-Channel-Token") || "";
  const state = req.headers.get("X-Goog-Resource-State") || "";

  if (!channelId || !token) return new Response("missing channel headers", { status: 400 });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service); // gcal_channels/gcal_pings are service_role-only

  const { data: row, error } = await admin.from("gcal_channels")
    .select("owner_id, token").eq("channel_id", channelId).maybeSingle();
  if (error) return new Response("lookup failed", { status: 500 });

  // Unknown channel: 404 tells Google's push service this receiver is done with it, so it stops
  // retrying (e.g. a channel we already stopped, or whose row was cascade-deleted with the user).
  if (!row) return new Response("unknown channel", { status: 404 });
  if (!safeEqual(token, row.token)) return new Response("bad token", { status: 401 });

  // `sync` is the handshake Google sends immediately on watch() — it means "channel created", not
  // "something changed". Acknowledge it without waking the client.
  if (state === "sync") return new Response("ok", { status: 200 });

  const up = await admin.from("gcal_pings").upsert({
    owner_id: row.owner_id,
    bumped_at: new Date().toISOString(),
    resource_state: state || null,
  });
  // A failed bump only costs latency — the client's poll fallback still catches the change — but a
  // non-2xx makes Google retry with backoff, which is the behaviour we want here.
  if (up.error) return new Response("ping failed", { status: 500 });

  return new Response("ok", { status: 200 });
});
