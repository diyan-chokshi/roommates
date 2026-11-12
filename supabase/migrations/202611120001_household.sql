-- Fixed household. All state changes take the same transaction lock, including rollover.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.members (
  id integer primary key check (id between 0 and 3),
  name text not null unique,
  user_id uuid unique references auth.users(id)
);
insert into app_private.members (id, name) values (0,'Diyan'),(1,'Pranav'),(2,'Rohan'),(3,'Vitthal');

create table app_private.proposals (
  id uuid primary key default gen_random_uuid(),
  period integer not null,
  target integer not null references app_private.members(id),
  proposer integer not null references app_private.members(id),
  approvals integer[] not null,
  status text not null check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  check (target <> proposer)
);
create unique index one_pending_per_target on app_private.proposals(target) where status = 'pending';
create table app_private.chore_votes (
  week integer not null,
  target integer not null references app_private.members(id),
  voter integer not null references app_private.members(id),
  primary key (week,target,voter), check (target <> voter)
);
create table app_private.reports (
  week integer primary key,
  snapshot jsonb not null
);
create table app_private.rollover_state (
  singleton boolean primary key default true check (singleton),
  last_closed_week integer not null default -1
);
insert into app_private.rollover_state default values;

alter table app_private.members enable row level security;
alter table app_private.proposals enable row level security;
alter table app_private.chore_votes enable row level security;
alter table app_private.reports enable row level security;
alter table app_private.rollover_state enable row level security;

-- Calendar arithmetic is performed in Eastern wall time, not fixed UTC weeks.
create function app_private.boundary(w integer) returns timestamptz
language sql immutable set search_path = '' as $$
  select (timestamp '2026-11-22 23:59:00' + w * interval '7 days') at time zone 'America/New_York'
$$;
create function app_private.week_at(t timestamptz) returns integer
language sql immutable set search_path = '' as $$
  select case when t < timestamptz '2026-11-16 00:00:00 America/New_York' then -1
    when t < app_private.boundary(0) then 0
    else 1 + floor(extract(epoch from ((t at time zone 'America/New_York') - timestamp '2026-11-22 23:59:00')) / 604800)::integer end
$$;
create function app_private.week_start(w integer) returns timestamptz
language sql immutable set search_path = '' as $$
  select case when w <= 0 then timestamptz '2026-11-16 00:00:00 America/New_York' else app_private.boundary(w-1) end
$$;
create function app_private.vote_open(w integer) returns timestamptz
language sql immutable set search_path = '' as $$
  select ((app_private.boundary(w) at time zone 'America/New_York')::date + time '08:00') at time zone 'America/New_York'
$$;
create function app_private.member_id() returns integer
language plpgsql stable set search_path = '' as $$
declare m integer;
begin
  select id into m from app_private.members where user_id = auth.uid();
  if m is null then raise exception 'Household access required.'; end if;
  return m;
end $$;

-- Called inside the caller's transaction, after authentication and the household lock.
create function app_private.rollover(t timestamptz) returns void
language plpgsql set search_path = '' as $$
declare current_w integer := app_private.week_at(t); closed integer; w integer; people jsonb; strikes jsonb;
begin
  select last_closed_week into closed from app_private.rollover_state where singleton;
  if current_w <= 0 or closed >= current_w - 1 then return; end if;
  for w in (closed+1)..(current_w-1) loop
    select jsonb_agg(jsonb_build_object('id', m.id, 'chore', (m.id+w)%4,
      'missed', (select count(*)=3 from app_private.chore_votes v where v.week=w and v.target=m.id),
      'charge', case when (select count(*) from app_private.chore_votes v where v.week=w and v.target=m.id)=3 then 45 else 0 end
    ) order by m.id) into people from app_private.members m;
    strikes := null;
    if (w+1)%4=0 then
      select jsonb_agg(jsonb_build_object('id',m.id,'count',s.n,'charge',greatest(0,s.n-3)*45) order by m.id)
      into strikes from app_private.members m cross join lateral (
        select count(*)::integer n from app_private.proposals p where p.target=m.id and p.period=w/4 and p.status='approved'
      ) s;
    end if;
    insert into app_private.reports(week,snapshot) values(w,jsonb_build_object(
      'week',w,'start',app_private.week_start(w),'end',app_private.boundary(w),'people',people,'strikes',strikes
    )) on conflict (week) do nothing;
    delete from app_private.chore_votes where week=w;
    if (w+1)%4=0 then delete from app_private.proposals where period <= w/4; end if;
  end loop;
  update app_private.rollover_state set last_closed_week=current_w-1 where singleton;
end $$;

create function public.get_dashboard() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m integer; t timestamptz; w integer; result jsonb;
begin
  m := app_private.member_id();
  perform pg_advisory_xact_lock(1645162026);
  -- clock_timestamp is obtained after acquiring the lock to reject requests queued past cutoff.
  t := clock_timestamp(); w := app_private.week_at(t);
  perform app_private.rollover(t);
  select jsonb_build_object(
    'me',m,'server_now',t,'week',w,'week_start',app_private.week_start(w),
    'next_rotation',case when w<0 then app_private.week_start(0) else app_private.boundary(w) end,
    'next_reset',app_private.boundary((greatest(w,0)/4)*4+3),
    'vote_opens',app_private.vote_open(greatest(w,0)),
    'voting_open',w>=0 and t>=app_private.vote_open(w) and t<app_private.boundary(w),
    'counts',(select jsonb_agg(s.n order by m2.id) from app_private.members m2 cross join lateral (
      select count(*)::integer n from app_private.proposals p where p.target=m2.id and p.period=w/4 and p.status='approved'
    ) s),
    'proposals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'target',p.target,'proposer',p.proposer,'approvals',p.approvals) order by p.created_at)
      from app_private.proposals p where p.status='pending' and p.period=w/4),'[]'::jsonb),
    'chore_votes',coalesce((select jsonb_agg(jsonb_build_object('target',v.target,'voter',v.voter)) from app_private.chore_votes v where v.week=w),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(r.snapshot order by r.week desc) from app_private.reports r),'[]'::jsonb)
  ) into result;
  return result;
end $$;

create function public.propose_strike(target_id integer, request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m integer; w integer; t timestamptz;
begin
  m:=app_private.member_id(); perform pg_advisory_xact_lock(1645162026);
  t:=clock_timestamp(); w:=app_private.week_at(t); perform app_private.rollover(t);
  if w<0 then raise exception 'The household schedule has not started yet.'; end if;
  if target_id=m or target_id not between 0 and 3 or target_id is null then raise exception 'Choose another roommate.'; end if;
  if exists(select 1 from app_private.proposals where id=request_id and proposer=m and target=target_id) then return; end if;
  if exists(select 1 from app_private.proposals where target=target_id and status='pending') then raise exception 'This roommate already has a pending proposal.'; end if;
  insert into app_private.proposals(id,period,target,proposer,approvals,status) values(request_id,w/4,target_id,m,array[m],'pending');
end $$;

create function public.respond_strike(proposal_id uuid, decision text) returns void
language plpgsql security definer set search_path = '' as $$
declare m integer; w integer; t timestamptz; p app_private.proposals%rowtype;
begin
  m:=app_private.member_id(); perform pg_advisory_xact_lock(1645162026);
  t:=clock_timestamp(); w:=app_private.week_at(t); perform app_private.rollover(t);
  select * into p from app_private.proposals where id=proposal_id;
  if not found or w<0 or p.period<>w/4 then raise exception 'This proposal has expired.'; end if;
  if decision='cancel' then
    if p.proposer<>m then raise exception 'Only the proposer can cancel.'; end if;
    if p.status='cancelled' then return; end if;
    if p.status<>'pending' then raise exception 'This proposal is already closed.'; end if;
    update app_private.proposals set status='cancelled' where id=proposal_id; return;
  end if;
  if m=p.target then raise exception 'You cannot vote on a strike against yourself.'; end if;
  if decision='approve' and m=any(p.approvals) then return; end if;
  if p.status<>'pending' then raise exception 'This proposal is already closed.'; end if;
  if m=any(p.approvals) then raise exception 'Your approval is final; the proposer can cancel while pending.'; end if;
  if decision='reject' then update app_private.proposals set status='rejected' where id=proposal_id;
  elsif decision='approve' then
    update app_private.proposals set approvals=array_append(approvals,m),
      status=case when cardinality(approvals)=2 then 'approved' else 'pending' end where id=proposal_id;
  else raise exception 'Unknown decision.'; end if;
end $$;

create function public.set_chore_vote(target_id integer, not_done boolean, expected_week integer) returns void
language plpgsql security definer set search_path = '' as $$
declare m integer; w integer; t timestamptz;
begin
  m:=app_private.member_id(); perform pg_advisory_xact_lock(1645162026);
  t:=clock_timestamp(); w:=app_private.week_at(t); perform app_private.rollover(t);
  if w<0 or w<>expected_week or t<app_private.vote_open(w) or t>=app_private.boundary(w) then raise exception 'Chore voting is closed. Refresh to see the current week.'; end if;
  if target_id=m or target_id not between 0 and 3 or target_id is null then raise exception 'Choose another roommate.'; end if;
  if not_done is null then raise exception 'Choose a vote.'; end if;
  if not_done then insert into app_private.chore_votes(week,target,voter) values(w,target_id,m) on conflict do nothing;
  else delete from app_private.chore_votes where week=w and target=target_id and voter=m; end if;
end $$;

-- Admin-only provisioning. No passcodes are stored in application tables.
create function public.link_roommate(member_id integer, auth_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update app_private.members set user_id=auth_user_id where id=member_id and (user_id is null or user_id=auth_user_id);
  if not found then raise exception 'Roommate already linked to another account or does not exist.'; end if;
end $$;

revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.get_dashboard() from public, anon;
revoke all on function public.propose_strike(integer,uuid) from public, anon;
revoke all on function public.respond_strike(uuid,text) from public, anon;
revoke all on function public.set_chore_vote(integer,boolean,integer) from public, anon;
revoke all on function public.link_roommate(integer,uuid) from public, anon, authenticated;
grant execute on function public.get_dashboard(), public.propose_strike(integer,uuid), public.respond_strike(uuid,text), public.set_chore_vote(integer,boolean,integer) to authenticated;
grant execute on function public.link_roommate(integer,uuid) to service_role;
