'use strict';
window.DisplayApp = (() => {
  if (!location.pathname.startsWith('/display/')) return null;
  const element = id => document.getElementById(id);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const storageKey = 'stage-time:last-display';
  const launcher = location.pathname === '/display/';
  if (!launcher) {
    try { parseDisplayLink(location.href, location.origin); }
    catch { location.replace('/display/?join=1'); return null; }
  }
  let stream, frame, scanning = false, scanGeneration = 0, installPrompt;

  const manifest = document.createElement('link');
  manifest.rel = 'manifest'; manifest.href = '/static/display.webmanifest'; document.head.append(manifest);
  const appleIcon = document.createElement('link');
  appleIcon.rel = 'apple-touch-icon'; appleIcon.href = '/static/icons/apple-touch-icon.png'; document.head.append(appleIcon);
  for (const [name, content] of [['theme-color', '#080909'], ['apple-mobile-web-app-capable', 'yes'],
    ['apple-mobile-web-app-title', 'Stage time Display'], ['apple-mobile-web-app-status-bar-style', 'black']]) {
    const meta = document.createElement('meta'); meta.name = name; meta.content = content; document.head.append(meta);
  }
  document.title = 'Stage time Display';
  element('installDisplay').hidden = standalone();
  element('displayLauncher').hidden = !launcher;
  if (launcher) { element('landing').hidden = true; element('appHeader').hidden = true; }
  function notice(text) { element('joinStatus').textContent = text; }
  function forget() { try { localStorage.removeItem(storageKey); } catch {} }
  function readSaved() {
    try { const saved = localStorage.getItem(storageKey); return saved ? parseDisplayLink(saved, location.origin) : null; }
    catch { forget(); return null; }
  }
  function stopScan() {
    scanning = false; scanGeneration++; cancelAnimationFrame(frame);
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    element('scanVideo').srcObject = null; element('scanner').hidden = true;
    element('scanDisplay').disabled = false;
  }
  function join(value) {
    try { const url = parseDisplayLink(value.trim(), location.origin); stopScan(); location.assign(url); }
    catch (error) { notice(error.message); }
  }
  function loadDecoder() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = '/static/vendor/jsQR.js';
      script.onload = resolve; script.onerror = () => { script.remove(); reject(Error('QR scanner could not load. Paste the display link instead.')); };
      document.head.append(script);
    });
  }
  async function startScan() {
    stopScan();
    const generation = scanGeneration;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      notice('Camera scanning requires HTTPS and a supported browser. Paste the display link instead.'); return;
    }
    element('scanDisplay').disabled = true; notice('');
    try {
      await loadDecoder();
      if (generation !== scanGeneration) return;
      const camera = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
      if (generation !== scanGeneration) { camera.getTracks().forEach(track => track.stop()); return; }
      stream = camera; scanning = true; element('scanner').hidden = false;
      const video = element('scanVideo'); video.srcObject = stream; await video.play();
      if (generation !== scanGeneration) return;
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d', {willReadFrequently: true});
      let lastScan = 0;
      function scan(timestamp) {
        if (!scanning || generation !== scanGeneration) return;
        try {
          if (video.readyState >= 2 && timestamp - lastScan >= 180) {
            lastScan = timestamp;
            const scale = Math.min(1, 960 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(pixels.data, pixels.width, pixels.height, {inversionAttempts: 'attemptBoth'});
            if (code) {
              try { const url = parseDisplayLink(code.data, location.origin); stopScan(); location.assign(url); return; }
              catch (error) { notice(error.message); }
            }
          }
          frame = requestAnimationFrame(scan);
        } catch { stopScan(); notice('Camera scanning failed. Paste the display link instead.'); }
      }
      frame = requestAnimationFrame(scan);
    } catch (error) {
      if (generation !== scanGeneration) return;
      stopScan(); notice(error.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in site settings, or paste the display link.' : 'Camera unavailable. Paste the display link instead.');
    }
  }
  element('scanDisplay').onclick = startScan;
  element('cancelScan').onclick = () => { stopScan(); notice(''); };
  element('joinDisplay').onsubmit = event => { event.preventDefault(); join(element('joinLink').value); };
  element('changeDisplay').onclick = () => location.assign('/display/?join=1');
  element('forgetDisplay').onclick = () => { forget(); location.assign('/display/?join=1'); };
  element('resumeDisplay').onclick = () => { const saved = readSaved(); if (saved) join(saved); };
  element('forgetSavedDisplay').onclick = () => { forget(); element('savedDisplayActions').hidden = true; notice('Saved display forgotten.'); };
  function showInstall() {
    element('installHelp').hidden = false;
    element('installInstructions').textContent = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
      ? 'In Safari, open Share, choose Add to Home Screen, leave Open as Web App enabled if shown, then tap Add. Launch Stage time Display from its icon and scan the QR here. Camera-app links may still open in your browser.'
      : 'Use your browser menu to install Stage time Display or add it to your Home Screen. Open the installed app and scan the QR to join a timer.';
  }
  element('installDisplay').onclick = async () => {
    if (!installPrompt) { showInstall(); return; }
    const prompt = installPrompt; installPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; } catch { showInstall(); }
  };
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
  window.addEventListener('appinstalled', () => { installPrompt = null; element('installDisplay').hidden = true; element('installHelp').hidden = true; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });
  window.addEventListener('pagehide', stopScan);
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/display/sw.js', {scope: '/display/', updateViaCache: 'none'}).then(registration => {
      function updateNotice() { if (registration.waiting) element('displayUpdate').hidden = false; }
      updateNotice(); registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', updateNotice);
      });
    }).catch(() => { if (launcher) notice('Offline installation unavailable. You can still join a display while online.'); });
  }
  if (launcher) {
    const saved = readSaved(), params = new URLSearchParams(location.search);
    element('savedDisplayActions').hidden = !saved;
    if (params.get('expired') === '1') notice('This display link expired or was replaced. Scan or paste a current link.');
    else if (saved && !params.has('join')) location.replace(saved);
    else if (navigator.onLine === false) notice('Offline. Joining a live timer requires a network connection.');
  }
  return {
    standalone,
    authenticated() {
      try { localStorage.setItem(storageKey, parseDisplayLink(location.href, location.origin)); }
      catch { element('wake').textContent = 'Session storage unavailable; rejoin after closing the app.'; }
    },
    invalid() { forget(); stopScan(); location.replace('/display/?join=1&expired=1'); },
  };
})();