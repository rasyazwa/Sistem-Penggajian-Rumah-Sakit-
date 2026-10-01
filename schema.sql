create extension if not exists pgcrypto;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  department_id uuid not null references public.departments(id) on delete restrict,
  position text not null,
  base_salary numeric(14, 2) not null check (base_salary >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  attendance_date date not null,
  status text not null check (status in ('present', 'sick', 'leave', 'absent')),
  created_at timestamptz not null default now(),
  unique (employee_id, attendance_date)
);

create table if not exists public.payrolls (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  base_salary numeric(14, 2) not null check (base_salary >= 0),
  allowance numeric(14, 2) not null default 0 check (allowance >= 0),
  deductions numeric(14, 2) not null default 0 check (deductions >= 0),
  net_salary numeric(14, 2) generated always as (base_salary + allowance - deductions) stored,
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (deductions <= base_salary + allowance),
  unique (employee_id, period_start, period_end)
);

create index if not exists employees_department_id_idx on public.employees(department_id);
create index if not exists attendance_records_date_idx on public.attendance_records(attendance_date desc);
create index if not exists payrolls_period_idx on public.payrolls(period_start desc, period_end desc);

alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.payrolls enable row level security;

grant select on public.departments to anon, authenticated;
drop policy if exists departments_read on public.departments;
create policy departments_read
  on public.departments
  for select
  to anon, authenticated
  using (true);

insert into public.departments (name) values
  ('Keperawatan'), ('Medis'), ('Farmasi'), ('Administrasi'), ('Laboratorium')
on conflict (name) do nothing;