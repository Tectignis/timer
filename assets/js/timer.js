// Countdown maths, drawing and the server clock, shared by the screen (screen.php) and the control room.
(function () {
  'use strict';

  /* ---- the server clock */

  var DRIFT = 0.0001; // how fast two computer clocks can drift apart (s per s), so older measurements count for less
  var KEEP = 16;      // measurements kept (one per check-in, so a few minutes' worth)
  var SLACK = 0.002;  // how exact the timestamps on both sides are (s), added to every measurement's range

  // Our own clock in seconds. It keeps going steadily even when someone changes the computer's time.
  function mono() { return performance.now() / 1000; }

  // When the request really left and the first byte of the answer came back, from the browser's own network
  // timings. Timing it in JavaScript also counts waiting for a connection and for the page to get round to the
  // answer (often tens of milliseconds, different on every screen), which would skew the clock.
  function wire(url, sent, got) {
    var p = window.performance;
    if (!url || !p.getEntriesByName) return [sent, got];
    var list = p.getEntriesByName(url, 'resource');
    var e = list[list.length - 1];
    if (p.clearResourceTimings) p.clearResourceTimings(); // the browser keeps only 250: never let it fill up
    if (e && e.requestStart > 0 && e.responseStart >= e.requestStart &&
        e.requestStart / 1000 >= sent - 0.001 && e.responseStart / 1000 <= got + 0.001) {
      return [e.requestStart / 1000, e.responseStart / 1000];
    }
    return [sent, got];
  }

  // The server's clock, measured the way NTP does it. Every answer from the server says when the request arrived
  // and when the answer left (timer_clock() in includes/timer.php). With the times we sent the request and got
  // the answer, the difference between the clocks is pinned to a range as wide as the network delay. Every recent
  // measurement must be right, so the true difference lies where all their ranges overlap, which narrows with each
  // check-in. The clock runs on the middle of that overlap.
  function Clock() {
    this.samples = [];
    this.offset = 0;
    this.gap = Date.now() / 1000 - mono();
  }

  Clock.prototype.now = function () { return mono() + this.offset; };

  // One measurement. sent / got: mono() when the request left and the answer came back. d: the answer.
  // url: the request's address (response.url), for the browser's exact timings. True when the clock moved.
  Clock.prototype.add = function (sent, got, d, url) {
    var t = wire(url, sent, got);
    sent = t[0];
    got = t[1];
    if (!d || !(d.received > 0) || !(d.now >= d.received) || !(got >= sent)) return false;
    var offset = (d.received - sent + d.now - got) / 2;
    var err = Math.max(0, got - sent - (d.now - d.received)) / 2 + SLACK;
    this.samples.push({ lo: offset - err, hi: offset + err, at: got });
    if (this.samples.length > KEEP) this.samples.shift();
    var r = this.range();
    var before = this.offset;
    this.offset = (r.lo + r.hi) / 2;
    return Math.abs(this.offset - before) > 0.0005;
  };

  // The page itself is the first measurement: when the browser asked for it and when its first byte came back
  Clock.prototype.addPage = function (d) {
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    this.add(nav && nav.requestStart > 0 ? nav.requestStart / 1000 : 0, nav && nav.responseStart > 0 ? nav.responseStart / 1000 : mono(), d);
  };

  // Where the recent measurements overlap, newest first, each widened by how far the clocks may have drifted since.
  // An older one that can't be right with the newer ones is left out: a clock jumped since (e.g. the computer
  // slept), so the newest measurements always count.
  Clock.prototype.range = function () {
    var t = mono();
    var lo = -Infinity;
    var hi = Infinity;
    for (var i = this.samples.length - 1; i >= 0; i--) {
      var s = this.samples[i];
      var drift = (t - s.at) * DRIFT;
      var l = Math.max(lo, s.lo - drift);
      var h = Math.min(hi, s.hi + drift);
      if (l > h) continue;
      lo = l;
      hi = h;
    }
    return { lo: lo, hi: hi };
  };

  // True (once) when the computer's time jumped against our own clock: it was changed or the computer slept.
  // Time to measure again.
  Clock.prototype.jumped = function () {
    var gap = Date.now() / 1000 - mono();
    var jumped = Math.abs(gap - this.gap) > 1;
    this.gap = gap;
    return jumped;
  };

  /* ---- the countdown */

  // Sizes in em, matching assets/css/screen.css
  var DIGIT = 0.58;   // .clock__d width
  var SEP = 0.3;      // .clock__sep width
  var LINE = 0.8;     // .clock line-height
  var UNIT = 0.195;   // .clock__unit height (font-size × line-height)
  var GAP = 0.06;     // .clock--stacked gap
  var UNITS = ['Hours', 'Minutes', 'Seconds'];

  // The gold look: the digits on one line with the ribbon under them, measured on the 3000 × 7000 artwork.
  // In em of the scene, whose font size is its width. Matches .scene in assets/css/screen.css.
  var G_DIGIT = 0.55;    // .is-gold .clock__d width (em of the digits)
  var G_SEP = 0.31;      // .is-gold .clock__sep width (em of the digits)
  var G_SIZE = 0.2341;   // digit font size: digits 517 px tall on the 3000 px wide artwork
  var G_TEXT = 0.2;      // bottom of a message: between the digits' baseline and the ribbon
  var G_RIBBON = 0.2237; // .scene__ribbon top
  var G_HEIGHT = 0.491;  // .scene height: top of the digits to the bottom of the ribbon
  var G_MID = 0.4379;    // middle of the scene, down the artwork's height

  // Seconds left at `now` (seconds). Same as timer_left() in includes/timer.php.
  function left(s, now) {
    if (s.status === 'running') return Math.max(0, s.ends_at - now);
    return s.left;
  }

  // The whole second shown. Rounds up, so the screen shows 00:00:01 until the very end.
  function shown(secs) { return Math.ceil(Math.round(secs * 1000) / 1000); }

  // Seconds until the screen changes on its own, i.e. when it should be drawn again: the next second, or the reveal
  // video starting after zero (Infinity while stopped)
  function untilNext(s, now) {
    var l = left(s, now);
    if (s.status !== 'running') return Infinity;
    if (l <= 0) {
      var start = s.ends_at + (s.end_delay || 0) - now;
      return s.end_show === 'video' && start > 0 ? start : Infinity;
    }
    return l - (shown(l) - 1);
  }

  // ['00', '10', '00']
  function groups(secs) {
    var t = shown(secs);
    return [Math.floor(t / 3600), Math.floor(t % 3600 / 60), t % 60].map(function (n) {
      return n < 10 ? '0' + n : String(n);
    });
  }

  function format(secs) { return groups(secs).join(':'); }

  // What the screen shows at `now`: { kind: clock|text|video|words|blank, groups, text, since, ended }.
  // The reveal video starts end_delay seconds after zero; until then the screen holds 00:00:00.
  // since: seconds since the video started (null when the timer isn't running, so there is no zero to go by)
  // words: the face shows fixed words (see drawWords()) until the video, and never the time or a message
  function content(s, now, words) {
    if (s.view === 'standby') return { kind: 'blank' };
    if (s.view === 'message' && !words) return { kind: 'text', text: s.message };
    var l = left(s, now);
    if (l <= 0 && s.end_show === 'video') {
      var since = s.status === 'running' ? now - s.ends_at - (s.end_delay || 0) : null;
      if (since === null || since >= 0) return { kind: 'video', since: since, ended: true };
    }
    if (words) return { kind: 'words' };
    return { kind: 'clock', groups: groups(l), ended: l <= 0 };
  }

  // Font size (px) that fills a w × h face with the clock in a layout
  function clockSize(layout, hourDigits, w, h) {
    if (layout === 'stacked') {
      return Math.min(w * 0.86 / (hourDigits * DIGIT), h * 0.9 / (3 * (LINE + UNIT) + 2 * GAP));
    }
    return Math.min(w * 0.92 / ((hourDigits + 4) * DIGIT + 2 * SEP), h * 0.8 / LINE);
  }

  // auto: stacked on tall faces (e.g. the side of a pillar), one line everywhere else
  function pickLayout(layout, hourDigits, w, h) {
    if (layout !== 'auto') return layout;
    return clockSize('stacked', hourDigits, w, h) > clockSize('line', hourDigits, w, h) * 1.15 ? 'stacked' : 'line';
  }

  function clockHtml(layout, g) {
    return '<div class="clock clock--' + layout + '">' + g.map(function (group, i) {
      var digits = '<span class="clock__g">' + group.split('').map(function (d) {
        return '<span class="clock__d">' + d + '</span>';
      }).join('') + '</span>';
      if (layout === 'stacked') return '<div class="clock__row">' + digits + '<span class="clock__unit">' + UNITS[i] + '</span></div>';
      return (i ? '<span class="clock__sep">:</span>' : '') + digits;
    }).join('') + '</div>';
  }

  // Where the gold scene goes in a w × h face: as wide as the face and as high up as on the artwork, unless the face
  // is too short for that (then it sits a little above the middle)
  function goldScene(w, h) {
    var size = Math.min(w, h * 0.9 / G_HEIGHT);
    var room = h - size * G_HEIGHT;
    var top = Math.min(room, Math.max(h * G_MID - size * G_HEIGHT / 2, room * 0.4));
    return { size: size, top: top, left: (w - size) / 2 };
  }

  // The ribbon artwork, decoded once and kept. Browsers throw decoded pictures away while a tab isn't showing and
  // decode them again before showing it, which for this large artwork takes a few hundred milliseconds: long enough
  // to see an old picture of the tab, with an old time, after switching to it. So the ribbon is drawn into a canvas
  // at the size it is shown, from pixels decoded once. Until then the CSS background shows it.
  var ribbon = { art: null, url: '', waiting: [] };

  function paintRibbon(box) {
    if (ribbon.art) return ribbonCanvas(box);
    ribbon.waiting.push(box);
    if (ribbon.url) return; // already on its way
    var m = /url\(["']?([^"')]+)["']?\)/.exec(getComputedStyle(box).backgroundImage);
    if (!m || !window.createImageBitmap) return;
    ribbon.url = m[1];
    var img = new Image();
    img.src = ribbon.url;
    img.decode()
      .then(function () { return createImageBitmap(img); })
      .then(function (art) {
        ribbon.art = art;
        ribbon.waiting.forEach(function (b) { if (b.isConnected) ribbonCanvas(b); });
        ribbon.waiting = [];
      })
      .catch(function () { ribbon.url = ''; }); // keep the CSS background
  }

  function ribbonCanvas(box) {
    var canvas = document.createElement('canvas');
    sizeCanvas(canvas, box);
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(ribbon.art, 0, 0, canvas.width, canvas.height);
    box.insertBefore(canvas, box.firstChild); // under the moving light
    box.classList.add('is-drawn');
  }

  // Gives a canvas as many pixels as `box` takes up on the screen, also when the screen is stretched (a face of the
  // monolith, see assets/css/screen.css), so the ribbon stays sharp
  function sizeCanvas(canvas, box) {
    var r = box.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  // The ribbon's moving light: assets/brand/ribbon.webm, a 15 second loop of the ribbon on a transparent background.
  // One video plays for every face, and each new frame is drawn into a canvas over the still ribbon, so all faces
  // shine in step and a face that is rebuilt carries on where the light is. Without the video, or in a browser that
  // drops its transparency, the still ribbon stays.
  var shine = { src: document.currentScript ? new URL('../brand/ribbon.webm', document.currentScript.src).href : '', video: null, canvases: [], ok: false, failed: false };

  function addShine(box) {
    if (shine.failed || !shine.src) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'scene__shine';
    box.appendChild(canvas);
    sizeCanvas(canvas, canvas);
    shine.canvases.push(canvas);
    if (shine.ok) drawShine(canvas);
    playShine();
  }

  function playShine() {
    var v = shine.video;
    if (!v) {
      v = shine.video = document.createElement('video');
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.addEventListener('error', stopShine);
      v.src = shine.src;
      nextShine();
    }
    if (v.paused) v.play().catch(function () {}); // not allowed yet: tried again when a face is next drawn
  }

  function nextShine() {
    if (shine.video.requestVideoFrameCallback) shine.video.requestVideoFrameCallback(frameShine);
    else requestAnimationFrame(frameShine);
  }

  // A new frame of the video: draw it into every ribbon on show, or rest the video when none is
  function frameShine() {
    if (shine.failed) return;
    shine.canvases = shine.canvases.filter(function (c) { return c.isConnected; });
    if (!shine.canvases.length) {
      shine.video.pause();
    } else if (shine.video.readyState >= 2) {
      if (!shine.ok && !(shine.ok = keepsAlpha(shine.video))) return stopShine();
      shine.canvases.forEach(drawShine);
    }
    nextShine();
  }

  function drawShine(canvas) {
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(shine.video, 0, 0, canvas.width, canvas.height);
    canvas.parentNode.classList.add('is-moving');
  }

  // True when the browser keeps the video's transparency: the frame's top left corner, above the ribbon, is clear
  function keepsAlpha(v) {
    try {
      var ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, 8, 8, 0, 0, 1, 1);
      return ctx.getImageData(0, 0, 1, 1).data[3] < 128;
    } catch (e) {
      return false;
    }
  }

  function stopShine() {
    shine.failed = true;
    shine.canvases.forEach(function (c) {
      if (c.parentNode) c.parentNode.classList.remove('is-moving');
      c.remove();
    });
    shine.canvases = [];
    if (shine.video) shine.video.removeAttribute('src');
  }

  // The browser pauses videos in a tab that isn't showing: play again when it is
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && shine.canvases.length && !shine.failed) playShine();
  });

  // still: the static screen link (screen.php?…&ribbon=static) keeps the ribbon still and never loads the video
  function dressRibbon(box, still) {
    paintRibbon(box);
    if (!still) addShine(box);
  }

  // Fills a face with the gold look: the ribbon, and above it the digits or a message. On a wider face of the
  // monolith the digits are laid out as on the narrowest one (digitScale of its width, data-digit-scale from
  // screen.php), so they are as large and as high up on every face.
  function drawGold(face, c, hourDigits, w, h, still, digitScale) {
    var g = goldScene(w, h);
    var scene = '<div class="scene' + (g.size < w - 1 ? ' is-inset' : '') + '" style="font-size:' + g.size + 'px;top:' + g.top +
      'px;left:' + g.left + 'px"><div class="scene__ribbon"></div>';
    if (c.kind === 'clock') {
      var d = goldScene(w * digitScale, h);
      face.innerHTML = scene + '<div class="scene__time" style="font-size:' + d.size + 'px;top:' + (d.top - g.top) + 'px;left:' +
        ((w - w * digitScale) / 2 + d.left - g.left) + 'px">' + clockHtml('line', c.groups) + '</div></div>';
      var clock = face.querySelector('.clock');
      clock.style.fontSize = Math.min(G_SIZE, 0.94 / ((hourDigits + 4) * G_DIGIT + 2 * G_SEP)) + 'em';
      seatDigits(clock);
      dressRibbon(face.querySelector('.scene__ribbon'), still);
      return;
    }
    face.innerHTML = scene + '</div><div class="scene__text"><div class="msg"></div></div>';
    dressRibbon(face.querySelector('.scene__ribbon'), still);
    var box = face.lastChild;
    var top = h * 0.05;
    var height = Math.max(0, g.top + G_TEXT * g.size - top);
    box.style.top = top + 'px';
    box.style.height = height + 'px';
    box.firstChild.textContent = c.text;
    fitText(box.firstChild, height);
  }

  // The gold digits' line ends at their baseline through the font's ascent-override (assets/css/screen.css). Safari
  // ignores it and sets them lower, by the font's own line height. Measure where the baseline really is and lift
  // the digits back onto the bottom of the line, in em so the smaller colon moves the same way.
  function seatDigits(clock) {
    var d = clock.querySelector('.clock__d');
    var mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:.4em'; // .4em above the baseline, inside the line
    d.appendChild(mark);
    var drop = (mark.getBoundingClientRect().bottom - d.getBoundingClientRect().bottom) / parseFloat(getComputedStyle(clock).fontSize) + 0.4;
    d.removeChild(mark);
    clock.style.setProperty('--lift', Math.abs(drop) < 0.002 ? 0 : drop.toFixed(4));
  }

  /* ---- the reveal video at zero */

  // The video comes from data-reveal on the .screen element (reveal_url() in includes/timer.php). A screen downloads
  // it whole from half an hour before zero, so it plays smoothly even on a slow network. It never waits for that:
  // if the copy isn't here when the video is due, it plays straight from the server at once. The control room (its
  // preview and the simulation) always plays it from the server. Every screen plays it in step with the clock,
  // looping, so all faces show the same frame. If the browser can't play it, the screen holds 00:00:00 (a face with
  // words keeps its words).
  var REVEAL_EARLY = 1800;
  var reveals = {}; // address → { src, url: the downloaded copy ('' until it is here), failed, fetching }

  // download: fetch a copy to play from (screens), otherwise it is only played from the server
  function reveal(src, download) {
    var r = reveals[src];
    if (!r) {
      Object.keys(reveals).forEach(function (old) { // a new video took the old one's place: let its copy go
        if (reveals[old].url) URL.revokeObjectURL(reveals[old].url);
        delete reveals[old];
      });
      r = reveals[src] = { src: src, url: '', failed: false, fetching: false };
    }
    if (download && !r.fetching && !r.url) {
      r.fetching = true;
      fetch(src)
        .then(function (res) {
          if (!res.ok) throw new Error(res.status);
          return res.blob();
        })
        .then(function (b) { if (reveals[src] === r) r.url = URL.createObjectURL(b); })
        .catch(function () { setTimeout(function () { r.fetching = false; }, 30000); }); // try again in a while
    }
    return r;
  }

  // How the video fills a face of another shape (end_fit): soft (the whole video, the rest of the face filled with
  // its own light and colour, blurred), whole (the whole video on the background), fill (fills the face and cuts
  // off what is left over) or stretch (the whole video stretched to the face)
  var REVEAL_FITS = ['soft', 'whole', 'fill', 'stretch'];

  // The downloaded copy when it is here, otherwise straight from the server. What the face showed stays until the
  // video's first frame is here, so the face never goes blank meanwhile. ratio: the face's real shape (width /
  // height). The video is placed in parts of the face, so it lands right however the face is stretched.
  // On a screen the face is then laid out over the whole window without the stretch (is-video, see
  // assets/css/screen.css), so the browser draws the video straight onto the window.
  function showReveal(el, face, r, fit, ratio) {
    var box = document.createElement('div');
    box.className = 'reveal';
    var v = document.createElement('video');
    v.muted = true; // the attribute alone doesn't let every browser play it on its own
    v.loop = true;
    v.playsInline = true;
    v.preload = 'auto';
    var soft = fit === 'soft' ? document.createElement('canvas') : null;
    if (soft) box.appendChild(soft);
    box.appendChild(v);
    var copy = r.url;
    v.addEventListener('loadeddata', function () {
      if (box.parentNode !== face) return; // replaced meanwhile
      box.classList.add('is-shown');
      Array.prototype.slice.call(face.children).forEach(function (n) { if (n !== box) face.removeChild(n); });
      if (el.hasAttribute('data-screen')) el.classList.add('is-video');
      if (soft) softReveal(v, soft, ratio);
    }, { once: true });
    v.addEventListener('error', function () { // the copy won't play: play it from the server, then give up
      if (!copy) return (r.failed = true);
      URL.revokeObjectURL(r.url);
      r.url = copy = '';
      v.src = r.src;
    });
    v.addEventListener('loadedmetadata', function () {
      placeReveal(v, fit, ratio);
      keepReveal(v);
    });
    v.src = copy || r.src;
    face.appendChild(box);
  }

  // Sizes and places the video in parts of the face
  function placeReveal(v, fit, ratio) {
    var shape = v.videoWidth / v.videoHeight;
    if (!(shape > 0) || !(ratio > 0)) return;
    var w = 1;
    var h = 1;
    if (fit === 'fill') {
      if (shape < ratio) h = ratio / shape;
      else w = shape / ratio;
    } else if (fit !== 'stretch') {
      if (shape < ratio) w = shape / ratio;
      else h = ratio / shape;
    }
    v.style.width = (w * 100).toFixed(3) + '%';
    v.style.height = (h * 100).toFixed(3) + '%';
    v.style.left = ((1 - w) * 50).toFixed(3) + '%';
    v.style.top = ((1 - h) * 50).toFixed(3) + '%';
  }

  // The soft fill behind the video: each frame, the part of the picture in the face's shape is drawn small and
  // blurred into a canvas that covers the face, so only its light and colour reach the edges
  var SOFT_WIDTH = 160; // the canvas's pixels across: large enough for the browser to draw it on the graphics card
  function softReveal(v, canvas, ratio) {
    canvas.width = SOFT_WIDTH;
    canvas.height = Math.max(1, Math.round(SOFT_WIDTH / ratio));
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'blur(' + Math.round(SOFT_WIDTH / 16) + 'px)';
    function paint() {
      if (!v.isConnected) return; // the video is gone: stop
      var vw = v.videoWidth;
      var vh = v.videoHeight;
      if (v.readyState >= 2 && vw && vh) {
        var sw = vw;
        var sh = vh;
        if (vw / vh < ratio) sh = vw / ratio;
        else sw = vh * ratio;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(v, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(paint);
      else setTimeout(paint, 100);
    }
    paint();
  }

  // since: seconds since zero at this moment (null: just play)
  function syncReveal(v, since) {
    v._sync = since === null ? null : { since: since, at: mono() };
    keepReveal(v);
  }

  // Keeps the video on the frame every other screen shows: a small drift is made up by playing a touch faster or
  // slower, a larger one (e.g. a screen opened after zero) by jumping there
  function keepReveal(v) {
    if (v.paused) v.play().catch(function () {}); // not allowed yet: tried again on the next draw
    var d = v.duration;
    if (!v._sync || !(d > 0)) return;
    var want = (v._sync.since + mono() - v._sync.at) % d;
    var ahead = v.currentTime - want;
    if (ahead > d / 2) ahead -= d; // the other side of the loop
    if (ahead < -d / 2) ahead += d;
    if (Math.abs(ahead) > 0.5) {
      v.currentTime = want;
      v.playbackRate = 1;
    } else {
      v.playbackRate = Math.abs(ahead) < 0.02 ? 1 : 1 - Math.max(-0.1, Math.min(0.1, ahead));
    }
  }

  /* ---- fixed words (the sides of the monolith) */

  // A face in SCREEN_WORDS (includes/timer.php) shows its words, one per line, in place of the countdown until the
  // reveal video starts. screen.php lists them in data-words (a JSON list). Gold letters of the brand font on the
  // background, in the face's shape and stretched like any face.
  function wordsOf(el) {
    if (el._words === undefined) {
      try {
        el._words = JSON.parse(el.getAttribute('data-words') || 'null');
      } catch (e) {
        el._words = null;
      }
      if (!Array.isArray(el._words) || !el._words.length) el._words = null;
    }
    return el._words;
  }

  function drawWords(face, list, w, h) {
    face.innerHTML = '<div class="words" role="img"></div>';
    var box = face.firstChild;
    box.setAttribute('aria-label', list.join(' '));
    list.forEach(function (word) {
      var span = document.createElement('span');
      span.className = 'words__w';
      span.textContent = word;
      box.appendChild(span);
    });
    fitWords(box, w, h);
  }

  // Sizes the words to a w × h face and centres their letters on it. Each word's letters are WORDS_WIDTH of the face
  // wide, unless all of them would then be taller than WORDS_HEIGHT of it, with WORDS_GAP of a letter's height
  // between two words. The letters are measured, not the line boxes, so the words sit in the middle whatever the
  // font. Laid out sizes (offset*, client*): a face of the monolith is stretched to the window afterwards.
  var WORDS_WIDTH = 0.78;
  var WORDS_HEIGHT = 0.64;
  var WORDS_GAP = 0.42;
  var measure = null;
  function fitWords(words, w, h) {
    var list = words.children;
    if (!list.length || !w || !h) return;
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

  // Largest font size at which the text fits the face
  function fitText(box, h) {
    var lo = 4;
    var hi = Math.max(8, h * 0.6);
    var size = lo;
    for (var i = 0; i < 14; i++) {
      var mid = (lo + hi) / 2;
      box.style.fontSize = mid + 'px';
      if (box.scrollHeight <= h * 0.88 && box.scrollWidth <= box.clientWidth + 1) {
        size = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    box.style.fontSize = size + 'px';
  }

  // Draws the state into a .screen element. Cheap to call often: it only rebuilds when the layout changes
  // and otherwise just swaps the digits that changed.
  function render(el, s, now) {
    // A small clock correction must never make the running timer step back a second
    if (s.status === 'running' && el._ends === s.ends_at && now < el._now && el._now - now < 1) now = el._now;
    el._ends = s.status === 'running' ? s.ends_at : null;
    el._now = now;

    var words = wordsOf(el);
    var c = content(s, now, words);
    var src = el.getAttribute('data-reveal');
    var screen = el.hasAttribute('data-screen');
    var r = null;
    if (src && (c.kind === 'video' || s.end_show === 'video' && screen && left(s, now) < REVEAL_EARLY)) {
      r = reveal(src, screen);
    }
    if (c.kind === 'video' && !(r && !r.failed)) c = words ? { kind: 'words' } : { kind: 'clock', groups: groups(0), ended: true };
    var faces = words ? 1 : s.faces || 1;
    var gold = s.look === 'gold';
    var still = el.getAttribute('data-ribbon') === 'static';
    var digitScale = parseFloat(el.getAttribute('data-digit-scale')) || 1;
    el.style.setProperty('--fg', s.fg);
    el.style.setProperty('--bg', s.bg);
    el.classList.toggle('is-gold', gold);
    el.classList.toggle('is-ended', !!c.ended && s.view === 'timer');

    while (el.children.length < faces) {
      var f = document.createElement('div');
      f.className = 'face';
      el.appendChild(f);
    }
    while (el.children.length > faces) el.removeChild(el.lastChild);

    if (c.kind !== 'video') el.classList.remove('is-video'); // a face of the monolith is stretched again
    var w = el.clientWidth / faces;
    var h = el.clientHeight;
    var hourDigits = c.kind === 'clock' ? c.groups[0].length : 0;
    var layout = c.kind === 'clock' ? (gold ? 'line' : pickLayout(s.layout, hourDigits, w, h)) : '';
    // The video is placed in parts of the face, so it needs the face's real shape (a face of the monolith has it
    // in --ratio, whatever shape it is laid out in), not its size
    var fit = REVEAL_FITS.indexOf(s.end_fit) >= 0 ? s.end_fit : REVEAL_FITS[0];
    var ratio = (parseFloat(el.style.getPropertyValue('--ratio')) || el.clientWidth / el.clientHeight) / faces;
    var key = [s.look, c.kind, layout, hourDigits, c.text || '', faces].concat(c.kind === 'video'
      ? [r.src, fit, ratio.toFixed(4)]
      : [Math.round(w), Math.round(h)]).join('|');
    var digits = c.kind === 'clock' ? c.groups.join('') : '';

    if (el._key !== key) {
      el._key = key;
      el._digits = digits;
      Array.prototype.forEach.call(el.children, function (face) {
        if (c.kind === 'video') {
          showReveal(el, face, r, fit, ratio);
        } else if (c.kind === 'words') {
          drawWords(face, words, w, h);
        } else if (gold && c.kind !== 'blank') {
          drawGold(face, c, hourDigits, w, h, still, digitScale);
        } else if (c.kind === 'clock') {
          face.innerHTML = clockHtml(layout, c.groups);
          face.firstChild.style.fontSize = clockSize(layout, hourDigits, w, h) + 'px';
        } else if (c.kind === 'text') {
          face.innerHTML = '<div class="msg"></div>';
          face.firstChild.textContent = c.text;
          fitText(face.firstChild, h);
        } else {
          face.innerHTML = '';
        }
      });
    } else if (digits !== el._digits) {
      el._digits = digits;
      Array.prototype.forEach.call(el.children, function (face) {
        var spans = face.querySelectorAll('.clock__d');
        for (var i = 0; i < spans.length; i++) {
          if (spans[i].textContent !== digits[i]) spans[i].textContent = digits[i];
        }
      });
    }

    if (c.kind === 'video') el.querySelectorAll('.reveal video').forEach(function (v) { syncReveal(v, c.since); });
  }

  // Forget the layout so the next render rebuilds (e.g. once the font has loaded)
  function refit(el) { el._key = null; }

  window.Countdown = { Clock: Clock, mono: mono, left: left, untilNext: untilNext, format: format, content: content, render: render, refit: refit };
})();
