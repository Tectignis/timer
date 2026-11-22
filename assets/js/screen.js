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

  function draw() {
    document.body.style.background = data.bg;
    C.render(el, data, clock.now());
  }

  // Checks in every 2 seconds: reports this screen and picks up any change from the control room
  function poll() {
    var sent = C.mono();
    var got = 0;
    var params = '&state=1&screen=' + screenId + '&etag=' + (data.etag || '') +
      '&size=' + window.innerWidth + 'x' + window.innerHeight + (name ? '&name=' + encodeURIComponent(name) : '');
    fetch(feed + params, { cache: 'no-store' })
      .then(function (r) { got = C.mono(); return r.json(); })
      .then(function (d) {
        if (d.error) { // the link was replaced: go blank
          data.view = 'standby';
          data.etag = '';
          return draw();
        }
        clock.add(sent, got, d);
        if (d.same) return;
        if (d.reload !== reloadAt) return location.reload();
        data = d;
        draw();
      })
      .catch(function () { /* keep counting with what we have if the network drops */ })
      .then(function () { setTimeout(poll, 2000); });
  }

  draw();
  setInterval(draw, 100);
  setTimeout(poll, 1000);
  window.addEventListener('resize', draw);
  if (document.fonts) document.fonts.ready.then(function () { C.refit(el); draw(); });

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
