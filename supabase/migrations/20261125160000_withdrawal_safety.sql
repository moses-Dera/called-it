-- Withdrawals: mainnet shielded addresses only, and one request at a time per player.
-- Before this, two requests sent together could both read the same balance and both be approved,
-- and testnet addresses were accepted although prizes are paid on mainnet.
create or replace function public.request_withdrawal(p_address text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  addr text := trim(coalesce(p_address, ''));
  earned numeric;
  taken numeric;
  available numeric;
  w public.withdrawals;
begin
  if uid is null then raise exception 'sign in to withdraw'; end if;
  -- Mainnet unified (u1…) or Sapling (zs1…) address, Bech32 characters only.
  if addr !~ '^(u1[02-9ac-hj-np-z]{100,}|zs1[02-9ac-hj-np-z]{70,80})$' then
    raise exception 'use a mainnet shielded Zcash address (it starts with u1 or zs1)';
  end if;

  -- Serialise this player's requests so two at once cannot both spend the same balance.
  perform pg_advisory_xact_lock(hashtext('withdraw:' || uid::text));

  select coalesce(sum(zec), 0) into earned from public.rewards where user_id = uid and verified;
  select coalesce(sum(amount), 0) into taken from public.withdrawals where user_id = uid and status <> 'rejected';
  available := earned - taken;

  if available < 0.001 then
    return jsonb_build_object('status', 'too_small', 'available', available);
  end if;

  insert into public.withdrawals (user_id, address, amount)
  values (uid, addr, available)
  returning * into w;

  return jsonb_build_object('status', 'requested', 'amount', w.amount, 'id', w.id);
end $$;
revoke all on function public.request_withdrawal(text) from public, anon;
grant execute on function public.request_withdrawal(text) to authenticated;
