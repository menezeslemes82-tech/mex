// Acesso administrativo ao Firestore (só no servidor)
const admin = require('firebase-admin');

function getDb() {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('Variável FIREBASE_SERVICE_ACCOUNT não existe na Vercel.');
    let sa;
    try { sa = JSON.parse(raw); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT não é um JSON válido (cole o arquivo inteiro).'); }
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
  }
  return admin.firestore();
}
module.exports = { getDb, admin };
