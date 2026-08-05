const { contextBridge, ipcRenderer } = require('electron');

// Exposes a minimal, safe bridge for the renderer (the React app) to reach
// OS-level printing — this is what makes "set a default printer once, then
// every receipt prints silently with no dialog" possible. None of this exists
// in a plain browser tab; the renderer feature-detects via window.electronAPI
// and falls back to window.print() when it's undefined.
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  printSilent: (html, printerName) => ipcRenderer.invoke('printer:print', { html, printerName }),

  // Ethernet weighing scale — raw TCP socket, main-process only (renderers
  // can't open TCP sockets). Data/close arrive as push events since this is
  // a continuous stream, not a request/response call.
  connectScale: (host, port) => ipcRenderer.invoke('scale:connect', { host, port }),
  disconnectScale: () => ipcRenderer.invoke('scale:disconnect'),
  onScaleData: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on('scale:data', listener);
    return () => ipcRenderer.removeListener('scale:data', listener);
  },
  onScaleClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('scale:closed', listener);
    return () => ipcRenderer.removeListener('scale:closed', listener);
  },
});
