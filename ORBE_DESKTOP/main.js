// ORBE instalável: abre o sistema numa janela própria, imprime direto, abre gaveta e lê balança.
const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { listPrinters, printCurrent } = require('./hardware/impressora');
const { printRaw, preaquece } = require('./hardware/raw');
const { openDrawer } = require('./hardware/gaveta');
const { readScale } = require('./hardware/balanca');
let wa = null;

const PORTA = 47821; // porta local fixa: mantém os dados do sistema sempre no mesmo lugar
const WWW = path.join(__dirname, 'www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const SITE_APP = 'https://orbepdv.pdvorbe.workers.dev/app/index.html'; // de onde o instalado busca a versão mais nova
let win = null, server = null;
// ---- atualização automática do sistema (index.html) + configurações simples ----
const pastaSis = () => path.join(app.getPath('userData'), 'sistema');
const arqCfg = () => path.join(app.getPath('userData'), 'orbe-config.json');
const lerCfg = () => { try { return JSON.parse(fs.readFileSync(arqCfg(), 'utf8')); } catch (e) { return {}; } };
const gravaCfg = o => { try { fs.writeFileSync(arqCfg(), JSON.stringify(Object.assign(lerCfg(), o))); } catch (e) {} };
const buildDe = txt => { const x = /ORBE_BUILD\s*=\s*(\d{9,})/.exec(txt || ''); return x ? +x[1] : 0; };
function indexAtual() { // cópia baixada (se existir) ou a que veio no instalador
  const baixado = path.join(pastaSis(), 'index.html');
  try { if (fs.existsSync(baixado)) return baixado; } catch (e) {}
  return path.join(WWW, 'index.html');
}
function baixaTexto(url, ms, n) { // segue redirecionamentos (o Cloudflare troca /app/index.html por /app/)
  n = n || 0;
  return new Promise(ok => {
    try {
      const rq = https.get(url, { headers: { 'Cache-Control': 'no-cache' }, timeout: ms }, r => {
        if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location && n < 5) {
          r.resume();
          let prox; try { prox = new URL(r.headers.location, url).toString(); } catch (e) { return ok(null); }
          if (!/^https:/.test(prox)) return ok(null);
          return baixaTexto(prox, ms, n + 1).then(ok);
        }
        if (r.statusCode !== 200) { r.resume(); return ok(null); }
        const partes = []; r.on('data', d => partes.push(d)); r.on('end', () => ok(Buffer.concat(partes).toString('utf8'))); r.on('error', () => ok(null));
      });
      rq.on('timeout', () => { rq.destroy(); ok(null); }); rq.on('error', () => ok(null));
    } catch (e) { ok(null); }
  });
}
const arqSt = () => path.join(pastaSis(), 'status.json');
const gravaSt = o => { try { fs.mkdirSync(pastaSis(), { recursive: true }); fs.writeFileSync(arqSt(), JSON.stringify(Object.assign({ em: new Date().toISOString() }, o))); } catch (e) {} };
const lerSt = () => { try { return JSON.parse(fs.readFileSync(arqSt(), 'utf8')); } catch (e) { return null; } };
async function atualizaSistema() {
  try {
    const novo = (await baixaTexto(SITE_APP + '?t=' + Date.now(), 8000)) || (await baixaTexto(SITE_APP.replace(/index\.html$/, '') + '?t=' + Date.now(), 8000));
    if (!novo) { gravaSt({ ok: false, motivo: 'sem resposta do site (internet fora ou endereço indisponível)' }); return false; }
    if (novo.length < 300000 || !/<\/html>\s*$/i.test(novo) || !novo.includes('ORBE_VER')) { gravaSt({ ok: false, motivo: 'o arquivo recebido não é o sistema (' + novo.length + ' bytes)' }); return false; } // não é o sistema (erro/offline)
    let atual = ''; try { atual = fs.readFileSync(indexAtual(), 'utf8'); } catch (e) {}
    if (buildDe(novo) <= buildDe(atual)) { gravaSt({ ok: true, motivo: 'já está na versão mais nova', build: buildDe(atual) }); return false; } // só aceita se for mais novo
    fs.mkdirSync(pastaSis(), { recursive: true });
    const tmp = path.join(pastaSis(), 'index.tmp'); fs.writeFileSync(tmp, novo); fs.renameSync(tmp, path.join(pastaSis(), 'index.html'));
    gravaSt({ ok: true, motivo: 'atualizado para a versão nova', build: buildDe(novo) });
    return true;
  } catch (e) { gravaSt({ ok: false, motivo: 'erro ao atualizar: ' + (e && e.message || e) }); return false; }
}
// se o instalador for mais novo que a cópia baixada, apaga a cópia velha
function limpaCopiaVelha() { try { const b = buildDe(fs.readFileSync(path.join(WWW, 'index.html'), 'utf8')), c = buildDe(fs.readFileSync(path.join(pastaSis(), 'index.html'), 'utf8')); if (c < b) fs.rmSync(path.join(pastaSis(), 'index.html'), { force: true }); } catch (e) {} }

// ---- o "motor" do WhatsApp também se atualiza sozinho (mesmo site, arquivo whatsapp.js) ----
const SITE_MOTOR = 'https://orbepdv.pdvorbe.workers.dev/app/whatsapp.js';
const motorDe = txt => { const x = /ORBE_MOTOR\s*=\s*(\d+)/.exec(txt || ''); return x ? +x[1] : 0; };
const motorBaixado = () => path.join(pastaSis(), 'whatsapp.js');
async function atualizaMotor() {
  try {
    const novo = await baixaTexto(SITE_MOTOR + '?t=' + Date.now(), 6000);
    if (!novo || novo.length < 3000 || !novo.includes('criaWhatsapp') || !novo.includes('module.exports')) return false;
    let atual = ''; try { atual = fs.readFileSync(fs.existsSync(motorBaixado()) ? motorBaixado() : path.join(__dirname, 'whatsapp.js'), 'utf8'); } catch (e) {}
    if (motorDe(novo) <= motorDe(atual)) return false;
    fs.mkdirSync(pastaSis(), { recursive: true });
    const tmp = path.join(pastaSis(), 'motor.tmp'); fs.writeFileSync(tmp, novo); fs.renameSync(tmp, motorBaixado());
    return true;
  } catch (e) { return false; }
}
function carregaMotor() {
  const emb = path.join(__dirname, 'whatsapp.js');
  try {
    const f = motorBaixado();
    if (fs.existsSync(f)) {
      const src = fs.readFileSync(f, 'utf8');
      if (motorDe(src) > motorDe(fs.readFileSync(emb, 'utf8')) && motorDe(src) > motorRuim()) {
        const Module = require('module'); const m = new Module(f, module);
        m.filename = emb; m.paths = Module._nodeModulePaths(__dirname); m._compile(src, emb);   // acha qrcode/pino do instalador
        if (m.exports && typeof m.exports.criaWhatsapp === 'function') return { fn: m.exports.criaWhatsapp, extra: true, ver: motorDe(src) };
      }
    }
  } catch (e) {}
  return { fn: require('./whatsapp').criaWhatsapp, extra: false, ver: 0 };   // se der qualquer problema, usa o que veio no instalador
}
const arqRuim = () => path.join(pastaSis(), 'motor-ruim.txt');
const motorRuim = () => { try { return +fs.readFileSync(arqRuim(), 'utf8') || 0; } catch (e) { return 0; } };

function sobeServidor() {
  return new Promise((ok, erro) => {
    server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      let f = path.normalize(path.join(WWW, p));
      if (!f.startsWith(WWW)) { res.writeHead(403); return res.end(); }
      if (path.basename(f) === 'index.html' && path.dirname(f) === WWW) f = indexAtual();
      fs.readFile(f, (e, d) => {
        if (e) { res.writeHead(404); return res.end('Não encontrado'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
        res.end(d);
      });
    });
    server.on('error', erro);
    server.listen(PORTA, '127.0.0.1', ok);
  });
}

// ---- versão carregada na janela x versão baixada no disco ----
let buildNaJanela = 0;
const buildNoDisco = () => { try { return buildDe(fs.readFileSync(indexAtual(), 'utf8')); } catch (e) { return 0; } };
const verNoDisco = () => { try { const x = /ORBE_VER\s*=\s*"([^"]*)"/.exec(fs.readFileSync(indexAtual(), 'utf8')); return x ? x[1] : ''; } catch (e) { return ''; } };
function avisaSeNova() { if (win && !win.isDestroyed() && buildNoDisco() > buildNaJanela) win.webContents.send('upd:pronta', { ver: verNoDisco() }); }
ipcMain.handle('upd:aplicar', () => { if (win && !win.isDestroyed()) { buildNaJanela = buildNoDisco(); win.webContents.reloadIgnoringCache(); } return true; });
ipcMain.handle('upd:verificar', async () => { const r = await atualizaSistema(); const st = lerSt() || {}; return { nova: buildNoDisco() > buildNaJanela, ver: verNoDisco(), motivo: st.motivo || '', ok: st.ok !== false, baixou: r }; });
function criaJanela() {
  buildNaJanela = buildNoDisco();
  win = new BrowserWindow({
    width: 1366, height: 800, show: false, autoHideMenuBar: true, backgroundColor: '#14181d', title: 'ORBE',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); if (lerCfg().telaCheia) win.setFullScreen(true); });
  win.loadURL('http://127.0.0.1:' + PORTA + '/index.html');
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (i.type === 'keyDown' && i.key === 'F5') { buildNaJanela = buildNoDisco(); win.webContents.reloadIgnoringCache(); e.preventDefault(); }
  });
  // links externos (WhatsApp, etc.) abrem no navegador do Windows
  win.webContents.setWindowOpenHandler(({ url }) => { require('electron').shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

const trava = app.requestSingleInstanceLock();
if (!trava) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try { await sobeServidor(); }
    catch (e) { dialog.showErrorBox('ORBE', 'Não consegui iniciar o sistema (porta ' + PORTA + ' ocupada). Feche outro ORBE aberto e tente de novo.'); return app.quit(); }
    limpaCopiaVelha();
    const baixando = Promise.all([atualizaSistema(), atualizaMotor()]);
    await Promise.race([baixando, new Promise(r => setTimeout(r, 10000))]); // sem internet ou lenta: abre com a versão que já tem
    criaJanela();
    setTimeout(preaquece, 3000); // deixa o motor de impressão pronto (cupom sai na hora)
    // se a versão nova terminar de baixar depois que a janela abriu, avisa o sistema (botão "Atualizar agora")
    baixando.then(() => avisaSeNova()).catch(() => {});
    setInterval(async () => { try { await atualizaSistema(); avisaSeNova(); } catch (e) {} }, 15 * 60 * 1000); // confere de 15 em 15 minutos
    const opcoes = { pasta: path.join(app.getPath('userData'), 'whatsapp'), avisa: s => { if (win && !win.isDestroyed()) win.webContents.send('wa:status', s); }, aoMsg: x => { if (win && !win.isDestroyed()) win.webContents.send('wa:msg', x); } };
    const m = carregaMotor();
    wa = m.fn(m.extra ? Object.assign({}, opcoes, { avisa: s => {
      // se o motor baixado der erro ao iniciar, volta sozinho para o que veio no instalador
      if (s && s.estado === 'erro' && m.extra && !wa._voltou) {
        try { fs.mkdirSync(pastaSis(), { recursive: true }); fs.writeFileSync(arqRuim(), String(m.ver)); } catch (e) {}
        try { wa.pausar && wa.pausar(); } catch (e) {}
        wa = require('./whatsapp').criaWhatsapp(opcoes); wa._voltou = true; wa.aoIniciar(); return;
      }
      opcoes.avisa(s);
    } }) : opcoes);
    wa.aoIniciar();
  });
  app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
}

// ---- ponte com o sistema (preload.js expõe como window.orbeDesktop) ----
ipcMain.on('info', e => { e.returnValue = { version: app.getVersion(), autostart: app.getLoginItemSettings().openAtLogin, telaCheia: !!lerCfg().telaCheia, upd: lerSt() }; });
ipcMain.handle('telacheia', (_e, on) => { gravaCfg({ telaCheia: !!on }); if (win) win.setFullScreen(!!on); return true; });
ipcMain.handle('autostart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return true; });
ipcMain.handle('printers', async () => listPrinters(win));
ipcMain.handle('print', async (_e, o) => printCurrent(win, o || {}));
ipcMain.handle('printRaw', async (_e, o) => printRaw(win, o || {}));
ipcMain.handle('drawer', async (_e, o) => openDrawer(o || {}, win));
ipcMain.handle('scale', async (_e, o) => readScale(o || {}));

// ---- WhatsApp da loja ----
ipcMain.handle('wa:status', () => (wa ? wa.status() : { estado: 'desligado' }));
ipcMain.handle('wa:conectar', () => wa && wa.conectar());
ipcMain.handle('wa:desconectar', () => wa && wa.desconectar());
ipcMain.handle('wa:enviar', (_e, o) => (wa ? wa.envia(o || {}) : { ok: false, motivo: 'desconectado' }));
ipcMain.handle('wa:conversas', () => (wa ? wa.conversas() : []));
ipcMain.handle('wa:mensagens', (_e, jid) => (wa ? wa.mensagens(jid) : []));
ipcMain.handle('wa:responder', (_e, o) => (wa ? wa.responder(o || {}) : { ok: false, motivo: 'desconectado' }));
ipcMain.handle('wa:lido', (_e, jid) => (wa ? wa.lido(jid) : true));
