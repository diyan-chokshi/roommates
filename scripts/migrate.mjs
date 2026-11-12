import { readFile } from 'node:fs/promises';

const projectUrl = new URL(process.env.VITE_SUPABASE_URL || 'https://missing.invalid');
const projectRef = projectUrl.hostname.split('.')[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token || !projectUrl.hostname.endsWith('.supabase.co')) {
  throw new Error('Set VITE_SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env.local.');
}
const expectedRef = process.argv.find(arg => arg.startsWith('--project-ref='))?.split('=')[1];
if (!expectedRef || expectedRef !== projectRef) throw new Error('Pass --project-ref matching the intended Supabase project.');

async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase SQL request failed (${response.status}): ${body}`);
  return body ? JSON.parse(body) : null;
}

const inspection = `select
  (select count(*)::integer from pg_catalog.pg_tables where schemaname='app_private') as household_tables,
  (select count(*)::integer from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('get_dashboard','propose_strike','respond_strike','set_chore_vote','link_roommate')) as household_rpcs`;
const before = await query(inspection);
console.log(JSON.stringify({ projectRef, before }));

if (process.argv.includes('--apply')) {
  if (before[0]?.household_tables !== 0 || before[0]?.household_rpcs !== 0) {
    throw new Error('Household objects already exist; refusing to reapply the initial migration. Inspect the existing schema first.');
  }
  const sql = await readFile(new URL('../supabase/migrations/202611120001_household.sql', import.meta.url), 'utf8');
  // All statements succeed together or roll back together. Do not retry uncertain writes automatically.
  await query(`begin;\n${sql}\ncommit;`, false);
  console.log('Household migration committed.');
}

const after = await query(inspection);
console.log(JSON.stringify({ after }));
if (after[0]?.household_tables === 5 && after[0]?.household_rpcs === 5) {
  const checks = await query(`select
    (select count(*)::integer from app_private.members) as roommates,
    (select count(*)::integer from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relkind='r' and c.relrowsecurity) as rls_tables,
    has_function_privilege('authenticated','public.get_dashboard()','execute') as member_dashboard_allowed,
    has_function_privilege('anon','public.get_dashboard()','execute') as anonymous_dashboard_allowed,
    has_function_privilege('authenticated','public.link_roommate(integer,uuid)','execute') as member_link_allowed,
    has_function_privilege('service_role','public.link_roommate(integer,uuid)','execute') as admin_link_allowed,
    (select bool_and(not has_table_privilege('authenticated',c.oid,'select,insert,update,delete'))
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_private' and c.relkind='r') as direct_member_table_access_denied`);
  console.log(JSON.stringify({ verification: checks }));
  const check = checks[0];
  if (check.roommates !== 4 || check.rls_tables !== 5 || !check.member_dashboard_allowed ||
      check.anonymous_dashboard_allowed || check.member_link_allowed || !check.admin_link_allowed ||
      !check.direct_member_table_access_denied) throw new Error('Post-migration verification failed.');
  console.log('Verified household tables, four members, RLS, and RPC permissions.');
}
