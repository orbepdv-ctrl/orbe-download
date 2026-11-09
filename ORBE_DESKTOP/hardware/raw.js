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

async function viaWindows(win, printer, buf) {
  if (process.platform !== 'win32') return { ok: false, msg: 'impressão USB só no Windows' };
  let nome = printer;
  if (!nome && win) { try { const L = await win.webContents.getPrintersAsync(); nome = ((L.find(p => p.isDefault) || L[0]) || {}).name; } catch (e) {} }
  if (!nome) return { ok: false, msg: 'nenhuma impressora encontrada no Windows' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbe-'));
  const ps1 = path.join(dir, 'raw.ps1'), arq = path.join(dir, 'cupom.bin');
  fs.writeFileSync(ps1, '﻿' + PS, 'utf8'); fs.writeFileSync(arq, buf);
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
module.exports = { printRaw };
