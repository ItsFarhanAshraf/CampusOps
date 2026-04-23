(function (global) {
  'use strict';

  var ACCESS = 'campusops_access';
  var REFRESH = 'campusops_refresh';

  function getCookie(name) {
    var value = '; ' + document.cookie;
    var parts = value.split('; ' + name + '=');
    if (parts.length === 2) return parts.pop().split(';').shift();
  }

  function setTokens(access, refresh) {
    if (access) localStorage.setItem(ACCESS, access);
    if (refresh) localStorage.setItem(REFRESH, refresh);
  }

  function clearTokens() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  }

  function getAccess() {
    return localStorage.getItem(ACCESS);
  }

  function getRefresh() {
    return localStorage.getItem(REFRESH);
  }

  function formatFieldErrors(data) {
    if (!data || typeof data !== 'object') return 'Request failed.';
    var parts = [];
    Object.keys(data).forEach(function (key) {
      var val = data[key];
      if (Array.isArray(val)) parts.push(key + ': ' + val.join(' '));
      else if (typeof val === 'object') parts.push(key + ': ' + JSON.stringify(val));
      else parts.push(key + ': ' + val);
    });
    return parts.join(' · ') || 'Request failed.';
  }

  async function refreshAccess(tokenUrl) {
    var refresh = getRefresh();
    if (!refresh) return null;
    var res = await fetch(tokenUrl.replace('/token/', '/token/refresh/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refresh }),
    });
    if (!res.ok) return null;
    var body = await res.json();
    if (body.access) {
      localStorage.setItem(ACCESS, body.access);
      if (body.refresh) localStorage.setItem(REFRESH, body.refresh);
      return body.access;
    }
    return null;
  }

  async function apiJson(url, options, tokenUrl) {
    var opts = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var access = getAccess();
    if (access) headers['Authorization'] = 'Bearer ' + access;
    var res = await fetch(url, Object.assign({}, opts, { headers: headers }));
    if (res.status === 401 && tokenUrl) {
      var next = await refreshAccess(tokenUrl);
      if (next) {
        headers['Authorization'] = 'Bearer ' + next;
        res = await fetch(url, Object.assign({}, opts, { headers: headers }));
      }
    }
    return res;
  }

  function showError(el, message) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
  }

  function initLoginPage(cfg) {
    var form = document.getElementById(cfg.formId);
    var err = document.getElementById(cfg.errorId);
    var submit = document.getElementById(cfg.submitId);
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      showError(err, '');
      submit.disabled = true;
      var fd = new FormData(form);
      var payload = { email: fd.get('email'), password: fd.get('password') };
      try {
        var res = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          showError(err, formatFieldErrors(data) || 'Invalid credentials.');
          submit.disabled = false;
          return;
        }
        setTokens(data.access, data.refresh);
        window.location.href = cfg.dashboardUrl;
      } catch (ex) {
        showError(err, 'Network error. Try again.');
        submit.disabled = false;
      }
    });
  }

  function initSignupPage(cfg) {
    var form = document.getElementById(cfg.formId);
    var err = document.getElementById(cfg.errorId);
    var submit = document.getElementById(cfg.submitId);
    if (!form) return;
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      showError(err, '');
      submit.disabled = true;
      var fd = new FormData(form);
      var payload = {
        email: fd.get('email'),
        password: fd.get('password'),
        password_confirm: fd.get('password_confirm'),
        role: fd.get('role'),
        first_name: fd.get('first_name') || '',
        last_name: fd.get('last_name') || '',
        campus_id: fd.get('campus_id') || '',
      };
      try {
        var csrftoken = getCookie('csrftoken');
        var headers = { 'Content-Type': 'application/json' };
        if (csrftoken) headers['X-CSRFToken'] = csrftoken;
        var res = await fetch(cfg.registerUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload),
        });
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          showError(err, formatFieldErrors(data) || 'Registration failed.');
          submit.disabled = false;
          return;
        }
        var tr = await fetch(cfg.tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: payload.email, password: payload.password }),
        });
        var tok = await tr.json().catch(function () { return {}; });
        if (!tr.ok) {
          showError(err, 'Account created but sign-in failed. Please sign in manually.');
          submit.disabled = false;
          return;
        }
        setTokens(tok.access, tok.refresh);
        window.location.href = cfg.dashboardUrl;
      } catch (ex) {
        showError(err, 'Network error. Try again.');
        submit.disabled = false;
      }
    });
  }

  function initDashboardPage(cfg) {
    var loginUrl = cfg.loginUrl;
    if (!getAccess()) {
      window.location.href = loginUrl;
      return;
    }
    var errEl = document.getElementById(cfg.errorId);
    var loading = document.getElementById(cfg.loadingId);
    var content = document.getElementById(cfg.contentId);
    var logout = document.getElementById(cfg.logoutId);

    var tokenUrl = cfg.tokenUrl || '/api/v1/auth/token/';

    async function load() {
      showError(errEl, '');
      try {
        var res = await apiJson(cfg.meUrl, { method: 'GET' }, tokenUrl);
        var me = await res.json().catch(function () { return {}; });
        if (res.status === 401) {
          clearTokens();
          window.location.href = loginUrl;
          return;
        }
        if (!res.ok) {
          showError(errEl, formatFieldErrors(me) || 'Could not load profile.');
          loading.classList.add('hidden');
          return;
        }
        document.getElementById(cfg.fields.email).textContent = me.email || '';
        var name = [me.first_name, me.last_name].filter(Boolean).join(' ') || '—';
        document.getElementById(cfg.fields.name).textContent = name;
        document.getElementById(cfg.fields.campus).textContent = me.campus_id || '—';
        document.getElementById(cfg.fields.groups).textContent =
          (me.group_names && me.group_names.join(', ')) || '—';
        loading.classList.add('hidden');
        content.classList.remove('hidden');

        var pingEl = document.getElementById(cfg.adminPingId);
        if (pingEl) {
          var pr = await apiJson(cfg.adminPingUrl, { method: 'GET' }, tokenUrl);
          if (pr.ok) {
            pingEl.textContent = 'Administrator API check: OK (you can call privileged endpoints).';
            pingEl.classList.remove('hidden');
          }
        }
      } catch (ex) {
        loading.classList.add('hidden');
        showError(errEl, 'Network error. Try again.');
      }
    }

    if (logout) {
      logout.addEventListener('click', function () {
        clearTokens();
        window.location.href = loginUrl;
      });
    }
    load();
  }

  global.CampusOpsAuth = {
    setTokens: setTokens,
    clearTokens: clearTokens,
    getAccess: getAccess,
    apiJson: apiJson,
    formatFieldErrors: formatFieldErrors,
    showError: showError,
    initLoginPage: initLoginPage,
    initSignupPage: initSignupPage,
    initDashboardPage: initDashboardPage,
  };
})(window);
