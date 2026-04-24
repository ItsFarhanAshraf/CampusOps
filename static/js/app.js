/* CampusOps — Core App Utilities  (CampusApp global) */
(function (global) {
  'use strict';

  /* ── Token helpers ── */
  const AK = 'campusops_access';
  const RK = 'campusops_refresh';

  function getAccess()  { return localStorage.getItem(AK); }
  function getRefresh() { return localStorage.getItem(RK); }
  function setTokens(access, refresh) {
    if (access)  localStorage.setItem(AK, access);
    if (refresh) localStorage.setItem(RK, refresh);
  }
  function clearTokens() {
    localStorage.removeItem(AK);
    localStorage.removeItem(RK);
  }

  /* ── Toast system ── */
  const ICONS = {
    success: 'bi-check-circle-fill',
    danger:  'bi-exclamation-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info:    'bi-info-circle-fill',
  };
  const COLORS = {
    success: '#10b981',
    danger:  '#ef4444',
    warning: '#f59e0b',
    info:    '#0ea5e9',
  };
  let _tid = 0;

  function toast(message, type, duration) {
    type     = type     || 'info';
    duration = duration || 4200;
    const container = document.getElementById('toast-container');
    if (!container) return;

    const id   = 'co-toast-' + (++_tid);
    const icon  = ICONS[type]  || ICONS.info;
    const color = COLORS[type] || COLORS.info;

    const el = document.createElement('div');
    el.id        = id;
    el.className = 'toast show align-items-center border-0 shadow-sm';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'assertive');
    el.innerHTML =
      '<div class="d-flex">' +
        '<div class="toast-body d-flex align-items-start gap-2" style="padding:.7rem .9rem;">' +
          '<i class="bi ' + icon + ' flex-shrink-0 mt-1" style="color:' + color + ';font-size:.95rem;"></i>' +
          '<span style="font-size:.855rem;line-height:1.45;">' + message + '</span>' +
        '</div>' +
        '<button type="button" class="btn-close me-2 m-auto" data-bs-dismiss="toast" style="font-size:.65rem;"></button>' +
      '</div>';

    container.appendChild(el);
    const bsToast = new bootstrap.Toast(el, { autohide: true, delay: duration });
    bsToast.show();
    el.addEventListener('hidden.bs.toast', function () { el.remove(); });
  }

  function toastSuccess(msg, dur) { toast(msg, 'success', dur); }
  function toastError(msg, dur)   { toast(msg, 'danger',  dur); }
  function toastWarning(msg, dur) { toast(msg, 'warning', dur); }
  function toastInfo(msg, dur)    { toast(msg, 'info',    dur); }

  /* ── Button loading state ── */
  function setLoading(btn, loading, text) {
    text = text || 'Loading…';
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>' + text;
    } else {
      btn.disabled = false;
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
      }
    }
  }

  /* ── Table skeleton loader ── */
  function showTableLoader(tbodyId, cols) {
    cols = cols || 5;
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    var rows = '';
    for (var i = 0; i < 5; i++) {
      rows += '<tr>';
      for (var c = 0; c < cols; c++) {
        rows += '<td><div class="co-skeleton"></div></td>';
      }
      rows += '</tr>';
    }
    tbody.innerHTML = rows;
  }

  /* ── Empty state ── */
  function showEmptyState(tbodyId, cols, msg, icon) {
    cols = cols || 5;
    msg  = msg  || 'No data found.';
    icon = icon || 'bi-inbox';
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML =
      '<tr><td colspan="' + cols + '">' +
        '<div class="co-empty">' +
          '<i class="bi ' + icon + '"></i>' +
          '<p>' + msg + '</p>' +
        '</div>' +
      '</td></tr>';
  }

  /* ── CSRF helper ── */
  function getCookie(name) {
    var v = '; ' + document.cookie;
    var p = v.split('; ' + name + '=');
    if (p.length === 2) return p.pop().split(';').shift();
  }

  /* ── Token refresh ── */
  async function _refreshAccess() {
    var refresh = getRefresh();
    if (!refresh) return null;
    try {
      var res = await fetch('/api/v1/auth/token/refresh/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: refresh }),
      });
      if (!res.ok) return null;
      var data = await res.json();
      if (data.access) {
        localStorage.setItem(AK, data.access);
        if (data.refresh) localStorage.setItem(RK, data.refresh);
        return data.access;
      }
    } catch (e) {}
    return null;
  }

  /* ── Main API helper ── */
  async function apiJson(url, options) {
    options = options || {};
    var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    var access = getAccess();
    if (access) headers['Authorization'] = 'Bearer ' + access;
    var method = (options.method || 'GET').toUpperCase();
    var csrf = getCookie('csrftoken');
    if (csrf && ['POST','PUT','PATCH','DELETE'].indexOf(method) !== -1) {
      headers['X-CSRFToken'] = csrf;
    }

    var res = await fetch(url, Object.assign({}, options, { headers: headers }));

    /* Auto-refresh on 401 */
    if (res.status === 401) {
      var next = await _refreshAccess();
      if (next) {
        headers['Authorization'] = 'Bearer ' + next;
        res = await fetch(url, Object.assign({}, options, { headers: headers }));
      }
    }
    return res;
  }

  /* ── Error formatting ── */
  function formatErrors(data) {
    if (!data || typeof data !== 'object') return 'Request failed.';
    if (data.detail) return String(data.detail);
    var parts = [];
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      if (Array.isArray(v)) parts.push(v.map(String).join(' '));
      else if (typeof v === 'string') parts.push(v);
      else if (v && typeof v === 'object') parts.push(formatErrors(v));
    });
    return parts.join(' · ') || 'Request failed.';
  }

  /* ── Standard API error handler ── */
  function handleApiError(res, data) {
    if (res.status === 401) {
      clearTokens();
      toastError('Session expired. Please sign in again.');
      setTimeout(function () { window.location.href = '/app/login/'; }, 1200);
      return;
    }
    if (res.status === 403) { toastError('You do not have permission for this action.'); return; }
    if (res.status >= 500)  { toastError('Server error. Please try again later.');       return; }
    toastError(formatErrors(data) || 'Request failed.');
  }

  /* ── Client-side table search ── */
  function initTableSearch(inputId, tbodyId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('input', function () {
      var q = this.value.toLowerCase();
      var tbody = document.getElementById(tbodyId);
      if (!tbody) return;
      Array.from(tbody.querySelectorAll('tr[data-search]')).forEach(function (row) {
        row.style.display = (row.dataset.search || '').toLowerCase().includes(q) ? '' : 'none';
      });
      /* reset paginator info if any */
      var info = tbody.closest('.co-table-card') && tbody.closest('.co-table-card').querySelector('.co-table-info');
      if (info) info.textContent = '';
    });
  }

  /* ── Client-side paginator ── */
  function createPaginator(rows, pageSize, tbodyId, paginationId, infoId) {
    var cur = 1;
    var ps  = pageSize || 10;

    function tp() { return Math.max(1, Math.ceil(rows.length / ps)); }

    function render() {
      var tbody = document.getElementById(tbodyId);
      if (!tbody) return;

      var start    = (cur - 1) * ps;
      var pageRows = rows.slice(start, start + ps);
      tbody.innerHTML = '';
      pageRows.forEach(function (r) { tbody.appendChild(r); });

      var info = document.getElementById(infoId);
      if (info && rows.length > 0) {
        info.textContent = 'Showing ' + (start + 1) + '–' + Math.min(start + ps, rows.length) + ' of ' + rows.length;
      } else if (info) {
        info.textContent = '';
      }

      var pg = document.getElementById(paginationId);
      if (!pg) return;
      if (tp() <= 1) { pg.innerHTML = ''; return; }

      var html = '<ul class="pagination pagination-sm mb-0 gap-1">';
      html += '<li class="page-item' + (cur === 1 ? ' disabled' : '') + '"><button class="page-link" data-p="' + (cur - 1) + '">&lsaquo;</button></li>';
      for (var i = 1; i <= tp(); i++) {
        html += '<li class="page-item' + (i === cur ? ' active' : '') + '"><button class="page-link" data-p="' + i + '">' + i + '</button></li>';
      }
      html += '<li class="page-item' + (cur === tp() ? ' disabled' : '') + '"><button class="page-link" data-p="' + (cur + 1) + '">&rsaquo;</button></li>';
      html += '</ul>';
      pg.innerHTML = html;

      pg.querySelectorAll('[data-p]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = parseInt(this.dataset.p);
          if (p >= 1 && p <= tp()) { cur = p; render(); }
        });
      });
    }

    render();
    return { render: render, reset: function () { cur = 1; render(); } };
  }

  /* ── Status badge ── */
  function statusBadge(status) {
    var labels = {
      draft:'Draft', issued:'Issued', partially_paid:'Partial',
      paid:'Paid', void:'Void', pending:'Pending',
      completed:'Completed', cancelled:'Cancelled', failed:'Failed',
      active:'Active', dropped:'Dropped',
      present:'Present', absent:'Absent', late:'Late', excused:'Excused',
      scheduled:'Scheduled', overdue:'Overdue',
    };
    var label = labels[status] || status || '—';
    return '<span class="co-badge co-status-' + status + '">' + label + '</span>';
  }

  /* ── Currency formatter ── */
  function fmtMoney(val) {
    if (val === null || val === undefined) return '—';
    return '$' + parseFloat(val).toFixed(2);
  }

  /* ── Date formatter ── */
  function fmtDate(val) {
    if (!val) return '—';
    return new Date(val).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
  }

  /* ── Guard: redirect to login if not authenticated ── */
  function requireAuth() {
    if (!getAccess() && !getRefresh()) {
      window.location.href = '/app/login/';
      return false;
    }
    return true;
  }

  /* ── Export ── */
  global.CampusApp = {
    getAccess, getRefresh, setTokens, clearTokens, requireAuth,
    toast, toastSuccess, toastError, toastWarning, toastInfo,
    setLoading,
    showTableLoader, showEmptyState,
    apiJson, formatErrors, handleApiError,
    initTableSearch, createPaginator,
    statusBadge, fmtMoney, fmtDate,
  };
})(window);
