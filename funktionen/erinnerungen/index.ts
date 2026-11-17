// Rudel: Erinnerungen aufs Handy
// Läuft alle 15 Minuten (Zeitplan in der Datenbank) und schickt fällige Aufgaben-Erinnerungen
// an die Handys der zuständigen Personen. Jede Erinnerung geht nur einmal raus.
// Die Schlüssel für die Mitteilungen erzeugt der Dienst beim ersten Lauf selbst
// und legt sie in einer Tabelle ab, die nur er lesen kann.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const APP = "https://juergenschandl.github.io/rudel/";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---- reminder rules (pure, also used by the tests) ----
export function viennaNow(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dm(iso) {
  const [, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.`;
}
export function dueReminders(rows, today) {
  const out = [];
  for (const row of rows || []) {
    const t = row.data || {};
    if (t.done || !t.due || !Array.isArray(t.who) || !t.who.length) continue;
    const at = t.time ? ` um ${t.time} Uhr` : "";
    for (const r of Array.isArray(t.remind) ? t.remind : []) {
      if (addDays(t.due, -r) !== today) continue;
      const body = r === 0 ? `Heute fällig${at}.` : r === 1 ? `Morgen fällig${at}.` : `Fällig in ${r} Tagen, am ${dm(t.due)}`;
      out.push({ key: `${row.id}|${t.due}|${r}`, task: row.id, who: t.who, title: t.title, body });
    }
    if (addDays(t.due, 1) === today) {
      out.push({ key: `${row.id}|${t.due}|late`, task: row.id, who: t.who, title: t.title, body: "Seit gestern überfällig. Noch nicht abgehakt." });
    }
  }
  return out;
}

// ---- service ----
async function vapidKeys(sb) {
  const { data } = await sb.from("push_keys").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("push_keys").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: "id", ignoreDuplicates: true });
  const again = await sb.from("push_keys").select("public_key, private_key").eq("id", 1).single();
  return again.data;
}
async function sendTo(sb, people, msg) {
  const { data: subs } = await sb.from("push_subs").select("endpoint, sub").in("person", people);
  let sent = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify(msg), { TTL: 86400 });
      sent++;
    } catch (e) {
      // the phone gave up this subscription (app removed, permission withdrawn)
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await sb.from("push_subs").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", e && e.statusCode, e && e.body);
    }
  }
  return sent;
}

if (typeof Deno !== "undefined") Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const keys = await vapidKeys(sb);
  const url = new URL(req.url);
  if (url.searchParams.has("key")) return json({ publicKey: keys.public_key });
  webpush.setVapidDetails(APP, keys.public_key, keys.private_key);

  if (url.searchParams.has("test")) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ error: "Nicht angemeldet" }, 401);
    const { data: m } = await sb.from("members").select("person").eq("user_id", u.user.id).maybeSingle();
    if (!m) return json({ error: "Keiner Person zugeordnet" }, 403);
    const sent = await sendTo(sb, [m.person], {
      title: "Rudel", body: "Mitteilungen sind eingeschaltet. So kommen eure Erinnerungen an.", url: APP + "#aufgaben", tag: "rudel-test",
    });
    return json({ sent });
  }

  const { day, hour } = viennaNow();
  if (hour < 8) return json({ day, hour, skipped: "vor 8 Uhr" });
  const { data: rows, error } = await sb.from("items").select("id, data").eq("kind", "task");
  if (error) return json({ error: error.message }, 500);
  const due = dueReminders(rows, day);
  let sent = 0;
  for (const d of due) {
    const { error: dup } = await sb.from("push_log").insert({ key: d.key });
    if (dup) continue; // already sent earlier today
    sent += await sendTo(sb, d.who, { title: d.title, body: d.body, url: APP + "#aufgaben", tag: d.task });
  }
  return json({ day, hour, tasks: (rows || []).length, reminders: due.length, sent });
});
