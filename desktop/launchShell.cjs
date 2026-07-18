const normalizeIconDataUrl = (value = '') => {
    const normalized = String(value || '').trim();
    return /^data:image\/(?:png|webp);base64,[a-z0-9+/=]+$/i.test(normalized)
        ? normalized
        : '';
};

const buildLaunchShellHtml = ({ iconDataUrl = '' } = {}) => {
    const trustedIconDataUrl = normalizeIconDataUrl(iconDataUrl);
    const mark = trustedIconDataUrl
        ? `<img src="${trustedIconDataUrl}" alt="" width="58" height="58">`
        : '<span aria-hidden="true">A</span>';

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
  <title>Aura Desktop</title>
  <style>
    :root{color-scheme:dark;background:#202020}
    *{box-sizing:border-box}
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#202020}
    body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f8fafc}
    main{display:grid;width:100%;height:100%;place-items:center;padding:48px}
    .mark{display:grid;width:58px;height:58px;place-items:center;border-radius:15px;animation:aura-launch-breathe 1.8s ease-in-out infinite}
    .mark img{display:block;width:58px;height:58px;border-radius:15px;box-shadow:0 12px 36px rgba(0,0,0,.28)}
    .mark span{display:grid;width:58px;height:58px;place-items:center;border:1px solid #4a4a4a;border-radius:15px;background:#292929;color:#f8fafc;font-size:30px;font-weight:700}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @keyframes aura-launch-breathe{0%,100%{opacity:.72;transform:scale(.97)}50%{opacity:1;transform:scale(1)}}
    @media (prefers-reduced-motion:reduce){.mark{animation:none}}
  </style>
</head>
<body>
  <main role="status" aria-live="polite" aria-label="Aura Desktop is starting">
    <div class="mark">${mark}</div>
    <span class="sr-only">Aura Desktop is starting.</span>
  </main>
</body>
</html>`;
};

const buildLaunchShellDataUrl = (options = {}) => (
    `data:text/html;charset=utf-8,${encodeURIComponent(buildLaunchShellHtml(options))}`
);

module.exports = {
    buildLaunchShellDataUrl,
    buildLaunchShellHtml,
    normalizeIconDataUrl,
};
