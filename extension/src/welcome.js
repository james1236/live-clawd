/** The page opened on install: asks for the optional permission to take before-pictures. */
import { api } from './api';

const $ = id => document.getElementById(id);
const done = () => { $('ask').hidden = true; $('done').hidden = false; };

api.permissions.contains({ origins: ['<all_urls>'] }).then(has => { if (has) done(); });
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
