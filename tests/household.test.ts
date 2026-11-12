import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { choreFor, strikeCharge, type Dashboard } from '../src/domain';

const db = new PGlite();
const ids = [0,1,2,3].map(i=>`00000000-0000-4000-8000-00000000000${i}`);
let sequence=0;
const requestId=()=>`10000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
const clock=async(value:string)=>{await db.query("select set_config('test.now',$1,false)",[value]);};
const as=async(id:number)=>{await db.query("select set_config('test.uid',$1,false)",[ids[id]]);};
const get=async()=> (await db.query<{data:Dashboard}>('select public.get_dashboard() as data')).rows[0].data;
const propose=async(target:number,id=requestId())=>{await db.query('select public.propose_strike($1,$2)',[target,id]);return id;};
const respond=async(id:string,decision:string)=>db.query('select public.respond_strike($1,$2)',[id,decision]);
const vote=async(target:number,value=true,week=0)=>db.query('select public.set_chore_vote($1,$2,$3)',[target,value,week]);

beforeAll(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;`);
  for(const id of ids) await db.query('insert into auth.users values($1)',[id]);
  // Only replace the clock source. All schema, RPCs, permissions and transactions are the real migration.
  const sql=readFileSync(new URL('../supabase/migrations/202611120001_household.sql',import.meta.url),'utf8')
    .replaceAll('clock_timestamp()',"current_setting('test.now')::timestamptz");
  await db.exec(sql);
  await db.exec(readFileSync(new URL('../supabase/migrations/202611120002_household_health.sql',import.meta.url),'utf8'));
  for(let i=0;i<4;i++)await db.query('select public.link_roommate($1,$2)',[i,ids[i]]);
},30000);
beforeEach(async()=>{
  await db.exec(`reset role; truncate app_private.proposals,app_private.chore_votes,app_private.reports;
    update app_private.rollover_state set last_closed_week=-1; set role authenticated;`);
  await clock('2026-11-16T05:00:00Z'); await as(0);
});
afterAll(async()=>{await db.close();});

describe('schedule and rotation',()=>{
  it('shows upcoming then starts exactly at midnight Eastern',async()=>{
    await clock('2026-11-16T04:59:59Z'); expect((await get()).week).toBe(-1);
    await expect(propose(1)).rejects.toThrow('not started');
    await clock('2026-11-16T05:00:00Z');const d=await get();expect(d.week).toBe(0);
    expect(new Date(d.next_rotation).toISOString()).toBe('2026-11-23T04:59:00.000Z');
    expect([0,1,2,3].map(i=>choreFor(i,d.week))).toEqual([0,1,2,3]);
  });
  it('rotates and closes reports at 23:59:00, not midnight',async()=>{
    await clock('2026-11-23T04:58:59Z');expect((await get()).week).toBe(0);
    await clock('2026-11-23T04:59:00Z');const d=await get();expect(d.week).toBe(1);
    expect(d.reports).toHaveLength(1);expect(d.reports[0].people.map(p=>p.chore)).toEqual([0,1,2,3]);
    expect([0,1,2,3].map(i=>choreFor(i,d.week))).toEqual([1,2,3,0]);
  });
  it('uses Eastern calendar weeks across spring and fall DST',async()=>{
    await db.exec('reset role');
    const rows=await db.query<{local:string;utc:string}>(`select
      to_char(app_private.boundary(i) at time zone 'America/New_York','YYYY-MM-DD HH24:MI') as local,
      to_char(app_private.boundary(i) at time zone 'UTC','HH24:MI') as utc
      from generate_series(14,16) i`);
    expect(rows.rows.map(r=>r.local.slice(-5))).toEqual(['23:59','23:59','23:59']);
    expect(rows.rows.map(r=>r.utc)).toEqual(['04:59','04:59','03:59']);
    const fall=await db.query<{utc:string}>(`select to_char(app_private.boundary(i) at time zone 'UTC','HH24:MI') utc from generate_series(49,50) i`);
    expect(fall.rows.map(r=>r.utc)).toEqual(['03:59','04:59']);
  });
  it('retains all missing reports after a long absence without duplicates',async()=>{
    await clock('2027-01-18T04:59:00Z');const d=await get();expect(d.week).toBe(9);expect(d.reports).toHaveLength(9);
    expect((await get()).reports).toHaveLength(9);expect(d.reports.filter(r=>r.strikes)).toHaveLength(2);
  });
});

describe('common-area strikes',()=>{
  it('requires exactly the other three and ignores duplicate approvals',async()=>{
    const id=await propose(1);expect((await get()).counts[1]).toBe(0);
    await as(1);await expect(respond(id,'approve')).rejects.toThrow('yourself');
    await as(2);await respond(id,'approve');await respond(id,'approve');expect((await get()).counts[1]).toBe(0);
    await as(3);await respond(id,'approve');await respond(id,'approve');expect((await get()).counts[1]).toBe(1);
    expect((await get()).proposals).toHaveLength(0);
  });
  it('prevents self proposals and more than one pending proposal per target',async()=>{
    await expect(propose(0)).rejects.toThrow('another roommate');
    const id=requestId();await propose(1,id);await propose(1,id);
    await expect(propose(1)).rejects.toThrow('already has');expect((await get()).proposals).toHaveLength(1);
  });
  it('rejects and allows another proposal; only proposer can cancel',async()=>{
    const id=await propose(1);await as(2);await respond(id,'reject');
    await expect(respond(id,'approve')).rejects.toThrow('closed');
    const next=await propose(1);await as(0);await expect(respond(next,'cancel')).rejects.toThrow('Only the proposer');
    await as(2);await respond(next,'cancel');await respond(next,'cancel');expect((await get()).proposals).toHaveLength(0);
  });
  it('does not allow proposer to cancel approved strikes',async()=>{
    const id=await propose(1);await as(2);await respond(id,'approve');await as(3);await respond(id,'approve');
    await as(0);await expect(respond(id,'cancel')).rejects.toThrow('closed');
  });
  it('charges beyond three and snapshots totals before four-week reset',async()=>{
    for(let i=0;i<5;i++){await as(0);const id=await propose(1);await as(2);await respond(id,'approve');await as(3);await respond(id,'approve');}
    expect(strikeCharge((await get()).counts[1])).toBe(90);
    const pending=await propose(0);
    await clock('2026-12-14T04:59:00Z');const d=await get();expect(d.week).toBe(4);expect(d.counts).toEqual([0,0,0,0]);
    expect(d.proposals).toHaveLength(0);expect(d.reports[0].strikes?.[1]).toEqual({id:1,count:5,charge:90});
    expect(d.reports[0].people.map(p=>p.chore)).toEqual([3,0,1,2]);
    await expect(respond(pending,'approve')).rejects.toThrow('expired');
  });
  it('computes the three-free-strike allowance',()=>{expect([0,3,4,5].map(strikeCharge)).toEqual([0,0,45,90]);});
});

describe('Sunday missed-chore voting',()=>{
  it('opens at 8 AM Eastern and permits reversible independent votes',async()=>{
    await clock('2026-11-22T12:59:59Z');await expect(vote(1)).rejects.toThrow('closed');
    await clock('2026-11-22T13:00:00Z');expect((await get()).voting_open).toBe(true);
    await vote(1);await vote(1);expect((await get()).chore_votes).toHaveLength(1);
    await as(2);await vote(1);await vote(1,false);expect((await get()).chore_votes).toHaveLength(1);
    await as(1);await expect(vote(1)).rejects.toThrow('another roommate');
  });
  it('finalizes a $45 charge only when all three votes remain at cutoff',async()=>{
    await clock('2026-11-22T13:00:00Z');await vote(1);await as(2);await vote(1);await as(3);await vote(1);
    await clock('2026-11-23T04:58:59Z');await vote(1,false);await vote(1);
    await clock('2026-11-23T04:59:00Z');await expect(vote(1,false)).rejects.toThrow('closed');
    const d=await get();expect(d.reports[0].people[1].charge).toBe(45);expect(d.reports[0].people[1].missed).toBe(true);
    expect(d.chore_votes).toEqual([]);expect(d.counts).toEqual([0,0,0,0]);
  });
  it('does not charge after one voter withdraws',async()=>{
    await clock('2026-11-22T13:00:00Z');await vote(1);await as(2);await vote(1);await as(3);await vote(1);await vote(1,false);
    await clock('2026-11-23T04:59:00Z');expect((await get()).reports[0].people[1].charge).toBe(0);
  });
  it('rejects stale-week votes during the next Sunday window',async()=>{
    await clock('2026-11-29T13:00:00Z');await expect(vote(1)).rejects.toThrow('closed');await vote(1,true,1);
    expect((await get()).chore_votes).toHaveLength(1);
  });
});

describe('access control',()=>{
  it('allows a public read-only health probe without access to household data',async()=>{
    await db.exec('reset role; set role anon');
    expect((await db.query<{ready:boolean}>('select public.household_health() as ready')).rows[0].ready).toBe(true);
    await expect(db.query('select * from app_private.members')).rejects.toThrow('permission denied');
  });
  it('denies unlinked accounts even with an authenticated token',async()=>{
    await db.query("select set_config('test.uid','20000000-0000-4000-8000-000000000000',false)");
    await expect(get()).rejects.toThrow('Household access');await expect(propose(1)).rejects.toThrow('Household access');
  });
  it('denies anonymous RPC calls, direct table access, and account relinking',async()=>{
    await expect(db.query('select * from app_private.members')).rejects.toThrow('permission denied');
    await expect(db.query('select public.link_roommate($1,$2)',[0,ids[0]])).rejects.toThrow('permission denied');
    await db.exec('reset role; set role anon');await expect(get()).rejects.toThrow('permission denied');
    await expect(propose(1)).rejects.toThrow('permission denied');
  });
});
