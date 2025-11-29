create extension if not exists pgcrypto;

create table if not exists public.rule_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  months jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.rule_templates enable row level security;
