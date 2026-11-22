// Countdown maths and drawing, shared by the screen (screen.php) and the control room preview.
(function () {
  'use strict';

  // Sizes in em, matching assets/css/screen.css
  var DIGIT = 0.62;   // .clock__d width
  var SEP = 0.32;     // .clock__sep width
  var LINE = 0.8;     // .clock line-height
  var UNIT = 0.195;   // .clock__unit height (font-size × line-height)
  var GAP = 0.06;     // .clock--stacked gap
  var UNITS = ['Hours', 'Minutes', 'Seconds'];

  // Seconds left at `now` (seconds). Same as timer_left() in includes/timer.php.
  function left(s, now) {
    if (s.status === 'running') return Math.max(0, s.ends_at - now);
    return s.left;
  }

  // ['00', '10', '00']. Rounds up, so the screen shows 00:00:01 until the very end.
  function groups(secs) {
    var t = Math.ceil(Math.round(secs * 1000) / 1000);
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
    var c = content(s, now);
    var faces = s.faces || 1;
    el.style.setProperty('--fg', s.fg);
    el.style.setProperty('--bg', s.bg);
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
    var layout = c.kind === 'clock' ? pickLayout(s.layout, hourDigits, w, h) : '';
    var key = [c.kind, layout, hourDigits, c.text || '', faces, Math.round(w), Math.round(h)].join('|');
    var digits = c.kind === 'clock' ? c.groups.join('') : '';

    if (el._key !== key) {
      el._key = key;
      el._digits = digits;
      Array.prototype.forEach.call(el.children, function (face) {
        if (c.kind === 'clock') {
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

  window.Countdown = { left: left, format: format, content: content, render: render, refit: refit };
})();
