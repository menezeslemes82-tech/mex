// Confere o login do Firebase e se o e-mail é permitido
const ALLOWED = (process.env.ALLOWED_EMAILS || 'agrosafra7@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const FB_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAdVNgwnZN0difI8IBsIgUo0OHWZHHse_c';

async function verify(idToken) {
  if (!idToken) return { error: 'Login não enviado ao servidor.' };
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FB_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  if (!r.ok) return { error: 'Firebase recusou (' + r.status + ')' };
  const d = await r.json();
  const u = d.users && d.users[0];
  if (!u) return { error: 'Usuário não encontrado no token.' };
  const email = (u.email || '').toLowerCase();
  if (!ALLOWED.includes(email)) return { error: 'E-mail não permitido: ' + email };
  return { uid: u.localId, email };
}
module.exports = { verify };
