import { contextBridge } from 'electron';

// Expose a minimal, read-only surface to the renderer. Never expose ipcRenderer
// or Node APIs directly — the renderer should stay a sandboxed web page.
contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
});
