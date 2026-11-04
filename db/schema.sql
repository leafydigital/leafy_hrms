-- =====================================================================
-- Leafy Digital HRMS — PostgreSQL schema, seed data and row-level security
-- Run once with:  cd server && npm run db:setup
-- The API connects as the table owner, then switches to the restricted
-- `app_user` role for every request so the policies below always apply.
-- =====================================================================

create extension if not exists pgcrypto;
create sequence if not exists public.emp_code_seq start 1;

-- Restricted role used for every API request (subject to RLS)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'app_user') then
    create role app_user nologin;
  end if;
  begin
    execute format('grant app_user to %I', current_user);
  exception when others then null;
  end;
end $$;

-- ---------------------------------------------------------------------
-- Logins. Passwords are bcrypt hashes; app_user can never read this table.
-- ---------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- The API sets app.user_id (per transaction) to the signed-in user's id.
create or replace function public.uid() returns uuid
language sql stable as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;


-- ---------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.designations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  -- system access role suggested when this designation is picked for an employee
  default_role text not null default 'employee'
    check (default_role in ('admin','hr','accounts','employee')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (department_id, name)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  emp_code text not null unique
    default ('LD' || lpad(nextval('public.emp_code_seq')::text, 3, '0')),
  full_name text not null,
  email text not null unique,
  phone text,
  gender text,
  date_of_birth date,
  address text,
  emergency_contact text,
  department_id uuid references public.departments(id) on delete set null,
  designation_id uuid references public.designations(id) on delete set null,
  reporting_to uuid references public.employees(id) on delete set null,
  role text not null default 'employee'
    check (role in ('admin','hr','accounts','employee')),
  employment_type text not null default 'Full-time'
    check (employment_type in ('Full-time','Part-time','Intern','Contract')),
  date_of_joining date,
  status text not null default 'active' check (status in ('active','inactive','resigned')),
  bank_name text,
  bank_account text,
  ifsc text,
  pan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helper functions used by RLS policies
-- ---------------------------------------------------------------------
create or replace function public.current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = public.uid() and status = 'active' limit 1
$$;

create or replace function public.current_role_key() returns text
language sql stable security definer set search_path = public as $$
  select role from public.employees where user_id = public.uid() and status = 'active' limit 1
$$;

create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role_key() = any(roles), false)
$$;

create or replace function public.today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Lightweight name directory every signed-in user can read (names only).
create or replace view public.employee_directory as
  select id, emp_code, full_name, department_id, designation_id, status from public.employees;
grant select on public.employee_directory to app_user;

-- ---------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------
create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  days_per_year numeric(5,1) not null default 0,
  is_paid boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id),
  start_date date not null,
  end_date date not null,
  days numeric(5,1) not null,
  half_day boolean not null default false,
  reason text,
  status text not null default 'pending'   -- every leave goes to HR for approval by default
    check (status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on public.leaves (employee_id, start_date);
create index on public.leaves (status);

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  check_in timestamptz,
  check_out timestamptz,
  status text not null default 'present'
    check (status in ('present','absent','half_day','wfh','leave','holiday')),
  note text,
  created_at timestamptz not null default now(),
  unique (employee_id, date)
);

-- ---------------------------------------------------------------------
-- Salary & payroll
-- ---------------------------------------------------------------------
create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees(id) on delete cascade,
  basic numeric(12,2) not null default 0,
  hra numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  pf numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  other_deductions numeric(12,2) not null default 0,
  effective_from date,
  updated_at timestamptz not null default now()
);

create table public.payroll (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  month date not null,                       -- always the 1st of the month
  working_days int not null default 30,
  lop_days numeric(5,1) not null default 0,  -- loss-of-pay days
  basic numeric(12,2) not null default 0,
  hra numeric(12,2) not null default 0,
  allowances numeric(12,2) not null default 0,
  bonus numeric(12,2) not null default 0,
  pf numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  other_deductions numeric(12,2) not null default 0,
  lop_amount numeric(12,2) not null default 0,
  gross numeric(12,2) generated always as (basic + hra + allowances + bonus) stored,
  total_deductions numeric(12,2) generated always as (pf + tax + other_deductions + lop_amount) stored,
  net_pay numeric(12,2) generated always as (basic + hra + allowances + bonus - pf - tax - other_deductions - lop_amount) stored,
  status text not null default 'draft' check (status in ('draft','published','paid')),
  paid_on date,
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, month)
);

-- ---------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  address text,
  gstin text,
  status text not null default 'active' check (status in ('active','inactive','prospect')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references public.clients(id) on delete set null,
  description text,
  status text not null default 'planning'
    check (status in ('planning','active','on_hold','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  manager_id uuid references public.employees(id) on delete set null,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role text,
  primary key (project_id, employee_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  assignee_id uuid references public.employees(id) on delete set null,
  status text not null default 'todo' check (status in ('todo','in_progress','review','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  due_date date,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tasks (assignee_id);
create index on public.tasks (project_id);

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  category text not null default 'Client payment',
  description text,
  amount numeric(14,2) not null check (amount >= 0),
  payment_mode text,
  reference text,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  category text not null default 'General',
  description text,
  amount numeric(14,2) not null check (amount >= 0),
  payment_mode text,
  reference text,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create or replace function public.is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members
                 where project_id = pid and employee_id = public.current_employee_id())
$$;

-- Assigning a task automatically makes the assignee a project member.
create or replace function public.tasks_add_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assignee_id is not null then
    insert into public.project_members (project_id, employee_id)
    values (new.project_id, new.assignee_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_tasks_add_member after insert or update of assignee_id on public.tasks
  for each row execute function public.tasks_add_member();

-- Non-admins may only change the STATUS of a task assigned to them.
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if public.uid() is null or public.has_role(array['admin']) then return new; end if;
  if old.assignee_id is distinct from public.current_employee_id() then
    raise exception 'Not allowed';
  end if;
  if (new.project_id, new.title, new.description, new.assignee_id, new.priority, new.due_date, new.created_by)
     is distinct from
     (old.project_id, old.title, old.description, old.assignee_id, old.priority, old.due_date, old.created_by) then
    raise exception 'You can only change the status of your tasks';
  end if;
  return new;
end $$;
create trigger trg_tasks_guard before update on public.tasks
  for each row execute function public.tasks_guard();

-- Leave: employees cannot touch review fields; HR/Admin reviews are stamped automatically.
create or replace function public.leaves_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.uid() is null then return new; end if;
  if public.has_role(array['admin','hr']) then
    if new.status is distinct from old.status and old.status = 'pending'
       and new.status in ('approved','rejected') then
      new.reviewed_by := public.current_employee_id();
      new.reviewed_at := now();
    end if;
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.review_note := old.review_note;
  end if;
  return new;
end $$;
create trigger trg_leaves_guard before update on public.leaves
  for each row execute function public.leaves_guard();

create or replace function public.employees_drop_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.user_id is not null then delete from public.users where id = old.user_id; end if;
  return old;
end $$;
create trigger trg_employees_drop_login after delete on public.employees
  for each row execute function public.employees_drop_login();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger trg_employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();
create trigger trg_salary_touch before update on public.salary_structures
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Row-level security
-- Roles: admin (Founder/CEO/COO/CTO/Admin) · hr · accounts · employee
-- ---------------------------------------------------------------------
alter table public.departments       enable row level security;
alter table public.designations      enable row level security;
alter table public.employees         enable row level security;
alter table public.leave_types       enable row level security;
alter table public.leaves            enable row level security;
alter table public.attendance        enable row level security;
alter table public.salary_structures enable row level security;
alter table public.payroll           enable row level security;
alter table public.clients           enable row level security;
alter table public.projects          enable row level security;
alter table public.project_members   enable row level security;
alter table public.tasks             enable row level security;
alter table public.incomes           enable row level security;
alter table public.expenses          enable row level security;

-- Departments / designations / leave types: everyone signed-in reads, Admin writes
-- (HR may manage leave types).
create policy dept_read  on public.departments  for select to app_user using (true);
create policy dept_write on public.departments  for all    to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

create policy desig_read  on public.designations for select to app_user using (true);
create policy desig_write on public.designations for all    to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

create policy ltype_read  on public.leave_types for select to app_user using (true);
create policy ltype_write on public.leave_types for all    to app_user
  using (public.has_role(array['admin','hr'])) with check (public.has_role(array['admin','hr']));

-- Employees
create policy emp_read on public.employees for select to app_user
  using (public.has_role(array['admin','hr','accounts']) or user_id = public.uid());
create policy emp_insert on public.employees for insert to app_user
  with check (public.has_role(array['admin']) or (public.has_role(array['hr']) and role <> 'admin'));
create policy emp_update on public.employees for update to app_user
  using (public.has_role(array['admin']) or (public.has_role(array['hr']) and role <> 'admin'))
  with check (public.has_role(array['admin']) or (public.has_role(array['hr']) and role <> 'admin'));
create policy emp_delete on public.employees for delete to app_user
  using (public.has_role(array['admin']));

-- Leaves
create policy leave_read on public.leaves for select to app_user
  using (employee_id = public.current_employee_id() or public.has_role(array['admin','hr']));
create policy leave_insert_own on public.leaves for insert to app_user
  with check (employee_id = public.current_employee_id() and status = 'pending');
create policy leave_insert_hr on public.leaves for insert to app_user
  with check (public.has_role(array['admin'])
              or (public.has_role(array['hr']) and employee_id <> public.current_employee_id()));
create policy leave_update_own on public.leaves for update to app_user
  using (employee_id = public.current_employee_id() and status = 'pending')
  with check (employee_id = public.current_employee_id() and status in ('pending','cancelled'));
create policy leave_update_admin on public.leaves for update to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy leave_update_hr on public.leaves for update to app_user
  using (public.has_role(array['hr']) and employee_id <> public.current_employee_id())
  with check (public.has_role(array['hr']) and employee_id <> public.current_employee_id());
create policy leave_delete on public.leaves for delete to app_user
  using (public.has_role(array['admin']));

-- Attendance
create policy att_read on public.attendance for select to app_user
  using (employee_id = public.current_employee_id() or public.has_role(array['admin','hr']));
create policy att_insert_own on public.attendance for insert to app_user
  with check (employee_id = public.current_employee_id() and date = public.today_ist());
create policy att_update_own on public.attendance for update to app_user
  using (employee_id = public.current_employee_id() and date = public.today_ist())
  with check (employee_id = public.current_employee_id() and date = public.today_ist());
create policy att_manage on public.attendance for all to app_user
  using (public.has_role(array['admin','hr'])) with check (public.has_role(array['admin','hr']));

-- Salary structures & payroll: Admin, HR and Accounts manage; employees see only
-- their own PUBLISHED payslips.
create policy sal_manage on public.salary_structures for all to app_user
  using (public.has_role(array['admin','hr','accounts']))
  with check (public.has_role(array['admin','hr','accounts']));

create policy pay_read_staff on public.payroll for select to app_user
  using (public.has_role(array['admin','hr','accounts']));
create policy pay_read_own on public.payroll for select to app_user
  using (employee_id = public.current_employee_id() and status in ('published','paid'));
create policy pay_manage on public.payroll for all to app_user
  using (public.has_role(array['admin','hr','accounts']))
  with check (public.has_role(array['admin','hr','accounts']));

-- Clients: Admin manages, HR views
create policy client_read on public.clients for select to app_user
  using (public.has_role(array['admin','hr']));
create policy client_write on public.clients for all to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

-- Projects, members, tasks
create policy proj_read on public.projects for select to app_user
  using (public.has_role(array['admin','hr']) or public.is_project_member(id));
create policy proj_write on public.projects for all to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

create policy pm_read on public.project_members for select to app_user
  using (public.has_role(array['admin','hr']) or public.is_project_member(project_id));
create policy pm_write on public.project_members for all to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

create policy task_read on public.tasks for select to app_user
  using (public.has_role(array['admin','hr']) or assignee_id = public.current_employee_id());
create policy task_admin on public.tasks for all to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy task_update_own on public.tasks for update to app_user
  using (assignee_id = public.current_employee_id())
  with check (assignee_id = public.current_employee_id());

-- Income: Admin only (Admin / CEO / COO / CTO).  Expenses: Admin + HR.
create policy inc_all on public.incomes for all to app_user
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));
create policy exp_all on public.expenses for all to app_user
  using (public.has_role(array['admin','hr'])) with check (public.has_role(array['admin','hr']));

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------
insert into public.departments (name, description) values
  ('Software Development', 'Product and client software engineering, DevOps and QA'),
  ('Digital Marketing',    'Content, SEO, design, video and social media'),
  ('Business Development', 'Sales, marketing outreach and data analysis'),
  ('Accounts & HR',        'Accounts, payroll, hiring and people operations'),
  ('Admin',                'Founder, CEO, COO, CTO and administration')
on conflict (name) do nothing;

insert into public.designations (department_id, name, default_role, sort_order)
select d.id, v.name, v.role, v.ord
from (values
  ('Software Development','Software Intern','employee',1),
  ('Software Development','Junior Software Developer','employee',2),
  ('Software Development','Software Developer','employee',3),
  ('Software Development','Senior Software Developer','employee',4),
  ('Software Development','DevOps Engineer','employee',5),
  ('Software Development','Tester Intern','employee',6),
  ('Software Development','Jr. Tester','employee',7),
  ('Software Development','Tester','employee',8),
  ('Software Development','Sr. Tester','employee',9),
  ('Software Development','UI/UX Designer','employee',10),
  ('Software Development','Project Manager','employee',11),
  ('Software Development','Team Lead','employee',12),
  ('Digital Marketing','Content Creator','employee',1),
  ('Digital Marketing','SEO Analyst','employee',2),
  ('Digital Marketing','Graphic Designer','employee',3),
  ('Digital Marketing','Video Editor','employee',4),
  ('Digital Marketing','Social Media Manager','employee',5),
  ('Digital Marketing','Team Lead','employee',6),
  ('Business Development','Jr. Marketing Executive','employee',1),
  ('Business Development','Marketing Executive','employee',2),
  ('Business Development','Data Analyst','employee',3),
  ('Business Development','Sales Executive','employee',4),
  ('Business Development','Business Development Manager','employee',5),
  ('Business Development','Team Lead','employee',6),
  ('Accounts & HR','Accounts Executive','accounts',1),
  ('Accounts & HR','Accounts Manager','accounts',2),
  ('Accounts & HR','HR Executive','hr',3),
  ('Accounts & HR','HR Manager','hr',4),
  ('Accounts & HR','HR People Manager','hr',5),
  ('Admin','Founder','admin',1),
  ('Admin','CEO','admin',2),
  ('Admin','COO','admin',3),
  ('Admin','CTO','admin',4),
  ('Admin','Admin','admin',5)
) as v(dept, name, role, ord)
join public.departments d on d.name = v.dept
on conflict (department_id, name) do nothing;

insert into public.leave_types (name, days_per_year, is_paid) values
  ('Casual Leave', 12, true),
  ('Sick Leave',    6, true),
  ('Comp Off',      0, true),
  ('Unpaid Leave',  0, false)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Privileges for the restricted role (RLS then narrows these per row)
-- ---------------------------------------------------------------------
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage, select on all sequences in schema public to app_user;
revoke all on public.users from app_user;
