// DJNP: Erinnerungen aufs Handy
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

// ---- messages about changes (pure, also used by the tests) ----
const NAMES = { d: "Dagmar", j: "Jürgen", n: "Nina", p: "Philip" };
const ALL = ["d", "j", "n", "p"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
function when(date, time) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd} ${d}.${m}.` + (time ? `, ${time}` : "");
}
export function canSee(row, person) {
  if (!row) return false;
  if (row.owner === person) return true;
  return !row.private && (!row.visible_to || row.visible_to.includes(person));
}
function audience(row) {
  if (row.private) return [];
  return row.visible_to && row.visible_to.length ? row.visible_to : ALL;
}
// changes: [{action, row:{kind,data,private,visible_to,owner}}]  ->  {person: [lines]}
export function changeLines(author, changes) {
  const per = {};
  const add = (who, line) => { for (const p of who) if (p !== author) (per[p] = per[p] || []).push(line); };
  const shop = {};
  for (const c of changes) {
    const r = c.row, d = r.data || {}, who = audience(r), a = c.action;
    if (r.kind === "shop") { if (a === "neu") for (const p of who) if (p !== author) (shop[p] = shop[p] || []).push(d.text); continue; }
    if (r.kind === "appt") {
      const t = `${d.title}, ${when(d.date, d.time)}`;
      add(who, a === "neu" ? `Neuer Termin: ${t}` : a === "gelöscht" ? `Termin gelöscht: ${t}` : `Termin geändert: ${t}`);
    } else if (r.kind === "meal") {
      const t = `${d.dish}, ${when(d.date, d.time)}`;
      if (a === "antwort") {
        const ans = (d.inv || {})[author];
        if (d.by && d.by !== author) add([d.by], `${ans === "ja" ? "Kommt" : ans === "nein" ? "Kann nicht" : "Antwort"} zum Essen: ${t}`);
        continue;
      }
      const invited = Object.keys(d.inv || {});
      if (a === "neu") {
        add(who.filter((p) => !invited.includes(p)), `Essen geplant: ${t}`);
        add(invited, `Einladung zum Essen: ${t}`);
      } else add(who, a === "foto" ? `Neues Foto vom Essen: ${d.dish}` : a === "gelöscht" ? `Essen abgesagt: ${t}` : `Essen geändert: ${t}`);
    } else if (r.kind === "task") {
      const due = d.due ? `, fällig ${when(d.due)}` : "";
      add(who, a === "neu" ? `Neue Aufgabe: ${d.title}${due}` : a === "erledigt" ? `Erledigt: ${d.title}` : a === "gelöscht" ? `Aufgabe gelöscht: ${d.title}` : `Aufgabe geändert: ${d.title}${due}`);
    } else if (r.kind === "away") {
      const names = (d.who || []).map((p) => NAMES[p]).filter(Boolean).join(" und ");
      const t = `${names}: ${d.place || d.label}, ${when(d.from)} bis ${when(d.to)}`;
      add(who, a === "neu" ? `Unterwegs: ${t}` : a === "gelöscht" ? `Abwesenheit gelöscht: ${t}` : `Abwesenheit geändert: ${t}`);
    } else if (r.kind === "doc") {
      const t = d.kind + (d.title ? `: ${d.title}` : "");
      add(who, a === "neu" ? `Neues Dokument: ${t}` : a === "foto" ? `Neue Datei bei: ${t}` : a === "gelöscht" ? `Dokument gelöscht: ${t}` : `Dokument geändert: ${t}`);
    } else if (r.kind === "wish" && a === "neu") {
      add(who, `Essenswunsch: ${d.text}`);
    }
  }
  for (const p of Object.keys(shop)) (per[p] = per[p] || []).unshift(`Einkauf: ${shop[p].join(", ")}`);
  return per;
}
export function messageFor(author, lines) {
  const shown = lines.slice(0, 4), more = lines.length - shown.length;
  return { title: `DJNP · ${NAMES[author] || ""}`, body: shown.join("\n") + (more > 0 ? `\nund ${more} weitere Änderung${more === 1 ? "" : "en"}` : "") };
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
async function sendTo(sb, people, msg, onlyChanges = false) {
  let q = sb.from("push_subs").select("endpoint, sub").in("person", people);
  if (onlyChanges) q = q.eq("changes", true);
  const { data: subs } = await q;
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
      title: "DJNP", body: "Mitteilungen sind eingeschaltet. So kommen eure Erinnerungen an.", url: APP + "#aufgaben", tag: "rudel-test",
    });
    return json({ sent });
  }

  if (url.searchParams.has("changes")) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u || !u.user) return json({ error: "Nicht angemeldet" }, 401);
    const { data: m } = await sb.from("members").select("person").eq("user_id", u.user.id).maybeSingle();
    if (!m) return json({ error: "Keiner Person zugeordnet" }, 403);
    const author = m.person;
    let body = {};
    try { body = await req.json(); } catch (_) { body = {}; }
    const list = (Array.isArray(body.changes) ? body.changes : []).slice(0, 50);
    const ids = list.filter((c) => c.action !== "gelöscht").map((c) => String(c.id));
    const { data: rows } = ids.length ? await sb.from("items").select("id, kind, data, owner, private, visible_to").in("id", ids) : { data: [] };
    const byId = Object.fromEntries((rows || []).map((r) => [r.id, r]));
    const changes = [];
    for (const c of list) {
      if (c.action === "gelöscht") {
        // the entry is gone; the app sends what it last knew about it
        if (c.kind && c.data) changes.push({ action: c.action, row: { kind: c.kind, data: c.data, private: false, visible_to: Array.isArray(c.visible_to) ? c.visible_to : null } });
      } else if (canSee(byId[c.id], author)) changes.push({ action: c.action, row: byId[c.id] });
    }
    const per = changeLines(author, changes);
    let sent = 0;
    for (const p of Object.keys(per)) {
      const msg = messageFor(author, per[p]);
      sent += await sendTo(sb, [p], { ...msg, url: APP, tag: "rudel-aenderung-" + author }, true);
    }
    return json({ people: Object.keys(per).length, sent });
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
