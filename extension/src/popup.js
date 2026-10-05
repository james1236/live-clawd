/** The toolbar popup: on/off, mute this dev page, sounds, and the optional capture permission. */
import { api } from './api';

const $ = id => document.getElementById(id);
const ask = (cmd, data) => api.runtime.sendMessage({ cmd, data });
let url = '';

async function render() {
  const st = await ask('LiveGet', { url });
  $('enabled').checked = st.enabled;
  $('sound').checked = st.sound;
  $('muteRow').hidden = !st.local;
  $('muted').checked = st.muted;
  $('status').className = `status ${st.connected ? 'on' : 'off'}`;
  $('status').textContent = !st.enabled ? 'Off' : st.connected ? 'Connected to Claude Code' : 'Waiting for Claude Code';
  $('help').hidden = !st.enabled || st.connected;
  $('captureRow').hidden = st.capture;
}

(async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  url = (tab && tab.url) || '';
  await render();
  $('enabled').onchange = async e => { await ask('LiveSet', { enabled: e.target.checked }); setTimeout(render, 300); };
  $('sound').onchange = e => ask('LiveSet', { sound: e.target.checked });
  $('muted').onchange = e => ask('LiveSet', { url, muted: e.target.checked });
  // Must be asked from the click itself.
  $('capture').onclick = async () => {
    await api.permissions.request({ origins: ['<all_urls>'] });
    await ask('CaptureAsked');
    render();
  };
})();
