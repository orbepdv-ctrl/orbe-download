// ORBE_MOTOR=2
// ORBE · WhatsApp da loja (roda dentro do app instalado, sem servidor).
// Liga o número da loja lendo um QR Code, igual ao WhatsApp Web.
// Só envia o que o sistema pedir (avisos de pedido). Fila lenta para evitar bloqueio.
const path = require('path');
const fs = require('fs');

function criaWhatsapp({ pasta, avisa, aoMsg }) {
  // pasta = onde guardar a sessão (userData/whatsapp). avisa(status) = empurra o estado para a tela.
  let sock = null, baileys = null, QRCode = null;
  let st = { estado: 'desligado', qr: '', numero: '', nome: '', msg: '' };
  let querLigado = false, tentativas = 0, timerRecon = null;
  const fila = []; let enviando = false; let enviadosMin = [];

  // ---- histórico de conversas (arquivo no computador, fora da pasta da sessão) ----
  const arqConv = pasta + '-conversas.json';
  let chats = {}, lids = {}; let timerSalva = null;   // lids: código oculto do WhatsApp (LID) -> telefone
  try { const j = JSON.parse(fs.readFileSync(arqConv, 'utf8')); chats = j.chats || {}; lids = j.lids || {}; } catch (e) {}
  const salva = () => { clearTimeout(timerSalva); timerSalva = setTimeout(() => { try { fs.writeFileSync(arqConv, JSON.stringify({ chats, lids })); } catch (e) {} }, 800); };
  const soNum = v => String(v || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const ehLid = j => String(j || '').endsWith('@lid');
  const ehPn = j => String(j || '').endsWith('@s.whatsapp.net');
  // junta a conversa do código oculto (LID) com a do telefone, quando o telefone é descoberto
  function aprende(lid, pn) {
    try {
      const l = soNum(lid), p = soNum(pn);
      if (!l || p.length < 10) return;
      lids[l] = p;
      const de = chats[l + '@lid']; if (!de) { salva(); return; }
      const jp = p + '@s.whatsapp.net';
      const para = chats[jp] || (chats[jp] = { jid: jp, nome: '', fone: p, ts: 0, naoLidas: 0, msgs: [] });
      const ids = new Set(para.msgs.map(x => x.id));
      de.msgs.forEach(x => { if (!ids.has(x.id)) para.msgs.push(x); });
      para.msgs.sort((a, b) => a.ts - b.ts); if (para.msgs.length > 200) para.msgs = para.msgs.slice(-200);
      para.nome = para.nome || de.nome; para.fone = p; para.ts = Math.max(para.ts, de.ts);
      para.naoLidas = (para.naoLidas || 0) + (de.naoLidas || 0);
      delete chats[l + '@lid']; salva();
    } catch (e) {}
  }
  const aprendeLista = arr => (arr || []).forEach(c => {
    if (!c) return;
    const a = c.id, b = c.lid || c.lidJid, p = c.phoneNumber || c.pn;
    if (ehLid(a) && (ehPn(b) || p)) aprende(a, b && ehPn(b) ? b : p);
    else if (ehPn(a) && b) aprende(b, a);
  });
  // tenta descobrir o telefone de um código oculto pelo próprio WhatsApp
  async function resolveLid(lidJid) {
    try {
      const m = sock && sock.signalRepository && sock.signalRepository.lidMapping;
      if (m && m.getPNForLID) { const pn = await m.getPNForLID(lidJid); if (pn) aprende(lidJid, pn); }
    } catch (e) {}
  }
  Object.values(chats).forEach(c => { if (ehLid(c.jid)) c.fone = ''; });
  Object.keys(chats).filter(k => ehLid(k) && lids[soNum(k)]).forEach(k => aprende(k, lids[soNum(k)]));
  const textoDe = m => {
    const x = m.message || {};
    const t = x.conversation || (x.extendedTextMessage && x.extendedTextMessage.text) || (x.imageMessage && (x.imageMessage.caption || '')) || (x.videoMessage && (x.videoMessage.caption || '')) || '';
    if (t) return { texto: t, tipo: 'texto' };
    if (x.imageMessage) return { texto: '📷 Foto', tipo: 'midia' };
    if (x.videoMessage) return { texto: '🎬 Vídeo', tipo: 'midia' };
    if (x.audioMessage) return { texto: '🎤 Áudio', tipo: 'midia' };
    if (x.stickerMessage) return { texto: 'Figurinha', tipo: 'midia' };
    if (x.documentMessage) return { texto: '📄 ' + (x.documentMessage.fileName || 'Documento'), tipo: 'midia' };
    if (x.locationMessage) return { texto: '📍 Localização', tipo: 'midia' };
    if (x.contactMessage) return { texto: '👤 Contato', tipo: 'midia' };
    return null;
  };
  function registra(m) {
    try {
      const k = m.key || {}; let jid = k.remoteJid;
      if (jid && ehLid(jid)) {
        const alt0 = k.remoteJidAlt || k.senderPn || (m.key && m.key.participantPn) || '';
        if (ehPn(alt0)) aprende(jid, alt0);
        const p0 = lids[soNum(jid)];
        if (p0) jid = p0 + '@s.whatsapp.net';
      }
      if (!jid || jid === 'status@broadcast' || String(jid).endsWith('@g.us') || String(jid).endsWith('@broadcast') || String(jid).endsWith('@newsletter')) return;
      const c = textoDe(m); if (!c) return;
      const ts = (Number(m.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;
      const alt = ehPn(k.remoteJidAlt) ? k.remoteJidAlt : (ehPn(k.senderPn) ? k.senderPn : '');
      const fone = ehLid(jid) ? '' : soNum(alt || jid);
      const ch = chats[jid] || (chats[jid] = { jid, nome: '', fone, ts: 0, naoLidas: 0, msgs: [] });
      if (ch.msgs.some(x => x.id === k.id)) return;
      if (!k.fromMe && m.pushName) ch.nome = m.pushName;
      if (fone && !ch.fone) ch.fone = fone;
      if (ehLid(jid) && sock) resolveLid(jid);
      ch.msgs.push({ id: k.id, de: k.fromMe ? 'eu' : 'cli', texto: c.texto, tipo: c.tipo, ts });
      ch.msgs.sort((a, b) => a.ts - b.ts); if (ch.msgs.length > 200) ch.msgs = ch.msgs.slice(-200);
      ch.ts = Math.max(ch.ts, ts);
      if (!k.fromMe) ch.naoLidas = (ch.naoLidas || 0) + 1;
      salva();
      try { aoMsg && aoMsg({ jid, de: k.fromMe ? 'eu' : 'cli' }); } catch (e) {}
    } catch (e) {}
  }
  const lista = () => Object.values(chats).sort((a, b) => b.ts - a.ts).map(c => { const u = c.msgs[c.msgs.length - 1] || {}; return { jid: c.jid, nome: c.nome || '', fone: c.fone || '', oculto: !c.fone, ts: c.ts, naoLidas: c.naoLidas || 0, ultima: u.texto || '', ultimaDe: u.de || '' }; });
  const msgsDe = jid => (chats[jid] ? chats[jid].msgs : []);
  const lido = jid => { if (chats[jid]) { chats[jid].naoLidas = 0; salva(); } return true; };
  // guarda o que foi enviado: o WhatsApp pede a mensagem de volta quando o celular não consegue abrir ("Aguardando mensagem")
  const enviadas = new Map();
  const guarda = r => { try { if (r && r.key && r.key.id && r.message) { enviadas.set(r.key.id, r.message); if (enviadas.size > 500) enviadas.delete(enviadas.keys().next().value); } } catch (e) {} };
  const mapaRetry = new Map();
  const cacheTent = { get: k => mapaRetry.get(k), set: (k, v) => { mapaRetry.set(k, v); }, del: k => { mapaRetry.delete(k); }, flushAll: () => mapaRetry.clear() };
  async function responder({ jid, texto }) {
    if (st.estado !== 'conectado' || !sock) return { ok: false, motivo: 'desconectado', msg: 'WhatsApp não está conectado.' };
    if (!jid || !String(texto || '').trim()) return { ok: false, motivo: 'dados', msg: 'Mensagem vazia.' };
    try { const r = await sock.sendMessage(jid, { text: String(texto) }); guarda(r); if (r) registra(r); return { ok: true }; }
    catch (e) { return { ok: false, motivo: 'erro', msg: String(e && e.message || e) }; }
  }

  const muda = o => { st = Object.assign({}, st, o); try { avisa && avisa(st); } catch (e) {} };
  const sessaoExiste = () => fs.existsSync(path.join(pasta, 'creds.json'));
  const espera = ms => new Promise(r => setTimeout(r, ms));

  async function carrega() {
    if (baileys) return;
    baileys = await import('@whiskeysockets/baileys');
    QRCode = require('qrcode');
  }

  async function conecta() {
    querLigado = true;
    clearTimeout(timerRecon);
    try {
      await carrega();
      const inner = baileys.default, B = Object.assign({}, (inner && typeof inner === 'object') ? inner : {}, baileys);
      const makeWASocket = [baileys.makeWASocket, inner && inner.makeWASocket, inner && inner.default, typeof inner === 'function' ? inner : null].find(f => typeof f === 'function');
      if (!makeWASocket) throw new Error('biblioteca do WhatsApp nao reconhecida');
      fs.mkdirSync(pasta, { recursive: true });
      const { state, saveCreds } = await B.useMultiFileAuthState(pasta);
      let versao; try { versao = (await B.fetchLatestBaileysVersion()).version; } catch (e) {}
      const logger = require('pino')({ level: 'silent' });
      muda({ estado: 'conectando', qr: '', msg: '' });
      sock = makeWASocket({ auth: state, version: versao, logger, printQRInTerminal: false, browser: ['ORBE', 'Desktop', '1.0'], markOnlineOnConnect: false, syncFullHistory: false, msgRetryCounterCache: cacheTent, getMessage: async key => (key && enviadas.get(key.id)) || undefined });
      sock.ev.on('creds.update', saveCreds);
      ['contacts.upsert', 'contacts.update', 'chats.phoneNumberShare'].forEach(ev => { try { sock.ev.on(ev, a => aprendeLista(Array.isArray(a) ? a : [a])); } catch (e) {} });
      try { sock.ev.on('lid-mapping.update', a => { const arr = Array.isArray(a) ? a : (a && a.mappings) || Object.entries(a || {}).map(([lid, pn]) => ({ lid, pn })); arr.forEach(x => x && aprende(x.lid || x.id, x.pn || x.phoneNumber)); }); } catch (e) {}
      try { sock.ev.on('messaging-history.set', h => { aprendeLista(h && h.contacts); }); } catch (e) {}
      sock.ev.on('messages.upsert', ({ messages }) => { (messages || []).forEach(registra); });
      sock.ev.on('connection.update', async u => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) { const img = await QRCode.toDataURL(qr, { margin: 1, width: 280 }); muda({ estado: 'qr', qr: img, msg: '' }); }
        if (connection === 'open') {
          tentativas = 0;
          const id = (sock.user && sock.user.id) || '';
          muda({ estado: 'conectado', qr: '', numero: id.split(':')[0].split('@')[0], nome: (sock.user && sock.user.name) || '', msg: '' });
          roda();
        }
        if (connection === 'close') {
          const cod = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
          sock = null;
          if (cod === B.DisconnectReason.loggedOut) { limpaSessao(); muda({ estado: 'desligado', qr: '', numero: '', nome: '', msg: 'O WhatsApp foi desconectado pelo celular. Leia o QR de novo.' }); return; }
          if (querLigado) { tentativas++; muda({ estado: 'conectando', msg: 'Reconectando…' }); timerRecon = setTimeout(conecta, Math.min(30000, 2000 * tentativas)); }
        }
      });
    } catch (e) {
      muda({ estado: 'erro', msg: 'Não consegui iniciar o WhatsApp: ' + (e && e.message || e) });
    }
  }

  function limpaSessao() { try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) {} }

  async function desliga(apagar) {
    querLigado = false; clearTimeout(timerRecon);
    try { if (sock && apagar) await sock.logout(); } catch (e) {}
    try { if (sock) sock.end && sock.end(undefined); } catch (e) {}
    sock = null;
    if (apagar) limpaSessao();
    muda({ estado: 'desligado', qr: '', numero: apagar ? '' : st.numero, nome: apagar ? '' : st.nome, msg: '' });
    return true;
  }

  // ---- envio: fila lenta (3 a 8 s entre mensagens, no máximo 12 por minuto) ----
  async function roda() {
    if (enviando) return; enviando = true;
    while (fila.length && sock && st.estado === 'conectado') {
      const agora = Date.now(); enviadosMin = enviadosMin.filter(t => agora - t < 60000);
      if (enviadosMin.length >= 12) { await espera(5000); continue; }
      const it = fila.shift();
      try {
        const num = String(it.fone || '').replace(/\D/g, '');
        const f = num.length <= 11 ? '55' + num : num;
        const r = await sock.onWhatsApp(f);
        const jid = r && r[0] && r[0].exists ? r[0].jid : null;
        if (!jid) { it.fim({ ok: false, motivo: 'sem_whatsapp', msg: 'Esse número não tem WhatsApp.' }); continue; }
        await sock.presenceSubscribe(jid).catch(() => {});
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
        await espera(1200 + Math.random() * 1800);
        const enviada = await sock.sendMessage(jid, { text: it.texto }); guarda(enviada); if (enviada) registra(enviada);
        await sock.sendPresenceUpdate('paused', jid).catch(() => {});
        enviadosMin.push(Date.now());
        it.fim({ ok: true });
      } catch (e) { it.fim({ ok: false, motivo: 'erro', msg: String(e && e.message || e) }); }
      await espera(3000 + Math.random() * 5000);
    }
    enviando = false;
  }

  function envia({ fone, texto }) {
    return new Promise(res => {
      if (st.estado !== 'conectado' || !sock) return res({ ok: false, motivo: 'desconectado', msg: 'WhatsApp não está conectado.' });
      if (!texto || String(fone || '').replace(/\D/g, '').length < 10) return res({ ok: false, motivo: 'dados', msg: 'Telefone ou texto inválido.' });
      if (fila.length > 50) return res({ ok: false, motivo: 'fila', msg: 'Fila cheia, tente em instantes.' });
      fila.push({ fone, texto, fim: res }); roda();
    });
  }

  return {
    status: () => st,
    conectar: () => { conecta(); return true; },
    desconectar: () => desliga(true),
    pausar: () => desliga(false),
    envia,
    conversas: lista, mensagens: msgsDe, responder, lido, registra, aprende,
    aoIniciar: () => { if (sessaoExiste()) conecta(); }   // se já leu o QR antes, volta sozinho
  };
}
module.exports = { criaWhatsapp };
