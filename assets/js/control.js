// Control room (admin/index.php): keeps itself up to date, sends button presses in the background
// and shows a live preview of the screen.
(function () {
  'use strict';
  var root = document.querySelector('[data-control]');
  if (!root || !window.Countdown || !window.Admin) return;
  var C = window.Countdown;
  var A = window.Admin;
  var $ = function (sel) { return root.querySelector(sel); };

  var form = document.getElementById('cr');
  var csrf = form.querySelector('[name=csrf]').value;
  var pollUrl = root.getAttribute('data-poll');
  var previewBox = $('.stage__preview');
  var preview = $('[data-cr-preview]');
  var screenEl = $('[data-cr-screen]');

  var data = JSON.parse(document.getElementById('cr-data').textContent);
  var serverClock = new C.Clock();
  serverClock.addPage(data);
  var html = data.html;                       // what each region shows now
  var ratio = 16 / 9;
  var busy = 0;
  var actions = 0; // count of button presses sent, so a slow poll can't undo a newer answer
  var pollTimer = null;
  var lastClicked = null;

  var STATUS = { ready: 'Ready', running: 'Running', paused: 'Paused', ended: 'Time’s up' };

  function now() { return serverClock.now(); }

  function isLive(s) { return s.status === 'running' && C.left(s, now()) > 0; }

  // A server timestamp as a time of day in the admin's own time zone
  function clock(ts) {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }

  // Swaps a region's HTML
  function swap(name, markup) {
    var region = $('[data-cr-region="' + name + '"]');
    if (!region || html[name] === markup) return;
    region.innerHTML = markup;
    html[name] = markup;
  }

  // Fits the preview into its box with the same shape as the real screen
  function sizePreview() {
    var w = Math.min(previewBox.clientWidth, previewBox.clientHeight * ratio);
    preview.style.width = Math.floor(w) + 'px';
    preview.style.height = Math.floor(w / ratio) + 'px';
  }

  // New data from the server
  function apply(d) {
    if (d.same) return;
    data = d;
    var s = d.state;
    Object.keys(d.html).forEach(function (name) { swap(name, d.html[name]); });
    root.querySelectorAll('[data-cr-view]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-cr-view') === s.view ? 'true' : 'false');
    });
    var online = $('[data-cr-online]');
    online.classList.toggle('is-online', d.online > 0);
    $('[data-cr-online-text]').textContent = d.online ? d.online + ' screen' + (d.online === 1 ? '' : 's') + ' connected' : 'No screen connected';

    var m = /^(\d+)x(\d+)$/.exec(d.size || '');
    ratio = m ? m[1] / m[2] : 16 / 9;
    sizePreview();
    tick();
  }

  // Runs 10 times a second: status, the big readout and the preview
  function tick() {
    var s = data.state;
    var t = now();
    var left = C.left(s, t);
    var status = s.status === 'running' && left <= 0 ? 'ended' : s.status;
    root.setAttribute('data-status', status);
    $('[data-cr-pill]').textContent = STATUS[status];
    $('[data-cr-readout]').textContent = C.format(left);

    var meta = 'Set to ' + C.format(s.duration);
    if (status === 'running') meta = 'Ends at ' + clock(s.ends_at);
    if (status === 'ended') meta = 'Ended at ' + clock(s.ends_at);
    $('[data-cr-meta]').textContent = meta;

    $('[data-cr-toggle]').disabled = status === 'ended';
    $('[data-cr-start-label]').textContent = s.status === 'paused' ? 'Resume' : 'Start';

    var note = '';
    if (s.view === 'standby') note = 'The screen is blank.';
    if (s.view === 'message') note = 'The screen shows your message.';
    if (note && status === 'running') note += ' The timer keeps counting behind it.';
    $('[data-cr-view-note]').textContent = note;

    C.render(screenEl, s, t);
  }

  /* ---- talking to the server */

  function poll() {
    clearTimeout(pollTimer);
    var sent = C.mono();
    var got = 0;
    var seen = actions;
    fetch(pollUrl + '&etag=' + encodeURIComponent(data.etag), { headers: { 'X-Requested-With': 'fetch' }, cache: 'no-store' })
      .then(function (r) { got = C.mono(); return r.json(); })
      .then(function (d) {
        if (d.signed_out) return signedOut(d.error);
        serverClock.add(sent, got, d);
        root.classList.remove('is-offline');
        if (!busy && seen === actions) apply(d);
      })
      .catch(function () { root.classList.add('is-offline'); })
      .then(function () {
        if (!root.classList.contains('is-signed-out')) {
          pollTimer = setTimeout(poll, document.visibilityState === 'visible' ? 2000 : 10000);
        }
      });
  }

  function signedOut(message) {
    root.classList.add('is-signed-out');
    A.toast(message, true);
    setTimeout(function () { location.reload(); }, 1500);
  }

  function send(body, button) {
    body.set('csrf', csrf);
    busy++;
    actions++;
    if (button) button.classList.add('is-busy');
    var sent = C.mono();
    var got = 0;
    return fetch(location.pathname, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, body: body })
      .then(function (r) { got = C.mono(); return r.json(); })
      .then(function (d) {
        busy--;
        if (d.signed_out) return signedOut(d.error);
        serverClock.add(sent, got, d);
        apply(d);
        A.toast(d.toast, !d.ok);
        return d;
      })
      .catch(function () {
        busy--;
        A.toast('Could not reach the server. Check your connection and try again.', true);
      })
      .then(function (d) {
        if (button) button.classList.remove('is-busy');
        return d;
      });
  }

  // Remember which button submitted (older browsers don't have e.submitter). A mouse click also drops
  // focus from the button, so Space goes back to start / pause instead of pressing it again.
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button');
    if (!b) return;
    if (b.name) lastClicked = b;
    if (e.detail > 0) setTimeout(function () { b.blur(); }, 0);
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.hasAttribute('data-cr-form')) return;
    e.preventDefault();
    var button = e.submitter || lastClicked;
    var value = button ? button.value : '';
    var s = data.state;

    var ask = null;
    if (value === 'reset' && isLive(s)) ask = ['Reset the timer? The screen goes back to ' + C.format(s.duration) + '.', 'Reset'];
    if (/^(set|set:start|until)$/.test(value) && isLive(s)) ask = ['Replace the running timer? It has ' + C.format(C.left(s, now())) + ' left.', 'Replace'];

    (ask ? A.confirm(ask[0], ask[1]) : Promise.resolve(true)).then(function (ok) {
      if (!ok) return;
      var body = new URLSearchParams();
      new FormData(f).forEach(function (v, k) { body.append(k, v); });
      if (button && button.name) body.set(button.name, button.value);
      if (value === 'until' && f.elements.until.value) {
        // the end time typed in the admin's own time zone, on the server clock (not this computer's, which may be off)
        body.set('until_ts', String(new Date(f.elements.until.value).getTime() / 1000));
      }
      send(body, button).then(function (d) {
        if (d && d.ok && f.querySelector('[data-cr-message]')) {
          f.reset();
          countChars();
        }
      });
    });
  });

  /* ---- quick times fill in the fields */
  root.querySelectorAll('[data-cr-preset]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var secs = +chip.getAttribute('data-cr-preset');
      var f = $('[data-cr-set]');
      f.elements.h.value = Math.floor(secs / 3600);
      f.elements.m.value = Math.floor(secs % 3600 / 60);
      f.elements.s.value = secs % 60;
    });
  });

  /* ---- "Ends at" starts one hour ahead (rounded up to a quarter hour) in the admin's own time zone */
  (function () {
    var input = $('[data-cr-until]').elements.until;
    var d = new Date(Math.ceil((now() * 1000 + 3600000) / 900000) * 900000);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    input.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  })();

  /* ---- message box */
  var messageBox = $('[data-cr-message]');
  var counter = $('[data-cr-count]');
  function countChars() { counter.textContent = messageBox.value.length + '/120'; }
  messageBox.addEventListener('input', countChars);
  countChars();
  $('[data-cr-goto-message]').addEventListener('click', function () {
    document.getElementById('message').scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { messageBox.focus({ preventScroll: true }); }, 300);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') poll();
  });
  window.addEventListener('resize', sizePreview);
  if (document.fonts) document.fonts.ready.then(function () { C.refit(screenEl); tick(); });

  apply(data);
  setInterval(tick, 100);
  pollTimer = setTimeout(poll, 2000);
})();
