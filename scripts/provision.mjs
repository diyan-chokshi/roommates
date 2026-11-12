import { randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...) in .env.local.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const passcodesPath = process.argv.find(arg => arg.startsWith('--passcodes-file='))?.slice('--passcodes-file='.length);
// .env-prefixed local files are excluded from Git. Open before account creation to check writability.
const passcodesFile = passcodesPath ? await open(passcodesPath, 'a', 0o600) : null;
const names = ['Diyan', 'Pranav', 'Rohan', 'Vitthal'];
const existing = [];
for (let page = 1; ; page++) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  existing.push(...data.users);
  if (data.users.length < 100) break;
}
try { for (const [id, name] of names.entries()) {
  const email = `${name.toLowerCase()}@roommates.invalid`;
  let user = existing.find(u => u.email === email);
  let passcode;
  if (!user) {
    passcode = randomBytes(9).toString('base64url');
    const { data, error } = await client.auth.admin.createUser({ email, password: passcode, email_confirm: true });
    if (error) throw error;
    user = data.user;
    // Save immediately so a later linking failure doesn't lose a newly generated passcode.
    if (passcodesFile) {
      await passcodesFile.write(`${name.toUpperCase()}_PASSCODE=${passcode}\n`);
      await passcodesFile.sync();
      console.log(`${name}: passcode saved privately.`);
    } else console.log(`${name}: ${passcode} — save privately; shown only on creation`);
  }
  const { error } = await client.rpc('link_roommate', { member_id: id, auth_user_id: user.id });
  if (error) throw error;
  console.log(`${name}: account linked${passcode ? '' : ' (existing passcode unchanged)'}.`);
  if (passcode && process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    const member = createClient(url, process.env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: loginError } = await member.auth.signInWithPassword({ email, password: passcode });
    if (loginError) throw loginError;
    const { data, error: boardError } = await member.rpc('get_dashboard');
    if (boardError) throw boardError;
    if (data.me !== id) throw new Error(`Incorrect household identity for ${name}.`);
    await member.auth.signOut({ scope: 'local' });
    console.log(`${name}: password login and household access verified.`);
  }
} } finally { await passcodesFile?.close(); }
