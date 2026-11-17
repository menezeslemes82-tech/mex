// Chaves geradas automaticamente na primeira vez (guardadas no Firestore, fora do alcance do app)
const crypto = require('crypto');
const webpush = require('web-push');

async function getConfig(db) {
  const ref = db.collection('config').doc('server');
  const snap = await ref.get();
  const c = snap.exists ? snap.data() : {};
  let changed = false;
  if (!c.vapidPublic || !c.vapidPrivate) {
    const k = webpush.generateVAPIDKeys();
    c.vapidPublic = k.publicKey; c.vapidPrivate = k.privateKey; changed = true;
  }
  if (!c.icsToken) { c.icsToken = crypto.randomBytes(16).toString('hex'); changed = true; }
  if (!c.cronToken) { c.cronToken = crypto.randomBytes(16).toString('hex'); changed = true; }
  if (changed) await ref.set(c, { merge: true });
  return c;
}
module.exports = { getConfig };
