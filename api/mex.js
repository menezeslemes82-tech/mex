// api/mex.js — cérebro do Mex (Vercel serverless, Node 18+)
// Variáveis de ambiente: ANTHROPIC_API_KEY, OPENAI_API_KEY, FIREBASE_API_KEY, ALLOWED_EMAILS (opcional)

const ALLOWED = (process.env.ALLOWED_EMAILS || 'agrosafra7@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function verifyToken(idToken) {
  if (!process.env.FIREBASE_API_KEY) return { error: 'Variável FIREBASE_API_KEY não existe na Vercel (ou falta redeploy).' };
  if (!idToken) return { error: 'Login não enviado ao servidor.' };
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + process.env.FIREBASE_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
  );
  if (!r.ok) {
    const t = (await r.text()).slice(0, 200);
    return { error: 'Firebase recusou (' + r.status + '): ' + t };
  }
  const d = await r.json();
  const u = d.users && d.users[0];
  return u ? { uid: u.localId, email: (u.email || '').toLowerCase() } : { error: 'Usuário não encontrado no token.' };
}

async function transcribe(audioB64, mime) {
  const buf = Buffer.from(audioB64, 'base64');
  const m = (mime || '').toLowerCase();
  const ext = m.includes('mp4') || m.includes('m4a') ? 'm4a' : m.includes('webm') ? 'webm' : m.includes('ogg') ? 'ogg' : 'wav';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/mp4' }), 'audio.' + ext);
  form.append('model', 'whisper-1');
  form.append('language', 'pt');
  form.append('prompt', 'Mex, agenda, compromisso, lembrete, gastei, recebi, reais, reunião.');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: form
  });
  if (!r.ok) throw new Error('Whisper: ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return (d.text || '').trim();
}

const SYSTEM = `Você é o Mex, assistente pessoal por voz e texto de uso exclusivo do seu dono. Fala português do Brasil, de forma curta, natural e direta, como alguém que será ouvido em voz alta: sem markdown, sem listas longas, sem emojis.

Você gerencia AGENDA (compromissos e lembretes) e FINANCEIRO (receitas e despesas em reais). Você recebe um CONTEXTO em JSON com a data/hora atual, compromissos pendentes (com id), últimas transações (com id) e resumo dos últimos meses.

Responda SEMPRE e SOMENTE com um JSON válido neste formato:
{"reply":"texto curto que será mostrado e falado","actions":[ ... ]}

Ações possíveis (use só quando o usuário pedir ou informar algo para registrar):
- {"type":"add_event","title":"...","when":"YYYY-MM-DDTHH:mm","notes":"..."}  (horário local; "when" é o momento em que o lembrete deve tocar)
- {"type":"complete_event","id":"<id do contexto>"}
- {"type":"delete_event","id":"<id do contexto>"}
- {"type":"add_transaction","kind":"expense"|"income","amount":123.45,"category":"...","description":"...","date":"YYYY-MM-DD"}
- {"type":"delete_transaction","id":"<id do contexto>"}

Regras:
- Resolva datas relativas ("amanhã", "sexta", "daqui a 2 horas") usando "agora" do contexto. Se não houver hora, use 09:00 e diga isso na resposta.
- Categorias de despesa: Alimentação, Transporte, Combustível, Moradia, Saúde, Lazer, Trabalho, Educação, Contas, Outros. Receita: Salário, Vendas, Serviços, Outros.
- Se não disser a data de um gasto, use hoje. Valor sempre número positivo em reais.
- Para perguntas (saldo, quanto gastei, o que tenho hoje/amanhã), responda com base no contexto e use actions vazio. Nunca invente dados.
- Para apagar ou concluir, use somente ids que existam no contexto; se houver dúvida sobre qual item, pergunte.
- Se o pedido for confuso, faça UMA pergunta curta e use actions vazio.
- Confirme o que foi feito em uma frase (ex: "Agendado: dentista, sexta às 14h.").`;

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b === -1) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await verifyToken(token);
    if (user.error) return res.status(401).json({ error: user.error });
    if (!ALLOWED.includes(user.email)) return res.status(401).json({ error: 'E-mail não permitido: ' + user.email + ' (defina ALLOWED_EMAILS na Vercel)' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let text = (body.text || '').trim();
    let transcript = '';
    if (!text && body.audio) {
      transcript = await transcribe(body.audio, body.mime);
      text = transcript;
    }
    if (!text) return res.status(200).json({ transcript: '', reply: 'Não consegui ouvir nada. Pode repetir?', actions: [] });

    const hist = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const messages = [];
    for (const h of hist) {
      if (!h || !h.content || (h.role !== 'user' && h.role !== 'assistant')) continue;
      if (messages.length === 0 && h.role !== 'user') continue;
      if (messages.length && messages[messages.length - 1].role === h.role) continue;
      messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
    }
    if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
    messages.push({
      role: 'user',
      content: 'CONTEXTO:\n' + JSON.stringify(body.context || {}) + '\n\nMENSAGEM DO USUÁRIO:\n' + text
    });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1024,
        system: SYSTEM,
        messages
      })
    });
    if (!r.ok) throw new Error('Claude: ' + (await r.text()).slice(0, 300));
    const d = await r.json();
    const raw = (d.content || []).map(c => c.text || '').join('');
    const parsed = extractJson(raw);
    const out = parsed && typeof parsed.reply === 'string'
      ? { reply: parsed.reply, actions: Array.isArray(parsed.actions) ? parsed.actions : [] }
      : { reply: raw.trim() || 'Não entendi, pode repetir?', actions: [] };
    return res.status(200).json({ transcript, text, ...out });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
