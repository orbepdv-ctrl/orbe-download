// Impressão direta (sem a janela do navegador).
async function listPrinters(win) {
  if (!win) return [];
  const L = await win.webContents.getPrintersAsync();
  return L.map(p => ({ name: p.name, padrao: !!p.isDefault }));
}
function printCurrent(win, o) {
  return new Promise(resolve => {
    if (!win) return resolve({ ok: false, msg: 'Janela não encontrada.' });
    const opc = { silent: true, printBackground: true, margins: { marginType: 'none' }, copies: Math.max(1, +o.copies || 1) };
    if (o.printer) opc.deviceName = o.printer;
    if (o.a4) opc.pageSize = 'A4';
    win.webContents.print(opc, (ok, motivo) => resolve(ok ? { ok: true } : { ok: false, msg: motivo || 'falhou' }));
  });
}
module.exports = { listPrinters, printCurrent };
