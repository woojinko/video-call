// Exposed by desktop/src/preload.ts via contextBridge. Undefined when running in a plain browser.
interface DesktopBridge {
  platform: string;
  versions: { electron: string; chrome: string };
}

interface Window {
  desktop?: DesktopBridge;
}

interface ImportMetaEnv {
  readonly VITE_SIGNALING_URL?: string;
}
