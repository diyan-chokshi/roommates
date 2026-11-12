import { useState, type ReactNode } from 'react';
import { projectDashboardUrl, type ServiceStatus } from './service-status';
import './recovery.css';

export function RecoveryPage({ status, brand, projectUrl, onRetry }: {
  status: ServiceStatus; brand: ReactNode; projectUrl: string; onRetry: () => Promise<boolean>;
}) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const paused = status === 'paused';
  const offline = status === 'offline';
  const dashboardUrl = projectDashboardUrl(projectUrl);
  async function retry() {
    if (checking) return;
    setChecking(true);
    try { await onRetry(); } finally { setChecking(false); setChecked(true); }
  }
  return <div className="app-shell recovery-shell"><header>{brand}<span className="eyebrow">HOUSEHOLD CONNECTION</span></header>
    <main className="recovery-main"><section className="panel recovery-card" aria-labelledby="recovery-title">
      <span className="recovery-icon" aria-hidden="true">{offline ? '↔' : '☾'}</span>
      <span className="eyebrow">{paused ? 'DATABASE PAUSED' : offline ? 'YOU’RE OFFLINE' : 'LET’S GET RECONNECTED'}</span>
      <h1 id="recovery-title">{paused ? 'Our home is taking a nap.' : offline ? 'A connection away from home.' : 'The board needs a moment.'}</h1>
      <p className="recovery-description">{paused
        ? 'Supabase has paused our household database. The site is here, but chores, votes, and reports need the database to come back online.'
        : offline ? 'Connect to the internet, then check again to return to the household board.'
        : 'We can’t confirm a connection to the household database. It may be paused, restarting, or temporarily unreachable.'}</p>
      {!offline && <div className="recovery-steps"><h2>Restore the connection</h2><ol>
        <li>Ask Diyan, the project owner, to open the Supabase dashboard.</li>
        <li>{paused ? 'Select Resume project and confirm.' : 'If the project is paused, select Resume project and confirm. Otherwise, check its service status.'}</li>
        <li>Wait until the project is ready, then check the connection here.</li>
      </ol><p>Resuming requires the owner’s Supabase account. This page can check the connection; it cannot resume the project itself.</p></div>}
      <div className="recovery-actions">{!offline && dashboardUrl && <a className="recovery-link" href={dashboardUrl} target="_blank" rel="noopener noreferrer">Open Supabase dashboard <span aria-hidden="true">↗</span></a>}
        <button className="primary" onClick={()=>void retry()} disabled={checking}>{checking ? 'Checking connection…' : 'Check connection & return'}</button></div>
      <p className="recovery-status" role="status" aria-live="polite">{checking ? 'Checking whether the database is ready…' : checked ? 'Still unable to connect. Wait a moment after resuming, then try again.' : 'We’ll return you to the app once the connection check succeeds.'}</p>
    </section></main><footer>under one roof · We’ll be back together soon.</footer></div>;
}
