// LED screen (screen.php): shows the countdown the control room sets, in step with every other screen.
(function () {
  'use strict';
  var el = document.querySelector('[data-screen]');
  if (!el || !window.Countdown) return;
  var C = window.Countdown;

  var feed = el.getAttribute('data-feed');
  var data = JSON.parse(document.getElementById('screen-data').textContent);
  var clock = new C.Clock();
  clock.addPage(data);
  var reloadAt = data.reload;
  var name = new URLSearchParams(location.search).get('name') || '';
  var screenId = (function () {
    var id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { // one id per tab, kept across reloads
      id = sessionStorage.getItem('countdown_screen') || id;
      sessionStorage.setItem('countdown_screen', id);
    } catch (e) { /* private mode */ }
    return id;
  })();

  // Draws the screen, then again the moment the next second is due (at least once a second)
  var drawTimer = null;
  function draw() {
    clearTimeout(drawTimer);
    var t = clock.now();
    document.body.style.background = data.bg;
    C.render(el, data, t);
    drawTimer = setTimeout(draw, Math.min(1000, C.untilNext(data, t) * 1000 + 2));
    if (clock.jumped()) restart(); // the computer slept or its time was changed
  }

  // Checks in over and over: reports this screen and picks up any change from the control room. The server holds
  // each check-in until something changes (up to 15 seconds), so a change shows on every screen at once.
  // The first few come back straight away, to set the clock quickly.
  var quick = 3;
  var current = null; // the check-in on its way
  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    if (current && current.ctrl) current.ctrl.abort();
    var me = current = { ctrl: window.AbortController ? new AbortController() : null };
    var wait = quick-- <= 0;
    var sent = C.mono();
    var got = 0;
    var next = 0;
    var params = '&state=1&screen=' + screenId + '&etag=' + (data.etag || '') + (wait ? '&wait=1' : '') +
      '&size=' + window.innerWidth + 'x' + window.innerHeight + (name ? '&name=' + encodeURIComponent(name) : '');
    // stop waiting for an answer that will never come (e.g. the network dropped halfway)
    var giveUp = setTimeout(function () { if (me.ctrl) me.ctrl.abort(); }, wait ? 30000 : 10000);
    fetch(feed + params, { cache: 'no-store', signal: me.ctrl ? me.ctrl.signal : undefined })
      .then(function (r) { got = C.mono(); return r.json(); })
      .then(function (d) {
        if (d.error) { // the link was replaced: go blank
          data.view = 'standby';
          data.etag = '';
          next = 10000;
          return draw();
        }
        clock.add(sent, got, d);
        if (d.same) {
          // a held check-in that came straight back means the server can't hold them: check in every 2 seconds
          next = !wait ? 300 : C.mono() - sent < 1 ? 2000 : 0;
          return;
        }
        if (d.reload !== reloadAt) return location.reload();
        data = d;
        draw();
      })
      .catch(function () { // keep counting with what we have, and set the clock again once back
        if (current !== me) return;
        next = 2000;
        quick = 2;
      })
      .then(function () {
        clearTimeout(giveUp);
        if (current === me) pollTimer = setTimeout(poll, next);
      });
  }

  // Check in again at once, with a few quick ones to set the clock
  function restart() {
    quick = 2;
    poll();
  }

  draw();
  poll();
  window.addEventListener('resize', draw);
  window.addEventListener('online', restart);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') restart();
  });
  if (document.fonts) { // fit again once a font arrives, e.g. the gold digits after switching looks
    document.fonts.ready.then(function () { C.refit(el); draw(); });
    document.fonts.addEventListener('loadingdone', function () { C.refit(el); draw(); });
  }

  // Double-click (or tap twice) for full screen
  document.addEventListener('dblclick', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });

  // Hide the mouse pointer when it isn't moving
  var idle = null;
  document.addEventListener('mousemove', function () {
    document.body.classList.remove('is-idle');
    clearTimeout(idle);
    idle = setTimeout(function () { document.body.classList.add('is-idle'); }, 2500);
  });

  // Keep the display awake
  function stayAwake() {
    if (navigator.wakeLock && document.visibilityState === 'visible') {
      navigator.wakeLock.request('screen').catch(function () {});
    }
  }
  document.addEventListener('visibilitychange', stayAwake);
  stayAwake();
})();
