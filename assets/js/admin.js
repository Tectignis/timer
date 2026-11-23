// Admin panel helpers: in-app confirm dialog, toasts, copy button, show / hide password, keyboard shortcuts.
(function () {
  'use strict';

  var toastEl = document.querySelector('[data-toast]');
  function toast(text, bad) {
    if (!text || !toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.toggle('toast--bad', !!bad);
    toastEl.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  // "Are you sure?" dialog styled like the app. Resolves true when confirmed.
  var dialog = null;
  function confirmBox(message, okLabel) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'dialog';
      dialog.innerHTML = '<form method="dialog"><p class="dialog__text"></p><div class="dialog__actions">' +
        '<button class="btn btn--ghost" value="cancel">Cancel</button><button class="btn btn--primary" value="ok"></button></div></form>';
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); }); // click outside
      document.body.appendChild(dialog);
    }
    dialog.querySelector('.dialog__text').textContent = message;
    dialog.querySelector('[value=ok]').textContent = okLabel || 'Continue';
    return new Promise(function (resolve) {
      dialog.returnValue = '';
      dialog.addEventListener('close', function done() {
        dialog.removeEventListener('close', done);
        resolve(dialog.returnValue === 'ok');
      });
      dialog.showModal();
      dialog.querySelector('[value=ok]').focus();
    });
  }

  // Forms with data-confirm ask first (data-confirm-ok sets the button label)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.hasAttribute('data-confirm') || form._confirmed) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var submitter = e.submitter;
    confirmBox(form.getAttribute('data-confirm'), form.getAttribute('data-confirm-ok')).then(function (ok) {
      if (!ok) return;
      form._confirmed = true;
      if (form.requestSubmit) form.requestSubmit(submitter || undefined);
      else form.submit();
      form._confirmed = false;
    });
  }, true);

  // Copy button
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var input = document.querySelector('[data-copy-source]');
      input.select();
      (navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.resolve(document.execCommand('copy')))
        .then(function () {
          btn.textContent = 'Copied';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
        });
    });
  });

  // Show / hide password buttons
  function showPassword(btn, show) {
    var box = btn.parentNode;
    box.querySelector('input').type = show ? 'text' : 'password';
    box.classList.toggle('is-shown', show);
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-pw-toggle]');
    if (btn) showPassword(btn, !btn.parentNode.classList.contains('is-shown'));
  });
  // Hidden again before sending, so the browser still offers to save the password
  document.addEventListener('submit', function (e) {
    e.target.querySelectorAll('.pw.is-shown [data-pw-toggle]').forEach(function (btn) { showPassword(btn, false); });
  });

  // Keyboard shortcuts (elements with data-key). Control room: Space start/pause, R reset.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (document.querySelector('dialog[open]')) return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if ((e.key === ' ' || e.key === 'Enter') && (tag === 'button' || tag === 'a')) return; // let it press the focused button
    var el = document.querySelector('[data-key="' + e.key.toLowerCase() + '"]');
    if (!el || el.disabled) return;
    e.preventDefault();
    el.click();
  });

  window.Admin = { toast: toast, confirm: confirmBox };
})();
