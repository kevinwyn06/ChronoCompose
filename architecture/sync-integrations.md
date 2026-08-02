# Sync and integrations

## Supabase

Supabase is optional and offline first. The client persists its managed session under `pp-auth`, restores
it on mount, switches to a UID-scoped workspace, reconciles cloud/local state, subscribes to Realtime, and
flushes queued changes. Tasks use row-level last-write-wins clocks; habits and journal use parallel JSONB
blob synchronization. Queue and tombstone stores survive reloads.

Migrations `0001`–`0007` cover schema/grants, Google token custody, second-level spent/predicted storage,
Google push notifications, and nullable scheduling clock flags. Migration `0007` removes the obsolete
schedule-pin columns. Reconcile migration history before any database push.

## Google Calendar

`gcalImport`, `mergeCalendarEvents`, and `pruneDeletedEvents` implement pull/merge. Outbound operations
are derived through the commit diff funnel and queued. Pure merge/diff helpers are tested separately from
OAuth and network IO.

The browser holds only a short-lived access token in memory. The refresh token is server-held in
`public.gcal_tokens` and reachable only through the `gcal-oauth` Edge Function. `events.watch`
notifications are content-free prompts to pull; they do not send calendar contents through the webhook.

For OAuth QA, follow the account/origin restrictions in `AGENTS.md` and never reload mid-session.
