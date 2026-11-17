-- Rudel: Mitteilungen bei Änderungen der anderen (pro Handy abschaltbar)
alter table public.push_subs add column if not exists changes boolean not null default true;
