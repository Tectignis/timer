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

  // The sides of the monolith show fixed words instead of the countdown (SCREEN_WORDS in includes/timer.php).
  // screen.php marks such a face with data-words and sends the words with the page. data-face holds the face's
  // display name ("Sides"), not the face in the link, so it is never compared on its own: data-face-id carries
  // the face from the link ("side"). A page from an older screen.php has neither, so its name is matched too,
  // whatever its case, and the words are put in here.
  var WORDS = ['zero', 'zero', 'zero']; // only for that older page; screen.php sends SCREEN_WORDS
  var faceId = (el.getAttribute('data-face-id') || el.getAttribute('data-face') || '').trim().toLowerCase();
  var words = el.hasAttribute('data-words') || faceId === 'side' || faceId === 'sides' ? wordsBox() : null;

  function wordsBox() {
    var box = el.querySelector('.words');
    if (!box) {
      box = document.createElement('div');
      box.className = 'words';
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', WORDS.join(' '));
      WORDS.forEach(function (word) {
        var w = document.createElement('span');
        w.className = 'words__w';
        w.textContent = word;
        box.appendChild(w);
      });
      el.innerHTML = '';
      el.appendChild(box);
    }
    el.classList.add('is-words');
    el.setAttribute('data-reveal', ''); // never fetch the reveal video
    return box;
  }

  // The words on the face, on the background the control room set. Standby (and a replaced link) blanks them, as
  // it blanks every screen. Nothing else from the control room shows here: no time, message or video.
  function showWords() {
    el.style.setProperty('--bg', data.bg);
    var hide = data.view === 'standby';
    if (words._hidden !== hide) words.style.visibility = (words._hidden = hide) ? 'hidden' : '';
  }

  // Sizes the words to the face and centres their letters on it. Each word's letters are WORDS_WIDTH of the face
  // wide, unless all of them would then be taller than WORDS_HEIGHT of it, with WORDS_GAP of a letter's height
  // between two words. The letters are measured, not the line boxes, so the words sit in the middle whatever the
  // font. Laid out sizes (offset*, client*): the face is stretched to the window afterwards (stretch()).
  var WORDS_WIDTH = 0.78;
  var WORDS_HEIGHT = 0.64;
  var WORDS_GAP = 0.42;
  var measure = null;
  function fitWords() {
    var w = el.clientWidth;
    var h = el.clientHeight;
    var list = words && words.children;
    if (!list || !list.length || !w || !h) return;
    var style = getComputedStyle(list[0]);
    measure = measure || document.createElement('canvas').getContext('2d');
    measure.font = style.fontStyle + ' ' + style.fontWeight + ' 100px ' + style.fontFamily;
    var ink = [];
    var wide = 0;
    var up = 0;
    var down = 0;
    Array.prototype.forEach.call(list, function (word) { // letters' extent per px of font size
      var m = measure.measureText(word.textContent);
      var i = m.actualBoundingBoxAscent === undefined
        ? { left: 0, right: m.width / 100, up: 0.5, down: 0, advance: m.width / 100 } // an old browser: guess the height
        : { left: m.actualBoundingBoxLeft / 100, right: m.actualBoundingBoxRight / 100, up: m.actualBoundingBoxAscent / 100,
            down: m.actualBoundingBoxDescent / 100, advance: m.width / 100 };
      ink.push(i);
      wide = Math.max(wide, i.left + i.right);
      up = Math.max(up, i.up);
      down = Math.max(down, i.down);
    });
    var tall = up + down;
    if (!(wide > 0) || !(tall > 0)) return;
    var n = list.length;
    var size = Math.min(w * WORDS_WIDTH / wide, h * WORDS_HEIGHT / (tall * (n + (n - 1) * WORDS_GAP)));
    words.style.transform = '';
    words.style.fontSize = size.toFixed(3) + 'px';
    words.style.lineHeight = (tall * (1 + WORDS_GAP)).toFixed(4); // one word's letters, then the gap
    // Each word's letters in the middle across (the font centres its advance, which can sit a little to one side)
    Array.prototype.forEach.call(list, function (word, k) {
      word.style.left = ((ink[k].advance / 2 - (ink[k].right - ink[k].left) / 2) * size).toFixed(2) + 'px';
    });
    // and all of them in the middle down: find the first word's baseline, then move the block by what's left over
    var mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    list[0].appendChild(mark);
    var base = mark.offsetTop + list[0].offsetTop; // from the top of .words, which covers the face
    list[0].removeChild(mark);
    var top = base - up * size;
    var bottom = base + (n - 1) * tall * (1 + WORDS_GAP) * size + down * size;
    words.style.transform = 'translateY(' + (h / 2 - (top + bottom) / 2).toFixed(2) + 'px)';
  }

  // A face of the monolith is laid out in its own shape and stretched to fill the window (assets/css/screen.css)
  function stretch() {
    if (!el.hasAttribute('data-face') || !el.offsetWidth || !el.offsetHeight) return;
    el.style.setProperty('--sx', (window.innerWidth / el.offsetWidth).toFixed(4));
    el.style.setProperty('--sy', (window.innerHeight / el.offsetHeight).toFixed(4));
  }

  // Draws the screen, then again the moment the next second is due (at least once a second). Also called whenever
  // the clock is corrected, so the next second still lands on time. A face with fixed words never draws the
  // countdown (no digits, ribbon, message or reveal video), but still goes round once a second to notice the
  // computer waking up.
  var drawTimer = null;
  function draw() {
    clearTimeout(drawTimer);
    var t = clock.now();
    document.body.style.background = data.bg;
    if (words) {
      showWords();
      drawTimer = setTimeout(draw, 1000);
    } else {
      C.render(el, data, t);
      drawTimer = setTimeout(draw, Math.min(1000, C.untilNext(data, t) * 1000 + 2));
    }
    if (clock.jumped()) restart(); // the computer slept or its time was changed
  }

  // Lays the screen out again for a new window size or once a font has arrived
  function refit() {
    if (words) fitWords();
    else C.refit(el);
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

  stretch();
  if (words) fitWords();
  draw();
  poll();
  window.addEventListener('resize', function () { stretch(); refit(); });
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
