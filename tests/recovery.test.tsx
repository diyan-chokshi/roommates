import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RecoveryPage } from '../src/RecoveryPage';
import { checkConnection, getServiceStatus, projectDashboardUrl, serviceFetch, showConnectionHelp, subscribeServiceStatus } from '../src/service-status';

const url = 'https://project123.supabase.co';
const mockFetch = vi.fn<typeof fetch>();
beforeEach(async()=>{
  vi.stubGlobal('fetch', mockFetch);
  vi.stubGlobal('navigator', { onLine: true });
  mockFetch.mockResolvedValue(new Response('true', {status:200}));
  await checkConnection(url,'sb_publishable_test');
  mockFetch.mockReset();
});
afterEach(()=>vi.unstubAllGlobals());

describe('database availability',()=>{
  it('identifies gateway 540 as paused before login or in an authenticated request',async()=>{
    mockFetch.mockResolvedValue(new Response('Project paused',{status:540}));
    const response=await serviceFetch(`${url}/auth/v1/token`);
    expect(response.status).toBe(540);expect(getServiceStatus()).toBe('paused');
  });
  it('does not mistake incorrect passwords or access denials for a paused project',async()=>{
    for(const status of [400,401,403,404,429]){
      mockFetch.mockResolvedValue(new Response('{}',{status}));await serviceFetch(`${url}/auth/v1/token`);
      expect(getServiceStatus()).toBe('available');
    }
  });
  it('shows generic recovery for server failures and network errors',async()=>{
    mockFetch.mockResolvedValue(new Response('Gateway timeout',{status:544}));await serviceFetch(url);
    expect(getServiceStatus()).toBe('unavailable');
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));await expect(serviceFetch(url)).rejects.toThrow();
    expect(getServiceStatus()).toBe('unavailable');
  });
  it('distinguishes offline failures',async()=>{
    vi.stubGlobal('navigator',{onLine:false});mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(serviceFetch(url)).rejects.toThrow();expect(getServiceStatus()).toBe('offline');
  });
  it('does not interpret caller cancellation as an outage',async()=>{
    const controller=new AbortController();controller.abort();
    mockFetch.mockRejectedValue(new DOMException('Aborted','AbortError'));
    await expect(serviceFetch(url,{signal:controller.signal})).rejects.toThrow();expect(getServiceStatus()).toBe('available');
  });
  it('keeps the paused screen until an explicit successful retry',async()=>{
    mockFetch.mockResolvedValue(new Response('',{status:540}));await serviceFetch(url);
    mockFetch.mockResolvedValue(new Response('{}',{status:200}));await serviceFetch(`${url}/auth/v1/settings`);
    expect(getServiceStatus()).toBe('paused');
    mockFetch.mockResolvedValue(new Response('true',{status:200}));
    expect(await checkConnection(url,'sb_publishable_test')).toBe(true);expect(getServiceStatus()).toBe('available');
    expect(mockFetch).toHaveBeenLastCalledWith(`${url}/rest/v1/rpc/household_health`,expect.objectContaining({method:'POST',headers:{apikey:'sb_publishable_test','Content-Type':'application/json'},cache:'no-store'}));
  });
  it('does not dismiss recovery when the probe still fails',async()=>{
    mockFetch.mockResolvedValue(new Response('',{status:540}));expect(await checkConnection(url,'key')).toBe(false);
    expect(getServiceStatus()).toBe('paused');
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));expect(await checkConnection(url,'key')).toBe(false);
    expect(getServiceStatus()).toBe('unavailable');
  });
  it('requires the expected health response, not merely HTTP 200',async()=>{
    showConnectionHelp();mockFetch.mockResolvedValue(new Response('{}',{status:200}));
    expect(await checkConnection(url,'key')).toBe(false);expect(getServiceStatus()).toBe('unavailable');
  });
  it('notifies subscribers and supports opening help without asserting a pause',()=>{
    const listener=vi.fn();const unsubscribe=subscribeServiceStatus(listener);
    showConnectionHelp();expect(listener).toHaveBeenCalledTimes(1);expect(getServiceStatus()).toBe('unknown');
    unsubscribe();showConnectionHelp();expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('recovery page',()=>{
  it('renders owner instructions and the correct Supabase project link',()=>{
    const html=renderToStaticMarkup(<RecoveryPage status="paused" brand="Under One Roof" projectUrl={url} onRetry={async()=>true}/>);
    expect(html).toContain('DATABASE PAUSED');expect(html).toContain('Ask Diyan');expect(html).toContain('Resume project');
    expect(html).toContain('https://supabase.com/dashboard/project/project123');expect(html).toContain('Check connection &amp; return');
    expect(html).toContain('cannot resume the project itself');
  });
  it('does not claim an unconfirmed outage is a pause',()=>{
    const html=renderToStaticMarkup(<RecoveryPage status="unavailable" brand="Under One Roof" projectUrl={url} onRetry={async()=>false}/>);
    expect(html).toContain('temporarily unreachable');expect(html).not.toContain('DATABASE PAUSED');
  });
  it('gives offline guidance without sending users to resume the database',()=>{
    const html=renderToStaticMarkup(<RecoveryPage status="offline" brand="Under One Roof" projectUrl={url} onRetry={async()=>false}/>);
    expect(html).toContain('Connect to the internet');expect(html).not.toContain('Open Supabase dashboard');
  });
  it('does not construct dashboard links from unexpected project URLs',()=>{
    expect(projectDashboardUrl('not a URL')).toBeNull();expect(projectDashboardUrl('https://example.com')).toBeNull();
  });
});
