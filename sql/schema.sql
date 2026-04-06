create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key,
  email text unique not null,
  role text check (role in ('company', 'freelancer', 'admin')) not null,
  suspended boolean default false,
  created_at timestamptz default now()
);

create table if not exists freelancer_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  full_name text not null,
  bio text,
  skills text[],
  hourly_rate numeric(10, 2),
  portfolio_url text,
  avatar_url text,
  avg_rating numeric(3, 2) default 0,
  total_reviews int default 0,
  created_at timestamptz default now(),
  unique (user_id)
);

create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  company_name text not null,
  industry text,
  website text,
  logo_url text,
  description text,
  avg_rating numeric(3, 2) default 0,
  created_at timestamptz default now(),
  unique (user_id)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references company_profiles(id) on delete cascade,
  title text not null,
  description text not null,
  budget_min numeric(12, 2),
  budget_max numeric(12, 2),
  skills_required text[],
  deadline date,
  status text check (status in ('open', 'in_progress', 'completed', 'disputed', 'cancelled')) default 'open',
  awarded_to uuid references freelancer_profiles(id),
  created_at timestamptz default now()
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  freelancer_id uuid references freelancer_profiles(id) on delete cascade,
  bid_amount numeric(12, 2) not null,
  cover_letter text,
  estimated_days int,
  status text check (status in ('pending', 'accepted', 'rejected', 'withdrawn')) default 'pending',
  created_at timestamptz default now(),
  unique (project_id, freelancer_id)
);

create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  description text,
  amount numeric(12, 2),
  due_date date,
  status text check (status in ('pending', 'in_progress', 'submitted', 'approved', 'rejected')) default 'pending',
  deliverable_url text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  reviewer_id uuid references users(id),
  reviewee_id uuid references users(id),
  rating int check (rating between 1 and 5) not null,
  comment text,
  reviewer_role text check (reviewer_role in ('company', 'freelancer')) not null,
  created_at timestamptz default now(),
  unique (project_id, reviewer_id)
);

create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  raised_by uuid references users(id),
  reason text not null,
  status text check (status in ('open', 'under_review', 'resolved', 'closed')) default 'open',
  resolution text,
  resolved_by uuid references users(id),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table users enable row level security;
alter table freelancer_profiles enable row level security;
alter table company_profiles enable row level security;
alter table projects enable row level security;
alter table bids enable row level security;
alter table milestones enable row level security;
alter table reviews enable row level security;
alter table disputes enable row level security;

drop policy if exists "Freelancer owns profile" on freelancer_profiles;
create policy "Freelancer owns profile" on freelancer_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Company owns profile" on company_profiles;
create policy "Company owns profile" on company_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Public can view open projects" on projects;
create policy "Public can view open projects" on projects
  for select using (status = 'open');

drop policy if exists "Companies post projects" on projects;
create policy "Companies post projects" on projects
  for insert with check (
    exists (select 1 from company_profiles where user_id = auth.uid())
  );

create or replace function public.promote_user_to_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid;
begin
  select id
  into v_user_id
  from auth.users
  where email = p_email
  limit 1;

  if v_user_id is null then
    raise exception 'No auth user found for email: %', p_email;
  end if;

  insert into public.users (id, email, role, suspended)
  values (v_user_id, p_email, 'admin', false)
  on conflict (id) do update
    set email = excluded.email,
        role = 'admin',
        suspended = false;

  return v_user_id;
end;
$$;

-- Demo seed values for local testing and UI preview.
-- These rows do not create Supabase Auth credentials.
-- They are for sample marketplace data only.
insert into users (id, email, role, suspended)
values
  ('11111111-1111-1111-1111-111111111111', 'demo-company@freelaunch.dev', 'company', false),
  ('22222222-2222-2222-2222-222222222222', 'demo-freelancer@freelaunch.dev', 'freelancer', false)
on conflict (id) do nothing;

insert into company_profiles (id, user_id, company_name, industry, website, description)
values
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Acme Labs', 'SaaS', 'https://acme.example', 'Building workflow products for modern teams.')
on conflict (id) do nothing;

insert into freelancer_profiles (id, user_id, full_name, bio, skills, hourly_rate, portfolio_url)
values
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', 'Nila Dev', 'Full-stack freelancer focused on product MVPs.', array['Node.js', 'PostgreSQL', 'JavaScript'], 40.00, 'https://portfolio.example')
on conflict (id) do nothing;

insert into projects (id, company_id, title, description, budget_min, budget_max, skills_required, deadline, status)
values
  ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', 'Build Team Collaboration Dashboard', 'Need a responsive dashboard with auth and reporting.', 1200.00, 2500.00, array['JavaScript', 'Node.js', 'UI/UX'], current_date + 20, 'open'),
  ('66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333', 'API Refactor and Performance Tune', 'Refactor APIs and optimize slow endpoints.', 900.00, 1800.00, array['Node.js', 'PostgreSQL'], current_date + 10, 'in_progress')
on conflict (id) do nothing;

insert into bids (id, project_id, freelancer_id, bid_amount, cover_letter, estimated_days, status)
values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444', 1450.00, 'I can deliver this in iterative milestones with weekly demos.', 14, 'pending'),
  ('88888888-8888-8888-8888-888888888888', '66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444', 1200.00, 'I have similar optimization project experience.', 9, 'accepted')
on conflict (id) do nothing;

update projects
set awarded_to = '44444444-4444-4444-4444-444444444444'
where id = '66666666-6666-6666-6666-666666666666';

insert into milestones (id, project_id, title, description, amount, due_date, status)
values
  ('99999999-9999-9999-9999-999999999999', '66666666-6666-6666-6666-666666666666', 'Audit and Bottleneck Report', 'Identify bottlenecks and deliver an optimization plan.', 300.00, current_date + 3, 'in_progress')
on conflict (id) do nothing;

insert into disputes (id, project_id, raised_by, reason, status)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '66666666-6666-6666-6666-666666666666', '22222222-2222-2222-2222-222222222222', 'Need scope clarification before milestone approval.', 'open')
on conflict (id) do nothing;
