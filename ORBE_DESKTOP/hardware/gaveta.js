// Gaveta de dinheiro ligada à impressora térmica (comando ESC/POS "abrir gaveta").
const net = require('net');
const PULSO = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
function openDrawer(o) {
  return new Promise(resolve => {
    if (o.host) { // impressora de rede (porta 9100)
      const s = net.connect({ host: o.host, port: o.port || 9100, timeout: 3000 }, () => s.end(PULSO));
      s.on('close', () => resolve({ ok: true }));
      s.on('timeout', () => { s.destroy(); resolve({ ok: false, msg: 'A impressora não respondeu.' }); });
      s.on('error', e => resolve({ ok: false, msg: e.message }));
    } else {
      // Impressora USB: precisa do envio "raw" pelo Windows. Fica para a próxima etapa (veja LEIA-ME).
      resolve({ ok: false, msg: 'Informe o IP da impressora de rede. Gaveta por USB entra na próxima etapa.' });
    }
  });
}
module.exports = { openDrawer };
