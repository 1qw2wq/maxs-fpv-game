// Must be called synchronously from a user gesture. Never bypass iframe/browser
// permissions, and never substitute touch controls for denied desktop lock.
export async function requestMobileFullscreen(enabled, notify = () => {}) {
  if (!enabled || document.fullscreenElement || document.webkitFullscreenElement) return true;
  const root = document.documentElement;
  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  if (!request) {
    notify('此浏览器不支持全屏，请使用浏览器的「添加到主屏幕」后打开游戏。');
    return false;
  }
  try {
    await request.call(root, { navigationUI:'hide' });
    return true;
  } catch {
    notify('浏览器禁止了全屏。请在独立标签页打开游戏后重试全屏。');
    return false;
  }
}
