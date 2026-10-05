/** Chrome only: an offscreen page that plays Clawd's sounds (its service worker has no audio). */
import { api } from './api';
import { playSound } from './clawd-sound';

api.runtime.onMessage.addListener(msg => {
  if (msg && msg.cmd === 'OffscreenSound') playSound(String(msg.data.name), msg.data.volume);
});
