const projectUrl = new URL(process.env.VITE_SUPABASE_URL || 'https://missing.invalid');
const projectRef = projectUrl.hostname.split('.')[0];
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token || projectUrl.hostname !== 'zlhakxdawtvfsokreuzp.supabase.co') {
  throw new Error('Expected this household project and SUPABASE_ACCESS_TOKEN in .env.local.');
}
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
async function request(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Auth configuration request failed: HTTP ${response.status}`);
  return response.json();
}
const desiredUrl = 'https://diyan-chokshi.github.io/roommates/';
let config = await request('GET');
if (config.site_url !== desiredUrl) {
  await request('PATCH', { site_url: desiredUrl });
  config = await request('GET');
}
console.log(JSON.stringify({
  site_url: config.site_url,
  signup_disabled: config.disable_signup,
  email_login_enabled: config.external_email_enabled,
  anonymous_login_enabled: config.external_anonymous_users_enabled,
}));
if (config.site_url !== desiredUrl || !config.disable_signup || !config.external_email_enabled || config.external_anonymous_users_enabled) {
  throw new Error('Review authentication settings: expected the Pages URL, email login enabled, and signup/anonymous access disabled.');
}
console.log('Authentication configuration verified.');
