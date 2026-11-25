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
  var name = new URLSearchParams(location.search).get('name') || el.getAttribute('data-face') || '';
  var screenId = (function () {
    var id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { // one id per tab, kept across reloads
      id = sessionStorage.getItem('countdown_screen') || id;
      sessionStorage.setItem('countdown_screen', id);
    } catch (e) { /* private mode */ }
    return id;
  })();

  // The sides of the monolith show fixed words until the reveal video (SCREEN_WORDS in includes/timer.php), drawn
  // by assets/js/timer.js from the list in data-words. data-face holds the face's display name ("Sides"), not the
  // face in the link, so it is never compared on its own: data-face-id carries the face from the link ("side").
  // A page from an older screen.php has no list, so its name is matched too, whatever its case, and the words are
  // put in here.
  var WORDS = ['zero', 'zero', 'zero']; // only for that older page; screen.php sends SCREEN_WORDS
  var faceId = (el.getAttribute('data-face-id') || el.getAttribute('data-face') || '').trim().toLowerCase();
  if (!el.getAttribute('data-words') && (faceId === 'side' || faceId === 'sides')) {
    el.setAttribute('data-words', JSON.stringify(WORDS));
    el.classList.add('is-words');
    el.innerHTML = '';
  }

  // A face of the monolith is laid out in its own shape and stretched to fill the window (assets/css/screen.css).
  // Worked out from the window and the face's shape, not from the laid out face, and again on every draw, so the
  // face fills the window even if the browser never said it changed size.
  var ratio = parseFloat(el.style.getPropertyValue('--ratio'));
  function stretch() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (!el.hasAttribute('data-face') || !(ratio > 0) || !w || !h) return;
    el.style.setProperty('--sx', (w / Math.min(w, h * ratio)).toFixed(4));
    el.style.setProperty('--sy', (h / Math.min(h, w / ratio)).toFixed(4));
  }

  // Draws the screen, then again the moment the next second or the reveal video is due (at least once a second).
  // Also called whenever the clock is corrected, so the next second still lands on time.
  var drawTimer = null;
  function draw() {
    clearTimeout(drawTimer);
    var t = clock.now();
    stretch();
    document.body.style.background = data.bg;
    if ('reveal' in data) el.setAttribute('data-reveal', data.reveal); // a new video from the control room
    C.render(el, data, t);
    drawTimer = setTimeout(draw, Math.min(1000, C.untilNext(data, t) * 1000 + 2));
    if (clock.jumped()) restart(); // the computer slept or its time was changed
  }

  // Lays the screen out again for a new window size or once a font has arrived
  function refit() {
    C.refit(el);
    draw();
  }

  // Checks in over and over: reports this screen and picks up any change from the control room. The server holds
  // each check-in until something changes (up to 15 seconds), so a change shows on every screen at once.
  // The first few come back straight away, to set the clock quickly.
  var quick = 5;
  var current = null; // the check-in on its way
  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    if (current && current.ctrl) current.ctrl.abort();
    var me = current = { ctrl: window.AbortController ? new AbortController() : null };
    var wait = quick-- <= 0;
    var sent = C.mono();
    var got = 0;
    var url = '';
    var next = 0;
    var params = '&state=1&screen=' + screenId + '&etag=' + (data.etag || '') + (wait ? '&wait=1' : '') +
      '&size=' + el.clientWidth + 'x' + el.clientHeight + (name ? '&name=' + encodeURIComponent(name) : '');
    // stop waiting for an answer that will never come (e.g. the network dropped halfway)
    var giveUp = setTimeout(function () { if (me.ctrl) me.ctrl.abort(); }, wait ? 30000 : 10000);
    fetch(feed + params, { cache: 'no-store', signal: me.ctrl ? me.ctrl.signal : undefined })
      .then(function (r) { got = C.mono(); url = r.url; return r.json(); })
      .then(function (d) {
        if (d.error) { // the link was replaced: go blank
          data.view = 'standby';
          data.etag = '';
          next = 10000;
          return draw();
        }
        var moved = clock.add(sent, got, d, url);
        if (d.same) {
          // a held check-in that came straight back means the server can't hold them: check in every 2 seconds
          next = !wait ? 200 : C.mono() - sent < 1 ? 2000 : 0;
          if (moved) draw();
          return;
        }
        if (d.reload !== reloadAt) return location.reload();
        data = d;
        draw();
      })
      .catch(function () { // keep counting with what we have, and set the clock again once back
        if (current !== me) return;
        next = 2000;
        quick = 3;
      })
      .then(function () {
        clearTimeout(giveUp);
        me.done = true;
        if (current !== me) return;
        // straight on without a timer when there's no pause: browsers hold timers back in tabs that aren't
        // showing, but not answers, so a hidden screen keeps checking in and stays up to date
        if (next) pollTimer = setTimeout(poll, next);
        else poll();
      });
  }

  // Check in again at once, with a few quick ones to set the clock
  function restart() {
    quick = 3;
    poll();
  }

  // Showing again (another tab was in front, or the browser paused the page): draw the right second at once,
  // before the browser shows the page, and check in now unless a check-in is already on its way. That one is
  // left running, so switching tabs doesn't pile up held requests on the server.
  function wake() {
    if (document.visibilityState !== 'visible') return;
    draw();
    if (!current || current.done) restart();
  }

  draw();
  poll();
  window.addEventListener('resize', refit);
  window.addEventListener('online', restart);
  document.addEventListener('visibilitychange', wake);
  document.addEventListener('resume', wake); // the browser froze the page in the background and let it go again
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return; // the browser brought the page back from its back / forward cache
    draw();
    restart();
  });
  if (document.fonts) { // fit again once a font arrives, e.g. the gold digits after switching looks
    document.fonts.ready.then(refit);
    document.fonts.addEventListener('loadingdone', refit);
  }

  // Double-click (or tap twice) for full screen
  document.addEventListener('dblclick', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });

  // Hide the mouse pointer when it isn't moving, from the moment the screen opens
  document.body.classList.add('is-idle');
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
