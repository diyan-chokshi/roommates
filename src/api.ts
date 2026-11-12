import { createClient } from '@supabase/supabase-js';
import type { Dashboard } from './domain';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT'));
export const supabase = configured ? createClient(url, key) : null;
export async function dashboard(): Promise<Dashboard> {
  const { data, error } = await supabase!.rpc('get_dashboard');
  if (error) throw new Error(error.message);
  return data as Dashboard;
}
export async function mutate(action: string, args: Record<string, unknown>) {
  const { error } = await supabase!.rpc(action, args);
  if (error) throw new Error(error.message);
}
