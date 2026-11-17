// api/mex.js — cérebro do Mex (Vercel serverless, Node 18+)
// Variáveis de ambiente: ANTHROPIC_API_KEY, OPENAI_API_KEY, FIREBASE_API_KEY, ALLOWED_EMAILS (opcional)

// Extrai só a chave sk-ant-... mesmo que a variável tenha texto extra colado junto
const ANTHROPIC_KEY = ((process.env.ANTHROPIC_API_KEY || '').match(/sk-ant-[A-Za-z0-9_\-]+/) || [''])[0];

const ALLOWED = (process.env.ALLOWED_EMAILS || 'agrosafra7@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function verifyToken(idToken) {
  const FB_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAdVNgwnZN0difI8IBsIgUo0OHWZHHse_c';
  if (!idToken) return { error: 'Login não enviado ao servidor.' };
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FB_KEY,
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

const SYSTEM = `Você é o Mex, assistente pessoal por voz, texto e foto de uso exclusivo do seu dono. Fala português do Brasil, de forma curta, natural e direta, como alguém que será ouvido em voz alta: sem markdown, sem listas longas, sem emojis.

Você gerencia AGENDA (compromissos e lembretes), TAREFAS, NOTAS/RECADOS, CARTÕES DE CRÉDITO e FINANCEIRO (receitas e despesas em reais, com categorias e limites mensais). Você recebe um CONTEXTO em JSON com a data/hora atual, compromissos e tarefas pendentes, notas, categorias criadas pelo usuário (com limite e gasto no mês), cartões (limite, fatura aberta e fechada), últimas transações (todos com id) e resumo dos últimos meses. O usuário também pode enviar uma FOTO.

Responda SEMPRE e SOMENTE com um JSON válido neste formato:
{"reply":"texto curto que será mostrado e falado","actions":[ ... ]}

Ações possíveis (use só quando o usuário pedir ou informar algo; pode usar várias na mesma resposta):
- {"type":"add_event","title":"...","when":"YYYY-MM-DDTHH:mm","notes":"..."}  (compromisso/lembrete com hora; "when" é quando deve tocar)
- {"type":"complete_event","id":"<id>"}  {"type":"delete_event","id":"<id>"}
- {"type":"add_task","title":"...","due":"YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm" ou "","priority":"alta"|"media"|"baixa"}
- {"type":"complete_task","id":"<id>"}  {"type":"delete_task","id":"<id>"}
- {"type":"add_note","title":"...","text":"...","attach_photo":true|false}  (recado, anotação, informação ou documento para guardar)
- {"type":"delete_note","id":"<id>"}
- {"type":"add_transaction","kind":"expense"|"income","amount":123.45,"category":"...","description":"...","date":"YYYY-MM-DD","card":"nome do cartão (só despesa no crédito)","attach_photo":true|false}
- {"type":"update_transaction","id":"<id>","category":"...","amount":0,"description":"...","date":"YYYY-MM-DD"}  (só os campos que mudam)
- {"type":"delete_transaction","id":"<id>"}
- {"type":"add_category","name":"...","kind":"expense"|"income","limit":300}  ("limit" opcional; se a categoria já existe e vier limit, atualiza)
- {"type":"set_category_limit","id":"<id>","limit":500}  (0 remove o limite)
- {"type":"delete_category","id":"<id>"}
- {"type":"add_card","name":"Nubank","limit":5000,"closing_day":3,"due_day":10}
- {"type":"update_card","id":"<id>","name":"...","limit":0,"closing_day":0,"due_day":0}  (só o que muda)
- {"type":"delete_card","id":"<id>"}
- {"type":"pay_invoice","id":"<id do cartão>"}  (marca a fatura fechada como paga)
- {"type":"export","format":"pdf"|"xlsx","month":"YYYY-MM"}  (relatório financeiro do mês)

Regras:
- Resolva datas relativas ("amanhã", "sexta", "daqui a 2 horas") usando "agora" do contexto. Compromisso sem hora: use 09:00 e diga isso na resposta.
- Compromisso/lembrete = algo com data e hora para ser avisado; tarefa = algo a fazer (prazo opcional); nota/recado = informação para guardar.
- Categorias padrão de despesa: Alimentação, Transporte, Combustível, Moradia, Saúde, Lazer, Trabalho, Educação, Contas, Outros. Receita: Salário, Vendas, Serviços, Outros. Prefira também as categorias criadas pelo usuário (contexto) quando combinarem.
- Se o usuário pedir para criar uma categoria e já lançar um gasto nela, faça add_category E add_transaction com exatamente o mesmo nome.
- Gasto no cartão: se disser "no cartão X" ou "no crédito", use "card" com o nome exato de um cartão do contexto. Se o cartão não existir, pergunte se deve cadastrar (nome, limite, dia de fechamento e de vencimento).
- Se um gasto fizer a categoria passar do limite mensal, ou usar mais que o limite disponível do cartão, avise na resposta.
- FOTO: se for comprovante, cupom ou nota de compra, extraia valor total, estabelecimento, data e categoria e faça add_transaction com attach_photo true (descrição = estabelecimento). Se o valor estiver ilegível, pergunte. Se for outro documento (contrato, boleto, nota fiscal, receita, recibo de serviço), faça add_note com título e no texto os dados principais (partes, valores, datas, vencimento, números) para poder ser achado depois, com attach_photo true. Se o usuário escreveu uma instrução junto com a foto, siga-a.
- Se não disser a data de um gasto, use hoje. Valor sempre número positivo em reais.
- Para perguntas (saldo, quanto gastei, fatura do cartão, o que tenho hoje, quais notas ou tarefas, buscar um documento), responda com base no contexto e use actions vazio. Nunca invente dados.
- Para apagar, concluir ou alterar, use somente ids que existam no contexto; se houver dúvida sobre qual item, pergunte.
- Se o pedido for confuso, faça UMA pergunta curta e use actions vazio.
- Confirme o que foi feito em uma frase curta.`;

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
    if (!text && !body.image) return res.status(200).json({ transcript: '', reply: 'Não consegui ouvir nada. Pode repetir?', actions: [] });

    const hist = Array.isArray(body.history) ? body.history.slice(-6) : [];
    const messages = [];
    for (const h of hist) {
      if (!h || !h.content || (h.role !== 'user' && h.role !== 'assistant')) continue;
      if (messages.length === 0 && h.role !== 'user') continue;
      if (messages.length && messages[messages.length - 1].role === h.role) continue;
      messages.push({ role: h.role, content: String(h.content).slice(0, 2000) });
    }
    if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
    const ctx = 'CONTEXTO:\n' + JSON.stringify(body.context || {}) + '\n\nMENSAGEM DO USUÁRIO:\n' + (text || '(enviou apenas uma foto)');
    if (body.image) {
      messages.push({ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.image } },
        { type: 'text', text: ctx }
      ] });
    } else {
      messages.push({ role: 'user', content: ctx });
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 1500,
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
