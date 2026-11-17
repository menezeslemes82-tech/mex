// api/push.js — chave pública, endereços de ajustes e teste de notificação
const { getDb } = require('../lib/fb');
const { getConfig } = require('../lib/config');
const { verify } = require('../lib/auth');
const { sendToUser } = require('../lib/push');

module.exports = async (req, res) => {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = (req.query && req.query.action) || body.action;
    const db = getDb();
    const cfg = await getConfig(db);

    if (action === 'key') return res.status(200).json({ key: cfg.vapidPublic });

    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const u = await verify(token);
    if (u.error) return res.status(401).json({ error: u.error });

    if (cfg.ownerUid !== u.uid) {
      await db.collection('config').doc('server').set({ ownerUid: u.uid, ownerEmail: u.email }, { merge: true });
      cfg.ownerUid = u.uid; cfg.ownerEmail = u.email;
    }

    if (action === 'info') {
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      return res.status(200).json({
        icsUrl: `https://${host}/api/agenda?t=${cfg.icsToken}`,
        webcalUrl: `webcal://${host}/api/agenda?t=${cfg.icsToken}`,
        cronUrl: `https://${host}/api/cron?t=${cfg.cronToken}`
      });
    }
    if (action === 'test') {
      const sent = await sendToUser(db, cfg, u.uid, { title: 'Mex', body: 'Notificação de teste funcionando ✅', tag: 'teste' });
      return res.status(200).json({ sent });
    }
    return res.status(400).json({ error: 'Ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
