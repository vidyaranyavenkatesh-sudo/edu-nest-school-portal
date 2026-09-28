# EduNest — School Portal

This is one of two websites that make up EduNest, a school system built on Supabase:

- **School Portal** (this folder) — for admins and teachers: attendance, staff attendance with automatic substitutions, daily notes, marks entry, exams and report cards, timetable, grade (std) changes, accounts, messaging, official notices, audit log
- **Student Portal** (the other file you were given) — for students: attendance, missed-class notes, notes library, timetable, report cards, messaging

Both websites share one Supabase backend. This folder is self-contained and includes the whole database (`supabase/`) because the School Portal is where the admin sets everything up — you only need to do the Supabase steps below once, and the Student Portal will use the same project.

## What's new in this version

- **Staff attendance** (School office → Staff attendance): mark each teacher present, absent, late or on leave for the day, the same way attendance is taken for students.
- **Automatic substitutions**: the moment a teacher is marked absent or on leave — whether from Staff Attendance or from Leave → "Mark a teacher absent" — the system finds every period they have that day and suggests a free substitute for each one immediately. There is no longer a manual step for this to happen; the "Find substitutes" button on the Substitutions page is now just a catch-up tool for a range of dates, not the only way to trigger it.
- Teachers have their own **My attendance** page to see their attendance history, and an admin-only guard now hides every School office page from anyone who isn't an admin, even if they type the address directly.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), create a project. Choose the **Mumbai (ap-south-1)** region.
2. In **SQL Editor**, open `supabase/schema.sql`, paste its full contents, and run it. Then do the same with `supabase/storage.sql`.
   - If anything errors, stop and fix it before continuing — the file is written to run once, top to bottom, on an empty project.
3. In **Project Settings → API**, copy the **Project URL** and the **anon / public key** (or "publishable key" on newer projects).
4. In **Project Settings → API → Service role**, copy the **service_role key**. Keep this one secret — never put it in the Student Portal or in any file that reaches a browser.
5. (Recommended) In **Authentication → Providers → Email**, turn **off** "Allow new users to sign up". Accounts are created only by the School Portal's admin tools.
6. (Optional but recommended) In **Authentication → Hooks**, add a "Password verification attempt" hook pointing at the `public.hook_password_verification_attempt` function. This makes the login lockout impossible to bypass even by calling the Auth API directly.

## 2. Create the first school and admin

The database has no schools or people yet. Run this once in the SQL Editor (change the values first):

```sql
insert into public.schools (name, code, timezone) values ('Your School Name', 'DPS', 'Asia/Kolkata');
```

Note the school's `id` (select it back: `select id from public.schools;`). Then, in Supabase's **Authentication → Users**, click **Add user**, and create the first admin manually:

- Email: `dps-adm-0001@login.invalid` (must match `NEXT_PUBLIC_LOGIN_DOMAIN` — see below — and end with your school's code)
- Password: choose a temporary one and tell the admin
- Auto Confirm User: yes

Then, back in SQL Editor, link that user to a profile (replace the UUID with the new user's id, from the Users list, and the school id from above):

```sql
insert into public.profiles (id, school_id, role, login_id, full_name, must_change_password)
values ('paste-the-new-users-uuid', 'paste-the-school-id', 'admin', 'DPS-ADM-0001', 'Admin''s Name', true);
```

Log in to the School Portal with login ID `DPS-ADM-0001` and that password — it will ask to set a new password immediately. From there, the admin does everything else (School set-up → add teachers and students) through the website; nobody else needs direct SQL access.

## 3. Run it on your computer (localhost)

You need Node.js 18.18 or newer installed. Then:

```bash
cd school-portal
cp .env.example .env.local
```

Edit `.env.local` with the three values from step 1 (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). Then:

```bash
npm install
npm run dev
```

This starts the School Portal at **http://localhost:3000**.

### Running both websites on localhost at the same time

Unzip the Student Portal file you were given as a sibling folder (so you have `school-portal/` and `student-portal/` next to each other, though they don't need to be — each is independent). Set up its own `.env.local` too (see its README — it needs the same `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_LOGIN_DOMAIN` as this one, but never the service role key).

Open two terminals:

```bash
# Terminal 1
cd school-portal
npm run dev          # http://localhost:3000

# Terminal 2
cd student-portal
npm run dev          # http://localhost:3001
```

They run on different ports (`school-portal`'s `package.json` is already set to `-p 3000`, `student-portal`'s to `-p 3001`), so both stay up together — log in to one as a teacher or admin and the other as a student, in two browser tabs (or one normal window and one private/incognito window, since both use cookies and a school-office session and a student session shouldn't share a browser profile).

`NEXT_PUBLIC_LOGIN_DOMAIN` can stay as `login.invalid` (a reserved domain that never receives real mail) unless you have a reason to change it — if you do, use the same value in both apps.

## 4. Deploy

Each app deploys on its own, as a normal Next.js project.

**Vercel:** import the repo, set the *root directory* to `school-portal` (create a second Vercel project with root directory `student-portal`), and add the environment variables from `.env.local` under Project Settings → Environment Variables.

**Netlify:** same idea — two separate sites, each pointed at its folder (`netlify.toml` is already in each folder), with the same environment variables added under Site settings → Environment variables.

Use your school's real domains (e.g. `school.yourdomain.in` and `student.yourdomain.in`), not the two testing subdomains together — logins are cookie-based per site.

## What was tested, and what wasn't

Tested against a local Postgres 16 database with the same access rules (Row Level Security), the same PostgREST API layer Supabase uses, and a Chromium browser: every page for admin, teacher and student; taking attendance and the same-day absentee-note flow; staff attendance triggering automatic substitution suggestions the instant a teacher is marked absent, from every entry point (Staff Attendance page, Leave page, and the manual catch-up button), with no double-booking possible; marks entry through locking, publishing and report cards (including a corrected re-publish); chat between all three roles, including reporting a message, muting, class groups, and admin review; substitution decline-and-reoffer; year-end grade (std) changes including a rule-based run, mid-year moves, applying and reversing; account creation (single and bulk), forced password change, reset, disable/enable, the login lockout, and that a teacher visiting an admin-only page or calling an admin-only function directly is refused, even bypassing the website.

Not tested: your actual Supabase project (regional latency, email deliverability if you add it later, Realtime under real load), a phone's native share/download behaviour for the printed report card PDF, and languages other than English. Try a full walkthrough with two or three real people before rolling it out to the whole school.

## If you change shared code

Some files under `lib/` and `components/` are identical to the same files in the Student Portal (the login screen's building blocks, the chat widget, the stylesheet). If you change one of those, make the same change in the other app's copy — there's no longer a build step linking them once each app is delivered as its own zip.

## Support

If a page shows a red error box, that message is written to be specific enough to act on (e.g. "This day is locked; ask the admin"). The audit log (School Portal → Audit log) records who changed what and when, which is the first place to look if something looks wrong.
