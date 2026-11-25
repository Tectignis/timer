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
    showVideo(d.video);
    tick();
    if (!sim) simDraw(); // e.g. a new look
  }

  // Status, the big readout and the preview. Runs again the moment the next second is due (at least once a second).
  var tickTimer = null;
  function tick() {
    clearTimeout(tickTimer);
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
    tickTimer = setTimeout(tick, Math.min(1000, C.untilNext(s, t) * 1000 + 2));
    if (serverClock.jumped()) poll(); // the computer slept or its time was changed: measure the clock again
  }

  /* ---- talking to the server */

  // fetch() that gives up after `secs`, so an answer lost on the way can't stall the page
  function request(url, options, secs) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var giveUp = setTimeout(function () { if (ctrl) ctrl.abort(); }, secs * 1000);
    options.signal = ctrl ? ctrl.signal : undefined;
    var done = function () { clearTimeout(giveUp); };
    var req = fetch(url, options);
    req.then(done, done);
    req.abort = function () { if (ctrl) ctrl.abort(); };
    return req;
  }

  var polling = null; // the check on its way
  function poll() {
    clearTimeout(pollTimer);
    if (polling) polling.abort();
    var sent = C.mono();
    var got = 0;
    var url = '';
    var seen = actions;
    var me = polling = request(pollUrl + '&etag=' + encodeURIComponent(data.etag), { headers: { 'X-Requested-With': 'fetch' }, cache: 'no-store' }, 10);
    me.then(function (r) { got = C.mono(); url = r.url; return r.json(); })
      .then(function (d) {
        if (d.signed_out) return signedOut(d.error);
        var moved = serverClock.add(sent, got, d, url);
        root.classList.remove('is-offline');
        if (!busy && seen === actions) apply(d);
        if (moved) tick(); // keep the preview's next second on time
      })
      .catch(function () { if (polling === me) root.classList.add('is-offline'); })
      .then(function () {
        if (polling !== me) return; // a newer check took over
        polling = null;
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
    body.set('at', now().toFixed(3)); // the moment of the press, so the timer starts or stops right on it
    busy++;
    actions++;
    if (button) button.classList.add('is-busy');
    var sent = C.mono();
    var got = 0;
    var url = '';
    return request(location.pathname, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, body: body }, 20)
      .then(function (r) { got = C.mono(); url = r.url; return r.json(); })
      .then(function (d) {
        busy--;
        if (d.signed_out) return signedOut(d.error);
        serverClock.add(sent, got, d, url);
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

  /* ---- after the timer: the reveal video */
  var videoBox = $('[data-video]');
  var videoInput = $('[data-video-input]');
  var videoChange = $('[data-video-change]');
  var shownVideo; // the address of the video the card shows
  var uploading = false;
  var PIECE = 8 * 1048576; // the video is sent in pieces this large (admin/video.php)

  function mb(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; }

  // The video's name, size, shape and length in the card, and the video the preview plays at zero
  function showVideo(v) {
    var url = v ? v.url : '';
    screenEl.setAttribute('data-reveal', url);
    sims.forEach(function (el) { el.setAttribute('data-reveal', url); });
    if (url === shownVideo) return;
    shownVideo = url;
    $('[data-video-name]').textContent = v ? v.name : 'No video yet';
    if (!uploading) videoChange.textContent = v ? 'Change video' : 'Add video';
    var meta = $('[data-video-meta]');
    meta.textContent = v ? mb(v.size) : 'Screens hold 00:00:00 at zero until one is added.';
    if (v) {
      probe(url).then(function (m) {
        if (m && shownVideo === url) meta.textContent = mb(v.size) + ' · ' + m.width + ' × ' + m.height + ' · ' + m.seconds.toFixed(1) + ' s';
      });
    }
  }

  // The video's shape and length, as the browser reads them: null when the browser can't play it
  function probe(src) {
    return new Promise(function (resolve) {
      var v = document.createElement('video');
      var done = function (m) {
        v.removeAttribute('src');
        v.load();
        resolve(m);
      };
      v.muted = true;
      v.preload = 'metadata';
      v.addEventListener('loadedmetadata', function () {
        done(v.videoWidth > 0 && v.duration > 0 ? { width: v.videoWidth, height: v.videoHeight, seconds: v.duration } : null);
      }, { once: true });
      v.addEventListener('error', function () { done(null); }, { once: true });
      v.src = src;
    });
  }

  videoInput.addEventListener('change', function () {
    var file = videoInput.files[0];
    videoInput.value = '';
    if (!file || uploading) return;
    var max = +videoBox.getAttribute('data-max');
    if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') return A.toast('Choose an MP4 video.', true);
    if (file.size > max) return A.toast('That video is larger than ' + Math.round(max / 1048576) + ' MB.', true);
    var local = URL.createObjectURL(file);
    probe(local).then(function (m) {
      URL.revokeObjectURL(local);
      if (!m) return A.toast('This video does not play in the browser. Save it as an MP4 (H.264) and try again.', true);
      return A.confirm('Play “' + file.name + '” after the timer? It takes the place of the current video on every screen.', 'Change video')
        .then(function (ok) { if (ok) upload(file); });
    });
  });

  // Sends the video in pieces, each tried again a few times if the network drops
  function upload(file) {
    uploading = true;
    videoInput.disabled = true;
    videoBox.classList.add('is-uploading');
    var bar = $('[data-video-progress]');
    bar.hidden = false;
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var id = Array.prototype.map.call(bytes, function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    var offset = 0;
    var tries = 0;

    function progress(sent) {
      var pct = Math.min(100, sent / file.size * 100);
      bar.firstChild.style.width = pct.toFixed(1) + '%';
      videoChange.textContent = 'Uploading ' + Math.floor(pct) + '%';
    }

    function finish(error, ok) {
      uploading = false;
      videoInput.disabled = false;
      videoBox.classList.remove('is-uploading');
      bar.hidden = true;
      bar.firstChild.style.width = '0';
      videoChange.textContent = data.video ? 'Change video' : 'Add video';
      A.toast(error || ok, !!error);
    }

    function next() {
      var piece = file.slice(offset, offset + PIECE);
      var body = new FormData();
      body.append('csrf', csrf);
      body.append('id', id);
      body.append('offset', offset);
      body.append('size', file.size);
      body.append('name', file.name);
      body.append('piece', piece, 'piece');
      var xhr = new XMLHttpRequest();
      xhr.open('POST', videoBox.getAttribute('data-upload'));
      xhr.setRequestHeader('X-Requested-With', 'fetch');
      xhr.responseType = 'json';
      xhr.timeout = 120000;
      xhr.upload.onprogress = function (e) { progress(offset + Math.min(e.loaded, piece.size)); };
      xhr.onload = function () {
        var d = xhr.response || {};
        if (d.signed_out) {
          finish(d.error);
          return signedOut(d.error);
        }
        if (xhr.status !== 200 || !d.ok) return finish(d.toast || d.error || 'The video could not be uploaded.');
        tries = 0;
        offset += piece.size;
        progress(offset);
        if (offset < file.size) return next();
        actions++; // a check that left before this must not undo it
        apply(d);
        finish(null, d.toast);
      };
      xhr.onerror = xhr.ontimeout = function () {
        if (++tries <= 3) return setTimeout(next, 1000 * tries);
        finish('Could not reach the server. Check your connection and try again.');
      };
      xhr.send(body);
    }
    progress(0);
    next();
  }

  /* ---- after the timer: the simulation. It counts down the last SIM_FROM seconds on a model of each face and goes
     on as the screens would, with the settings in the card, saved or not. It runs on this computer's own clock and
     leaves the real timer and the screens alone. */
  var sims = root.querySelectorAll('[data-sim-screen]');
  var endForm = $('[data-cr-end]');
  var simPlay = $('[data-sim-play]');
  var simStop = $('[data-sim-stop]');
  var simLabel = $('[data-sim-label]');
  var SIM_FROM = 5;
  var sim = null; // the simulated timer while it plays
  var simTimer = null;

  // The timer as it stands before the simulation plays
  function simSettings() {
    var s = Object.assign({}, data.state, { status: 'ready', left: SIM_FROM, ends_at: 0, view: 'timer', faces: 1 });
    var show = endForm.querySelector('[name=end_show]:checked');
    if (show) s.end_show = show.value;
    var delay = endForm.elements.end_delay;
    s.end_delay = Math.max(0, Math.min(+delay.max, parseInt(delay.value, 10) || 0));
    return s;
  }

  function simDraw() {
    clearTimeout(simTimer);
    var s = sim || simSettings();
    var t = C.mono();
    sims.forEach(function (el) { C.render(el, s, t); });
    if (sim) simTimer = setTimeout(simDraw, Math.min(1000, C.untilNext(s, t) * 1000 + 2));
  }

  simPlay.addEventListener('click', function () {
    var s = simSettings();
    var src = data.video ? data.video.url : '';
    simPlay.classList.add('is-busy');
    simLabel.textContent = 'Loading the video…';
    (s.end_show === 'video' && src ? C.preload(src) : Promise.resolve(true)).then(function (ok) {
      simPlay.classList.remove('is-busy');
      simLabel.textContent = 'Play again';
      if (!ok) A.toast('The video could not be loaded, so the simulation holds 00:00:00.', true);
      s.status = 'running';
      s.ends_at = C.mono() + SIM_FROM;
      sim = s;
      simStop.hidden = false;
      simDraw();
    });
  });

  simStop.addEventListener('click', function () {
    sim = null;
    simStop.hidden = true;
    simLabel.textContent = 'Play simulation';
    simDraw();
  });

  // Lay the preview and the simulation out again, e.g. once a font has arrived
  function refitAll() {
    C.refit(screenEl);
    sims.forEach(function (el) { C.refit(el); });
    tick();
    simDraw();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    tick(); // timers may have been held back while hidden
    if (sim) simDraw();
    poll();
  });
  window.addEventListener('resize', function () { sizePreview(); tick(); simDraw(); });
  if (document.fonts) { // fit again once a font arrives, e.g. the gold digits after switching looks
    document.fonts.ready.then(refitAll);
    document.fonts.addEventListener('loadingdone', refitAll);
  }

  apply(data);
  pollTimer = setTimeout(poll, 2000);
})();
