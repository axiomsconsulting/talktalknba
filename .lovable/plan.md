## Why Drive pull still fails

The fresh Google Drive connection is linked, but two credentials now exist in the worker env:

- `GOOGLE_DRIVE_API_KEY` (older, from the previous workspace connection) → returns **401 "Credential not found"**
- `GOOGLE_DRIVE_API_KEY_1` (issued for the new connection) → returns **200 OK**

I verified both directly against the gateway. The current code reads the bare name first, finds a value (the stale one), and never falls back. So every "Pull now" / "Test connection" hits the dead key.

## Fix

In `src/server/connections.server.ts`, change `gatewayHeaders()` to **prefer suffixed env names** (`_1` … `_5`) over the bare `GOOGLE_DRIVE_API_KEY` / `DATABRICKS_API_KEY`. A suffix indicates the platform issued a fresh credential after a previous one was disconnected, so it's always the one to use when present.

Same one-function change as before, just with the lookup order reversed.

## After the fix

- Drive "Test connection" → success
- Drive "Pull now" → enumerates files in the configured shared folder
- Cron poller (`/api/public/hooks/poll-drive`) starts working again

No DB migrations, no new env vars, no UI changes.
