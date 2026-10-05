/** The page opened on install: asks for the optional permission to take before-pictures. */
import { api } from './api';

const $ = id => document.getElementById(id);
const done = () => { $('ask').hidden = true; $('done').hidden = false; };

api.permissions.contains({ origins: ['<all_urls>'] }).then(has => { if (has) done(); });

// Is the Claude Code plugin there yet? (Only once a session with it is running.)
async function checkConnection() {
  let st = null;
  try { st = await api.runtime.sendMessage({ cmd: 'LiveGet', data: {} }); } catch { /* background starting */ }
  const on = !!(st && st.connected);
  $('status').className = `status ${on ? 'on' : ''}`;
  $('status').textContent = on ? 'Connected to Claude Code' : 'Not connected to Claude Code yet';
  $('plugin').hidden = on;
}
checkConnection();
setInterval(checkConnection, 2000);
// Must be asked from the click itself.
$('allow').onclick = async () => {
  if (await api.permissions.request({ origins: ['<all_urls>'] })) done();
  api.runtime.sendMessage({ cmd: 'CaptureAsked' });
};
$('skip').onclick = e => {
  e.preventDefault();
  api.runtime.sendMessage({ cmd: 'CaptureAsked' });
  done();
};
