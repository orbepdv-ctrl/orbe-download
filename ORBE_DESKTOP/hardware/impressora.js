// Impressão direta (sem a janela do navegador).
async function listPrinters(win) {
  if (!win) return [];
  const L = await win.webContents.getPrintersAsync();
  return L.map(p => ({ name: p.name, padrao: !!p.isDefault }));
}
function printCurrent(win, o) {
  return new Promise(resolve => {
    if (!win) return resolve({ ok: false, msg: 'Janela não encontrada.' });
    // Sempre em pé (landscape:false). Papel em rolo: o sistema manda a largura e a altura do cupom (em mícrons).
    const opc = { silent: true, printBackground: true, landscape: false, margins: { marginType: 'none' }, copies: Math.max(1, +o.copies || 1) };
    if (o.printer) opc.deviceName = o.printer;
    if (o.pageSize && typeof o.pageSize === 'object' && +o.pageSize.width > 0 && +o.pageSize.height > 0) {
      opc.pageSize = { width: Math.round(+o.pageSize.width), height: Math.max(Math.round(+o.pageSize.height), Math.round(+o.pageSize.width) + 1000) };
    } else if (o.a4 || o.pageSize === 'A4') opc.pageSize = 'A4';
    try {
      win.webContents.print(opc, (ok, motivo) => resolve(ok ? { ok: true } : { ok: false, msg: motivo || 'falhou' }));
    } catch (e) { resolve({ ok: false, msg: e.message }); }
  });
}
module.exports = { listPrinters, printCurrent };
