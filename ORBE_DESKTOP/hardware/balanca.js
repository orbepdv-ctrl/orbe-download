// Balança serial (COM). Usa o módulo "serialport" se ele estiver instalado (opcional).
async function readScale(o) {
  let SerialPort;
  try { ({ SerialPort } = require('serialport')); }
  catch (e) { return { ok: false, msg: 'Leitura de balança ainda não instalada nesta versão.' }; }
  if (!o.port) return { ok: false, msg: 'Informe a porta (ex.: COM3).' };
  return new Promise(resolve => {
    let buf = '';
    const sp = new SerialPort({ path: o.port, baudRate: o.baud || 9600 }, err => { if (err) resolve({ ok: false, msg: err.message }); });
    const fim = setTimeout(() => { try { sp.close(); } catch (e) {} const m = buf.match(/(\d+[.,]\d+)/); resolve(m ? { ok: true, peso: parseFloat(m[1].replace(',', '.')) } : { ok: false, msg: 'Sem resposta da balança.' }); }, 1500);
    sp.on('data', d => { buf += d.toString('latin1'); });
    sp.on('error', e => { clearTimeout(fim); resolve({ ok: false, msg: e.message }); });
  });
}
module.exports = { readScale };
