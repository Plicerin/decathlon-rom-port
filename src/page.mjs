// the page: mounts the player and runs the full-screen button
import { mountPlayer } from './decathlonPlayer.mjs?v=9794fb5e';
const shell = document.getElementById('play');
window.__decathlon = mountPlayer(shell.parentElement);
// full screen: the browser's own where allowed (desktop, Android, iPad), and
// the same layout without it on iPhone, where only video may go fullscreen
const root = document.documentElement;
const nativeElement = () => document.fullscreenElement || document.webkitFullscreenElement;
const canNative = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const setFull = (on) => {
  document.body.classList.toggle('fs', on);
  shell.querySelector('canvas:not([data-view3d])').focus({ preventScroll: true });
};
const enter = () => {
  setFull(true);
  if (canNative) (root.requestFullscreen || root.webkitRequestFullscreen)?.call(root)?.catch?.(() => {});
};
const leave = () => {
  if (nativeElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  setFull(false);
};
document.getElementById('lp-fullscreen').addEventListener('click', () => (document.body.classList.contains('fs') ? leave() : enter()));
shell.querySelector('[data-exit]').addEventListener('click', leave);
for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(event, () => { if (!nativeElement()) setFull(false); });
}
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('fs') && !nativeElement()) leave(); });
