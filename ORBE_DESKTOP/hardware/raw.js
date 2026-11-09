// Impressão "crua" (ESC/POS) para impressora térmica: texto direto, sempre em pé, com corte.
// USB/local: manda os bytes pelo spooler do Windows em modo RAW (PowerShell + winspool).
// Rede: manda os bytes direto para IP:porta (normalmente 9100).
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PS = `param([string]$Printer,[string]$Arq)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class OrbeRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static string Envia(string p, byte[] b) {
    IntPtr h; if (!OpenPrinter(p, out h, IntPtr.Zero)) return "nao abriu a impressora (" + Marshal.GetLastWin32Error() + ")";
    DOCINFO di = new DOCINFO(); di.pDocName = "ORBE"; di.pDataType = "RAW";
    if (StartDocPrinter(h, 1, di) == 0) { ClosePrinter(h); return "falha ao iniciar (" + Marshal.GetLastWin32Error() + ")"; }
    StartPagePrinter(h); int w; bool ok = WritePrinter(h, b, b.Length, out w); EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    return ok ? "OK" : "falha ao enviar (" + Marshal.GetLastWin32Error() + ")";
  }
}
"@
[Console]::Out.Write([OrbeRaw]::Envia($Printer, [IO.File]::ReadAllBytes($Arq)))
`;

function viaRede(host, port, buf) {
  return new Promise(resolve => {
    const s = net.connect({ host, port: +port || 9100 });
    let fim = false; const ok = r => { if (!fim) { fim = true; try { s.destroy(); } catch (e) {} resolve(r); } };
    s.setTimeout(5000, () => ok({ ok: false, msg: 'a impressora de rede não respondeu (' + host + ')' }));
    s.on('connect', () => s.end(buf, () => setTimeout(() => ok({ ok: true }), 300)));
    s.on('error', e => ok({ ok: false, msg: e.message }));
  });
}

// Motor rápido: um PowerShell fica aberto com o código já compilado; cada cupom só manda uma linha.
// (antes: abria um PowerShell novo e recompilava a cada impressão = 3 a 6 s de espera)
const LOOP = PS.replace(/^param\(\[string\]\$Printer,\[string\]\$Arq\)\s*/, '')
  .replace(/\[Console\]::Out\.Write\(\[OrbeRaw\]::Envia\(\$Printer, \[IO\.File\]::ReadAllBytes\(\$Arq\)\)\)\s*$/, '') + `
[Console]::Out.WriteLine('PRONTO')
while ($true) {
  $l = [Console]::In.ReadLine(); if ($l -eq $null) { break }
  $r = 'falhou'
  try { $p = $l.Split('|'); $n = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[0])); $r = [OrbeRaw]::Envia($n, [Convert]::FromBase64String($p[1])) } catch { $r = $_.Exception.Message }
  [Console]::Out.WriteLine('FIM:' + ($r -replace '[\r\n]', ' '))
}
`;
let motor = null;
function abreMotor() {
  if (process.platform !== 'win32') return null;
  if (motor && !motor.morto) return motor;
  const { spawn } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-motor-')), ps1 = path.join(dir, 'motor.ps1');
  fs.writeFileSync(ps1, '\ufeff' + LOOP, 'utf8');
  const pr = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { windowsHide: true });
  const m = { pr, fila: [], buf: '', pronto: false, morto: false };
  let espera = [];
  m.ok = new Promise(res => espera.push(res));
  pr.stdout.on('data', d => {
    m.buf += d.toString();
    let i; while ((i = m.buf.indexOf('\n')) >= 0) {
      const l = m.buf.slice(0, i).trim(); m.buf = m.buf.slice(i + 1);
      if (l === 'PRONTO') { m.pronto = true; espera.forEach(f => f(true)); espera = []; continue; }
      if (l.startsWith('FIM:')) { const f = m.fila.shift(); if (f) f(l.slice(4)); }
    }
  });
  const morre = () => { m.morto = true; espera.forEach(f => f(false)); espera = []; m.fila.splice(0).forEach(f => f(null)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} };
  pr.on('exit', morre); pr.on('error', morre);
  motor = m; return m;
}
const tempo = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
async function pelaMotor(nome, buf) {
  const m = abreMotor(); if (!m) return null;
  if (!m.pronto && !(await tempo(m.ok, 20000))) return null;
  if (m.morto) return null;
  const r = new Promise(res => m.fila.push(res));
  try { m.pr.stdin.write(Buffer.from(nome, 'utf8').toString('base64') + '|' + buf.toString('base64') + '\n'); } catch (e) { return null; }
  const out = await tempo(r, 20000);
  if (out == null) { try { m.pr.kill(); } catch (e) {} m.morto = true; }
  return out;
}
function preaquece() { try { abreMotor(); } catch (e) {} }

async function viaWindows(win, printer, buf) {
  if (process.platform !== 'win32') return { ok: false, msg: 'impressão USB só no Windows' };
  let nome = printer;
  if (!nome && win) { try { const L = await win.webContents.getPrintersAsync(); nome = ((L.find(p => p.isDefault) || L[0]) || {}).name; } catch (e) {} }
  if (!nome) return { ok: false, msg: 'nenhuma impressora encontrada no Windows' };
  // 1) motor rápido
  try { const r = await pelaMotor(nome, buf); if (r === 'OK') return { ok: true, printer: nome }; if (r) return { ok: false, msg: r }; } catch (e) {}
  // 2) reserva: jeito antigo (PowerShell novo)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-'));
  const ps1 = path.join(dir, 'raw.ps1'), arq = path.join(dir, 'cupom.bin');
  fs.writeFileSync(ps1, '\ufeff' + PS, 'utf8'); fs.writeFileSync(arq, buf);
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Printer', nome, '-Arq', arq], { windowsHide: true, timeout: 30000 }, (err, out, errTxt) => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
      const r = String(out || '').trim();
      if (r === 'OK') return resolve({ ok: true, printer: nome });
      resolve({ ok: false, msg: r || (errTxt && String(errTxt).trim().split('\n')[0]) || (err && err.message) || 'falhou' });
    });
  });
}

async function printRaw(win, o) {
  try {
    const buf = Buffer.from(String(o.b64 || ''), 'base64');
    if (!buf.length) return { ok: false, msg: 'cupom vazio' };
    if (o.host) return await viaRede(o.host, o.port, buf);
    return await viaWindows(win, o.printer || '', buf);
  } catch (e) { return { ok: false, msg: e.message }; }
}
module.exports = { printRaw, preaquece };
