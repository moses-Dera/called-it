-- The passphrase backup was replaced by the server-side reveal escrow (app/api/escrow); its metadata table is unused.
drop table if exists public.vault_meta;
