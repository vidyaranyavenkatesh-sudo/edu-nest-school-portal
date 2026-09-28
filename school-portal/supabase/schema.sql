-- =====================================================================
-- EduNest for Supabase (Postgres 15+)
-- Run this whole file once in the Supabase SQL editor on a NEW project,
-- then run storage.sql.
-- =====================================================================

create schema if not exists internal;
revoke all on schema internal from public;

-- Default settings. A school can override any key in schools.settings.
create or replace function internal.default_settings() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'attendance_mode', 'day',                -- 'day' or 'period'
    'attendance_lock_days', 7,               -- older days lock for teachers
    'late_counts_as_attended', true,
    'low_attendance_threshold', 75,
    'student_chat_enabled', true,
    'quiet_hours', jsonb_build_object('enabled', false, 'start', '21:00', 'end', '06:00'),
    'max_upload_mb', 10,
    'max_extra_periods_per_day', 2,
    'substitution_rank', jsonb_build_array('subject', 'grade'),
    'lockout_attempts', 5,
    'lockout_minutes', 15,
    'promotion_reverse_days', 14,
    'min_attendance_for_promotion', 75,
    'pass_percent', 33
  )
$$;

-- ---------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique check (code = upper(code) and code ~ '^[A-Z0-9]{2,10}$'),
  timezone text not null default 'Asia/Kolkata',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  role text not null check (role in ('admin', 'teacher', 'student')),
  login_id text not null unique check (login_id = upper(login_id)),
  full_name text not null,
  is_active boolean not null default true,
  disabled_from date,
  must_change_password boolean not null default true,
  messaging_disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index profiles_school_role on public.profiles (school_id, role);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date > start_date),
  unique (school_id, name)
);
create unique index academic_years_one_current on public.academic_years (school_id) where is_current;

create table public.grade_levels (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  order_no int not null,
  unique (school_id, name),
  unique (school_id, order_no)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete restrict,
  section text not null default 'A',
  class_teacher_id uuid references public.profiles(id) on delete set null,
  chat_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (academic_year_id, grade_level_id, section)
);

create table public.enrolments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  roll_no int,
  status text not null default 'active'
    check (status in ('active', 'promoted', 'held_back', 'passed_out', 'left')),
  created_at timestamptz not null default now(),
  unique (student_id, academic_year_id),
  unique (class_id, roll_no)
);
create index enrolments_class on public.enrolments (class_id);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  code text,
  unique (school_id, name)
);

create table public.teaching_assignments (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  unique (class_id, subject_id)
);
create index teaching_assignments_teacher on public.teaching_assignments (teacher_id);

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  number int not null,
  label text,
  start_time time not null,
  end_time time not null,
  unique (school_id, number),
  check (end_time > start_time)
);

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),   -- 1 = Monday
  period_id uuid not null references public.periods(id) on delete cascade,
  unique (class_id, weekday, period_id),
  unique (academic_year_id, teacher_id, weekday, period_id)    -- a teacher cannot be in two places
);
create index timetable_teacher on public.timetable_entries (teacher_id);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('teacher', 'student')),
  from_date date not null,
  to_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index leave_requester on public.leave_requests (requester_id);

create table public.substitutions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  timetable_entry_id uuid not null references public.timetable_entries(id) on delete cascade,
  period_id uuid references public.periods(id) on delete cascade,
  date date not null,
  absent_teacher_id uuid references public.profiles(id) on delete set null,
  substitute_id uuid references public.profiles(id) on delete set null,
  status text not null default 'suggested'
    check (status in ('unassigned', 'suggested', 'approved', 'accepted', 'declined', 'self_study')),
  declined_by uuid[] not null default '{}',
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (timetable_entry_id, date)
);
-- The database itself refuses to book one substitute into two rooms at once.
create unique index substitutions_no_double_booking
  on public.substitutions (substitute_id, date, period_id)
  where substitute_id is not null and status in ('suggested', 'approved', 'accepted');

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  date date not null,
  period_id uuid references public.periods(id) on delete restrict,
  status text not null check (status in ('present', 'absent', 'late', 'leave')),
  marked_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index attendance_day_unique on public.attendance (enrolment_id, date) where period_id is null;
create unique index attendance_period_unique on public.attendance (enrolment_id, date, period_id) where period_id is not null;
create index attendance_school_date on public.attendance (school_id, date);

-- Teacher (staff) attendance: a daily register, separate from the leave/absence
-- record in leave_requests. Marking someone absent or on leave here fires the
-- audit_staff_attendance trigger below, which finds their periods for that
-- date and suggests substitutes automatically -- no extra click needed.
create table public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'absent', 'late', 'leave')),
  marked_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, date)
);
create index staff_attendance_school_date on public.staff_attendance (school_id, date);

create table public.daily_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  note_date date not null,
  title text not null,
  body text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  withdrawn boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index daily_notes_class_date on public.daily_notes (class_id, note_date);

create table public.note_files (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  note_id uuid not null references public.daily_notes(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint
);
create index note_files_note on public.note_files (note_id);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  name text not null,
  term text not null,
  weight numeric(6, 2) not null default 1 check (weight > 0),
  status text not null default 'draft' check (status in ('draft', 'locked', 'published')),
  created_at timestamptz not null default now()
);

create table public.exam_subjects (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  grade_level_id uuid not null references public.grade_levels(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  max_marks numeric(6, 2) not null check (max_marks > 0),
  unique (exam_id, grade_level_id, subject_id)
);

create table public.marks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  exam_subject_id uuid not null references public.exam_subjects(id) on delete cascade,
  enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  marks_obtained numeric(6, 2),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'locked')),
  entered_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (exam_subject_id, enrolment_id)
);
create index marks_enrolment on public.marks (enrolment_id);

create table public.grade_scales (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  min_percent numeric(5, 2) not null,
  grade text not null,
  points numeric(4, 1),
  unique (school_id, min_percent)
);

create table public.report_remarks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  term text not null,
  teacher_remark text,
  principal_remark text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (enrolment_id, term)
);

-- A published report card is a frozen snapshot; corrections create a new version.
create table public.report_cards (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  term text not null,
  version int not null default 1,
  snapshot jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid references public.profiles(id) on delete set null,
  superseded_at timestamptz,
  withdrawn_at timestamptz,
  unique (enrolment_id, term, version)
);

-- ---------------------------------------------------------------------
-- Messaging and notices
-- ---------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  type text not null check (type in ('teacher_student', 'student_student', 'teacher_teacher')),
  title text,
  is_group boolean not null default false,
  class_id uuid references public.classes(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  is_muted boolean not null default false,
  last_read_at timestamptz not null default now(),
  added_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
create index conversation_members_profile on public.conversation_members (profile_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null default '',
  sent_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index messages_conversation on public.messages (conversation_id, sent_at desc);

create table public.message_files (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  size_bytes bigint
);
create index message_files_message on public.message_files (message_id);

-- Bodies of removed messages are kept for admins only.
create table public.deleted_message_bodies (
  message_id uuid primary key references public.messages(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  body text
);

create table public.message_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reported_by uuid not null references public.profiles(id) on delete cascade,
  reason text,
  message_body text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  title text not null,
  body text not null,
  audience_type text not null check (audience_type in ('school', 'grade', 'section', 'people')),
  audience jsonb not null default '{}'::jsonb,
  sent_by uuid references public.profiles(id) on delete set null,
  sent_at timestamptz not null default now()
);

create table public.notice_reads (
  notice_id uuid not null references public.notices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  read_at timestamptz,
  primary key (notice_id, profile_id)
);
create index notice_reads_profile on public.notice_reads (profile_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_profile on public.notifications (profile_id, created_at desc);

-- ---------------------------------------------------------------------
-- Grade (std) changes
-- ---------------------------------------------------------------------
create table public.promotion_runs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  from_year_id uuid not null references public.academic_years(id) on delete cascade,
  to_year_id uuid not null references public.academic_years(id) on delete cascade,
  rule text not null default 'all' check (rule in ('all', 'by_rule')),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'applied', 'reversed')),
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  check (from_year_id <> to_year_id)
);

create table public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  run_id uuid not null references public.promotion_runs(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  from_enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  from_class_id uuid not null references public.classes(id) on delete cascade,
  action text not null check (action in ('promote', 'hold_back', 'move', 'pass_out')),
  to_class_id uuid references public.classes(id) on delete set null,
  needs_review boolean not null default false,
  note text,
  new_enrolment_id uuid,
  unique (run_id, student_id)
);
create index promotion_items_run on public.promotion_items (run_id);

create table public.grade_change_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  enrolment_id uuid not null references public.enrolments(id) on delete cascade,
  from_class_id uuid not null references public.classes(id) on delete cascade,
  to_class_id uuid not null references public.classes(id) on delete cascade,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references public.profiles(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Privacy, security, housekeeping
-- ---------------------------------------------------------------------
create table public.guardian_consents (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  guardian_name text not null,
  relationship text,
  verified_method text,
  purposes text[] not null default '{}',
  consented_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  recorded_by uuid references public.profiles(id) on delete set null
);
create index guardian_consents_student on public.guardian_consents (student_id);

create table public.audit_log (
  id bigserial primary key,
  school_id uuid,
  actor_id uuid,
  table_name text not null,
  row_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_school_time on public.audit_log (school_id, created_at desc);
create index audit_table_row on public.audit_log (table_name, row_id);

create table public.login_attempts (
  login_id text primary key,
  failed_count int not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz
);

create table public.id_counters (
  school_id uuid not null references public.schools(id) on delete cascade,
  kind text not null,
  last_value int not null default 0,
  primary key (school_id, kind)
);
-- ---------------------------------------------------------------------
-- Helper functions. The ones in "internal" cannot be called by browsers;
-- the ones in "public" only ever describe the caller (auth.uid()).
-- ---------------------------------------------------------------------
set check_function_bodies = off;

create or replace function internal.get_setting(p_school uuid, p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select settings -> p_key from public.schools where id = p_school),
                  internal.default_settings() -> p_key)
$$;

-- Who am I?  (a disabled or expired account resolves to NULL, so it sees nothing)
create or replace function public.auth_school() returns uuid
language sql stable security definer set search_path = public as $$
  select p.school_id
    from public.profiles p join public.schools s on s.id = p.school_id
   where p.id = auth.uid() and p.is_active
     and (p.disabled_from is null or p.disabled_from > (now() at time zone s.timezone)::date)
$$;

create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role
    from public.profiles p join public.schools s on s.id = p.school_id
   where p.id = auth.uid() and p.is_active
     and (p.disabled_from is null or p.disabled_from > (now() at time zone s.timezone)::date)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'admin', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() in ('admin', 'teacher'), false)
$$;

create or replace function public.school_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce(
    (select s.timezone from public.schools s join public.profiles p on p.school_id = s.id where p.id = auth.uid()),
    'Asia/Kolkata'))::date
$$;

create or replace function internal.teacher_teaches_class(p_teacher uuid, p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = p_class and c.class_teacher_id = p_teacher)
      or exists (select 1 from public.teaching_assignments ta where ta.class_id = p_class and ta.teacher_id = p_teacher)
      or exists (select 1 from public.timetable_entries te where te.class_id = p_class and te.teacher_id = p_teacher)
$$;

-- Teaches the class, or has an approved/accepted substitution for it on that date.
create or replace function public.teaches_class_on(p_class uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select internal.teacher_teaches_class(auth.uid(), p_class)
      or exists (
        select 1 from public.substitutions s
          join public.timetable_entries te on te.id = s.timetable_entry_id
         where te.class_id = p_class and s.substitute_id = auth.uid()
           and s.date = p_date and s.status in ('approved', 'accepted'))
$$;

create or replace function public.teaches_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.teaches_class_on(p_class, public.school_today())
$$;

create or replace function public.is_class_teacher_of(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = p_class and c.class_teacher_id = auth.uid())
$$;

create or replace function public.my_enrolment_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.enrolments where student_id = auth.uid()
$$;

create or replace function public.my_class_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select class_id from public.enrolments where student_id = auth.uid()
$$;

create or replace function public.classmate_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e2.student_id
    from public.enrolments e1
    join public.enrolments e2 on e2.class_id = e1.class_id and e2.status = 'active'
   where e1.student_id = auth.uid() and e1.status = 'active'
$$;

create or replace function public.my_conversation_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select conversation_id from public.conversation_members where profile_id = auth.uid()
$$;

create or replace function public.can_post_note(p_class uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = p_class and c.school_id = public.auth_school())
     and exists (select 1 from public.subjects s where s.id = p_subject and s.school_id = public.auth_school())
     and (
       public.is_admin()
       or public.is_class_teacher_of(p_class)
       or exists (select 1 from public.teaching_assignments ta
                   where ta.class_id = p_class and ta.subject_id = p_subject and ta.teacher_id = auth.uid())
       or exists (select 1 from public.substitutions s
                    join public.timetable_entries te on te.id = s.timetable_entry_id
                   where te.class_id = p_class and s.substitute_id = auth.uid()
                     and s.date = public.school_today() and s.status in ('approved', 'accepted'))
     )
$$;

-- Notifications ---------------------------------------------------------
create or replace function internal.notify(p_school uuid, p_profile uuid, p_kind text, p_title text,
                                           p_body text default null, p_link text default null) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (school_id, profile_id, kind, title, body, link)
  select p_school, p_profile, p_kind, p_title, p_body, p_link where p_profile is not null
$$;

-- Attendance percentage for an enrolment (leave days are excused, not counted).
create or replace function internal.attendance_pct(p_enrolment uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid; v_late boolean; v_att bigint; v_tot bigint;
begin
  select school_id into v_school from public.enrolments where id = p_enrolment;
  v_late := coalesce((internal.get_setting(v_school, 'late_counts_as_attended') #>> '{}')::boolean, true);
  select count(*) filter (where status = 'present' or (status = 'late' and v_late)),
         count(*) filter (where status in ('present', 'late', 'absent'))
    into v_att, v_tot
    from public.attendance where enrolment_id = p_enrolment;
  if v_tot = 0 then return null; end if;
  return round(100.0 * v_att / v_tot, 1);
end $$;

create or replace function internal.grade_for(p_school uuid, p_pct numeric) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('grade', grade, 'points', points)
                     from public.grade_scales
                    where school_id = p_school and min_percent <= p_pct
                    order by min_percent desc limit 1), '{}'::jsonb)
$$;

-- Weighted marks over all non-draft exams of the enrolment's year.
create or replace function internal.year_overall_pct(p_enrolment uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when sum(x.weight * es.max_marks) > 0
              then round(100 * sum(x.weight * m.marks_obtained) / sum(x.weight * es.max_marks), 1) end
    from public.marks m
    join public.exam_subjects es on es.id = m.exam_subject_id
    join public.exams x on x.id = es.exam_id
   where m.enrolment_id = p_enrolment and m.marks_obtained is not null and x.status <> 'draft'
$$;

-- Who may chat with whom.
create or replace function internal.can_chat(p_a uuid, p_b uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare pa record; pb record; v_teacher uuid; v_student uuid;
begin
  if p_a = p_b then return false; end if;
  select school_id, role, is_active into pa from public.profiles where id = p_a;
  select school_id, role, is_active into pb from public.profiles where id = p_b;
  if pa.school_id is null or pb.school_id is null or pa.school_id <> pb.school_id then return false; end if;
  if not (pa.is_active and pb.is_active) then return false; end if;
  if pa.role = 'admin' then return true; end if;                    -- the office may write to anyone
  if pb.role = 'admin' then return pa.role = 'teacher'; end if;     -- students cannot start chats with the office
  if pa.role = 'teacher' and pb.role = 'teacher' then return true; end if;
  if pa.role = 'student' and pb.role = 'student' then
    if not coalesce((internal.get_setting(pa.school_id, 'student_chat_enabled') #>> '{}')::boolean, true) then
      return false;
    end if;
    return exists (
      select 1 from public.enrolments e1
        join public.enrolments e2 on e2.class_id = e1.class_id
        join public.classes c on c.id = e1.class_id
       where e1.student_id = p_a and e2.student_id = p_b
         and e1.status = 'active' and e2.status = 'active' and c.chat_enabled);
  end if;
  if pa.role = 'teacher' then v_teacher := p_a; v_student := p_b; else v_teacher := p_b; v_student := p_a; end if;
  return exists (select 1 from public.enrolments e
                  where e.student_id = v_student and e.status = 'active'
                    and internal.teacher_teaches_class(v_teacher, e.class_id));
end $$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function internal.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Every foreign key that points at another school-owned table must stay inside the same school,
-- and (optionally) point at the right kind of account.  Args: 'column:table[:role]'
create or replace function internal.check_refs() returns trigger
language plpgsql security definer set search_path = public as $$
declare i int; spec text; col text; tbl text; want_role text; v uuid; sid uuid; rl text;
begin
  for i in 0 .. tg_nargs - 1 loop
    spec := tg_argv[i];
    col := split_part(spec, ':', 1);
    tbl := split_part(spec, ':', 2);
    want_role := nullif(split_part(spec, ':', 3), '');
    v := nullif(to_jsonb(new) ->> col, '')::uuid;
    if v is null then continue; end if;
    if tbl = 'profiles' then
      select school_id, role into sid, rl from public.profiles where id = v;
    else
      execute format('select school_id from public.%I where id = $1', tbl) into sid using v;
      rl := null;
    end if;
    if sid is distinct from new.school_id then
      raise exception 'invalid reference in column %', col using errcode = '23503';
    end if;
    if want_role is not null and rl is distinct from want_role then
      raise exception 'column % must point to a % account', col, want_role using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;

create or replace function internal.trg_timetable_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select academic_year_id into new.academic_year_id from public.classes where id = new.class_id;
  return new;
end $$;

-- A substitution can never break the rules, whoever saves it.
create or replace function internal.trg_substitution_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_te record; v_role text; v_school uuid;
begin
  select te.*, c.school_id as c_school into v_te
    from public.timetable_entries te join public.classes c on c.id = te.class_id
   where te.id = new.timetable_entry_id;
  if not found then raise exception 'timetable entry not found'; end if;
  new.period_id := v_te.period_id;
  new.absent_teacher_id := v_te.teacher_id;
  new.school_id := v_te.school_id;
  new.updated_at := now();
  if new.substitute_id is not null and new.status in ('suggested', 'approved', 'accepted') then
    select role, school_id into v_role, v_school from public.profiles where id = new.substitute_id;
    if v_role is distinct from 'teacher' or v_school is distinct from new.school_id then
      raise exception 'the substitute must be a teacher of this school' using errcode = '23514';
    end if;
    if new.substitute_id = v_te.teacher_id then
      raise exception 'a teacher cannot substitute for themselves' using errcode = '23514';
    end if;
    if exists (select 1 from public.timetable_entries t2
                where t2.teacher_id = new.substitute_id and t2.academic_year_id = v_te.academic_year_id
                  and t2.weekday = v_te.weekday and t2.period_id = v_te.period_id) then
      raise exception 'that teacher already has a class in this period' using errcode = '23514';
    end if;
    if exists (select 1 from public.leave_requests l
                where l.requester_id = new.substitute_id and l.kind = 'teacher' and l.status = 'approved'
                  and new.date between l.from_date and l.to_date) then
      raise exception 'that teacher is on leave on this date' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- Exam status may only change through set_exam_status().
create or replace function internal.trg_exam_status_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.status := 'draft'; return new; end if;
  if new.status is distinct from old.status and coalesce(current_setting('edunest.exam_rpc', true), '') <> '1' then
    raise exception 'use the Lock / Publish buttons to change an exam''s status';
  end if;
  return new;
end $$;

-- The school code is part of every login ID, so it never changes.
create or replace function internal.trg_school_immutable() returns trigger
language plpgsql as $$
begin
  if new.code is distinct from old.code or new.id is distinct from old.id then
    raise exception 'the school code cannot be changed';
  end if;
  return new;
end $$;

-- When a note is posted, everyone who was absent that day in that class is told.
create or replace function internal.trg_note_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (school_id, profile_id, kind, title, body, link)
  select new.school_id, e.student_id, 'note', 'New notes for a day you missed', new.title, '/missed-notes'
    from public.enrolments e
    join public.attendance a on a.enrolment_id = e.id and a.date = new.note_date and a.status = 'absent'
   where e.class_id = new.class_id
   group by e.student_id;
  return new;
end $$;

-- Append-only audit trail.
create or replace function internal.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_school text;
begin
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then return new; end if;
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_school := case when tg_table_name = 'schools' then v_row ->> 'id' else v_row ->> 'school_id' end;
  insert into public.audit_log (school_id, actor_id, table_name, row_id, action, old_data, new_data)
  values (nullif(v_school, '')::uuid, auth.uid(), tg_table_name, nullif(v_row ->> 'id', '')::uuid, tg_op,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function internal.prevent_audit_change() returns trigger
language plpgsql as $$
begin raise exception 'the audit log is append-only'; end $$;

-- attach ---------------------------------------------------------------
create trigger attendance_touch before update on public.attendance for each row execute function internal.touch_updated_at();
create trigger staff_attendance_touch before update on public.staff_attendance for each row execute function internal.touch_updated_at();
create trigger marks_touch before update on public.marks for each row execute function internal.touch_updated_at();
create trigger notes_touch before update on public.daily_notes for each row execute function internal.touch_updated_at();

create trigger classes_refs before insert or update on public.classes for each row
  execute function internal.check_refs('academic_year_id:academic_years', 'grade_level_id:grade_levels', 'class_teacher_id:profiles:teacher');
create trigger enrolments_refs before insert or update on public.enrolments for each row
  execute function internal.check_refs('student_id:profiles:student', 'class_id:classes', 'academic_year_id:academic_years');
create trigger assignments_refs before insert or update on public.teaching_assignments for each row
  execute function internal.check_refs('class_id:classes', 'subject_id:subjects', 'teacher_id:profiles:teacher');
create trigger timetable_fill before insert or update on public.timetable_entries for each row execute function internal.trg_timetable_fill();
create trigger timetable_refs before insert or update on public.timetable_entries for each row
  execute function internal.check_refs('class_id:classes', 'subject_id:subjects', 'teacher_id:profiles:teacher', 'period_id:periods');
create trigger notes_refs before insert or update on public.daily_notes for each row
  execute function internal.check_refs('class_id:classes', 'subject_id:subjects');
create trigger staff_attendance_refs before insert or update on public.staff_attendance for each row
  execute function internal.check_refs('profile_id:profiles:teacher');
create trigger exams_refs before insert or update on public.exams for each row
  execute function internal.check_refs('academic_year_id:academic_years');
create trigger exam_subjects_refs before insert or update on public.exam_subjects for each row
  execute function internal.check_refs('exam_id:exams', 'grade_level_id:grade_levels', 'subject_id:subjects');
create trigger consents_refs before insert or update on public.guardian_consents for each row
  execute function internal.check_refs('student_id:profiles:student');
create trigger exams_status_guard before insert or update on public.exams for each row execute function internal.trg_exam_status_guard();
create trigger substitutions_check before insert or update on public.substitutions for each row execute function internal.trg_substitution_check();
create trigger schools_immutable before update on public.schools for each row execute function internal.trg_school_immutable();
create trigger notes_notify after insert on public.daily_notes for each row execute function internal.trg_note_notify();

create trigger audit_log_no_update before update or delete on public.audit_log for each row execute function internal.prevent_audit_change();
create trigger audit_log_no_truncate before truncate on public.audit_log for each statement execute function internal.prevent_audit_change();

do $$
declare t text;
begin
  foreach t in array array[
    'schools', 'profiles', 'academic_years', 'grade_levels', 'classes', 'enrolments', 'subjects',
    'teaching_assignments', 'periods', 'timetable_entries', 'leave_requests', 'substitutions', 'attendance',
    'staff_attendance', 'daily_notes', 'exams', 'exam_subjects', 'marks', 'grade_scales', 'report_remarks', 'report_cards',
    'notices', 'promotion_runs', 'promotion_items', 'grade_change_requests', 'guardian_consents',
    'message_reports']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function internal.audit_trigger()',
                   'audit_' || t, t);
  end loop;
end $$;
-- ---------------------------------------------------------------------
-- Row Level Security.  Every table is locked; each policy below opens exactly
-- the rows a role is allowed to see.  Almost all WRITES go through the
-- functions in 04_functions.sql, which enforce the business rules.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- Schools ---------------------------------------------------------------
create policy schools_read on public.schools for select to authenticated
  using (id = (select public.auth_school()));
create policy schools_update on public.schools for update to authenticated
  using (id = (select public.auth_school()) and (select public.is_admin()))
  with check (id = (select public.auth_school()) and (select public.is_admin()));

-- Profiles: you see yourself; staff see everyone in the school.  Students get names
-- of teachers and classmates through the "directory" view (no login IDs).
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid()
         or (school_id = (select public.auth_school()) and (select public.is_staff())));

create view public.directory as
  select p.id, p.school_id, p.role, p.full_name, p.is_active
    from public.profiles p
   where p.school_id = public.auth_school()
     and (public.is_staff() or p.id = auth.uid() or p.role = 'teacher'
          or p.id in (select public.classmate_ids()));

-- School set-up tables: everyone in the school can read, only admins write ---
do $$
declare t text;
begin
  foreach t in array array['academic_years', 'grade_levels', 'subjects', 'periods', 'classes',
                           'teaching_assignments', 'timetable_entries', 'grade_scales']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (school_id = (select public.auth_school()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (school_id = (select public.auth_school()) and (select public.is_admin()))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (school_id = (select public.auth_school()) and (select public.is_admin())) with check (school_id = (select public.auth_school()) and (select public.is_admin()))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (school_id = (select public.auth_school()) and (select public.is_admin()))', t || '_del', t);
  end loop;
end $$;

-- Enrolments -------------------------------------------------------------
create policy enrolments_read on public.enrolments for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or student_id = auth.uid()
              or ((select public.is_staff()) and public.teaches_class(class_id))));
create policy enrolments_ins on public.enrolments for insert to authenticated
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy enrolments_upd on public.enrolments for update to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()))
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy enrolments_del on public.enrolments for delete to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()));

-- Leave, substitutions ---------------------------------------------------
create policy leave_read on public.leave_requests for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or requester_id = auth.uid()
              or exists (select 1 from public.enrolments e join public.classes c on c.id = e.class_id
                          where e.student_id = leave_requests.requester_id and e.status = 'active'
                            and c.class_teacher_id = auth.uid())));

create policy substitutions_read on public.substitutions for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or substitute_id = auth.uid()
              or absent_teacher_id = auth.uid()
              or exists (select 1 from public.timetable_entries te
                          where te.id = substitutions.timetable_entry_id
                            and (public.is_class_teacher_of(te.class_id)
                                 or (substitutions.status in ('approved', 'accepted', 'self_study')
                                     and te.class_id in (select public.my_class_ids()))))));

-- Attendance -------------------------------------------------------------
create policy attendance_read on public.attendance for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or enrolment_id in (select public.my_enrolment_ids())
              or ((select public.is_staff())
                  and exists (select 1 from public.enrolments e
                               where e.id = attendance.enrolment_id and public.teaches_class(e.class_id)))));

-- Staff attendance (writes go only through save_staff_attendance, below) -----
create policy staff_attendance_read on public.staff_attendance for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin()) or profile_id = auth.uid()));

-- Daily notes ------------------------------------------------------------
create policy notes_read on public.daily_notes for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or created_by = auth.uid()
              or ((select public.is_staff()) and public.teaches_class(class_id))
              or (not withdrawn and class_id in (select public.my_class_ids()))));
create policy notes_ins on public.daily_notes for insert to authenticated
  with check (school_id = (select public.auth_school()) and created_by = auth.uid()
              and public.can_post_note(class_id, subject_id));
create policy notes_upd on public.daily_notes for update to authenticated
  using (school_id = (select public.auth_school()) and (created_by = auth.uid() or (select public.is_admin())))
  with check (school_id = (select public.auth_school()) and public.can_post_note(class_id, subject_id));
create policy notes_del on public.daily_notes for delete to authenticated
  using (school_id = (select public.auth_school()) and (created_by = auth.uid() or (select public.is_admin())));

create policy note_files_read on public.note_files for select to authenticated
  using (school_id = (select public.auth_school())
         and exists (select 1 from public.daily_notes n where n.id = note_files.note_id));
create policy note_files_ins on public.note_files for insert to authenticated
  with check (school_id = (select public.auth_school())
              and exists (select 1 from public.daily_notes n
                           where n.id = note_files.note_id and (n.created_by = auth.uid() or (select public.is_admin()))));
create policy note_files_del on public.note_files for delete to authenticated
  using (school_id = (select public.auth_school())
         and exists (select 1 from public.daily_notes n
                      where n.id = note_files.note_id and (n.created_by = auth.uid() or (select public.is_admin()))));

-- Exams and marks ----------------------------------------------------------
create policy exams_read on public.exams for select to authenticated
  using (school_id = (select public.auth_school()) and ((select public.is_staff()) or status = 'published'));
create policy exams_ins on public.exams for insert to authenticated
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy exams_upd on public.exams for update to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()))
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy exams_del on public.exams for delete to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()) and status = 'draft');

create policy exam_subjects_read on public.exam_subjects for select to authenticated
  using (school_id = (select public.auth_school())
         and exists (select 1 from public.exams x where x.id = exam_subjects.exam_id));
create policy exam_subjects_ins on public.exam_subjects for insert to authenticated
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy exam_subjects_upd on public.exam_subjects for update to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()))
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy exam_subjects_del on public.exam_subjects for delete to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()));

create policy marks_read on public.marks for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or (enrolment_id in (select public.my_enrolment_ids())
                  and exists (select 1 from public.exam_subjects es join public.exams x on x.id = es.exam_id
                               where es.id = marks.exam_subject_id and x.status = 'published'))
              or ((select public.is_staff())
                  and exists (select 1 from public.enrolments e, public.exam_subjects es
                               where e.id = marks.enrolment_id and es.id = marks.exam_subject_id
                                 and (public.is_class_teacher_of(e.class_id)
                                      or exists (select 1 from public.teaching_assignments ta
                                                  where ta.class_id = e.class_id and ta.subject_id = es.subject_id
                                                    and ta.teacher_id = auth.uid()))))));

create policy remarks_read on public.report_remarks for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or exists (select 1 from public.enrolments e
                          where e.id = report_remarks.enrolment_id and public.is_class_teacher_of(e.class_id))));

create policy report_cards_read on public.report_cards for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or exists (select 1 from public.enrolments e
                          where e.id = report_cards.enrolment_id and public.is_class_teacher_of(e.class_id))
              or (enrolment_id in (select public.my_enrolment_ids())
                  and withdrawn_at is null and superseded_at is null)));

-- Messaging -----------------------------------------------------------------
create policy conversations_read on public.conversations for select to authenticated
  using (school_id = (select public.auth_school())
         and (id in (select public.my_conversation_ids()) or (select public.is_admin())));
create policy conv_members_read on public.conversation_members for select to authenticated
  using (school_id = (select public.auth_school())
         and (conversation_id in (select public.my_conversation_ids()) or (select public.is_admin())));
create policy messages_read on public.messages for select to authenticated
  using (school_id = (select public.auth_school())
         and (conversation_id in (select public.my_conversation_ids()) or (select public.is_admin())));
create policy message_files_read on public.message_files for select to authenticated
  using (school_id = (select public.auth_school())
         and exists (select 1 from public.messages m where m.id = message_files.message_id));
create policy deleted_bodies_read on public.deleted_message_bodies for select to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy reports_read on public.message_reports for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or reported_by = auth.uid()
              or exists (select 1 from public.enrolments e join public.classes c on c.id = e.class_id
                          where e.student_id = message_reports.reported_by and e.status = 'active'
                            and c.class_teacher_id = auth.uid())));

-- Notices and notifications -----------------------------------------------------
create policy notice_reads_read on public.notice_reads for select to authenticated
  using (school_id = (select public.auth_school()) and (profile_id = auth.uid() or (select public.is_admin())));
create policy notices_read on public.notices for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or id in (select nr.notice_id from public.notice_reads nr where nr.profile_id = auth.uid())));
create policy notifications_read on public.notifications for select to authenticated
  using (profile_id = auth.uid());

-- Grade (std) changes -------------------------------------------------------------
create policy promotion_items_read on public.promotion_items for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin()) or public.is_class_teacher_of(from_class_id)));
create policy promotion_runs_read on public.promotion_runs for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin())
              or exists (select 1 from public.promotion_items i
                          where i.run_id = promotion_runs.id and public.is_class_teacher_of(i.from_class_id))));
create policy grade_changes_read on public.grade_change_requests for select to authenticated
  using (school_id = (select public.auth_school())
         and ((select public.is_admin()) or requested_by = auth.uid() or public.is_class_teacher_of(from_class_id)));

-- Consents and audit (admins only) -------------------------------------------------
create policy consents_read on public.guardian_consents for select to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy consents_ins on public.guardian_consents for insert to authenticated
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));
create policy consents_upd on public.guardian_consents for update to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()))
  with check (school_id = (select public.auth_school()) and (select public.is_admin()));

create policy audit_read on public.audit_log for select to authenticated
  using (school_id = (select public.auth_school()) and (select public.is_admin()));

-- login_attempts and id_counters have RLS on and NO policy: only the server can touch them.
-- ---------------------------------------------------------------------
-- Functions the apps call (supabase.rpc).  Each one checks who is calling
-- and enforces the school's rules, so the website cannot bypass them.
-- ---------------------------------------------------------------------
set check_function_bodies = off;

-- ===== Login protection =================================================
create or replace function public.login_gate(p_login_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_until timestamptz;
begin
  select locked_until into v_until from public.login_attempts where login_id = upper(trim(p_login_id));
  if v_until is not null and v_until > now() then
    return jsonb_build_object('locked', true, 'retry_seconds', ceil(extract(epoch from (v_until - now())))::int);
  end if;
  return jsonb_build_object('locked', false, 'retry_seconds', 0);
end $$;

create or replace function public.login_record_failure(p_login_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id text := upper(trim(p_login_id)); v_school uuid; v_max int; v_mins int; v_count int;
begin
  select school_id into v_school from public.profiles where login_id = v_id;
  if v_school is null then return; end if;          -- unknown IDs leave no trace
  v_max := coalesce((internal.get_setting(v_school, 'lockout_attempts') #>> '{}')::int, 5);
  v_mins := coalesce((internal.get_setting(v_school, 'lockout_minutes') #>> '{}')::int, 15);
  insert into public.login_attempts (login_id, failed_count, last_failed_at) values (v_id, 1, now())
  on conflict (login_id) do update
    set failed_count = case when public.login_attempts.locked_until is not null
                                  and public.login_attempts.locked_until <= now() then 1
                            else public.login_attempts.failed_count + 1 end,
        last_failed_at = now()
  returning failed_count into v_count;
  if v_count >= v_max then
    update public.login_attempts set locked_until = now() + make_interval(mins => v_mins), failed_count = 0
     where login_id = v_id;
  end if;
end $$;

create or replace function public.login_clear_failures() returns void
language sql security definer set search_path = public as $$
  delete from public.login_attempts where login_id = (select login_id from public.profiles where id = auth.uid())
$$;

create or replace function public.mark_password_changed() returns void
language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid()
$$;

-- Optional: switch this on in Supabase (Auth > Hooks > Password verification) to make the
-- lockout impossible to bypass, even by calling the Auth API directly.
create or replace function public.hook_password_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := (event ->> 'user_id')::uuid; v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
        v_login text; v_until timestamptz;
begin
  select login_id into v_login from public.profiles where id = v_uid;
  if v_login is null then return jsonb_build_object('decision', 'continue'); end if;
  select locked_until into v_until from public.login_attempts where login_id = v_login;
  if v_until is not null and v_until > now() then
    return jsonb_build_object('decision', 'reject', 'message', 'Too many wrong attempts. Try again later.');
  end if;
  if v_valid then delete from public.login_attempts where login_id = v_login;
  else perform public.login_record_failure(v_login); end if;
  return jsonb_build_object('decision', 'continue');
end $$;

-- Next login ID for a school, e.g. DPS-STU-0042 (called by the School Portal server only).
create or replace function public.next_login_id(p_school uuid, p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_tag text; v_n int;
begin
  select code into v_code from public.schools where id = p_school;
  v_tag := case p_kind when 'student' then 'STU' when 'teacher' then 'TCH' when 'admin' then 'ADM' end;
  if v_code is null or v_tag is null then raise exception 'unknown school or account type'; end if;
  insert into public.id_counters (school_id, kind, last_value) values (p_school, p_kind, 1)
  on conflict (school_id, kind) do update set last_value = public.id_counters.last_value + 1
  returning last_value into v_n;
  return v_code || '-' || v_tag || '-' || lpad(v_n::text, 4, '0');
end $$;

-- ===== Enrolment ========================================================
create or replace function public.enrol_student(p_student uuid, p_class uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_cls record; v_id uuid; v_roll int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into v_cls from public.classes where id = p_class and school_id = v_school;
  if not found then raise exception 'class not found'; end if;
  if not exists (select 1 from public.profiles where id = p_student and school_id = v_school and role = 'student') then
    raise exception 'student not found';
  end if;
  select id into v_id from public.enrolments where student_id = p_student and academic_year_id = v_cls.academic_year_id;
  select coalesce(max(roll_no), 0) + 1 into v_roll from public.enrolments where class_id = p_class;
  if v_id is null then
    insert into public.enrolments (school_id, student_id, class_id, academic_year_id, roll_no)
    values (v_school, p_student, p_class, v_cls.academic_year_id, v_roll) returning id into v_id;
  else
    update public.enrolments set class_id = p_class, roll_no = v_roll, status = 'active'
     where id = v_id and class_id <> p_class;
  end if;
  return v_id;
end $$;

-- ===== Attendance =======================================================
-- p_rows: [{"enrolment_id": "...", "status": "present|absent|late|leave"}]
create or replace function public.save_attendance(p_class_id uuid, p_date date, p_period_id uuid,
                                                  p_rows jsonb, p_reason text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid := public.auth_school(); v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_today date := public.school_today(); v_mode text; v_lock int; v_cls record; v_is_admin boolean;
  v_is_ct boolean; r jsonb; v_enr record; v_status text; v_existing text; v_n int := 0;
  v_pct numeric; v_thr numeric; v_name text; v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_school is null or v_role not in ('admin', 'teacher') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_is_admin := (v_role = 'admin');
  select * into v_cls from public.classes where id = p_class_id and school_id = v_school;
  if not found then raise exception 'class not found'; end if;
  v_is_ct := (v_cls.class_teacher_id = v_uid);
  if not (v_is_admin or public.teaches_class_on(p_class_id, p_date)) then
    raise exception 'you do not teach this class' using errcode = '42501';
  end if;

  v_mode := coalesce(internal.get_setting(v_school, 'attendance_mode') #>> '{}', 'day');
  if v_mode = 'day' and p_period_id is not null then raise exception 'this school marks attendance once per day'; end if;
  if v_mode = 'period' and p_period_id is null then raise exception 'choose a period'; end if;
  if p_period_id is not null and not exists (select 1 from public.periods where id = p_period_id and school_id = v_school) then
    raise exception 'unknown period';
  end if;

  if p_date > v_today then raise exception 'you cannot mark attendance for a future date'; end if;
  v_lock := coalesce((internal.get_setting(v_school, 'attendance_lock_days') #>> '{}')::int, 7);
  if p_date < v_today then
    if not (v_is_admin or v_is_ct) then
      raise exception 'only the class teacher or the admin can change earlier days' using errcode = '42501';
    end if;
    if p_date < v_today - v_lock and not v_is_admin then
      raise exception 'this day is locked; ask the admin' using errcode = '42501';
    end if;
    if v_reason is null then raise exception 'a reason is required when changing an earlier day'; end if;
  end if;

  v_thr := coalesce((internal.get_setting(v_school, 'low_attendance_threshold') #>> '{}')::numeric, 75);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_status := r ->> 'status';
    if v_status not in ('present', 'absent', 'late', 'leave') then raise exception 'bad status: %', v_status; end if;
    select e.*, p.full_name into v_enr
      from public.enrolments e join public.profiles p on p.id = e.student_id
     where e.id = (r ->> 'enrolment_id')::uuid and e.class_id = p_class_id and e.status = 'active';
    if not found then raise exception 'a student in the list is not in this class'; end if;
    if v_status = 'leave' and not (v_is_admin or v_is_ct or exists (
         select 1 from public.leave_requests l
          where l.requester_id = v_enr.student_id and l.kind = 'student' and l.status = 'approved'
            and p_date between l.from_date and l.to_date)) then
      raise exception 'leave must be approved by the class teacher or admin first';
    end if;

    if p_period_id is null then
      select status into v_existing from public.attendance
       where enrolment_id = v_enr.id and date = p_date and period_id is null;
      insert into public.attendance (school_id, enrolment_id, date, status, marked_by, reason)
      values (v_school, v_enr.id, p_date, v_status, v_uid, v_reason)
      on conflict (enrolment_id, date) where period_id is null
      do update set status = excluded.status, marked_by = excluded.marked_by, reason = excluded.reason
        where public.attendance.status is distinct from excluded.status;
    else
      select status into v_existing from public.attendance
       where enrolment_id = v_enr.id and date = p_date and period_id = p_period_id;
      insert into public.attendance (school_id, enrolment_id, date, period_id, status, marked_by, reason)
      values (v_school, v_enr.id, p_date, p_period_id, v_status, v_uid, v_reason)
      on conflict (enrolment_id, date, period_id) where period_id is not null
      do update set status = excluded.status, marked_by = excluded.marked_by, reason = excluded.reason
        where public.attendance.status is distinct from excluded.status;
    end if;
    v_n := v_n + 1;

    if v_status = 'absent' and v_existing is distinct from 'absent' then
      perform internal.notify(v_school, v_enr.student_id, 'absence', 'Marked absent',
                              format('You were marked absent on %s. Notes will appear under Missed classes.', p_date),
                              '/missed-notes');
      if v_cls.class_teacher_id is not null and v_cls.class_teacher_id <> v_uid then
        perform internal.notify(v_school, v_cls.class_teacher_id, 'absence', 'Absent: ' || v_enr.full_name,
                                format('Marked absent on %s.', p_date), '/class-desk');
      end if;
      v_pct := internal.attendance_pct(v_enr.id);
      if v_pct is not null and v_pct < v_thr then
        perform internal.notify(v_school, v_enr.student_id, 'low_attendance', 'Attendance is low',
                                format('Your attendance is %s%%, below the school minimum of %s%%.', v_pct, v_thr), '/attendance');
        if v_cls.class_teacher_id is not null then
          perform internal.notify(v_school, v_cls.class_teacher_id, 'low_attendance',
                                  'Low attendance: ' || v_enr.full_name, format('%s%% attendance.', v_pct), '/class-desk');
        end if;
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- Classes (out of the ones given) that already have attendance for the date.
create or replace function public.marked_classes(p_date date, p_class_ids uuid[]) returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct e.class_id
    from public.attendance a join public.enrolments e on e.id = a.enrolment_id
   where a.date = p_date and e.class_id = any(p_class_ids) and a.school_id = public.auth_school()
     and public.is_staff()
$$;

create or replace function public.attendance_summary(p_class_id uuid, p_from date, p_to date)
returns table (enrolment_id uuid, student_id uuid, full_name text, roll_no int,
               present bigint, absent bigint, late bigint, leave bigint, pct numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (public.is_admin() or (public.is_staff() and public.teaches_class(p_class_id))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.classes c where c.id = p_class_id and c.school_id = public.auth_school()) then
    raise exception 'class not found';
  end if;
  return query
  select e.id, e.student_id, p.full_name, e.roll_no,
         count(a.id) filter (where a.status = 'present'),
         count(a.id) filter (where a.status = 'absent'),
         count(a.id) filter (where a.status = 'late'),
         count(a.id) filter (where a.status = 'leave'),
         case when count(a.id) filter (where a.status in ('present', 'late', 'absent')) = 0 then null
              else round(100.0 * count(a.id) filter (where a.status = 'present'
                     or (a.status = 'late' and coalesce((internal.get_setting(e.school_id, 'late_counts_as_attended') #>> '{}')::boolean, true)))
                   / count(a.id) filter (where a.status in ('present', 'late', 'absent')), 1) end
    from public.enrolments e
    join public.profiles p on p.id = e.student_id
    left join public.attendance a on a.enrolment_id = e.id and a.date between p_from and p_to
   where e.class_id = p_class_id and e.status = 'active'
   group by e.id, e.student_id, p.full_name, e.roll_no, e.school_id
   order by e.roll_no nulls last, p.full_name;
end $$;

-- ===== Marks, exams and report cards ====================================
-- p_rows: [{"enrolment_id": "...", "marks_obtained": 17.5 | null}]
create or replace function public.save_marks(p_exam_subject_id uuid, p_class_id uuid, p_rows jsonb,
                                             p_submit boolean default false) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid := public.auth_school(); v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_es record; v_cls record; r jsonb; v_enr uuid; v_val numeric; v_n int := 0; v_existing text;
  v_status text := case when p_submit then 'submitted' else 'draft' end; v_exists boolean;
begin
  if v_school is null or v_role not in ('admin', 'teacher') then raise exception 'not allowed' using errcode = '42501'; end if;
  select es.*, x.status as exam_status, x.academic_year_id as exam_year into v_es
    from public.exam_subjects es join public.exams x on x.id = es.exam_id
   where es.id = p_exam_subject_id and es.school_id = v_school;
  if not found then raise exception 'exam subject not found'; end if;
  if v_es.exam_status <> 'draft' then raise exception 'marks for this exam are locked'; end if;
  select * into v_cls from public.classes where id = p_class_id and school_id = v_school;
  if not found or v_cls.grade_level_id <> v_es.grade_level_id or v_cls.academic_year_id <> v_es.exam_year then
    raise exception 'this class does not take this exam paper';
  end if;
  if not (v_role = 'admin' or exists (select 1 from public.teaching_assignments ta
        where ta.class_id = p_class_id and ta.subject_id = v_es.subject_id and ta.teacher_id = v_uid)) then
    raise exception 'you do not teach this subject in this class' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_enr := (r ->> 'enrolment_id')::uuid;
    if not exists (select 1 from public.enrolments e where e.id = v_enr and e.class_id = p_class_id and e.status = 'active') then
      raise exception 'a student in the list is not in this class';
    end if;
    v_val := nullif(r ->> 'marks_obtained', '')::numeric;
    if v_val is not null and (v_val < 0 or v_val > v_es.max_marks) then
      raise exception 'marks must be between 0 and %', v_es.max_marks;
    end if;
    select status, true into v_existing, v_exists from public.marks where exam_subject_id = p_exam_subject_id and enrolment_id = v_enr;
    if coalesce(v_exists, false) and v_existing = 'locked' then raise exception 'marks are locked'; end if;
    if v_val is null and not coalesce(v_exists, false) and not p_submit then continue; end if;
    insert into public.marks (school_id, exam_subject_id, enrolment_id, marks_obtained, status, entered_by)
    values (v_school, p_exam_subject_id, v_enr, v_val, v_status, v_uid)
    on conflict (exam_subject_id, enrolment_id)
    do update set marks_obtained = excluded.marks_obtained, status = excluded.status, entered_by = excluded.entered_by;
    v_n := v_n + 1;
    v_exists := false;
  end loop;
  return v_n;
end $$;

-- draft -> locked -> published, and back.
create or replace function public.set_exam_status(p_exam_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_old text;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select status into v_old from public.exams where id = p_exam_id and school_id = v_school;
  if v_old is null then raise exception 'exam not found'; end if;
  if not ((v_old = 'draft' and p_status = 'locked') or (v_old = 'locked' and p_status in ('draft', 'published'))
          or (v_old = 'published' and p_status = 'locked')) then
    raise exception 'cannot change an exam from % to %', v_old, p_status;
  end if;
  perform set_config('edunest.exam_rpc', '1', true);
  update public.exams set status = p_status where id = p_exam_id;
  if p_status = 'locked' and v_old = 'draft' then
    update public.marks set status = 'locked'
     where exam_subject_id in (select id from public.exam_subjects where exam_id = p_exam_id) and status <> 'locked';
  elsif p_status = 'draft' then
    update public.marks set status = 'submitted'
     where exam_subject_id in (select id from public.exam_subjects where exam_id = p_exam_id) and status = 'locked';
  end if;
end $$;

-- One student's report card, computed live.  Percent = weighted marks / weighted maximum.
create or replace function internal.report_data(p_enrolment uuid, p_term text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_e record; v_subjects jsonb; v_tm numeric; v_tx numeric; v_pct numeric; v_att jsonb; v_rem record; v_school text;
begin
  select e.id, e.school_id, e.roll_no, e.academic_year_id, e.class_id, p.full_name, p.login_id, c.section,
         c.grade_level_id, g.name as grade_name, y.name as year_name
    into v_e
    from public.enrolments e
    join public.profiles p on p.id = e.student_id
    join public.classes c on c.id = e.class_id
    join public.grade_levels g on g.id = c.grade_level_id
    join public.academic_years y on y.id = e.academic_year_id
   where e.id = p_enrolment;
  if not found then return null; end if;
  select name into v_school from public.schools where id = v_e.school_id;

  with ex as (
    select es.subject_id, s.name as subject_name, x.name as exam_name, x.weight, es.max_marks, m.marks_obtained
      from public.exam_subjects es
      join public.exams x on x.id = es.exam_id
      join public.subjects s on s.id = es.subject_id
      left join public.marks m on m.exam_subject_id = es.id and m.enrolment_id = p_enrolment
     where x.school_id = v_e.school_id and x.academic_year_id = v_e.academic_year_id
       and x.term = p_term and x.status <> 'draft' and es.grade_level_id = v_e.grade_level_id
  ), ps as (
    select subject_id, subject_name,
           jsonb_agg(jsonb_build_object('exam', exam_name, 'weight', weight, 'max', max_marks, 'marks', marks_obtained)
                     order by exam_name) as exams,
           sum(weight * marks_obtained) as wm,
           sum(weight * max_marks) filter (where marks_obtained is not null) as wx
      from ex group by subject_id, subject_name
  )
  select jsonb_agg(jsonb_build_object(
           'subject', subject_name, 'exams', exams,
           'percent', case when wx > 0 then round(100 * wm / wx, 1) end,
           'grade', internal.grade_for(v_e.school_id, case when wx > 0 then round(100 * wm / wx, 1) end) ->> 'grade')
           order by subject_name),
         sum(wm), sum(wx)
    into v_subjects, v_tm, v_tx from ps;

  v_pct := case when coalesce(v_tx, 0) > 0 then round(100 * v_tm / v_tx, 1) end;

  select jsonb_build_object(
           'present', count(*) filter (where status = 'present'), 'absent', count(*) filter (where status = 'absent'),
           'late', count(*) filter (where status = 'late'), 'leave', count(*) filter (where status = 'leave'),
           'percent', internal.attendance_pct(p_enrolment))
    into v_att from public.attendance where enrolment_id = p_enrolment;

  select teacher_remark, principal_remark into v_rem from public.report_remarks where enrolment_id = p_enrolment and term = p_term;

  return jsonb_build_object(
    'school', v_school, 'student', v_e.full_name, 'login_id', v_e.login_id,
    'class', v_e.grade_name || ' ' || v_e.section, 'roll_no', v_e.roll_no, 'year', v_e.year_name, 'term', p_term,
    'subjects', coalesce(v_subjects, '[]'::jsonb),
    'overall', jsonb_build_object('percent', v_pct, 'grade', internal.grade_for(v_e.school_id, v_pct) ->> 'grade',
                                  'points', internal.grade_for(v_e.school_id, v_pct) ->> 'points'),
    'attendance', v_att,
    'remarks', jsonb_build_object('teacher', v_rem.teacher_remark, 'principal', v_rem.principal_remark),
    'generated_at', now());
end $$;

create or replace function public.get_report_data(p_enrolment_id uuid, p_term text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_class uuid;
begin
  select e.class_id into v_class from public.enrolments e where e.id = p_enrolment_id and e.school_id = public.auth_school();
  if v_class is null then raise exception 'not found'; end if;
  if not (public.is_admin() or public.is_class_teacher_of(v_class)) then
    raise exception 'only the class teacher or admin can preview report cards' using errcode = '42501';
  end if;
  return internal.report_data(p_enrolment_id, p_term);
end $$;

create or replace function public.save_remarks(p_enrolment_id uuid, p_term text, p_teacher_remark text,
                                               p_principal_remark text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_class uuid;
begin
  select e.class_id into v_class from public.enrolments e where e.id = p_enrolment_id and e.school_id = v_school;
  if v_class is null then raise exception 'not found'; end if;
  if public.is_admin() then
    insert into public.report_remarks (school_id, enrolment_id, term, teacher_remark, principal_remark, updated_by)
    values (v_school, p_enrolment_id, p_term, nullif(trim(p_teacher_remark), ''), nullif(trim(p_principal_remark), ''), auth.uid())
    on conflict (enrolment_id, term) do update
      set teacher_remark = excluded.teacher_remark, principal_remark = excluded.principal_remark,
          updated_by = excluded.updated_by, updated_at = now();
  elsif public.is_class_teacher_of(v_class) then
    insert into public.report_remarks (school_id, enrolment_id, term, teacher_remark, updated_by)
    values (v_school, p_enrolment_id, p_term, nullif(trim(p_teacher_remark), ''), auth.uid())
    on conflict (enrolment_id, term) do update
      set teacher_remark = excluded.teacher_remark, updated_by = excluded.updated_by, updated_at = now();
  else
    raise exception 'only the class teacher or admin can write remarks' using errcode = '42501';
  end if;
end $$;

-- Freeze report cards for a class.  Publishing again makes version + 1 and keeps the old one.
create or replace function public.publish_report_cards(p_class_id uuid, p_term text) returns integer
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_cls record; e record; v_ver int; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into v_cls from public.classes where id = p_class_id and school_id = v_school;
  if not found then raise exception 'class not found'; end if;
  if not exists (select 1 from public.exams x join public.exam_subjects es on es.exam_id = x.id
                  where x.school_id = v_school and x.academic_year_id = v_cls.academic_year_id and x.term = p_term
                    and x.status <> 'draft' and es.grade_level_id = v_cls.grade_level_id) then
    raise exception 'lock the exams for this term first (nothing to publish yet)';
  end if;
  for e in select en.id, en.student_id from public.enrolments en
            where en.class_id = p_class_id and en.status <> 'left' loop
    select coalesce(max(version), 0) into v_ver from public.report_cards where enrolment_id = e.id and term = p_term;
    update public.report_cards set superseded_at = now()
     where enrolment_id = e.id and term = p_term and superseded_at is null;
    insert into public.report_cards (school_id, enrolment_id, term, version, snapshot, published_by)
    values (v_school, e.id, p_term, v_ver + 1, internal.report_data(e.id, p_term), auth.uid());
    perform internal.notify(v_school, e.student_id, 'report_card', 'Report card published',
                            p_term || ' report card is ready.', '/report-cards');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.withdraw_report_card(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.report_cards set withdrawn_at = now()
   where id = p_id and school_id = public.auth_school() and withdrawn_at is null;
end $$;
set check_function_bodies = off;

-- ===== Grade (std) changes ==============================================
create or replace function public.create_promotion_run(p_from_year uuid, p_to_year uuid,
                                                       p_rule text default 'all') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid := public.auth_school(); v_run uuid; e record; v_next uuid; v_to uuid; v_action text;
  v_review boolean; v_note text; v_att numeric; v_mark numeric; v_min numeric; v_pass numeric;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_rule not in ('all', 'by_rule') then raise exception 'unknown rule'; end if;
  if p_from_year = p_to_year then raise exception 'choose two different years'; end if;
  if (select count(*) from public.academic_years where school_id = v_school and id in (p_from_year, p_to_year)) <> 2 then
    raise exception 'academic year not found';
  end if;
  if exists (select 1 from public.promotion_runs where school_id = v_school and from_year_id = p_from_year
                and status in ('proposed', 'approved', 'applied')) then
    raise exception 'a grade change run already exists for that year';
  end if;
  v_min := coalesce((internal.get_setting(v_school, 'min_attendance_for_promotion') #>> '{}')::numeric, 75);
  v_pass := coalesce((internal.get_setting(v_school, 'pass_percent') #>> '{}')::numeric, 33);

  insert into public.promotion_runs (school_id, from_year_id, to_year_id, rule, created_by)
  values (v_school, p_from_year, p_to_year, p_rule, auth.uid()) returning id into v_run;

  for e in
    select en.id as enrolment_id, en.student_id, en.class_id, c.section, c.grade_level_id, g.order_no
      from public.enrolments en
      join public.classes c on c.id = en.class_id
      join public.grade_levels g on g.id = c.grade_level_id
     where en.school_id = v_school and en.academic_year_id = p_from_year and en.status = 'active'
  loop
    v_action := 'promote'; v_review := false; v_note := null; v_to := null;
    select id into v_next from public.grade_levels where school_id = v_school and order_no = e.order_no + 1;
    if v_next is null then
      v_action := 'pass_out';
    else
      select id into v_to from public.classes
       where academic_year_id = p_to_year and grade_level_id = v_next
       order by (section = e.section) desc, section limit 1;
      if v_to is null then v_review := true; v_note := 'No class exists in the new year for the next grade'; end if;
    end if;

    if p_rule = 'by_rule' and v_action = 'promote' then
      v_att := internal.attendance_pct(e.enrolment_id);
      v_mark := internal.year_overall_pct(e.enrolment_id);
      if (v_att is not null and v_att < v_min) or (v_mark is not null and v_mark < v_pass) then
        v_action := 'hold_back'; v_review := true;
        v_note := format('Attendance %s%%, marks %s%%', coalesce(v_att::text, 'n/a'), coalesce(v_mark::text, 'n/a'));
        select id into v_to from public.classes
         where academic_year_id = p_to_year and grade_level_id = e.grade_level_id
         order by (section = e.section) desc, section limit 1;
        if v_to is null then v_note := v_note || '; no class for this grade in the new year'; end if;
      end if;
    end if;

    insert into public.promotion_items (school_id, run_id, student_id, from_enrolment_id, from_class_id,
                                        action, to_class_id, needs_review, note)
    values (v_school, v_run, e.student_id, e.enrolment_id, e.class_id, v_action, v_to, v_review, v_note);
  end loop;
  return v_run;
end $$;

create or replace function public.update_promotion_item(p_item_id uuid, p_action text, p_to_class_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_item record; v_run record; v_to record; v_from_grade uuid;
begin
  if p_action not in ('promote', 'hold_back', 'move', 'pass_out') then raise exception 'unknown action'; end if;
  select * into v_item from public.promotion_items where id = p_item_id and school_id = v_school;
  if not found then raise exception 'not found'; end if;
  if not (public.is_admin() or public.is_class_teacher_of(v_item.from_class_id)) then
    raise exception 'only the class teacher or admin can change this' using errcode = '42501';
  end if;
  select * into v_run from public.promotion_runs where id = v_item.run_id;
  if v_run.status <> 'proposed' then raise exception 'this run can no longer be edited'; end if;
  if p_action = 'pass_out' then
    p_to_class_id := null;
  else
    select * into v_to from public.classes where id = p_to_class_id and school_id = v_school and academic_year_id = v_run.to_year_id;
    if not found then raise exception 'choose a class of the new year'; end if;
    if p_action = 'hold_back' then
      select grade_level_id into v_from_grade from public.classes where id = v_item.from_class_id;
      if v_to.grade_level_id <> v_from_grade then raise exception 'hold back means the same grade'; end if;
    end if;
  end if;
  update public.promotion_items
     set action = p_action, to_class_id = p_to_class_id, needs_review = false,
         note = coalesce(note || ' | ', '') || 'edited'
   where id = p_item_id;
end $$;

create or replace function public.confirm_promotion_items(p_run_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.promotion_items set needs_review = false
   where run_id = p_run_id and school_id = public.auth_school() and needs_review
     and (to_class_id is not null or action = 'pass_out');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.approve_promotion_run(p_run_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_bad int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if not exists (select 1 from public.promotion_runs where id = p_run_id and school_id = v_school and status = 'proposed') then
    raise exception 'run not found or not waiting for approval';
  end if;
  select count(*) into v_bad from public.promotion_items
   where run_id = p_run_id and (needs_review or (action <> 'pass_out' and to_class_id is null));
  if v_bad > 0 then raise exception '% students still need a decision', v_bad; end if;
  update public.promotion_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run_id;
end $$;

-- Everything in one transaction: a class is never half promoted.
create or replace function public.apply_promotion_run(p_run_id uuid, p_passout_disable_on date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_run record; i record; v_roll int; v_new uuid; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into v_run from public.promotion_runs where id = p_run_id and school_id = v_school;
  if not found or v_run.status <> 'approved' then raise exception 'approve the run first'; end if;

  for i in
    select it.*, p.full_name from public.promotion_items it join public.profiles p on p.id = it.student_id
     where it.run_id = p_run_id order by it.to_class_id, p.full_name
  loop
    if i.action = 'pass_out' then
      update public.enrolments set status = 'passed_out' where id = i.from_enrolment_id;
      if p_passout_disable_on is not null then
        update public.profiles set disabled_from = p_passout_disable_on where id = i.student_id;
      end if;
    else
      select coalesce(max(roll_no), 0) + 1 into v_roll from public.enrolments where class_id = i.to_class_id;
      insert into public.enrolments (school_id, student_id, class_id, academic_year_id, roll_no)
      values (v_school, i.student_id, i.to_class_id, v_run.to_year_id, v_roll) returning id into v_new;
      update public.enrolments set status = case when i.action = 'hold_back' then 'held_back' else 'promoted' end
       where id = i.from_enrolment_id;
      update public.promotion_items set new_enrolment_id = v_new where id = i.id;
    end if;
    v_n := v_n + 1;
  end loop;

  update public.academic_years set is_current = false where school_id = v_school and is_current;
  update public.academic_years set is_current = true where id = v_run.to_year_id;
  update public.promotion_runs set status = 'applied', applied_at = now() where id = p_run_id;
  return v_n;
end $$;

create or replace function public.reverse_promotion_run(p_run_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_run record; v_days int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into v_run from public.promotion_runs where id = p_run_id and school_id = v_school;
  if not found or v_run.status <> 'applied' then raise exception 'only an applied run can be reversed'; end if;
  v_days := coalesce((internal.get_setting(v_school, 'promotion_reverse_days') #>> '{}')::int, 14);
  if v_run.applied_at < now() - make_interval(days => v_days) then
    raise exception 'this run is older than % days and can no longer be reversed', v_days;
  end if;
  if exists (select 1 from public.promotion_items it
              where it.run_id = p_run_id and it.new_enrolment_id is not null
                and (exists (select 1 from public.attendance a where a.enrolment_id = it.new_enrolment_id)
                     or exists (select 1 from public.marks m where m.enrolment_id = it.new_enrolment_id))) then
    raise exception 'attendance or marks were already recorded in the new year';
  end if;
  update public.enrolments set status = 'active'
   where id in (select from_enrolment_id from public.promotion_items where run_id = p_run_id);
  delete from public.enrolments where id in (select new_enrolment_id from public.promotion_items
                                              where run_id = p_run_id and new_enrolment_id is not null);
  update public.promotion_items set new_enrolment_id = null where run_id = p_run_id;
  update public.profiles set disabled_from = null
   where id in (select student_id from public.promotion_items where run_id = p_run_id and action = 'pass_out');
  update public.academic_years set is_current = false where id = v_run.to_year_id;
  update public.academic_years set is_current = true where id = v_run.from_year_id;
  update public.promotion_runs set status = 'reversed', reversed_at = now() where id = p_run_id;
end $$;

-- Copy classes, subject teachers and the timetable into a new academic year.
create or replace function public.clone_year_setup(p_from_year uuid, p_to_year uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_n int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if (select count(*) from public.academic_years where school_id = v_school and id in (p_from_year, p_to_year)) <> 2 then
    raise exception 'academic year not found';
  end if;
  insert into public.classes (school_id, academic_year_id, grade_level_id, section, class_teacher_id, chat_enabled)
  select school_id, p_to_year, grade_level_id, section, class_teacher_id, chat_enabled
    from public.classes where academic_year_id = p_from_year and school_id = v_school
  on conflict (academic_year_id, grade_level_id, section) do nothing;
  get diagnostics v_n = row_count;

  insert into public.teaching_assignments (school_id, class_id, subject_id, teacher_id)
  select ta.school_id, nc.id, ta.subject_id, ta.teacher_id
    from public.teaching_assignments ta
    join public.classes oc on oc.id = ta.class_id and oc.academic_year_id = p_from_year
    join public.classes nc on nc.academic_year_id = p_to_year and nc.grade_level_id = oc.grade_level_id and nc.section = oc.section
  on conflict do nothing;

  insert into public.timetable_entries (school_id, class_id, subject_id, teacher_id, weekday, period_id)
  select te.school_id, nc.id, te.subject_id, te.teacher_id, te.weekday, te.period_id
    from public.timetable_entries te
    join public.classes oc on oc.id = te.class_id and oc.academic_year_id = p_from_year
    join public.classes nc on nc.academic_year_id = p_to_year and nc.grade_level_id = oc.grade_level_id and nc.section = oc.section
  on conflict do nothing;
  return v_n;
end $$;

-- Mid-year change for one student: class teacher proposes, admin approves.
create or replace function public.request_grade_change(p_enrolment_id uuid, p_to_class_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_e record; v_id uuid;
begin
  select * into v_e from public.enrolments where id = p_enrolment_id and school_id = v_school and status = 'active';
  if not found then raise exception 'student not found'; end if;
  if not (public.is_admin() or public.is_class_teacher_of(v_e.class_id)) then
    raise exception 'only the class teacher or admin can propose this' using errcode = '42501';
  end if;
  if not exists (select 1 from public.classes where id = p_to_class_id and school_id = v_school
                    and academic_year_id = v_e.academic_year_id and id <> v_e.class_id) then
    raise exception 'choose a different class of the same year';
  end if;
  insert into public.grade_change_requests (school_id, enrolment_id, from_class_id, to_class_id, reason, requested_by)
  values (v_school, p_enrolment_id, v_e.class_id, p_to_class_id, nullif(trim(p_reason), ''), auth.uid()) returning id into v_id;
  insert into public.notifications (school_id, profile_id, kind, title, body, link)
  select v_school, p.id, 'grade_change', 'Grade change proposed', coalesce(p_reason, ''), '/admin/promotions'
    from public.profiles p where p.school_id = v_school and p.role = 'admin' and p.is_active and p.id <> auth.uid();
  return v_id;
end $$;

create or replace function public.decide_grade_change(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_r record; v_roll int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  select * into v_r from public.grade_change_requests where id = p_id and school_id = v_school and status = 'pending';
  if not found then raise exception 'request not found'; end if;
  if p_approve then
    select coalesce(max(roll_no), 0) + 1 into v_roll from public.enrolments where class_id = v_r.to_class_id;
    update public.enrolments set class_id = v_r.to_class_id, roll_no = v_roll where id = v_r.enrolment_id and status = 'active';
  end if;
  update public.grade_change_requests
     set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end $$;

-- ===== Leave and substitutions ==========================================
create or replace function public.request_leave(p_from date, p_to date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_role text := public.auth_role(); v_id uuid; v_ct uuid; v_name text;
begin
  if v_role not in ('teacher', 'student') then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'the end date is before the start date'; end if;
  insert into public.leave_requests (school_id, requester_id, kind, from_date, to_date, reason, created_by)
  values (v_school, auth.uid(), v_role, p_from, p_to, nullif(trim(p_reason), ''), auth.uid()) returning id into v_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  if v_role = 'student' then
    select c.class_teacher_id into v_ct from public.enrolments e join public.classes c on c.id = e.class_id
     where e.student_id = auth.uid() and e.status = 'active' limit 1;
    perform internal.notify(v_school, v_ct, 'leave', 'Leave request: ' || v_name, format('%s to %s', p_from, p_to), '/leave');
  end if;
  insert into public.notifications (school_id, profile_id, kind, title, body, link)
  select v_school, p.id, 'leave', 'Leave request: ' || v_name, format('%s to %s', p_from, p_to), '/leave'
    from public.profiles p where p.school_id = v_school and p.role = 'admin' and p.is_active and p.id is distinct from v_ct;
  return v_id;
end $$;

create or replace function public.decide_leave(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_l record; v_ok boolean;
begin
  select * into v_l from public.leave_requests where id = p_id and school_id = v_school and status = 'pending';
  if not found then raise exception 'request not found'; end if;
  if v_l.requester_id = auth.uid() then raise exception 'you cannot decide your own request'; end if;
  v_ok := public.is_admin() or (v_l.kind = 'student' and exists (
            select 1 from public.enrolments e join public.classes c on c.id = e.class_id
             where e.student_id = v_l.requester_id and e.status = 'active' and c.class_teacher_id = auth.uid()));
  if not v_ok then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now() where id = p_id;
  perform internal.notify(v_school, v_l.requester_id, 'leave',
                          case when p_approve then 'Leave approved' else 'Leave not approved' end,
                          format('%s to %s', v_l.from_date, v_l.to_date), '/leave');
end $$;

create or replace function public.mark_teacher_absent(p_teacher uuid, p_from date, p_to date, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_id uuid; d date;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_to < p_from then raise exception 'the end date is before the start date'; end if;
  if p_to - p_from > 62 then raise exception 'choose a range of up to 62 days'; end if;
  if not exists (select 1 from public.profiles where id = p_teacher and school_id = v_school and role = 'teacher') then
    raise exception 'teacher not found';
  end if;
  insert into public.leave_requests (school_id, requester_id, kind, from_date, to_date, reason, status,
                                     decided_by, decided_at, created_by)
  values (v_school, p_teacher, 'teacher', p_from, p_to, nullif(trim(p_reason), ''), 'approved', auth.uid(), now(), auth.uid())
  returning id into v_id;
  -- automatic: every period this teacher has on these dates gets a substitute suggested at once
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    perform internal.generate_subs_for_teacher_date(p_teacher, d);
  end loop;
  return v_id;
end $$;

-- Is this teacher marked absent (or on approved leave) on this date, by either record?
create or replace function internal.is_teacher_absent(p_teacher uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.leave_requests l
                  where l.requester_id = p_teacher and l.kind = 'teacher' and l.status = 'approved'
                    and p_date between l.from_date and l.to_date)
      or exists (select 1 from public.staff_attendance a
                  where a.profile_id = p_teacher and a.date = p_date and a.status in ('absent', 'leave'))
$$;

-- Best free teacher for one period on one date.
--   must be free, not on leave, not over the daily limit;
--   then ranked by the school's order (same subject / same grade), then fewest substitutions this month.
create or replace function internal.suggest_substitute(p_entry uuid, p_date date, p_exclude uuid[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_te record; v_max int; v_rank jsonb; v_w_subject int := 0; v_w_grade int := 0; v_pos int; v_cand uuid;
begin
  select te.*, c.grade_level_id into v_te from public.timetable_entries te join public.classes c on c.id = te.class_id where te.id = p_entry;
  if not found then return null; end if;
  v_max := coalesce((internal.get_setting(v_te.school_id, 'max_extra_periods_per_day') #>> '{}')::int, 2);
  v_rank := internal.get_setting(v_te.school_id, 'substitution_rank');
  for v_pos in 0 .. coalesce(jsonb_array_length(v_rank), 0) - 1 loop
    if v_rank ->> v_pos = 'subject' then v_w_subject := 8 >> v_pos; end if;
    if v_rank ->> v_pos = 'grade' then v_w_grade := 8 >> v_pos; end if;
  end loop;

  select p.id into v_cand
    from public.profiles p
   where p.school_id = v_te.school_id and p.role = 'teacher' and p.is_active
     and p.id <> v_te.teacher_id and p.id <> all (coalesce(p_exclude, '{}'))
     and not exists (select 1 from public.leave_requests l
                      where l.requester_id = p.id and l.kind = 'teacher' and l.status = 'approved'
                        and p_date between l.from_date and l.to_date)
     and not exists (select 1 from public.timetable_entries t2
                      where t2.teacher_id = p.id and t2.academic_year_id = v_te.academic_year_id
                        and t2.weekday = v_te.weekday and t2.period_id = v_te.period_id)
     and not exists (select 1 from public.substitutions s
                      where s.substitute_id = p.id and s.date = p_date and s.period_id = v_te.period_id
                        and s.timetable_entry_id <> p_entry and s.status in ('suggested', 'approved', 'accepted'))
     and (select count(*) from public.substitutions s
           where s.substitute_id = p.id and s.date = p_date and s.timetable_entry_id <> p_entry
             and s.status in ('suggested', 'approved', 'accepted')) < v_max
   order by
     (case when exists (select 1 from public.teaching_assignments ta
                         where ta.teacher_id = p.id and ta.subject_id = v_te.subject_id) then v_w_subject else 0 end
      + case when exists (select 1 from public.teaching_assignments ta join public.classes cc on cc.id = ta.class_id
                           where ta.teacher_id = p.id and cc.grade_level_id = v_te.grade_level_id) then v_w_grade else 0 end) desc,
     (select count(*) from public.substitutions s
       where s.substitute_id = p.id and s.status in ('approved', 'accepted')
         and date_trunc('month', s.date) = date_trunc('month', p_date)) asc,
     p.full_name asc
   limit 1;
  return v_cand;
end $$;

-- The automatic part: every period this ONE teacher has on this ONE date gets a
-- substitute suggestion (or is left alone if already approved/accepted/self-study).
-- Called the instant a teacher is marked absent, from whichever screen did it.
create or replace function internal.generate_subs_for_teacher_date(p_teacher uuid, p_date date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_school uuid; te record; v_cand uuid; v_declined uuid[]; v_n int := 0;
begin
  select school_id into v_school from public.profiles where id = p_teacher;
  if v_school is null then return 0; end if;
  for te in
    select t.* from public.timetable_entries t
     where t.teacher_id = p_teacher and t.weekday = extract(isodow from p_date)::int
       and t.academic_year_id = (select ay.id from public.academic_years ay
                                  where ay.school_id = v_school and p_date between ay.start_date and ay.end_date
                                  order by ay.is_current desc limit 1)
     order by t.period_id
  loop
    if exists (select 1 from public.substitutions s where s.timetable_entry_id = te.id and s.date = p_date
                  and s.status in ('approved', 'accepted', 'self_study')) then
      continue;
    end if;
    select declined_by into v_declined from public.substitutions where timetable_entry_id = te.id and date = p_date;
    v_cand := internal.suggest_substitute(te.id, p_date, coalesce(v_declined, '{}'));
    insert into public.substitutions (school_id, timetable_entry_id, date, substitute_id, status)
    values (v_school, te.id, p_date, v_cand, case when v_cand is null then 'unassigned' else 'suggested' end)
    on conflict (timetable_entry_id, date) do update
      set substitute_id = excluded.substitute_id, status = excluded.status
      where public.substitutions.status in ('suggested', 'unassigned', 'declined');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Manual catch-up over a range: finds every teacher marked absent (leave or staff
-- attendance) on each date and makes sure every one of their periods has a suggestion.
-- Mostly a safety net now that marking someone absent does this automatically.
create or replace function public.generate_substitutions(p_from date, p_to date) returns integer
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); d date; t record; v_n int := 0;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 62 then raise exception 'choose a range of up to 62 days'; end if;
  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    for t in
      select distinct te.teacher_id from public.timetable_entries te
       where te.school_id = v_school and te.weekday = extract(isodow from d)::int
         and internal.is_teacher_absent(te.teacher_id, d)
    loop
      v_n := v_n + internal.generate_subs_for_teacher_date(t.teacher_id, d);
    end loop;
  end loop;
  return v_n;
end $$;

-- ===== Staff (teacher) attendance =======================================
-- p_rows: [{"profile_id": "...", "status": "present|absent|late|leave"}]
-- Marking someone absent or on leave here fires a trigger that suggests
-- substitutes for their periods that same date -- fully automatic.
create or replace function public.save_staff_attendance(p_date date, p_rows jsonb, p_reason text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_school uuid := public.auth_school(); v_uid uuid := auth.uid(); v_today date := public.school_today();
  r jsonb; v_status text; v_reason text := nullif(trim(coalesce(p_reason, '')), ''); v_n int := 0;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_date > v_today + 1 then raise exception 'you cannot mark attendance too far in the future'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_status := r ->> 'status';
    if v_status not in ('present', 'absent', 'late', 'leave') then raise exception 'bad status: %', v_status; end if;
    if not exists (select 1 from public.profiles where id = (r ->> 'profile_id')::uuid and school_id = v_school and role = 'teacher') then
      raise exception 'a person in the list is not a teacher of this school';
    end if;
    insert into public.staff_attendance (school_id, profile_id, date, status, marked_by, reason)
    values (v_school, (r ->> 'profile_id')::uuid, p_date, v_status, v_uid, v_reason)
    on conflict (profile_id, date)
    do update set status = excluded.status, marked_by = excluded.marked_by, reason = excluded.reason
      where public.staff_attendance.status is distinct from excluded.status;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function internal.trg_staff_attendance_auto_sub() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('absent', 'leave') and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    perform internal.generate_subs_for_teacher_date(new.profile_id, new.date);
  end if;
  return new;
end $$;
create trigger staff_attendance_auto_sub after insert or update on public.staff_attendance
  for each row execute function internal.trg_staff_attendance_auto_sub();

create or replace function public.staff_attendance_summary(p_from date, p_to date)
returns table (profile_id uuid, full_name text, login_id text, present bigint, absent bigint, late bigint, leave bigint, pct numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name, p.login_id,
         count(a.id) filter (where a.status = 'present'),
         count(a.id) filter (where a.status = 'absent'),
         count(a.id) filter (where a.status = 'late'),
         count(a.id) filter (where a.status = 'leave'),
         case when count(a.id) filter (where a.status in ('present', 'late', 'absent')) = 0 then null
              else round(100.0 * count(a.id) filter (where a.status in ('present', 'late'))
                   / count(a.id) filter (where a.status in ('present', 'late', 'absent')), 1) end
    from public.profiles p
    left join public.staff_attendance a on a.profile_id = p.id and a.date between p_from and p_to
   where p.school_id = public.auth_school() and p.role = 'teacher' and p.is_active
   group by p.id, p.full_name, p.login_id
   order by p.full_name;
end $$;

create or replace function public.my_staff_attendance(p_from date, p_to date)
returns table (date date, status text)
language sql stable security definer set search_path = public as $$
  select date, status from public.staff_attendance
   where profile_id = auth.uid() and date between p_from and p_to
   order by date
$$;

create or replace function public.assign_substitution(p_id uuid, p_substitute uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_s record; v_class text;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_status not in ('approved', 'suggested', 'self_study', 'unassigned') then raise exception 'unknown status'; end if;
  select * into v_s from public.substitutions where id = p_id and school_id = v_school;
  if not found then raise exception 'substitution not found'; end if;
  if p_status in ('approved', 'suggested') and p_substitute is null then raise exception 'choose a substitute teacher'; end if;
  if p_status in ('self_study', 'unassigned') then p_substitute := null; end if;
  update public.substitutions
     set substitute_id = p_substitute, status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else null end
   where id = p_id;
  if p_status = 'approved' then
    select g.name || ' ' || c.section into v_class
      from public.timetable_entries te join public.classes c on c.id = te.class_id
      join public.grade_levels g on g.id = c.grade_level_id where te.id = v_s.timetable_entry_id;
    perform internal.notify(v_school, p_substitute, 'substitution', 'Substitution assigned',
                            format('%s on %s. Please accept or decline.', v_class, v_s.date), '/substitutions');
  end if;
end $$;

create or replace function public.respond_substitution(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_s record; v_cand uuid; v_declined uuid[];
begin
  select * into v_s from public.substitutions where id = p_id and school_id = v_school
     and substitute_id = auth.uid() and status = 'approved';
  if not found then raise exception 'nothing to respond to'; end if;
  if p_accept then
    update public.substitutions set status = 'accepted' where id = p_id;
    perform internal.notify(v_school, v_s.approved_by, 'substitution', 'Substitution accepted',
                            format('Accepted for %s.', v_s.date), '/substitutions');
  else
    v_declined := array_append(v_s.declined_by, auth.uid());
    update public.substitutions set substitute_id = null, status = 'unassigned', declined_by = v_declined where id = p_id;
    v_cand := internal.suggest_substitute(v_s.timetable_entry_id, v_s.date, v_declined);
    update public.substitutions set substitute_id = v_cand,
           status = case when v_cand is null then 'unassigned' else 'suggested' end where id = p_id;
    insert into public.notifications (school_id, profile_id, kind, title, body, link)
    select v_school, p.id, 'substitution', 'Substitution declined',
           format('A substitution on %s was declined and needs a decision.', v_s.date), '/substitutions'
      from public.profiles p where p.school_id = v_school and p.role = 'admin' and p.is_active;
  end if;
end $$;

-- ===== Official notices and notifications ================================
create or replace function public.send_notice(p_title text, p_body text, p_audience_type text,
                                              p_grade_ids uuid[] default '{}', p_class_ids uuid[] default '{}',
                                              p_profile_ids uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_id uuid; v_year uuid;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then raise exception 'a title and a message are required'; end if;
  if p_audience_type not in ('school', 'grade', 'section', 'people') then raise exception 'unknown audience'; end if;
  select id into v_year from public.academic_years where school_id = v_school and is_current;
  insert into public.notices (school_id, title, body, audience_type, audience, sent_by)
  values (v_school, trim(p_title), trim(p_body), p_audience_type,
          jsonb_build_object('grade_ids', p_grade_ids, 'class_ids', p_class_ids, 'profile_ids', p_profile_ids), auth.uid())
  returning id into v_id;

  insert into public.notice_reads (notice_id, profile_id, school_id)
  select distinct v_id, r.pid, v_school from (
    select p.id as pid from public.profiles p
     where p_audience_type = 'school' and p.school_id = v_school and p.is_active
    union
    select e.student_id from public.enrolments e join public.classes c on c.id = e.class_id
     where p_audience_type in ('grade', 'section') and e.status = 'active' and c.school_id = v_school
       and c.academic_year_id = v_year
       and ((p_audience_type = 'grade' and c.grade_level_id = any(p_grade_ids))
            or (p_audience_type = 'section' and c.id = any(p_class_ids)))
    union
    select c.class_teacher_id from public.classes c
     where p_audience_type in ('grade', 'section') and c.school_id = v_school and c.academic_year_id = v_year
       and c.class_teacher_id is not null
       and ((p_audience_type = 'grade' and c.grade_level_id = any(p_grade_ids))
            or (p_audience_type = 'section' and c.id = any(p_class_ids)))
    union
    select p.id from public.profiles p
     where p_audience_type = 'people' and p.school_id = v_school and p.is_active and p.id = any(p_profile_ids)
  ) r where r.pid is not null;

  if not exists (select 1 from public.notice_reads where notice_id = v_id) then
    raise exception 'that audience has no members';
  end if;
  return v_id;
end $$;

create or replace function public.mark_notice_read(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.notice_reads set read_at = coalesce(read_at, now()) where notice_id = p_id and profile_id = auth.uid()
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns void
language sql security definer set search_path = public as $$
  update public.notifications set read_at = now()
   where profile_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
$$;

-- ===== Dashboard numbers ==================================================
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_today date := public.school_today();
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'students', (select count(*) from public.profiles where school_id = v_school and role = 'student' and is_active),
    'teachers', (select count(*) from public.profiles where school_id = v_school and role = 'teacher' and is_active),
    'classes', (select count(*) from public.classes c join public.academic_years y on y.id = c.academic_year_id
                 where c.school_id = v_school and y.is_current),
    'present_today', (select count(*) from public.attendance where school_id = v_school and date = v_today and status in ('present', 'late')),
    'absent_today', (select count(*) from public.attendance where school_id = v_school and date = v_today and status = 'absent'),
    'staff_marked_today', (select count(*) from public.staff_attendance where school_id = v_school and date = v_today),
    'staff_present_today', (select count(*) from public.staff_attendance where school_id = v_school and date = v_today and status in ('present', 'late')),
    'staff_absent_today', (select count(*) from public.staff_attendance where school_id = v_school and date = v_today and status in ('absent', 'leave')),
    'pending_leaves', (select count(*) from public.leave_requests where school_id = v_school and status = 'pending'),
    'open_reports', (select count(*) from public.message_reports where school_id = v_school and status = 'open'),
    'open_substitutions', (select count(*) from public.substitutions where school_id = v_school and date >= v_today
                            and status in ('unassigned', 'suggested', 'declined')));
end $$;
set check_function_bodies = off;

-- ===== Messaging ==========================================================
-- People the caller is allowed to start a chat with.
create or replace function public.chat_contacts(p_query text default null)
returns table (id uuid, full_name text, role text, subtitle text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if public.auth_school() is null then return; end if;
  return query
  select p.id, p.full_name, p.role,
         coalesce(case p.role
           when 'student' then (select g.name || ' ' || c.section
                                  from public.enrolments e join public.classes c on c.id = e.class_id
                                  join public.grade_levels g on g.id = c.grade_level_id
                                 where e.student_id = p.id and e.status = 'active' limit 1)
           when 'teacher' then (select string_agg(distinct s.name, ', ')
                                  from public.teaching_assignments ta join public.subjects s on s.id = ta.subject_id
                                 where ta.teacher_id = p.id)
           else 'School office' end, '')
    from public.profiles p
   where p.school_id = public.auth_school() and p.is_active and p.id <> auth.uid()
     and (p_query is null or p_query = '' or p.full_name ilike '%' || p_query || '%')
     and internal.can_chat(auth.uid(), p.id)
   order by p.full_name
   limit 200;
end $$;

create or replace function public.start_conversation(p_member_ids uuid[], p_title text default null,
                                                     p_class_id uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_school uuid := public.auth_school(); v_role text := public.auth_role();
  v_members uuid[]; v_type text; v_id uuid; m uuid; v_group boolean := false; v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_roles text[];
begin
  if v_school is null then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_class_id is not null then
    if not (v_role = 'admin' or (v_role = 'teacher' and internal.teacher_teaches_class(v_uid, p_class_id))) then
      raise exception 'only teachers of the class can start a class group' using errcode = '42501';
    end if;
    if not exists (select 1 from public.classes where id = p_class_id and school_id = v_school) then raise exception 'class not found'; end if;
    v_members := array(select e.student_id from public.enrolments e
                        join public.profiles p on p.id = e.student_id and p.is_active
                       where e.class_id = p_class_id and e.status = 'active');
    if cardinality(v_members) = 0 then raise exception 'that class has no students'; end if;
    v_type := 'teacher_student'; v_group := true;
    if v_title is null then
      select 'Class ' || g.name || ' ' || c.section into v_title
        from public.classes c join public.grade_levels g on g.id = c.grade_level_id where c.id = p_class_id;
    end if;
  else
    v_members := array(select distinct x from unnest(p_member_ids) x where x <> v_uid);
    if cardinality(v_members) = 0 then raise exception 'choose at least one person'; end if;
    foreach m in array v_members loop
      if not internal.can_chat(v_uid, m) then raise exception 'you cannot message one of the people you chose'; end if;
    end loop;
    v_roles := array(select distinct role from public.profiles where id = any(v_members || v_uid));
    if v_roles <@ array['teacher', 'admin'] then v_type := 'teacher_teacher';
    elsif v_roles = array['student'] then v_type := 'student_student';
    else v_type := 'teacher_student'; end if;
    v_group := cardinality(v_members) > 1;
    if not v_group then
      select c.id into v_id from public.conversations c
       where not c.is_group and c.school_id = v_school
         and exists (select 1 from public.conversation_members x where x.conversation_id = c.id and x.profile_id = v_uid)
         and exists (select 1 from public.conversation_members y where y.conversation_id = c.id and y.profile_id = v_members[1])
         and (select count(*) from public.conversation_members z where z.conversation_id = c.id) = 2
       limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  insert into public.conversations (school_id, type, title, is_group, class_id, created_by)
  values (v_school, v_type, v_title, v_group, p_class_id, v_uid) returning id into v_id;
  insert into public.conversation_members (conversation_id, profile_id, school_id)
  select v_id, x, v_school from unnest(v_members || v_uid) x;
  return v_id;
end $$;

create or replace function public.send_message(p_conversation_id uuid, p_body text, p_files jsonb default '[]') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_school uuid := public.auth_school(); v_role text := public.auth_role();
  v_conv record; v_mem record; v_disabled boolean; v_id uuid; f jsonb; v_body text := trim(coalesce(p_body, ''));
  v_q jsonb; v_now time; v_start time; v_end time; v_tz text; v_inq boolean;
begin
  if v_school is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into v_conv from public.conversations where id = p_conversation_id and school_id = v_school;
  select * into v_mem from public.conversation_members where conversation_id = p_conversation_id and profile_id = v_uid;
  if v_conv.id is null or v_mem.profile_id is null then raise exception 'you are not part of this chat' using errcode = '42501'; end if;
  select messaging_disabled into v_disabled from public.profiles where id = v_uid;
  if v_disabled then raise exception 'messaging is switched off for your account'; end if;
  if v_mem.is_muted then raise exception 'you have been muted in this chat'; end if;
  if v_body = '' and jsonb_array_length(coalesce(p_files, '[]')) = 0 then raise exception 'write a message first'; end if;
  if length(v_body) > 4000 then raise exception 'that message is too long'; end if;

  if v_role = 'student' and v_conv.type = 'student_student' then
    if not coalesce((internal.get_setting(v_school, 'student_chat_enabled') #>> '{}')::boolean, true) then
      raise exception 'student chat is switched off';
    end if;
    -- every other person must still be someone this student may chat with (class chat switched off, etc.)
    if exists (select 1 from public.conversation_members cm
                where cm.conversation_id = p_conversation_id and cm.profile_id <> v_uid
                  and not internal.can_chat(v_uid, cm.profile_id)) then
      raise exception 'chat is switched off for this class';
    end if;
    v_q := internal.get_setting(v_school, 'quiet_hours');
    if coalesce((v_q ->> 'enabled')::boolean, false) then
      select timezone into v_tz from public.schools where id = v_school;
      v_now := (now() at time zone v_tz)::time;
      v_start := (v_q ->> 'start')::time; v_end := (v_q ->> 'end')::time;
      v_inq := case when v_start > v_end then (v_now >= v_start or v_now < v_end) else (v_now >= v_start and v_now < v_end) end;
      if v_inq then raise exception 'student chat is paused during quiet hours (% to %)', v_q ->> 'start', v_q ->> 'end'; end if;
    end if;
  end if;

  insert into public.messages (school_id, conversation_id, sender_id, body) values (v_school, p_conversation_id, v_uid, v_body)
  returning id into v_id;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]')) loop
    if (f ->> 'path') is null or (f ->> 'path') not like v_school::text || '/%' then raise exception 'bad file path'; end if;
    insert into public.message_files (school_id, message_id, storage_path, file_name, size_bytes)
    values (v_school, v_id, f ->> 'path', coalesce(f ->> 'name', 'file'), nullif(f ->> 'size', '')::bigint);
  end loop;
  update public.conversation_members set last_read_at = now() where conversation_id = p_conversation_id and profile_id = v_uid;
  return v_id;
end $$;

create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_m record;
begin
  select * into v_m from public.messages where id = p_id and school_id = public.auth_school() and deleted_at is null;
  if not found then raise exception 'message not found'; end if;
  if not (v_m.sender_id = auth.uid() or public.is_admin()) then raise exception 'not allowed' using errcode = '42501'; end if;
  insert into public.deleted_message_bodies (message_id, school_id, body) values (p_id, v_m.school_id, v_m.body)
  on conflict do nothing;
  update public.messages set body = '', deleted_at = now() where id = p_id;
end $$;

create or replace function public.report_message(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_school uuid := public.auth_school(); v_m record; v_id uuid; v_ct uuid; v_name text;
begin
  select m.* into v_m from public.messages m
   where m.id = p_id and m.school_id = v_school and m.conversation_id in (select public.my_conversation_ids());
  if not found then raise exception 'message not found'; end if;
  insert into public.message_reports (school_id, message_id, conversation_id, reported_by, reason, message_body)
  values (v_school, p_id, v_m.conversation_id, auth.uid(), nullif(trim(p_reason), ''), v_m.body) returning id into v_id;
  select full_name into v_name from public.profiles where id = auth.uid();
  select c.class_teacher_id into v_ct from public.enrolments e join public.classes c on c.id = e.class_id
   where e.student_id = auth.uid() and e.status = 'active' limit 1;
  perform internal.notify(v_school, v_ct, 'report', 'A message was reported', 'Reported by ' || v_name, '/class-desk');
  insert into public.notifications (school_id, profile_id, kind, title, body, link)
  select v_school, p.id, 'report', 'A message was reported', 'Reported by ' || v_name, '/admin/moderation'
    from public.profiles p where p.school_id = v_school and p.role = 'admin' and p.is_active and p.id is distinct from v_ct;
  return v_id;
end $$;

create or replace function public.resolve_report(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare v_r record; v_ok boolean;
begin
  if p_status not in ('reviewed', 'dismissed') then raise exception 'unknown status'; end if;
  select * into v_r from public.message_reports where id = p_id and school_id = public.auth_school();
  if not found then raise exception 'report not found'; end if;
  v_ok := public.is_admin() or exists (select 1 from public.enrolments e join public.classes c on c.id = e.class_id
                                        where e.student_id = v_r.reported_by and e.status = 'active' and c.class_teacher_id = auth.uid());
  if not v_ok then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.message_reports set status = p_status, handled_by = auth.uid() where id = p_id;
end $$;

create or replace function public.my_conversations()
returns table (id uuid, type text, title text, is_group boolean, class_id uuid,
               last_body text, last_at timestamptz, unread bigint, is_muted boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  select c.id, c.type,
         case when c.is_group then coalesce(c.title, 'Group chat')
              else coalesce((select p.full_name from public.conversation_members m2
                               join public.profiles p on p.id = m2.profile_id
                              where m2.conversation_id = c.id and m2.profile_id <> auth.uid() limit 1), 'Chat') end,
         c.is_group, c.class_id,
         lm.shown, lm.sent_at,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id is distinct from auth.uid()
             and m.sent_at > cm.last_read_at and m.deleted_at is null),
         cm.is_muted
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    left join lateral (select case when m.deleted_at is not null then 'Message removed' else m.body end as shown, m.sent_at
                         from public.messages m where m.conversation_id = c.id order by m.sent_at desc limit 1) lm on true
   where cm.profile_id = auth.uid()
   order by coalesce(lm.sent_at, c.created_at) desc;
end $$;

create or replace function public.conversation_members_info(p_conversation_id uuid)
returns table (profile_id uuid, full_name text, role text, is_muted boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (p_conversation_id in (select public.my_conversation_ids()) or public.is_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select m.profile_id, p.full_name, p.role, m.is_muted
    from public.conversation_members m join public.profiles p on p.id = m.profile_id
   where m.conversation_id = p_conversation_id and m.school_id = public.auth_school()
   order by p.full_name;
end $$;

create or replace function public.mark_conversation_read(p_conversation_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.conversation_members set last_read_at = now()
   where conversation_id = p_conversation_id and profile_id = auth.uid()
$$;

create or replace function public.set_member_mute(p_conversation_id uuid, p_profile uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or (public.auth_role() = 'teacher'
          and p_conversation_id in (select public.my_conversation_ids()))) then
    raise exception 'only teachers in the chat or admins can mute' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and role = 'student' and school_id = public.auth_school()) then
    raise exception 'only students can be muted';
  end if;
  update public.conversation_members set is_muted = p_muted
   where conversation_id = p_conversation_id and profile_id = p_profile and school_id = public.auth_school();
end $$;

create or replace function public.set_class_chat(p_class uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() or (public.auth_role() = 'teacher' and internal.teacher_teaches_class(auth.uid(), p_class))) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.classes set chat_enabled = p_enabled where id = p_class and school_id = public.auth_school();
end $$;

create or replace function public.set_messaging_disabled(p_profile uuid, p_disabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update public.profiles set messaging_disabled = p_disabled
   where id = p_profile and school_id = public.auth_school() and role = 'student';
end $$;

create or replace function public.admin_conversations(p_limit int default 100)
returns table (id uuid, type text, title text, members text, last_at timestamptz, message_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return query
  select c.id, c.type, c.title,
         (select string_agg(p.full_name, ', ' order by p.full_name) from public.conversation_members m
            join public.profiles p on p.id = m.profile_id where m.conversation_id = c.id),
         (select max(sent_at) from public.messages where conversation_id = c.id),
         (select count(*) from public.messages where conversation_id = c.id)
    from public.conversations c
   where c.school_id = public.auth_school()
   order by (select max(sent_at) from public.messages where conversation_id = c.id) desc nulls last
   limit least(p_limit, 500);
end $$;

-- ===== Student attendance report (with per-subject figures when marked per period) =====
create or replace function public.my_attendance_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_late boolean; v_school uuid := public.auth_school(); v_out jsonb;
begin
  if public.auth_role() is distinct from 'student' then raise exception 'students only' using errcode = '42501'; end if;
  v_late := coalesce((internal.get_setting(v_school, 'late_counts_as_attended') #>> '{}')::boolean, true);
  select jsonb_build_object(
           'present', count(*) filter (where a.status = 'present'),
           'absent', count(*) filter (where a.status = 'absent'),
           'late', count(*) filter (where a.status = 'late'),
           'leave', count(*) filter (where a.status = 'leave'),
           'percent', case when count(*) filter (where a.status in ('present', 'late', 'absent')) = 0 then null
                           else round(100.0 * count(*) filter (where a.status = 'present' or (a.status = 'late' and v_late))
                                / count(*) filter (where a.status in ('present', 'late', 'absent')), 1) end)
    into v_out
    from public.attendance a join public.enrolments e on e.id = a.enrolment_id
   where e.student_id = auth.uid() and a.date between p_from and p_to;
  v_out := v_out || jsonb_build_object('by_subject', coalesce((
    select jsonb_agg(q.x order by q.x ->> 'subject') from (
      select jsonb_build_object(
               'subject', s.name,
               'present', count(*) filter (where a.status = 'present'),
               'absent', count(*) filter (where a.status = 'absent'),
               'late', count(*) filter (where a.status = 'late'),
               'percent', case when count(*) filter (where a.status in ('present', 'late', 'absent')) = 0 then null
                               else round(100.0 * count(*) filter (where a.status = 'present' or (a.status = 'late' and v_late))
                                    / count(*) filter (where a.status in ('present', 'late', 'absent')), 1) end) as x
        from public.attendance a
        join public.enrolments e on e.id = a.enrolment_id
        join public.timetable_entries te on te.class_id = e.class_id and te.period_id = a.period_id
                                        and te.weekday = extract(isodow from a.date)::int
        join public.subjects s on s.id = te.subject_id
       where e.student_id = auth.uid() and a.date between p_from and p_to and a.period_id is not null
       group by s.name) q), '[]'::jsonb));
  return v_out;
end $$;

-- How many people got / read each notice (admins).
create or replace function public.notice_stats() returns table (notice_id uuid, total_count bigint, read_count bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return query
  select nr.notice_id, count(*), count(nr.read_at)
    from public.notice_reads nr where nr.school_id = public.auth_school() group by nr.notice_id;
end $$;

-- ---------------------------------------------------------------------
-- Live updates for chat and alerts (only if Realtime exists, as on Supabase)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'notice_reads', 'notifications'] loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when duplicate_object then null;
      end;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Privileges.  Nobody signed-out can do anything except the two login-protection calls.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema internal from public, anon, authenticated;

grant execute on all functions in schema public to authenticated;
revoke execute on function public.next_login_id(uuid, text) from authenticated;
revoke execute on function public.hook_password_verification_attempt(jsonb) from authenticated;
grant execute on function public.login_gate(text) to anon, authenticated;
grant execute on function public.login_record_failure(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on all functions in schema public to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
  end if;
end $$;

grant select on public.directory to authenticated;

-- Safety net: every table must have Row Level Security switched on.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' and not rowsecurity loop
    raise exception 'Row Level Security is OFF for table %', r.tablename;
  end loop;
end $$;
