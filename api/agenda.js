// api/agenda.js — calendário assinável (.ics) com compromissos e tarefas
const { getDb } = require('../lib/fb');
const { getConfig } = require('../lib/config');

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

module.exports = async (req, res) => {
  try {
    const db = getDb();
    const cfg = await getConfig(db);
    if ((req.query.t || '') !== cfg.icsToken || !cfg.ownerUid) return res.status(401).send('token inválido');
    const base = db.collection('users').doc(cfg.ownerUid);
    const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mex//PT', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mex',
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    const nowS = stamp(new Date());

    const evs = await base.collection('events').where('done', '==', false).get();
    evs.docs.forEach(d => {
      const e = d.data();
      const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(e.when || '');
      if (!m) return;
      const start = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5])); // Brasília -> UTC
      const end = new Date(start.getTime() + 30 * 60000);
      out.push('BEGIN:VEVENT', `UID:ev-${d.id}@mex`, `DTSTAMP:${nowS}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
        `SUMMARY:${esc(e.title)}`, e.notes ? `DESCRIPTION:${esc(e.notes)}` : '',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Lembrete', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
    });

    const tks = await base.collection('tasks').where('done', '==', false).get();
    tks.docs.forEach(d => {
      const t = d.data();
      if (!t.due) return;
      const dt = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(t.due);
      const dd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t.due);
      out.push('BEGIN:VEVENT', `UID:tk-${d.id}@mex`, `DTSTAMP:${nowS}`);
      if (dt) {
        const s = new Date(Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4] + 3, +dt[5]));
        out.push(`DTSTART:${stamp(s)}`, `DTEND:${stamp(new Date(s.getTime() + 30 * 60000))}`);
      } else if (dd) {
        const s = new Date(Date.UTC(+dd[1], +dd[2] - 1, +dd[3]));
        const n = new Date(s.getTime() + 86400000);
        const f = x => x.toISOString().slice(0, 10).replace(/-/g, '');
        out.push(`DTSTART;VALUE=DATE:${f(s)}`, `DTEND;VALUE=DATE:${f(n)}`);
      } else { out.length -= 3; return; }
      out.push(`SUMMARY:${esc('Tarefa: ' + t.title)}`, 'END:VEVENT');
    });

    out.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(200).send(out.filter(Boolean).join('\r\n'));
  } catch (e) {
    console.error(e);
    return res.status(500).send('erro: ' + (e.message || e));
  }
};
