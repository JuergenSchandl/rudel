-- Rudel: Erinnerungsdienst alle 15 Minuten aufrufen
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'rudel-erinnerungen';
select cron.schedule('rudel-erinnerungen', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://hbohrdbqptfzhzqybbpc.supabase.co/functions/v1/erinnerungen',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
$$);
