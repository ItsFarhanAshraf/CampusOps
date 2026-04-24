(function (global) {
  'use strict';

  function canManageFinance(me) {
    if (!me) return false;
    if (me.is_staff) return true;
    var g = me.group_names || [];
    return ['staff', 'campus_administrator', 'finance'].some(function (x) {
      return g.indexOf(x) !== -1;
    });
  }

  function init(cfg) {
    var loginUrl = cfg.loginUrl;
    var tokenUrl = cfg.tokenUrl || '/api/v1/auth/token/';
    if (!CampusOpsAuth.getAccess()) {
      window.location.href = loginUrl;
      return;
    }

    var errEl = document.getElementById('finance-error');
    var roleEl = document.getElementById('finance-role');
    var feeManage = document.getElementById('fee-manage');
    var invoiceManage = document.getElementById('invoice-manage');
    var feeActionsTh = document.getElementById('fee-actions-th');
    var me = null;

    function show(msg) {
      CampusOpsAuth.showError(errEl, msg || '');
    }

    async function loadMe() {
      var res = await CampusOpsAuth.apiJson(cfg.meUrl, { method: 'GET' }, tokenUrl);
      if (res.status === 401) {
        CampusOpsAuth.clearTokens();
        window.location.href = loginUrl;
        return false;
      }
      me = await res.json().catch(function () { return null; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(me) || 'Could not load profile.');
        return false;
      }
      if (roleEl) {
        roleEl.textContent =
          'Signed in as ' +
          (me.email || '') +
          (me.group_names && me.group_names.length
            ? ' · Roles: ' + me.group_names.join(', ')
            : '');
        roleEl.classList.remove('hidden');
      }
      if (canManageFinance(me)) {
        feeManage.classList.remove('hidden');
        invoiceManage.classList.remove('hidden');
        if (feeActionsTh) feeActionsTh.classList.remove('hidden');
      }
      return true;
    }

    document.querySelectorAll('.tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.tab').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        var tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-panel').forEach(function (panel) {
          var on = panel.getAttribute('data-panel') === tab;
          panel.classList.toggle('hidden', !on);
        });
      });
    });

    document.getElementById('finance-logout').addEventListener('click', function () {
      CampusOpsAuth.clearTokens();
      window.location.href = loginUrl;
    });

    async function loadFees() {
      var res = await CampusOpsAuth.apiJson(cfg.feesUrl, { method: 'GET' }, tokenUrl);
      var data = await res.json().catch(function () { return null; });
      var list = Array.isArray(data) ? data : data && data.results ? data.results : [];
      var body = document.getElementById('fee-body');
      if (!res.ok) {
        body.innerHTML =
          '<tr><td colspan="6" class=\"muted\">Could not load fee structures.</td></tr>';
        return;
      }
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="6" class=\"muted\">No fee structures yet.</td></tr>';
        return;
      }
      var manage = canManageFinance(me);
      body.innerHTML = list
        .map(function (f) {
          var actionCell = manage
            ? '<td><button type="button" class="btn ghost fee-edit" data-id="' +
              f.id +
              '">Edit</button></td>'
            : '<td></td>';
          return (
            '<tr><td>' +
            f.code +
            '</td><td>' +
            f.name +
            '</td><td>' +
            f.amount +
            '</td><td>' +
            (f.term || '') +
            '</td><td>' +
            (f.is_active ? 'yes' : 'no') +
            '</td>' +
            actionCell +
            '</tr>'
          );
        })
        .join('');
      if (manage) {
        body.querySelectorAll('.fee-edit').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            var row = list.find(function (x) { return String(x.id) === String(id); });
            if (!row) return;
            document.getElementById('fee-id').value = String(row.id);
            var form = document.getElementById('fee-form');
            form.code.value = row.code;
            form.name.value = row.name;
            form.amount.value = row.amount;
            form.term.value = row.term || '';
            form.is_active.checked = !!row.is_active;
          });
        });
      }
    }

    async function loadInvoices() {
      var res = await CampusOpsAuth.apiJson(cfg.invoicesUrl, { method: 'GET' }, tokenUrl);
      var data = await res.json().catch(function () { return null; });
      var list = Array.isArray(data) ? data : data && data.results ? data.results : [];
      var body = document.getElementById('invoice-body');
      if (!res.ok) {
        body.innerHTML =
          '<tr><td colspan="7" class=\"muted\">Could not load invoices.</td></tr>';
        return;
      }
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="7" class=\"muted\">No invoices yet.</td></tr>';
        return;
      }
      body.innerHTML = list
        .map(function (inv) {
          return (
            '<tr><td>' +
            inv.id +
            '</td><td>' +
            inv.student +
            '</td><td>' +
            inv.status +
            '</td><td>' +
            inv.due_date +
            '</td><td>' +
            inv.line_total +
            '</td><td>' +
            inv.amount_paid +
            '</td><td>' +
            inv.balance +
            '</td></tr>'
          );
        })
        .join('');
    }

    async function loadPayments() {
      var res = await CampusOpsAuth.apiJson(cfg.paymentsUrl, { method: 'GET' }, tokenUrl);
      var data = await res.json().catch(function () { return null; });
      var list = Array.isArray(data) ? data : data && data.results ? data.results : [];
      var body = document.getElementById('payment-body');
      if (!res.ok) {
        body.innerHTML =
          '<tr><td colspan="6" class=\"muted\">Could not load payments.</td></tr>';
        return;
      }
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="6" class=\"muted\">No payments yet.</td></tr>';
        return;
      }
      body.innerHTML = list
        .map(function (p) {
          return (
            '<tr><td>' +
            p.id +
            '</td><td>' +
            p.invoice +
            '</td><td>' +
            p.amount +
            '</td><td>' +
            p.method +
            '</td><td>' +
            (p.reference || '') +
            '</td><td>' +
            p.created_at +
            '</td></tr>'
          );
        })
        .join('');
    }

    document.getElementById('fee-reset').addEventListener('click', function () {
      var form = document.getElementById('fee-form');
      form.reset();
      document.getElementById('fee-id').value = '';
      form.is_active.checked = true;
    });

    document.getElementById('fee-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!canManageFinance(me)) return;
      show('');
      var fd = new FormData(e.target);
      var id = (fd.get('id') || '').toString().trim();
      var payload = {
        code: fd.get('code'),
        name: fd.get('name'),
        amount: fd.get('amount'),
        term: fd.get('term') || '',
        is_active: fd.get('is_active') === 'on',
      };
      var url = cfg.feesUrl;
      var method = 'POST';
      if (id) {
        url = cfg.feesUrl + id + '/';
        method = 'PATCH';
      }
      var btn = document.getElementById('fee-submit');
      btn.disabled = true;
      var res = await CampusOpsAuth.apiJson(
        url,
        { method: method, body: JSON.stringify(payload) },
        tokenUrl,
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Save failed.');
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      document.getElementById('fee-reset').click();
      await loadFees();
    });

    document.getElementById('invoice-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!canManageFinance(me)) return;
      show('');
      var fd = new FormData(e.target);
      var linesRaw = fd.get('lines_json');
      var lines;
      try {
        lines = JSON.parse(linesRaw);
      } catch (ex) {
        show('Lines must be valid JSON.');
        return;
      }
      if (!Array.isArray(lines) || !lines.length) {
        show('Provide a non-empty JSON array of line objects.');
        return;
      }
      var payload = {
        student: Number(fd.get('student')),
        due_date: fd.get('due_date'),
        notes: fd.get('notes') || '',
        lines: lines,
      };
      var btn = document.getElementById('invoice-submit');
      btn.disabled = true;
      var res = await CampusOpsAuth.apiJson(
        cfg.invoicesUrl,
        { method: 'POST', body: JSON.stringify(payload) },
        tokenUrl,
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Create failed.');
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      e.target.reset();
      e.target.lines_json.value =
        '[{"label":"Tuition","quantity":"1","unit_price":"5000.00","amount":"5000.00"}]';
      await loadInvoices();
    });

    async function opInvoice(pathSuffix) {
      show('');
      var id = document.getElementById('op-invoice-id').value;
      if (!id) {
        show('Enter an invoice ID.');
        return;
      }
      var url = cfg.invoicesUrl + id + '/' + pathSuffix + '/';
      var res = await CampusOpsAuth.apiJson(url, { method: 'POST', body: '{}' }, tokenUrl);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Operation failed.');
        return;
      }
      await loadInvoices();
      await loadPayments();
    }

    document.getElementById('btn-issue').addEventListener('click', function () {
      if (!canManageFinance(me)) return;
      opInvoice('issue');
    });
    document.getElementById('btn-void').addEventListener('click', function () {
      if (!canManageFinance(me)) return;
      opInvoice('void');
    });

    document.getElementById('btn-pay').addEventListener('click', async function () {
      if (!canManageFinance(me)) return;
      show('');
      var id = document.getElementById('op-invoice-id').value;
      if (!id) {
        show('Enter an invoice ID.');
        return;
      }
      var payload = {
        amount: document.getElementById('pay-amount').value,
        method: document.getElementById('pay-method').value,
        reference: document.getElementById('pay-ref').value || '',
      };
      var url = cfg.invoicesUrl + id + '/record-payment/';
      var res = await CampusOpsAuth.apiJson(
        url,
        { method: 'POST', body: JSON.stringify(payload) },
        tokenUrl,
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Payment failed.');
        return;
      }
      await loadInvoices();
      await loadPayments();
    });

    (async function boot() {
      var ok = await loadMe();
      if (!ok) return;
      await loadFees();
      await loadInvoices();
      await loadPayments();
    })();
  }

  global.CampusOpsFinance = { init: init };
})(window);
