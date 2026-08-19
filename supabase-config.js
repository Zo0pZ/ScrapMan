/* ScrapMan — Supabase project config.
 *
 * Fill these in from your project's dashboard: Project Settings → API.
 * The "anon/publishable" key is DESIGNED to be public — it's safe to ship in client-side
 * code. Access control comes from the Row Level Security policies in
 * supabase/schema.sql, not from keeping this key secret. Never put a service_role key
 * here or in any file that ships to the browser.
 *
 * Until these are filled in, the whole app runs exactly as it does today: open demo
 * mode, no accounts, everything in localStorage. Nothing breaks by leaving this as-is.
 */
window.SCRAPMAN_SUPABASE = {
  url: "https://bvfhcwfifjyododertvx.supabase.co",
  anonKey: "sb_publishable_UyeJmELfBzUNXsTtlGoNKw_L8R6xBna"
};
