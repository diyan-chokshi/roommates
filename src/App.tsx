import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Session } from '@supabase/supabase-js';
import { configured, dashboard, mutate, retryConnection, supabase } from './api';
import { RecoveryPage } from './RecoveryPage';
import { getServiceStatus, showConnectionHelp, subscribeServiceStatus } from './service-status';
import { choreFor, chores, formatTime, hints, loginEmail, money, names, strikeCharge, type Dashboard, type Report } from './domain';

function HouseMark() {
  return <span className="house-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M5 15 16 5l11 10v13H5V15Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/><path d="M12 28V17h8v11M22 5v6" stroke="currentColor" strokeWidth="2"/></svg></span>;
}
function Brand() { return <div className="brand"><HouseMark /><span>under one roof<span className="brand-sub">FOUR PEOPLE. ONE HOME.</span></span></div>; }

function Login() {
  const [person, setPerson] = useState(0);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email: loginEmail(person), password: passcode });
      if (error) throw error;
    } catch { setError('Couldn’t sign in. Check your passcode and connection, then try again.'); }
    finally { setBusy(false); }
  }
  return <div className="login-shell"><header><Brand /><span className="eyebrow">THE HOUSEHOLD BOARD</span></header>
    <main className="login-layout"><div className="login-intro"><span className="eyebrow">A LITTLE STRUCTURE. A BETTER HOME.</span><h1>Good roommates.<br /><em>Shared responsibility.</em></h1><p>Our weekly chores, a little accountability, and one less thing for the group chat.</p><div className="people-stack" aria-hidden="true">{names.map((n,i)=><span className={`avatar color-${i}`} key={n}>{n[0]}</span>)}<span className="stack-caption">Our place, together.</span></div></div>
      <section className="login-card"><span className="section-number">01 / COME ON IN</span><h2>Who’s home?</h2><p>Choose your name and enter your passcode.</p>
        {!configured ? <div className="setup-note"><strong>The board is ready for setup.</strong><p>Connect your Supabase project to enable sign-in. Follow the setup instructions in the repository README.</p></div> : <form onSubmit={signIn}>
          <div className="person-picker" role="group" aria-label="Choose your name">{names.map((n,i)=><button type="button" aria-pressed={person===i} className={person===i?'selected':''} key={n} onClick={()=>{setPerson(i);setPasscode('');setError('');}}>{n}</button>)}</div>
          <label htmlFor="passcode">Your passcode</label><input id="passcode" type="password" autoComplete="current-password" required value={passcode} onChange={e=>setPasscode(e.target.value)} placeholder="Enter your personal passcode" />
          {error && <p role="alert" className="error">{error}</p>}<button className="primary wide" disabled={busy || !passcode}>{busy?'Opening the door…':'Open the board'} <span aria-hidden="true">↗</span></button><p className="fine-print">You’ll stay signed in on this device.</p><button type="button" className="connection-help" onClick={showConnectionHelp}>Trouble connecting? Restore database</button>
        </form>}
      </section></main><footer>Less mess. More living.</footer></div>;
}

function WeekReport({ report }: {report: Report}) {
  return <div className="report-content"><div className="report-period"><span className="tag">WEEK {report.week+1}</span><span>{formatTime(report.start,{hour:undefined,minute:undefined})} — {formatTime(report.end,{hour:undefined,minute:undefined,year:'numeric'})}</span></div>
    <div className="table-scroll"><table><caption className="sr-only">Completed week’s chores and missed-chore charges</caption><thead><tr><th>Roommate</th><th>Assigned chore</th><th>Chore result</th><th className="numeric">Charge</th></tr></thead><tbody>{report.people.map(p=><tr key={p.id}><th scope="row"><span className={`dot color-${p.id}`}/>{names[p.id]}</th><td>{chores[p.chore]}</td><td><span className={p.missed?'result charged':'result'}>{p.missed?'Missed · 3 votes':'No charge'}</span></td><td className="numeric">{money(p.charge)}</td></tr>)}</tbody></table></div>
    {report.strikes && <div className="strike-summary"><div><span className="eyebrow">FOUR-WEEK WRAP-UP</span><h3>A fresh start.</h3><p>These are the closing totals. The new period starts at zero.</p></div><div className="summary-grid">{report.strikes.map(s=><div key={s.id}><strong>{names[s.id]}</strong><span>{s.count} strike{s.count===1?'':'s'}</span><b>{money(s.charge)}</b></div>)}</div></div>}
    <p className="report-note">Chore charges require all three roommates’ votes at cutoff. “No charge” does not certify completion. Add any charges to your cost-splitting app manually.</p>
  </div>;
}

function Board({ onLogout }: {onLogout:()=>Promise<void>}) {
  const [data,setData] = useState<Dashboard|null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [busy,setBusy] = useState(false);
  const [online,setOnline] = useState(navigator.onLine);
  const [selectedReport,setSelectedReport] = useState<number|null>(null);
  const [confirmTarget,setConfirmTarget] = useState<number|null>(null);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const refresh = useCallback(async()=>{
    if (inFlight.current) return;
    inFlight.current=true;
    try {setData(await dashboard());setError('');} catch(e) {setError(e instanceof Error?e.message:'Unable to load the board.');}
    finally {inFlight.current=false;}
  },[]);
  useEffect(()=>{
    void refresh();
    const onFocus=()=>{if(!document.hidden) void refresh();};
    const onOnline=()=>{setOnline(true);void refresh();};
    const onOffline=()=>setOnline(false);
    const timer=window.setInterval(onFocus,15000);
    window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onFocus);
    window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);
    return ()=>{clearInterval(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);};
  },[refresh]);
  useEffect(()=>{
    if(!data) return;
    const now=new Date(data.server_now).getTime();
    const next=[data.next_rotation,data.vote_opens].map(v=>new Date(v).getTime()).filter(t=>t>now).sort((a,b)=>a-b)[0];
    if(!next) return;
    const timer=setTimeout(()=>void refresh(),Math.min(next-now+150,2147483647));
    return ()=>clearTimeout(timer);
  },[data,refresh]);
  useEffect(()=>{if(confirmTarget!==null)dialog.current?.showModal();else dialog.current?.close();},[confirmTarget]);
  async function action(name:string,args:Record<string,unknown>,message:string) {
    if(busy || !online) return;
    setBusy(true);setError('');setNotice('');
    try {await mutate(name,args);setNotice(message);await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Could not save. Please retry.');}
    finally{setBusy(false);}
  }
  const disabled=busy || !online;
  const report=data?.reports.find(r=>r.week===selectedReport) ?? data?.reports[0];
  return <div className="app-shell"><header className="topbar"><Brand /><div className="account">{data && <span className={`avatar small color-${data.me}`}>{names[data.me][0]}</span>}<span>{data?names[data.me]:'Your account'}</span><button className="text-button" onClick={()=>void onLogout().catch(e=>setError(e.message))}>Log out</button></div></header>
    <main>
      <div className="page-heading"><div><span className="eyebrow">THE HOUSEHOLD BOARD</span><h1>A home we all<br className="mobile-break" /> <em>take care of.</em></h1><p>Four roommates. Four chores. A fresh turn every week.</p></div><div className="house-note"><span aria-hidden="true">✳</span><p>A little effort<br />goes a long way.</p></div></div>
      {!online && <div className="banner" role="status">You’re offline. The last loaded board is shown; reconnect to vote or see updates.</div>}
      {error && <div className="banner error" role="alert">{error}<button className="text-button" onClick={()=>void refresh()}>Retry</button></div>}
      <div className="sr-only" role="status">{notice}</div>
      {!data ? <section className="panel loading" aria-busy={!error}>{error?'The board couldn’t load. Use Retry above.':'Getting the household together…'}</section> : <>
        <div className="schedule-strip"><span><span className="status-dot"/>{data.week<0?'STARTING SOON':`WEEK ${data.week+1}`}<span className="strip-divider">/</span>{data.week<0?'First assignments':`Period ${Math.floor(data.week/4)+1} · week ${data.week%4+1} of 4`}</span><span>{data.week<0?'Starts':'Next rotation'} <strong>{formatTime(data.next_rotation)} ET</strong></span></div>
        <section aria-labelledby="chores-title"><div className="section-heading"><h2 id="chores-title">{data.week<0?'Our first assignments':'This week’s lineup'}<span className="heading-count">04</span></h2><span className="section-aside">EVERYONE TAKES A TURN</span></div>
          <div className="roommate-grid">{names.map((name,id)=>{const chore=choreFor(id,data.week);const pending=data.proposals.some(p=>p.target===id);return <article className={`roommate-card card-${id}`} key={name}>
            <div className="card-top"><span className={`avatar color-${id}`}>{name[0]}</span><span className="card-index">0{id+1}</span></div><div className="roommate-name">{name}{data.me===id && <span className="you">YOU</span>}</div><h3>{chores[chore]}</h3><p className="chore-hint">{hints[chore]}</p>
            <div className="card-stats"><div><span>STRIKES THIS PERIOD</span><div className="strike-dots" aria-label={`${data.counts[id]} strikes`}>{[0,1,2].map(i=><span className={i<data.counts[id]?'filled':''} key={i}/>)}<b>{data.counts[id]}<small> / 3 free</small></b></div></div><div className="charge"><span>STRIKE CHARGE</span><b>{money(strikeCharge(data.counts[id]))}</b></div></div>
            <button className="propose-button" disabled={disabled||id===data.me||pending||data.week<0} onClick={()=>setConfirmTarget(id)}>{id===data.me?'Your corner of the house':pending?'Proposal awaiting votes':'Propose a strike'}{id!==data.me&&!pending&&<span aria-hidden="true">＋</span>}</button>
          </article>;})}</div>
          <div className="rules-line"><span>Three free strikes. $45 for each one after.</span><span>Fresh start: {formatTime(data.next_reset)} ET</span></div>
        </section>
        <div className="board-columns"><section className="panel" aria-labelledby="strikes-title"><div className="panel-heading"><div><span className="section-number">01 / ACCOUNTABILITY</span><h2 id="strikes-title">Strike proposals <span className="heading-count">{data.proposals.length.toString().padStart(2,'0')}</span></h2></div><span className="mini-symbol" aria-hidden="true">↗</span></div>
          <p className="panel-description">A strike counts when all three other roommates agree.</p>
          {data.proposals.length===0?<div className="empty-state"><span aria-hidden="true">✓</span><h3>All clear here.</h3><p>No strike proposals waiting for a vote.</p></div>:<div className="proposal-list">{data.proposals.map(p=><article className="proposal" key={p.id}><h3>Strike for {names[p.target]}</h3><p>Proposed by {names[p.proposer]} <span>· {p.approvals.length}/3 agree</span></p><div className="voter-list">{names.map((n,i)=>i!==p.target&&<span className={p.approvals.includes(i)?'approved':''} key={n}>{p.approvals.includes(i)?'✓':'○'} {n}</span>)}</div><div className="vote-actions">{data.me===p.proposer?<button disabled={disabled} onClick={()=>void action('respond_strike',{proposal_id:p.id,decision:'cancel'},'Proposal cancelled.')}>Cancel proposal</button>:data.me===p.target?<span className="fine-print">Only your other roommates can vote.</span>:p.approvals.includes(data.me)?<span className="fine-print">Your approval is recorded.</span>:<><button className="primary" disabled={disabled} onClick={()=>void action('respond_strike',{proposal_id:p.id,decision:'approve'},'Approval recorded.')}>Agree</button><button disabled={disabled} onClick={()=>void action('respond_strike',{proposal_id:p.id,decision:'reject'},'Proposal rejected.')}>Reject</button></>}</div></article>)}</div>}
        </section>
        <section className="panel chore-panel" aria-labelledby="chore-vote-title"><div className="panel-heading"><div><span className="section-number">02 / WEEKLY CHECK-IN</span><h2 id="chore-vote-title">Did we do our part?</h2></div><span className={`tag ${data.voting_open?'live':''}`}>{data.voting_open?'VOTING OPEN':'OPENS SUNDAY'}</span></div><p className="panel-description">Sunday 8 AM–11:59 PM ET. Three “not done” votes at cutoff add a $45 charge. You can withdraw your vote if the chore gets done.</p>
          <div className="chore-vote-list">{names.map((n,i)=>{const votes=data.chore_votes.filter(v=>v.target===i);const mine=votes.some(v=>v.voter===data.me);return <div className="chore-vote-row" key={n}><span className={`avatar small color-${i}`}>{n[0]}</span><div className="chore-vote-person"><strong>{n}</strong><span>{chores[choreFor(i,data.week)]}</span><span className="vote-names">{votes.length?`${votes.map(v=>names[v.voter]).join(', ')} voted not done`:'No votes recorded'}</span></div><div className="chore-vote-control"><span>{votes.length}/3</span>{i===data.me?<span className="fine-print">Your chore</span>:<button aria-label={`${mine?'Withdraw not-done vote for':'Vote chore not done for'} ${n}`} className={mine?'voted':''} disabled={disabled||!data.voting_open} onClick={()=>void action('set_chore_vote',{target_id:i,not_done:!mine,expected_week:data.week},mine?'Vote withdrawn.':'Not-done vote recorded.')}>{mine?'Withdraw':'Not done'}</button>}</div></div>;})}</div>
        </section></div>
        <section className="panel reports-panel" aria-labelledby="report-title"><div className="panel-heading"><div><span className="section-number">03 / THE WEEK IN REVIEW</span><h2 id="report-title">Household report</h2></div>{data.reports.length>0&&<div className="report-picker"><label htmlFor="report-week" className="sr-only">Choose a weekly report</label><select id="report-week" value={report?.week??''} onChange={e=>setSelectedReport(Number(e.target.value))}>{data.reports.map((r,i)=><option key={r.week} value={r.week}>Week {r.week+1}{i===0?' · latest':''} · {formatTime(r.end,{hour:undefined,minute:undefined})}</option>)}</select></div>}</div>
          {report?<WeekReport report={report}/>:<div className="empty-state report-empty"><span aria-hidden="true">≡</span><h3>The first chapter is still being written.</h3><p>Your first report appears after the November 22, 11:59 PM rotation.</p></div>}
        </section>
        <div className="next-week"><span className="eyebrow">UP NEXT · {formatTime(data.next_rotation)} ET</span><div>{names.map((n,i)=><span key={n}><strong>{n}</strong> {chores[choreFor(i,data.week<0?0:data.week+1)]}</span>)}</div></div>
      </>}
    </main><footer><span>under one roof <span aria-hidden="true">✳</span> a shared space, a shared effort.</span><span>All times Eastern.</span></footer>
    <dialog ref={dialog} onCancel={()=>setConfirmTarget(null)} onClose={()=>setConfirmTarget(null)}><div className="dialog-content"><span className="eyebrow">A LITTLE ACCOUNTABILITY</span><h2>Propose a strike for {confirmTarget!==null?names[confirmTarget]:''}?</h2><p>Your approval counts as the first vote. The other two roommates must agree before it counts. You can cancel while it’s pending.</p><div className="vote-actions"><button onClick={()=>setConfirmTarget(null)}>Go back</button><button className="primary" disabled={disabled} onClick={()=>{const target=confirmTarget;setConfirmTarget(null);void action('propose_strike',{target_id:target,request_id:crypto.randomUUID()},'Strike proposed. Waiting for the other roommates.');}}>Propose strike</button></div></div></dialog>
  </div>;
}

export default function App() {
  const serviceStatus = useSyncExternalStore(subscribeServiceStatus, getServiceStatus);
  const [session,setSession]=useState<Session|null>(null);
  const [ready,setReady]=useState(!configured);
  const [authError,setAuthError]=useState('');
  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    void supabase.auth.getSession().then(({data,error})=>{if(active){setSession(data.session);setAuthError(error?'Could not restore your session. Sign in again.':'');setReady(true);}}).catch(()=>{if(active){setAuthError('Could not restore your session. Sign in again.');setReady(true);}});
    const {data}=supabase.auth.onAuthStateChange((_event,next)=>{setSession(next);setReady(true);});
    return()=>{active=false;data.subscription.unsubscribe();};
  },[]);
  if(configured && serviceStatus !== 'available') return <RecoveryPage status={serviceStatus} brand={<Brand />} projectUrl={import.meta.env.VITE_SUPABASE_URL} onRetry={retryConnection} />;
  if(!ready)return <div className="initial-loading"><Brand /><p>Opening the household board…</p></div>;
  if(!session)return <>{authError&&<p className="banner error" role="alert">{authError}</p>}<Login /></>;
  return <Board key={session.user.id} onLogout={async()=>{const {error}=await supabase!.auth.signOut({scope:'local'});if(error)throw error;}} />;
}
