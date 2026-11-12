# Under One Roof

A private household board for Diyan, Pranav, Rohan, and Vitthal. Static React frontend on GitHub Pages; Supabase Auth and Postgres enforce the household rules. No paid services, email service, scheduler, or running application server required.

## Household rules

- Starts **November 16, 2026, 12:00 AM America/New_York** with Diyan → Clean Kitchen, Pranav → Clean Common Area, Rohan → Dishwasher, Vitthal → Take Out Garbage.
- Chores shift forward one position each Sunday at **23:59:00 Eastern**. The first rotation is November 22. The first week is one minute shorter than a calendar week, per the chosen start time.
- A common-area strike requires all three non-target roommates. The proposer automatically approves; the other two approve or reject. One pending proposal per target. An eligible rejection closes it; only the proposer can cancel while pending. Approved strikes are final.
- Three strikes are free in each four-week period; each additional strike costs **$45 USD**.
- Missed-chore voting runs Sunday **08:00:00 inclusive to 23:59:00 exclusive**. Each non-target roommate independently sets or withdraws their vote. All three votes must remain at cutoff for one **$45** charge. These votes are separate from strikes.
- Every fourth rotation resets strikes and pending strike proposals. The first reset is December 13, 2026, at 23:59 Eastern.
- Each completed week has a permanent report of its assignments and missed-chore charges. Every fourth report also preserves closing strike counts and charges. There is no running debt or payment tracking; enter charges into your cost-splitting app manually.

## Local development

Requires Node.js 22.14+ and npm.

```powershell
npm ci
Copy-Item .env.example .env.local
# Fill in the two VITE_SUPABASE values after creating a project below.
npm run dev
```

Open the URL printed by Vite. Without configuration the login screen displays a setup message; it does not invent data or pretend to save votes.

```powershell
npm test
npm run build
npm run preview
```

Tests run the actual SQL migration in PGlite (PostgreSQL compiled to WASM), using an isolated Auth stub and deterministic clock. No hosted credentials are needed. They cover SQL authorization, voting, reset/report generation, and DST. They do not simulate the hosted Supabase Auth service or its password rate limits.

## One-time Supabase setup

1. Create a **Free** Supabase project. Save the database password privately. No paid upgrade is needed. Low-activity free projects may pause and require restoration in the Supabase dashboard.
2. In SQL Editor, execute the files in `supabase/migrations/` once each, in filename order. The first creates private tables and narrow authenticated RPCs; the second adds a public read-only health check with no household data. Do not expose the `app_private` schema through the Data API.
3. Under Authentication → Providers / Sign In, enable email/password and **disable new user signups**. Disable anonymous sign-in. The four users are created with the admin API, so no confirmation mail is sent.
4. Under Project Settings → API Keys, copy the project URL and **publishable key** (`sb_publishable_...`) into `.env.local`. Keep the **secret key** (`sb_secret_...`) only in the unprefixed `SUPABASE_SECRET_KEY` variable. Never use that key as a `VITE_` value, a GitHub variable, or frontend configuration. Use the new publishable/secret keys rather than legacy anon/service-role API keys. Secret keys still use the Postgres `service_role` role, so the migration's database grants remain correct. The separate `SUPABASE_ACCESS_TOKEN` is a management token for executing migrations; it is not an application API key.
5. Provision the four accounts from your local terminal:

   ```powershell
   npm run provision
   ```

   Save the generated passcodes in a password manager and send each roommate only their own passcode through a private channel. The script prints each passcode once on account creation; reruns reuse accounts and do not change passwords. Do not run provisioning in CI, record the terminal, or share its output. Browser sessions stay signed in; the passcode can also be saved in a password manager.

   To save newly generated passcodes in an ignored local file instead of printing them:

   ```powershell
   npm run provision -- --passcodes-file=.env.roommate-passcodes.local
   ```

   The script also verifies password sign-in and household access for each newly created account. The passcode file is excluded from Git by the `.env*` rule. Keep it private; rerunning provisioning does not recover or replace existing passwords.

6. Remove `SUPABASE_SECRET_KEY` from `.env.local` when provisioning is complete.
7. Set Authentication → URL Configuration → Site URL to `https://diyan-chokshi.github.io/roommates/`. The app uses password login rather than redirects or magic links.

   Alternatively, with `SUPABASE_ACCESS_TOKEN` authorized for this project’s Auth configuration, run `node --env-file=.env.local scripts/configure-auth.mjs`. This sets the Site URL and verifies that email login is enabled and new signups/anonymous sign-ins are disabled. Account provisioning and this URL configuration can be completed before publishing GitHub Pages.

Login names map internally to `diyan@roommates.invalid`, `pranav@roommates.invalid`, `rohan@roommates.invalid`, and `vitthal@roommates.invalid`. These are identifiers, not inboxes. Do not send mail to them. There is no reset UI; a rare manual reset can be performed through the Supabase Auth admin API for the existing user. Do not delete/recreate accounts, because member identities are linked to their user IDs.

The four membership IDs are fixed, starting at zero in the listed order. Anyone else who obtains an Auth account still cannot access the household because every RPC checks membership. The public key is safe to embed; access is enforced in Postgres, not by hiding the website URL.

## GitHub Pages deployment

The included workflow tests and builds each push to `main`, then deploys the static artifact. Pull requests run checks without deployment.

1. In `diyan-chokshi/roommates`, set Settings → Pages → Build and deployment → Source to **GitHub Actions**.
2. Under Settings → Secrets and variables → Actions → **Variables**, add:
   - `VITE_SUPABASE_URL`: project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable key (`sb_publishable_...`)
3. Push this project to `main` or run the workflow manually once the files are on GitHub.
4. The deployment URL is `https://diyan-chokshi.github.io/roommates/`.

Never add a secret API key or management access token to this workflow. There are no server secrets in the deployed static app. The workflow sets the repository asset prefix automatically. To build a project-site preview locally:

```powershell
$env:VITE_BASE_PATH = '/roommates/'
npm run build
```

Use a public repository for free GitHub-hosted Actions/Pages availability without a paid GitHub plan. Login protects household data even though the static site and source are public. Commit no passcodes, `.env.local`, or private keys. The `.gitignore` excludes local environment files.

## Data flow and rollover

`get_dashboard()` uses database time and a transaction-level household lock. Before reading it finalizes every missing completed week in order, saves immutable report snapshots, clears the completed week's chore votes, and clears the closing period's strike proposals only after preserving its totals. Mutations take the same lock and check time **after** acquisition. Direct browser writes to tables are denied.

The browser reloads data every 15 seconds while visible, on focus/reconnection, after actions, and at the next opening/rotation boundary. A missed browser timer cannot extend a deadline: the database is authoritative. Reports materialize on the first authenticated operation after cutoff; multiple weeks of inactivity are handled on the next visit. No user needs to keep a tab open.

### Database recovery page

Supabase gateway status 540 opens a dedicated paused-database page from either login or the board. Network and other server failures show connection-recovery guidance without claiming that the project is paused. Invalid passwords and ordinary access errors stay in their existing flows. A recovery link is also available on the login screen.

The page links to the project dashboard and explains how the owner can resume the project. **Check connection & return** calls the read-only `household_health` RPC using only the publishable key; it returns to the app only after Postgres responds successfully. This function returns only `true`, exposes no household records, and cannot change data. No management access token or secret API key is included in the website, and the page cannot resume Supabase itself. Transport and recovery-page tests use simulated failures rather than pausing the live household database.

RPCs:

| Operation | Input | Behavior |
| --- | --- | --- |
| `get_dashboard` | none | Identity, authoritative schedule, current strikes/proposals/votes, reports newest first |
| `propose_strike` | `target_id`, `request_id` UUID | Idempotent proposal creation with proposer approval |
| `respond_strike` | `proposal_id`, `decision` | `approve`, `reject`, or proposer-only `cancel` |
| `set_chore_vote` | `target_id`, `not_done`, `expected_week` | Set/withdraw own vote within that week's Sunday window |
| `link_roommate` | `member_id`, `auth_user_id` | Service-role-only initial provisioning |

Amounts are derived from votes and approved strikes, never supplied by the client. Weekly snapshots retain only the report data needed for the archive; the app has no payment status or raw historical incident browser.

## Deployment acceptance check

After connecting the real project, sign in with two different roommate accounts in separate browser profiles. Check that names cannot be impersonated by changing the picker after login, a proposed strike appears in both sessions, the target cannot vote on it, and logging out returns to the name picker. Confirm another non-target roommate can approve and only the third approval counts the strike. Confirm report dropdown and Sunday chore controls on the first real household week; automated SQL tests cover these future dates in advance.
