/**
 * Clawd's sound effects, played here in the background page for every overlay and the
 * sidebar (a web page's own autoplay rules don't apply), with an on/off setting.
 */
import { addOwnCommands, addPublicCommands } from './init';
import { playSound } from '@/common/clawd-sound';

const KEY = 'clawdifySound';
let settings = { enabled: true, volume: 0.35 };
const lastPlayed = new Map();

browser.storage.local.get(KEY).then(r => { settings = { ...settings, ...r[KEY] }; }, () => {});

addPublicCommands({
  /** From an overlay or the sidebar: play one of Clawd's sounds. */
  ClawdSound({ name } = {}, src) {
    if (!settings.enabled) return;
    if (src && src.tab && !src.tab.active) return; // only the tab you're looking at
    // Several Clawds (or a burst) shouldn't stack the same sound into a din.
    const now = Date.now();
    if (now - (lastPlayed.get(name) || 0) < 45) return;
    lastPlayed.set(name, now);
    playSound(String(name), settings.volume);
  },
});

addOwnCommands({
  ClawdSoundGet() {
    return settings;
  },
  async ClawdSoundSet({ enabled, volume } = {}) {
    if (enabled != null) settings.enabled = !!enabled;
    if (volume != null) settings.volume = Math.max(0, Math.min(1, +volume));
    await browser.storage.local.set({ [KEY]: settings });
    if (enabled) playSound('boop', settings.volume);
  },
});
