(function () {
  // Service worker + offline caching is disabled during active development so every
  // page/script edit is always picked up fresh. Actively unregister and clear any
  // caches left over from earlier testing, then re-enable this at the PWA-polish stage.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
  }
  if ('caches' in window) {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
  }

  async function getCurrentUser() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) return null;
      return res.json();
    } catch (err) {
      return null;
    }
  }

  function buildFloatingButtons() {
    const wrap = document.createElement('div');
    wrap.className = 'floating-buttons';
    wrap.innerHTML = `
      <button class="fab companion" id="lp-companion-btn">Companion</button>
      <button class="fab emergency" id="lp-emergency-btn">Emergency</button>
    `;
    document.body.appendChild(wrap);
    return wrap;
  }

  function buildCompanionModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'lp-companion-modal';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal-sheet">
        <h2>Your Companion</h2>
        <div class="mic-indicator"><span class="mic-dot" id="lp-companion-dot"></span><span id="lp-companion-status">Connecting...</span></div>
        <button class="btn secondary" id="lp-companion-pause">Pause</button>
        <button class="btn outline" id="lp-companion-close">Done talking</button>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  // The call screen is a demo: it looks like a call but dials nothing. Flip this to true to
  // also open the phone's real dialer (tel:) when the Emergency button is pressed.
  const PLACE_REAL_CALL = false;

  let ringback = null;

  function startRingback() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      [440, 480].forEach((freq) => {
        const osc = ctx.createOscillator();
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start();
      });
      // US ringback cadence: 2s of tone, then 4s of quiet.
      let step = 0;
      const tick = () => {
        gain.gain.setTargetAtTime(step === 0 ? 0.05 : 0, ctx.currentTime, 0.02);
        step = (step + 1) % 3;
      };
      tick();
      ringback = { ctx, timer: setInterval(tick, 2000) };
    } catch (err) {
      ringback = null;
    }
  }

  function stopRingback() {
    if (!ringback) return;
    clearInterval(ringback.timer);
    try { ringback.ctx.close(); } catch (err) {}
    ringback = null;
  }

  // When the app is shown inside the demo phone frame, tell it which status bar colour to use.
  function setStatusBarStyle(style) {
    if (window.parent !== window) window.parent.postMessage({ lifepathStatusBar: style }, '*');
  }

  function closeCallScreen() {
    stopRingback();
    const el = document.getElementById('lp-call-screen');
    if (el) el.remove();
    setStatusBarStyle('dark');
  }

  function initialsOf(name) {
    return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  async function openEmergency() {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const profile = await res.json();
    const contact = profile.profile && profile.profile.emergencyContact;
    closeCallScreen();

    const screen = document.createElement('div');
    screen.className = 'call-screen';
    screen.id = 'lp-call-screen';
    setStatusBarStyle('light');

    if (contact && contact.name) {
      screen.innerHTML = `
        <div class="call-top">
          <div class="call-avatar">${escapeHtml(initialsOf(contact.name))}</div>
          <div class="call-name">${escapeHtml(contact.name)}</div>
          <div class="call-number">${escapeHtml(contact.phone || '')}</div>
          <div class="call-status">Calling<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
        </div>
        <div class="call-bottom">
          <button class="call-end" id="lp-call-end" aria-label="End Call">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="white"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
          </button>
          <div class="call-end-label">End Call</div>
        </div>`;
      document.body.appendChild(screen);
      document.getElementById('lp-call-end').addEventListener('click', closeCallScreen);
      startRingback();
      if (PLACE_REAL_CALL && contact.phone) {
        window.location.href = `tel:${contact.phone.replace(/[^0-9+]/g, '')}`;
      }
    } else {
      screen.innerHTML = `
        <div class="call-top">
          <div class="call-avatar">?</div>
          <div class="call-name">No emergency contact yet</div>
          <div class="call-status">Tell me about yourself and I'll set one up.</div>
        </div>
        <div class="call-bottom">
          <button class="btn secondary" id="lp-call-setup" style="max-width:280px;">Set it up now</button>
          <button class="btn outline" id="lp-call-close" style="max-width:280px; color:white; border-color:white;">Close</button>
        </div>`;
      document.body.appendChild(screen);
      document.getElementById('lp-call-setup').addEventListener('click', () => { window.location.href = '/wizard.html'; });
      document.getElementById('lp-call-close').addEventListener('click', closeCallScreen);
    }
  }

  // ---------- Shopping: arrival reminders ----------
  const ARRIVAL_RADIUS_METERS = 150;
  const ARRIVAL_COOLDOWN_MS = 45 * 60 * 1000;
  const SHOPPING_REFRESH_MS = 2 * 60 * 1000;

  function distanceMeters(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function closeArrivalModal() {
    const el = document.getElementById('lp-arrival-modal');
    if (el) el.remove();
  }

  async function showArrivalReminder(placeId) {
    const res = await fetch(`/api/shopping/places/${placeId}/arrive`, { method: 'POST' });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.items || data.items.length === 0) return false;

    closeArrivalModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'lp-arrival-modal';
    overlay.innerHTML = `
      <div class="modal-sheet">
        <h2>You're at ${escapeHtml(data.placeName)}</h2>
        <p style="margin-top:0;">Don't forget to pick up:</p>
        <ul class="arrival-list">${data.items.map((i) => `<li>${escapeHtml(i.item)}</li>`).join('')}</ul>
        <button class="btn secondary" id="lp-arrival-ok">Got it</button>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('lp-arrival-ok').addEventListener('click', closeArrivalModal);

    if (data.audioBase64) {
      const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
      const audio = new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })));
      audio.play().catch(() => {});
    }
    return true;
  }

  // Watches the phone's GPS while the app is open and reminds the person when they reach a
  // store that has items waiting. Only starts if location was already allowed and at least one
  // store has a saved location, so nobody gets a surprise permission prompt.
  async function startShoppingWatcher() {
    if (!navigator.geolocation || !navigator.permissions) return;
    try {
      const perm = await navigator.permissions.query({ name: 'geolocation' });
      if (perm.state !== 'granted') return;
    } catch (err) {
      return;
    }

    let data = null;
    let fetchedAt = 0;
    async function refresh() {
      const res = await fetch('/api/shopping');
      if (res.ok) {
        data = await res.json();
        fetchedAt = Date.now();
      }
    }
    await refresh();
    if (!data || !data.places.some((p) => p.lat != null && p.lng != null)) return;

    navigator.geolocation.watchPosition(
      async (pos) => {
        if (Date.now() - fetchedAt > SHOPPING_REFRESH_MS) await refresh();
        for (const place of data.places) {
          if (place.lat == null || place.lng == null) continue;
          const meters = distanceMeters(pos.coords.latitude, pos.coords.longitude, place.lat, place.lng);
          if (meters > ARRIVAL_RADIUS_METERS) continue;
          const hasItems = data.items.some((i) => !i.done && (i.placeId === place.id || !i.placeId));
          if (!hasItems) continue;
          const key = `lp_shop_last_${place.id}`;
          let last = 0;
          try { last = parseInt(localStorage.getItem(key) || '0', 10); } catch (err) {}
          if (Date.now() - last < ARRIVAL_COOLDOWN_MS) continue;
          try { localStorage.setItem(key, String(Date.now())); } catch (err) {}
          console.log(`[shopping] arrived at ${place.name} (${Math.round(meters)}m away) - showing reminder`);
          showArrivalReminder(place.id);
        }
      },
      (err) => console.log('[shopping] location unavailable:', err.message),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 }
    );
  }

  let companionSession = null;

  function toggleCompanion(overlay) {
    const isHidden = overlay.hidden;
    if (isHidden) {
      overlay.hidden = false;
      const dot = document.getElementById('lp-companion-dot');
      const status = document.getElementById('lp-companion-status');
      document.getElementById('lp-companion-pause').textContent = 'Pause';
      companionSession = window.RealtimeVoice.connect({
        path: '/ws/companion',
        onStatus: (s) => {
          status.textContent = s === 'listening' ? "I'm listening..." : s === 'speaking' ? 'Speaking...' : s === 'thinking' ? 'Got it, one moment...' : s === 'paused' ? "Paused - tap Resume when you're ready" : s;
          dot.className = 'mic-dot' + (s === 'listening' ? ' listening' : s === 'speaking' || s === 'thinking' ? ' speaking' : '');
        },
        onError: (msg) => { status.textContent = msg; }
      });
    } else {
      closeCompanion(overlay);
    }
  }

  function closeCompanion(overlay) {
    overlay.hidden = true;
    if (companionSession) {
      companionSession.stop();
      companionSession = null;
    }
  }

  async function init() {
    const user = await getCurrentUser();
    if (!user) return;

    buildFloatingButtons();
    const modal = buildCompanionModal();

    document.getElementById('lp-companion-btn').addEventListener('click', () => toggleCompanion(modal));
    document.getElementById('lp-companion-close').addEventListener('click', () => closeCompanion(modal));
    document.getElementById('lp-companion-pause').addEventListener('click', (e) => {
      if (!companionSession) return;
      if (companionSession.isPaused()) {
        companionSession.resume();
        e.target.textContent = 'Pause';
      } else {
        companionSession.pause();
        e.target.textContent = 'Resume';
      }
    });
    document.getElementById('lp-emergency-btn').addEventListener('click', openEmergency);

    startShoppingWatcher().catch((err) => console.log('[shopping] watcher not started:', err.message));
  }

  window.LifePathApp = { getCurrentUser, showArrivalReminder };
  document.addEventListener('DOMContentLoaded', init);
})();
