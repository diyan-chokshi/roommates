import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error('Set VITE_SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_...) in .env.local.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const names = ['Diyan', 'Pranav', 'Rohan', 'Vitthal'];
const existing = [];
for (let page = 1; ; page++) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
  if (error) throw error;
  existing.push(...data.users);
  if (data.users.length < 100) break;
}
for (const [id, name] of names.entries()) {
  const email = `${name.toLowerCase()}@roommates.invalid`;
  let user = existing.find(u => u.email === email);
  let passcode;
  if (!user) {
    passcode = randomBytes(9).toString('base64url');
    const { data, error } = await client.auth.admin.createUser({ email, password: passcode, email_confirm: true });
    if (error) throw error;
    user = data.user;
    // Print immediately so a later linking failure doesn't lose a newly generated passcode.
    console.log(`${name}: ${passcode} — save privately; shown only on creation`);
  }
  const { error } = await client.rpc('link_roommate', { member_id: id, auth_user_id: user.id });
  if (error) throw error;
  console.log(`${name}: account linked${passcode ? '' : ' (existing passcode unchanged)'}.`);
}
