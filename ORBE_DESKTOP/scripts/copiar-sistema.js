// Copia a versão mais recente do sistema (ORBE_SITE/app) para dentro do instalável.
const fs = require('fs'), path = require('path');
const candidatos = [path.join(__dirname, '..', '..', 'ORBE_SITE', 'app'), path.join(__dirname, '..', 'sistema')];
const origem = candidatos.find(p => fs.existsSync(path.join(p, 'index.html')));
if (!origem) { console.error('Não achei o sistema. Coloque a pasta ORBE_SITE ao lado de ORBE_DESKTOP (ou o index.html em ORBE_DESKTOP/sistema).'); process.exit(1); }
const destino = path.join(__dirname, '..', 'www');
fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(origem, destino, { recursive: true });
const icons = path.join(__dirname, '..', '..', 'ORBE_SITE', 'icons');
if (fs.existsSync(icons)) fs.cpSync(icons, path.join(destino, 'icons'), { recursive: true });
console.log('Sistema copiado de', origem);
