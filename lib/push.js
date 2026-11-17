const webpush = require('web-push');

async function sendToUser(db, cfg, uid, payload) {
  webpush.setVapidDetails('mailto:' + (cfg.ownerEmail || 'admin@example.com'), cfg.vapidPublic, cfg.vapidPrivate);
  const snap = await db.collection('users').doc(uid).collection('push').get();
  let n = 0;
  for (const d of snap.docs) {
    const sub = d.data().sub;
    if (!sub) continue;
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await d.ref.delete();
      else console.error('push falhou', e.statusCode, e.body);
    }
  }
  return n;
}
module.exports = { sendToUser };
