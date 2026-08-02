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
});
