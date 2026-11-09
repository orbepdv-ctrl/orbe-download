const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('info');
contextBridge.exposeInMainWorld('orbeDesktop', {
  isDesktop: true,
  version: info.version,
  autostart: info.autostart,
  telaCheia: info.telaCheia,
  upd: info.upd,
  setTelaCheia: on => ipcRenderer.invoke('telacheia', on),
  setAutostart: on => ipcRenderer.invoke('autostart', on),
  printers: () => ipcRenderer.invoke('printers'),
  print: o => ipcRenderer.invoke('print', o),          // { printer, a4, copies }
  openDrawer: o => ipcRenderer.invoke('drawer', o),    // { host, port, printer }
  scaleRead: o => ipcRenderer.invoke('scale', o),      // { port, baud }
  wa: {
    status: () => ipcRenderer.invoke('wa:status'),
    conectar: () => ipcRenderer.invoke('wa:conectar'),
    desconectar: () => ipcRenderer.invoke('wa:desconectar'),
    enviar: o => ipcRenderer.invoke('wa:enviar', o),   // { fone, texto }
    aoMudar: fn => ipcRenderer.on('wa:status', (_e, s) => fn(s)),
    conversas: () => ipcRenderer.invoke('wa:conversas'),
    mensagens: jid => ipcRenderer.invoke('wa:mensagens', jid),
    responder: o => ipcRenderer.invoke('wa:responder', o),   // { jid, texto }
    lido: jid => ipcRenderer.invoke('wa:lido', jid),
    aoMsg: fn => ipcRenderer.on('wa:msg', (_e, x) => fn(x))
  }
});
