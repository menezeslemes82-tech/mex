// api/cron.js — chamado a cada minuto por um cron externo: lembretes + resumo diário (7h30)
const { getDb } = require('../lib/fb');
const { getConfig } = require('../lib/config');
const { sendToUser } = require('../lib/push');

const SUMMARY_MINUTES = 7 * 60 + 30; // 07:30 (horário de Brasília)
const pad = n => String(n).padStart(2, '0');
const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

module.exports = async (req, res) => {
  try {
    const db = getDb();
    const cfg = await getConfig(db);
    if ((req.query.t || '') !== cfg.cronToken) return res.status(401).json({ error: 'token inválido' });
    if (!cfg.ownerUid) return res.status(200).json({ ok: false, msg: 'Abra Ajustes no app uma vez.' });
    const uid = cfg.ownerUid;

    const now = new Date(Date.now() - 3 * 3600 * 1000); // Brasília (UTC-3)
    const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
    const nowStr = `${today}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
    const base = db.collection('users').doc(uid);
    let sent = 0;

    // 1) lembretes de compromissos
    const evs = await base.collection('events').where('done', '==', false).get();
    for (const d of evs.docs) {
      const e = d.data();
      if (e.pushed || !e.when || e.when > nowStr) continue;
      await sendToUser(db, cfg, uid, { title: '⏰ ' + e.title, body: e.notes || 'Lembrete do Mex', tag: 'ev-' + d.id });
      await d.ref.update({ pushed: true, notified: true });
      sent++;
    }

    // 2) resumo diário
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (minutes >= SUMMARY_MINUTES && cfg.dailyLast !== today) {
      const evAll = evs.docs.map(d => d.data()).filter(e => e.when);
      const hoje = evAll.filter(e => e.when.startsWith(today)).sort((a, b) => a.when.localeCompare(b.when));
      const atras = evAll.filter(e => e.when < today).length;
      const tks = await base.collection('tasks').where('done', '==', false).get();
      const tarefas = tks.docs.map(d => d.data()).filter(t => t.due && t.due.slice(0, 10) <= today);
      const monthStart = today.slice(0, 7) + '-01';
      const txs = await base.collection('transactions').where('date', '>=', monthStart).get();
      let mes = 0;
      txs.docs.forEach(d => { const t = d.data(); if (t.kind === 'expense') mes += t.amount; });

      const partes = [];
      if (hoje.length) partes.push('Hoje: ' + hoje.slice(0, 3).map(e => e.when.slice(11) + ' ' + e.title).join(', ') + (hoje.length > 3 ? ' +' + (hoje.length - 3) : ''));
      else partes.push('Nenhum compromisso hoje.');
      if (atras) partes.push(atras + ' atrasado(s).');
      if (tarefas.length) partes.push(tarefas.length + ' tarefa(s) para hoje ou atrasadas.');
      partes.push('Gastos do mês: ' + brl(mes) + '.');
      await sendToUser(db, cfg, uid, { title: 'Bom dia ☀️ Resumo do dia', body: partes.join(' '), tag: 'resumo' });
      await db.collection('config').doc('server').set({ dailyLast: today }, { merge: true });
      sent++;
    }
    return res.status(200).json({ ok: true, sent, now: nowStr });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
