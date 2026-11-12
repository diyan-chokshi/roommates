export type ServiceStatus = 'available' | 'paused' | 'unavailable' | 'offline' | 'unknown';

let status: ServiceStatus = 'available';
const listeners = new Set<() => void>();
export const getServiceStatus = () => status;
export function subscribeServiceStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(next: ServiceStatus) {
  if (next === status) return;
  status = next;
  listeners.forEach(listener => listener());
}
export function showConnectionHelp() { update('unknown'); }
const disconnected = () => typeof navigator !== 'undefined' && !navigator.onLine;

// Keep transport status intact: auth and PostgREST otherwise normalize gateway failures differently.
export const serviceFetch: typeof fetch = async (input, init) => {
  try {
    const response = await fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (response.status === 540) update('paused');
    else if (response.status >= 500 && status !== 'paused') update('unavailable');
    return response;
  } catch (error) {
    // Cancellation by the caller isn't evidence that Supabase is unavailable.
    if (!init?.signal?.aborted && status !== 'paused') update(disconnected() ? 'offline' : 'unavailable');
    throw error;
  }
};

export function projectDashboardUrl(projectUrl: string): string | null {
  try {
    const host = new URL(projectUrl).hostname;
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return match ? `https://supabase.com/dashboard/project/${match[1]}` : null;
  } catch { return null; }
}

// A public API probe works before login. It does not call a mutation or need administrative keys.
export async function checkConnection(projectUrl: string, publishableKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${projectUrl.replace(/\/$/, '')}/rest/v1/rpc/household_health`, {
      method: 'POST',
      headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    if (response.ok && await response.json() === true) { update('available'); return true; }
    update(response.status === 540 ? 'paused' : 'unavailable');
  } catch { update(disconnected() ? 'offline' : 'unavailable'); }
  return false;
}
