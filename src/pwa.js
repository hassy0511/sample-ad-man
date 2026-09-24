// ホーム画面への追加（PWA）とアプリ表示時の調整

const standalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function setupPwa() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  document.documentElement.classList.toggle('is-app', standalone());

  const btn = document.getElementById('btn-install');
  const sheet = document.getElementById('install-sheet');
  if (!btn || !sheet) return;
  let deferred = null;
  const touch = matchMedia('(pointer: coarse)').matches;

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!standalone()) btn.hidden = false;
  });
  addEventListener('appinstalled', () => {
    btn.hidden = true;
    deferred = null;
  });
  // iOS はインストール用のイベントがないので、手順を案内する
  if (!standalone() && (isIOS || touch)) btn.hidden = false;

  btn.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      return;
    }
    document.getElementById('install-ios').hidden = !isIOS;
    document.getElementById('install-android').hidden = isIOS;
    sheet.hidden = false;
  });
  document.getElementById('install-close').addEventListener('click', () => {
    sheet.hidden = true;
  });

  // ダブルタップやピンチでの拡大を防ぐ（iOS Safari は viewport 指定を無視するため）
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouch < 300 && !e.target.closest('button, a')) e.preventDefault();
    lastTouch = now;
  }, { passive: false });
}
