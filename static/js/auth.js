/* CampusOps — Auth pages JS  (depends on app.js / CampusApp) */
(function (global) {
  'use strict';

  /* ── Helpers (delegated to CampusApp) ── */
  function setTokens(a, r)  { CampusApp.setTokens(a, r); }
  function clearTokens()    { CampusApp.clearTokens(); }
  function getAccess()      { return CampusApp.getAccess(); }
  function formatFieldErrors(d) { return CampusApp.formatErrors(d); }

  function showError(el, msg) {
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.classList.remove('d-none');
    } else {
      el.textContent = '';
      el.classList.add('d-none');
    }
  }

  function showPwdToggle(toggleId, inputId) {
    var btn   = document.getElementById(toggleId);
    var input = document.getElementById(inputId);
    if (!btn || !input) return;
    btn.addEventListener('click', function () {
      var isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.querySelector('i').className = 'bi bi-eye' + (isText ? '' : '-slash');
    });
  }

  /* ── Login page ── */
  function initLoginPage(cfg) {
    /* cfg: { formId, errorId, submitId, tokenUrl, dashboardUrl } */
    if (CampusApp.getAccess()) {
      window.location.href = cfg.dashboardUrl || '/app/dashboard/';
      return;
    }

    var form   = document.getElementById(cfg.formId);
    var errEl  = document.getElementById(cfg.errorId);
    var submit = document.getElementById(cfg.submitId);
    showPwdToggle('toggle-password', 'id_password');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      showError(errEl, '');
      CampusApp.setLoading(submit, true, 'Signing in…');

      var fd = new FormData(form);
      try {
        var res = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          showError(errEl, CampusApp.formatErrors(data) || 'Invalid credentials. Please try again.');
          CampusApp.setLoading(submit, false);
          return;
        }
        CampusApp.setTokens(data.access, data.refresh);
        CampusApp.toastSuccess('Welcome back!');
        setTimeout(function () { window.location.href = cfg.dashboardUrl; }, 500);
      } catch (ex) {
        showError(errEl, 'Network error. Please check your connection.');
        CampusApp.setLoading(submit, false);
      }
    });
  }

  /* ── Signup page ── */
  function initSignupPage(cfg) {
    /* cfg: { formId, errorId, submitId, registerUrl, tokenUrl, dashboardUrl, loginUrl } */
    var form   = document.getElementById(cfg.formId);
    var errEl  = document.getElementById(cfg.errorId);
    var submit = document.getElementById(cfg.submitId);
    showPwdToggle('toggle-password', 'id_password');
    if (!form) return;

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      showError(errEl, '');

      /* Client-side password match */
      var fd = new FormData(form);
      if (fd.get('password') !== fd.get('password_confirm')) {
        showError(errEl, 'Passwords do not match.');
        return;
      }

      CampusApp.setLoading(submit, true, 'Creating account…');

      var payload = {
        email:            fd.get('email'),
        password:         fd.get('password'),
        password_confirm: fd.get('password_confirm'),
        role:             fd.get('role'),
        first_name:       fd.get('first_name') || '',
        last_name:        fd.get('last_name')  || '',
        campus_id:        fd.get('campus_id')  || '',
      };

      try {
        var csrf = _getCookie('csrftoken');
        var headers = { 'Content-Type': 'application/json' };
        if (csrf) headers['X-CSRFToken'] = csrf;

        var res = await fetch(cfg.registerUrl, {
          method: 'POST', headers: headers, body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          showError(errEl, CampusApp.formatErrors(data) || 'Registration failed.');
          CampusApp.setLoading(submit, false);
          return;
        }

        /* Auto-sign-in */
        var tr = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: payload.email, password: payload.password }),
        });
        var tok = await tr.json().catch(function () { return {}; });
        if (!tr.ok) {
          CampusApp.toastSuccess('Account created! Please sign in.');
          setTimeout(function () { window.location.href = cfg.loginUrl || '/app/login/'; }, 900);
          return;
        }
        CampusApp.setTokens(tok.access, tok.refresh);
        CampusApp.toastSuccess('Account created successfully!');
        setTimeout(function () { window.location.href = cfg.dashboardUrl; }, 500);
      } catch (ex) {
        showError(errEl, 'Network error. Please check your connection.');
        CampusApp.setLoading(submit, false);
      }
    });
  }

  function _getCookie(name) {
    var v = '; ' + document.cookie;
    var p = v.split('; ' + name + '=');
    if (p.length === 2) return p.pop().split(';').shift();
  }

  /* ── Export ── */
  global.CampusOpsAuth = {
    setTokens, clearTokens, getAccess,
    formatFieldErrors, showError,
    initLoginPage, initSignupPage,
  };
})(window);
