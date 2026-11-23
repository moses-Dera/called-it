-- OpenTimestamps proof store. The anchor API writes one row per Merkle root when it stamps it on
-- Bitcoin via the public OTS calendars; it updates the row when the proof is upgraded (mined).
-- Only the service role can read/write this table (no user RLS needed — no user data here).

create table if not exists public.ots_proofs (
  root        text primary key check (root ~ '^[0-9a-f]{64}$'),
  proof_b64   text not null,              -- base64-encoded binary .ots file
  status      text not null default 'queued' check (status in ('queued', 'mined', 'failed')),
  height      int,                        -- Bitcoin block height once mined
  stamped_at  timestamptz not null default now(),
  upgraded_at timestamptz
);

-- No RLS: accessed only by the service-role key from API routes, never from the browser.
alter table public.ots_proofs enable row level security;
-- Deny all by default (service role bypasses RLS anyway).
