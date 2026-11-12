import { spawnSync } from 'node:child_process';

const repo = 'diyan-chokshi/roommates';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key?.startsWith('sb_publishable_')) {
  throw new Error('Expected a Supabase project URL and a publishable key in .env.local.');
}
function gh(args, input) {
  const result = spawnSync('gh', args, { encoding: 'utf8', input, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'GitHub CLI request failed.');
  return result.stdout;
}
const existing = spawnSync('gh', ['api', `repos/${repo}/pages`], { encoding: 'utf8', windowsHide: true });
if (existing.status !== 0) {
  if (!existing.stderr?.includes('404')) throw new Error('Unable to inspect Pages settings.');
  gh(['api', '--method', 'POST', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
  console.log('Enabled GitHub Pages using GitHub Actions.');
} else if (JSON.parse(existing.stdout).build_type !== 'workflow') {
  gh(['api', '--method', 'PUT', `repos/${repo}/pages`, '-f', 'build_type=workflow']);
  console.log('Set GitHub Pages source to GitHub Actions.');
}
for (const [name, value] of Object.entries({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key })) {
  gh(['variable', 'set', name, '--repo', repo], value);
  console.log(`Configured ${name}.`);
}
gh(['workflow', 'run', 'pages.yml', '--ref', 'main', '--repo', repo]);
console.log('Started a fresh deployment build on main.');
