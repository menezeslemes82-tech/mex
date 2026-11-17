// api/gcal.js — lê o Google Agenda pelo endereço secreto iCal (somente leitura)
const ical = require('node-ical');
const { getDb } = require('../lib/fb');
const { verify } = require('../lib/auth');

const TZ = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const local = d => fmt.format(d).replace(' ', 'T');                       // "2026-11-17T18:30"
const dayOnly = d => d.toISOString().slice(0, 10);                       // eventos de dia inteiro vêm em UTC

function listEvents(data, from, to) {
  const out = [];
  for (const k of Object.keys(data)) {
    const ev = data[k];
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    if (ev.status === 'CANCELLED') continue;
    const allDay = ev.datetype === 'date';
    const push = (start, end, id) => {
      if (end < from || start > to) return;
      out.push({ id, title: String(ev.summary && ev.summary.val || ev.summary || '(sem título)'), allDay,
        when: allDay ? dayOnly(start) + 'T00:00' : local(start), end: allDay ? '' : (end ? local(end) : ''),
        place: String(ev.location && ev.location.val || ev.location || '') });
    };
    try {
      if (ev.rrule) {
        const items = ical.expandRecurringEvent(ev, { from, to, includeOverrides: true, excludeExdates: true });
        items.forEach((x, i) => push(x.start, x.end, k + '-' + i));
      } else push(ev.start, ev.end || ev.start, k);
    } catch (e) { push(ev.start, ev.end || ev.start, k); }
  }
  return out.sort((a, b) => a.when.localeCompare(b.when));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const u = await verify(token);
    if (u.error) return res.status(401).json({ error: u.error });
    const db = getDb();
    const ref = db.collection('users').doc(u.uid).collection('settings').doc('gcal');
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (typeof body.url === 'string') {                                   // salvar ou remover o endereço
      const url = body.url.trim().replace(/^webcal:/i, 'https:');
      if (!url) { await ref.delete(); return res.status(200).json({ ok: true, removed: true, events: [] }); }
      if (!/^https:\/\/calendar\.google\.com\/calendar\/ical\//i.test(url))
        return res.status(400).json({ error: 'Esse não parece o endereço secreto em formato iCal do Google (começa com https://calendar.google.com/calendar/ical/...).' });
      await ref.set({ url, savedAt: Date.now() });
    }
    const snap = await ref.get();
    if (!snap.exists) return res.status(200).json({ ok: true, connected: false, events: [] });

    const r = await fetch(snap.data().url, { headers: { 'User-Agent': 'Mex/1.0' } });
    if (!r.ok) return res.status(502).json({ error: 'O Google recusou o endereço (' + r.status + '). Gere o endereço secreto de novo.' });
    const data = ical.sync.parseICS(await r.text());
    const from = new Date(Date.now() - 24 * 3600 * 1000), to = new Date(Date.now() + 60 * 24 * 3600 * 1000);
    return res.status(200).json({ ok: true, connected: true, events: listEvents(data, from, to).slice(0, 300) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
module.exports.listEvents = listEvents;
