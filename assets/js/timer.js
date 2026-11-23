// Countdown maths, drawing and the server clock, shared by the screen (screen.php) and the control room.
(function () {
  'use strict';

  /* ---- the server clock */

  var DRIFT = 0.0001; // how fast two computer clocks can drift apart (s per s), so older measurements count for less
  var KEEP = 16;      // measurements kept (one per check-in, so a few minutes' worth)

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
    var err = Math.max(0, got - sent - (d.now - d.received)) / 2;
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
  // An older one that can't be right with the newer ones means a clock jumped (e.g. the computer slept):
  // it and everything before it are dropped, so the newest measurement always counts.
  Clock.prototype.range = function () {
    var t = mono();
    var lo = -Infinity;
    var hi = Infinity;
    for (var i = this.samples.length - 1; i >= 0; i--) {
      var s = this.samples[i];
      var drift = (t - s.at) * DRIFT;
      var l = Math.max(lo, s.lo - drift);
      var h = Math.min(hi, s.hi + drift);
      if (l > h) {
        this.samples.splice(0, i + 1);
        break;
      }
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

  // Seconds until the next second is due, i.e. when the countdown should be drawn again (Infinity while stopped)
  function untilNext(s, now) {
    var l = left(s, now);
    if (s.status !== 'running' || l <= 0) return Infinity;
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

  // What the screen shows at `now`: { kind: clock|text|blank, groups, text, ended }
  function content(s, now) {
    if (s.view === 'standby') return { kind: 'blank' };
    if (s.view === 'message') return { kind: 'text', text: s.message };
    var l = left(s, now);
    if (l <= 0 && s.end_text) return { kind: 'text', text: s.end_text, ended: true };
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

  // Fills a face with the gold look: the ribbon, and above it the digits or a message
  function drawGold(face, c, hourDigits, w, h) {
    var g = goldScene(w, h);
    var scene = '<div class="scene' + (g.size < w - 1 ? ' is-inset' : '') + '" style="font-size:' + g.size + 'px;top:' + g.top +
      'px;left:' + g.left + 'px"><div class="scene__ribbon"></div>';
    if (c.kind === 'clock') {
      face.innerHTML = scene + '<div class="scene__time">' + clockHtml('line', c.groups) + '</div></div>';
      face.querySelector('.clock').style.fontSize = Math.min(G_SIZE, 0.94 / ((hourDigits + 4) * G_DIGIT + 2 * G_SEP)) + 'em';
      return;
    }
    face.innerHTML = scene + '</div><div class="scene__text"><div class="msg"></div></div>';
    var box = face.lastChild;
    var top = h * 0.05;
    var height = Math.max(0, g.top + G_TEXT * g.size - top);
    box.style.top = top + 'px';
    box.style.height = height + 'px';
    box.firstChild.textContent = c.text;
    fitText(box.firstChild, height);
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

    var c = content(s, now);
    var faces = s.faces || 1;
    var gold = s.look === 'gold';
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

    var w = el.clientWidth / faces;
    var h = el.clientHeight;
    var hourDigits = c.kind === 'clock' ? c.groups[0].length : 0;
    var layout = c.kind === 'clock' ? (gold ? 'line' : pickLayout(s.layout, hourDigits, w, h)) : '';
    var key = [s.look, c.kind, layout, hourDigits, c.text || '', faces, Math.round(w), Math.round(h)].join('|');
    var digits = c.kind === 'clock' ? c.groups.join('') : '';

    if (el._key !== key) {
      el._key = key;
      el._digits = digits;
      Array.prototype.forEach.call(el.children, function (face) {
        if (gold && c.kind !== 'blank') {
          drawGold(face, c, hourDigits, w, h);
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
      return;
    }

    if (digits !== el._digits) {
      el._digits = digits;
      Array.prototype.forEach.call(el.children, function (face) {
        var spans = face.querySelectorAll('.clock__d');
        for (var i = 0; i < spans.length; i++) {
          if (spans[i].textContent !== digits[i]) spans[i].textContent = digits[i];
        }
      });
    }
  }

  // Forget the layout so the next render rebuilds (e.g. once the font has loaded)
  function refit(el) { el._key = null; }

  window.Countdown = { Clock: Clock, mono: mono, left: left, untilNext: untilNext, format: format, content: content, render: render, refit: refit };
})();
