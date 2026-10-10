// Life Planner — local configuration.
//
// Paste your Google OAuth Client ID below ONCE to enable one-click "Sign in with Google"
// (no more typing it into the app). An OAuth Client ID is PUBLIC and safe to commit — it is
// shipped in every browser OAuth app; only a client *secret* is sensitive, and this flow uses none.
//
// How to get one (one time): see SETUP.md → "Google Calendar setup".
// Remember to add your serve origin (e.g. http://localhost:8000) as an Authorized JavaScript origin.
//
// Durable Calendar sign-in (stays connected across reloads) uses the OAuth *auth-code* flow, which
// needs the OAuth client SECRET. The secret is NEVER placed here — it lives only in the Supabase
// Edge Function: `supabase secrets set GCAL_CLIENT_SECRET=<secret>` (see SETUP.md → Google Calendar
// setup). Persistent gcal also requires being signed into your account.

// Supabase backend (offline-first cloud sync).
// Both values below are PUBLIC and safe to commit — same rule as the Google Client ID above.
// The Project URL and the "anon / public" key are shipped in every browser Supabase app; only the
// `service_role` key is sensitive and must NEVER go here (it bypasses Row-Level Security).
//   Get them: Supabase dashboard → Project Settings (gear) → API → Project URL + anon/public key.
// Leave blank to run fully local (no Account panel, no cloud sync — the app works exactly as before).
// After pasting these, add your serve origin (http://localhost:8000) AND the exact page URL to the
// Supabase dashboard → Authentication → URL Configuration → Redirect URLs, so the magic link returns.

window.PP_CONFIG = {
  googleClientId: "1020034689909-9v15v4867nhdnn7bolqdspgr8r9c20j2.apps.googleusercontent.com",   // e.g. "123456789-abcdef.apps.googleusercontent.com"
  supabaseUrl: "https://yoyfwyyrgdjdggkqsvge.supabase.co",
  supabaseAnonKey: "sb_publishable_fpr8Od_NlHmK_L9IIaiapg_XMIjR9gz"   // publishable ("anon/public") key. Public — never the secret / service_role key.
};
