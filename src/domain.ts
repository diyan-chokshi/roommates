export const names = ['Diyan', 'Pranav', 'Rohan', 'Vitthal'] as const;
export const chores = ['Clean Kitchen', 'Clean Common Area', 'Dishwasher', 'Take Out Garbage'] as const;
export const hints = ['Counters, sink & stovetop', 'Living & dining spaces', 'Load, run & put away', 'Bins out, fresh bags in'];
export const loginEmail = (id: number) => `${names[id].toLowerCase()}@roommates.invalid`;
export const choreFor = (person: number, week: number) => (person + Math.max(week, 0)) % 4;
export const strikeCharge = (count: number) => Math.max(0, count - 3) * 45;
export const money = (value: number) => `$${value}`;
export const formatTime = (value: string, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...options,
}).format(new Date(value));

export interface Proposal { id: string; target: number; proposer: number; approvals: number[] }
export interface Report {
  week: number; start: string; end: string;
  people: { id: number; chore: number; missed: boolean; charge: number }[];
  strikes: { id: number; count: number; charge: number }[] | null;
}
export interface Dashboard {
  me: number; server_now: string; week: number; week_start: string; next_rotation: string;
  next_reset: string; vote_opens: string; voting_open: boolean; counts: number[];
  proposals: Proposal[]; chore_votes: { target: number; voter: number }[]; reports: Report[];
}
