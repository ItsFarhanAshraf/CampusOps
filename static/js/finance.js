/* CampusOps — Finance Hub  (depends on app.js) */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var _roles    = [];
  var _tabLoaded = {};
  var _feeStructures = [];

  /* ── Role helpers ── */
  function hasRole() {
    var args = Array.from(arguments);
    return args.some(function (r) { return _roles.indexOf(r) !== -1; });
  }
  function canManage() {
    return hasRole('finance', 'campus_administrator', 'staff');
  }

  /* ── Tab switching ── */
  function initTabs() {
    var btns = document.querySelectorAll('#fin-tabs [data-tab]');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        ['fees','invoices','pending','installments','payments'].forEach(function (t) {
          var el = document.getElementById('tab-' + t);
          if (el) el.classList.toggle('d-none', t !== btn.dataset.tab);
        });
        if (!_tabLoaded[btn.dataset.tab]) {
          _tabLoaded[btn.dataset.tab] = true;
          loadTab(btn.dataset.tab);
        }
      });
    });
  }

  function loadTab(name) {
    if (name === 'invoices')     loadInvoices();
    if (name === 'pending')      loadPendingPayments();
    if (name === 'installments') loadInstallmentPlans();
    if (name === 'payments')     loadPayments();
  }

  /* ── Generic fetch ── */
  async function apiFetch(url) {
    var res = await CampusApp.apiJson(url);
    if (!res.ok) return [];
    var data = await res.json();
    return Array.isArray(data) ? data : (data.results || []);
  }

  /* ── FEE STRUCTURES ── */
  async function loadFees() {
    CampusApp.showTableLoader('fees-tbody', 5);
    var list = await apiFetch('/api/v1/finance/fee-structures/');
    _feeStructures = list;
    populateFeeSelect(list);
    renderFeesTable(list);
    CampusApp.initTableSearch('fee-search', 'fees-tbody');
  }

  function populateFeeSelect(list) {
    var sel = document.getElementById('invoice-fee-select');
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    list.forEach(function (f) {
      var opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name + ' (' + CampusApp.fmtMoney(f.amount) + ')';
      opt.dataset.amount = f.amount;
      sel.appendChild(opt);
    });
  }

  function renderFeesTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('fees-tbody', 5, 'No fee structures defined.', 'bi-tags');
      document.getElementById('fees-info').textContent = '';
      return;
    }
    var rows = list.map(function (f) {
      var tr = document.createElement('tr');
      tr.dataset.search = [f.name, f.category, f.academic_year].join(' ');
      tr.innerHTML =
        '<td><span class="fw-500">' + esc(f.name) + '</span></td>' +
        '<td>' + esc(f.category || '—') + '</td>' +
        '<td>' + CampusApp.fmtMoney(f.amount) + '</td>' +
        '<td>' + esc(f.frequency || '—') + '</td>' +
        '<td>' + esc(f.academic_year || '—') + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'fees-tbody', 'fees-pager', 'fees-info');
  }

  /* ── INVOICES ── */
  async function loadInvoices() {
    CampusApp.showTableLoader('invoices-tbody', 7);
    var statusV = document.getElementById('inv-status-filter').value;
    var url = '/api/v1/finance/invoices/' + (statusV ? '?status=' + statusV : '');
    var list = await apiFetch(url);
    renderInvoicesTable(list);
    CampusApp.initTableSearch('inv-search', 'invoices-tbody');
  }

  function renderInvoicesTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('invoices-tbody', 7, 'No invoices found.', 'bi-receipt');
      document.getElementById('inv-info').textContent = '';
      return;
    }
    var rows = list.map(function (inv) {
      var invNum  = inv.invoice_number || ('INV-' + inv.id);
      var student = inv.student_email  || inv.student || '—';
      var balance = parseFloat(inv.balance || 0);
      var total   = parseFloat(inv.total   || 0);

      var actions = '<div class="d-flex gap-1 flex-wrap">';
      actions += '<button class="btn btn-xs btn-outline-secondary" onclick="CampusFinance.downloadPDF(' + inv.id + ')" title="Download PDF"><i class="bi bi-file-pdf"></i></button>';

      if (canManage()) {
        if (inv.status === 'draft') {
          actions += '<button class="btn btn-xs btn-outline-primary" onclick="CampusFinance.issueInvoice(' + inv.id + ')">Issue</button>';
        }
        if (inv.status === 'issued' || inv.status === 'partially_paid') {
          actions += '<button class="btn btn-xs btn-outline-success" onclick="CampusFinance.openPayModal(' + inv.id + ',\'' + esc(invNum) + '\',' + balance + ')">Pay</button>';
          actions += '<button class="btn btn-xs btn-outline-warning" onclick="CampusFinance.openPendingModal(' + inv.id + ',\'' + esc(invNum) + '\')">Pending</button>';
          if (inv.installment_plan === null || inv.installment_plan === undefined) {
            actions += '<button class="btn btn-xs btn-outline-info" onclick="CampusFinance.openInstallModal(' + inv.id + ',\'' + esc(invNum) + '\',' + balance + ')">Installs</button>';
          }
          actions += '<button class="btn btn-xs btn-outline-danger" onclick="CampusFinance.voidInvoice(' + inv.id + ')">Void</button>';
        }
      }
      actions += '</div>';

      var tr = document.createElement('tr');
      tr.dataset.search = [invNum, student, inv.status].join(' ');
      tr.innerHTML =
        '<td><span class="fw-500">' + esc(invNum) + '</span></td>' +
        '<td style="font-size:.8rem;">' + esc(student) + '</td>' +
        '<td>' + CampusApp.fmtDate(inv.due_date) + '</td>' +
        '<td>' + CampusApp.fmtMoney(total) + '</td>' +
        '<td class="' + (balance > 0 ? 'text-danger fw-500' : 'text-success') + '">' + CampusApp.fmtMoney(balance) + '</td>' +
        '<td>' + CampusApp.statusBadge(inv.status) + '</td>' +
        '<td>' + actions + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'invoices-tbody', 'inv-pager', 'inv-info');
  }

  /* ── PENDING PAYMENTS ── */
  async function loadPendingPayments() {
    CampusApp.showTableLoader('pending-tbody', 5);
    var list = await apiFetch('/api/v1/finance/payments/?status=pending');
    renderPendingTable(list);
    CampusApp.initTableSearch('pending-search', 'pending-tbody');
  }

  function renderPendingTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('pending-tbody', 5, 'No pending payments.', 'bi-clock');
      document.getElementById('pending-info').textContent = '';
      return;
    }
    var rows = list.map(function (p) {
      var actions = '<div class="d-flex gap-1">';
      if (canManage()) {
        actions += '<button class="btn btn-xs btn-outline-success" onclick="CampusFinance.confirmPending(' + p.id + ')">Confirm</button>';
        actions += '<button class="btn btn-xs btn-outline-danger" onclick="CampusFinance.cancelPending(' + p.id + ')">Cancel</button>';
      }
      actions += '</div>';

      var tr = document.createElement('tr');
      tr.dataset.search = [p.client_reference || '', p.invoice || ''].join(' ');
      tr.innerHTML =
        '<td style="font-size:.78rem;">' + esc(p.client_reference || '—') + '</td>' +
        '<td>' + (p.invoice || '—') + '</td>' +
        '<td>' + CampusApp.fmtMoney(p.amount) + '</td>' +
        '<td>' + CampusApp.fmtDate(p.expires_at) + '</td>' +
        '<td>' + actions + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'pending-tbody', 'pending-pager', 'pending-info');
  }

  /* ── INSTALLMENT PLANS ── */
  async function loadInstallmentPlans() {
    CampusApp.showTableLoader('plans-tbody', 5);
    var list = await apiFetch('/api/v1/finance/installment-plans/');
    renderPlansTable(list);
    CampusApp.initTableSearch('plan-search', 'plans-tbody');
  }

  function renderPlansTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('plans-tbody', 5, 'No installment plans.', 'bi-calendar3');
      document.getElementById('plans-info').textContent = '';
      return;
    }
    var rows = list.map(function (p) {
      var installs = p.installments ? p.installments.length : (p.number_of_installments || '—');
      var total    = p.total_amount || (p.installments
        ? p.installments.reduce(function (s, i) { return s + parseFloat(i.amount || 0); }, 0).toFixed(2)
        : '—');

      /* Status based on installments */
      var allPaid = p.installments && p.installments.every(function (i) { return i.status === 'paid'; });
      var someOverdue = p.installments && p.installments.some(function (i) { return i.status === 'overdue'; });
      var status = allPaid ? 'completed' : (someOverdue ? 'overdue' : 'scheduled');

      var tr = document.createElement('tr');
      tr.dataset.search = [p.invoice || '', status].join(' ');
      tr.innerHTML =
        '<td>' + (p.invoice || '—') + '</td>' +
        '<td>' + installs + '</td>' +
        '<td>' + CampusApp.fmtMoney(total) + '</td>' +
        '<td>' + CampusApp.statusBadge(status) + '</td>' +
        '<td>' + CampusApp.fmtDate(p.created_at) + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'plans-tbody', 'plans-pager', 'plans-info');
  }

  /* ── ALL PAYMENTS ── */
  async function loadPayments() {
    CampusApp.showTableLoader('payments-tbody', 6);
    var list = await apiFetch('/api/v1/finance/payments/');
    renderPaymentsTable(list);
    CampusApp.initTableSearch('pay-search', 'payments-tbody');
  }

  function renderPaymentsTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('payments-tbody', 6, 'No payments recorded.', 'bi-check-circle');
      document.getElementById('pay-info').textContent = '';
      return;
    }
    var rows = list.map(function (p) {
      var tr = document.createElement('tr');
      tr.dataset.search = [p.invoice || '', p.payment_method, p.status, p.client_reference || ''].join(' ');
      tr.innerHTML =
        '<td>' + (p.invoice || '—') + '</td>' +
        '<td>' + CampusApp.fmtMoney(p.amount) + '</td>' +
        '<td>' + esc(p.payment_method || '—') + '</td>' +
        '<td>' + CampusApp.statusBadge(p.status) + '</td>' +
        '<td>' + CampusApp.fmtDate(p.paid_at || p.created_at) + '</td>' +
        '<td style="font-size:.78rem;">' + esc(p.client_reference || p.reference || '—') + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'payments-tbody', 'pay-pager', 'pay-info');
  }

  /* ── ACTIONS ── */
  async function issueInvoice(id) {
    if (!confirm('Issue this invoice?')) return;
    try {
      var res = await CampusApp.apiJson('/api/v1/finance/invoices/' + id + '/issue/', { method: 'POST' });
      if (res.ok) { CampusApp.toastSuccess('Invoice issued!'); loadInvoices(); }
      else { var d = await res.json(); CampusApp.handleApiError(res, d); }
    } catch (e) { CampusApp.toastError('Network error.'); }
  }

  async function voidInvoice(id) {
    if (!confirm('Void this invoice? This cannot be undone.')) return;
    try {
      var res = await CampusApp.apiJson('/api/v1/finance/invoices/' + id + '/void/', { method: 'POST' });
      if (res.ok) { CampusApp.toastSuccess('Invoice voided.'); loadInvoices(); }
      else { var d = await res.json(); CampusApp.handleApiError(res, d); }
    } catch (e) { CampusApp.toastError('Network error.'); }
  }

  async function confirmPending(id) {
    if (!confirm('Confirm this pending payment?')) return;
    try {
      var res = await CampusApp.apiJson('/api/v1/finance/payments/' + id + '/confirm/', { method: 'POST' });
      if (res.ok) { CampusApp.toastSuccess('Payment confirmed!'); loadPendingPayments(); loadPayments(); }
      else { var d = await res.json(); CampusApp.handleApiError(res, d); }
    } catch (e) { CampusApp.toastError('Network error.'); }
  }

  async function cancelPending(id) {
    if (!confirm('Cancel this pending payment?')) return;
    try {
      var res = await CampusApp.apiJson('/api/v1/finance/payments/' + id + '/cancel/', { method: 'POST' });
      if (res.ok) { CampusApp.toastSuccess('Payment cancelled.'); loadPendingPayments(); }
      else { var d = await res.json(); CampusApp.handleApiError(res, d); }
    } catch (e) { CampusApp.toastError('Network error.'); }
  }

  async function downloadPDF(id) {
    var access = CampusApp.getAccess();
    try {
      var res = await fetch('/api/v1/finance/invoices/' + id + '/pdf/', {
        headers: { 'Authorization': 'Bearer ' + access },
      });
      if (!res.ok) { CampusApp.toastError('Could not generate PDF.'); return; }
      var blob = await res.blob();
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href     = url;
      a.download = 'invoice-' + id + '.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { CampusApp.toastError('Network error.'); }
  }

  /* ── MODAL OPENERS ── */
  function openPayModal(invId, invNum, balance) {
    document.getElementById('pay-invoice-id').value = invId;
    document.getElementById('pay-invoice-num').textContent = invNum;
    document.getElementById('pay-invoice-balance').textContent = CampusApp.fmtMoney(balance);
    document.getElementById('form-pay').reset();
    showFormError('pay-modal-error', '');
    new bootstrap.Modal(document.getElementById('modal-pay')).show();
  }

  function openPendingModal(invId, invNum) {
    document.getElementById('pending-invoice-id').value = invId;
    document.getElementById('pending-invoice-num').textContent = invNum;
    document.getElementById('form-pending-pay').reset();
    showFormError('pending-modal-error', '');
    new bootstrap.Modal(document.getElementById('modal-pending-pay')).show();
  }

  function openInstallModal(invId, invNum, balance) {
    document.getElementById('inst-invoice-id').value = invId;
    document.getElementById('inst-invoice-num').textContent = invNum;
    var totalInput = document.querySelector('#form-installment [name="total_amount"]');
    if (totalInput) totalInput.value = balance.toFixed(2);
    document.getElementById('form-installment').reset();
    /* Restore total_amount after reset */
    if (totalInput) totalInput.value = balance.toFixed(2);
    showFormError('inst-modal-error', '');
    new bootstrap.Modal(document.getElementById('modal-installment')).show();
  }

  /* ── INVOICE LINE BUILDER ── */
  var _lineCount = 0;

  function addInvoiceLine(feeId, feeAmount) {
    var container = document.getElementById('invoice-lines-container');
    if (!container) return;
    var idx = ++_lineCount;
    var options = _feeStructures.map(function (f) {
      return '<option value="' + f.id + '" data-amount="' + f.amount + '" ' +
        (f.id == feeId ? 'selected' : '') + '>' + esc(f.name) + '</option>';
    }).join('');

    var div = document.createElement('div');
    div.className = 'border rounded p-2 mb-2 position-relative';
    div.innerHTML =
      '<button type="button" class="btn-close position-absolute top-0 end-0 p-2" style="font-size:.6rem;" onclick="this.closest(\'.border\').remove()"></button>' +
      '<div class="row g-2">' +
        '<div class="col-md-6">' +
          '<label class="form-label">Fee Structure</label>' +
          '<select class="form-select form-select-sm line-fee-select" name="lines[' + idx + '][fee_structure]">' +
            '<option value="">— custom —</option>' + options +
          '</select>' +
        '</div>' +
        '<div class="col-md-6">' +
          '<label class="form-label">Description</label>' +
          '<input type="text" class="form-control form-control-sm" name="lines[' + idx + '][description]" placeholder="Item description">' +
        '</div>' +
        '<div class="col-md-4">' +
          '<label class="form-label">Qty</label>' +
          '<input type="number" class="form-control form-control-sm" name="lines[' + idx + '][quantity]" value="1" min="1">' +
        '</div>' +
        '<div class="col-md-4">' +
          '<label class="form-label">Unit Price</label>' +
          '<input type="number" class="form-control form-control-sm line-unit-price" name="lines[' + idx + '][unit_price]" ' +
            'value="' + (feeAmount || '') + '" min="0" step="0.01">' +
        '</div>' +
        '<div class="col-md-4">' +
          '<label class="form-label">Discount</label>' +
          '<input type="number" class="form-control form-control-sm" name="lines[' + idx + '][discount]" value="0" min="0" step="0.01">' +
        '</div>' +
      '</div>';

    /* Fee select → auto-fill unit price */
    var sel = div.querySelector('.line-fee-select');
    sel.addEventListener('change', function () {
      var opt = this.options[this.selectedIndex];
      var amount = opt.dataset.amount;
      if (amount) div.querySelector('.line-unit-price').value = amount;
    });

    container.appendChild(div);
  }

  /* ── FORM SUBMISSIONS ── */
  function initForms() {
    /* Fee Structure */
    var formFee = document.getElementById('form-fee');
    if (formFee) {
      formFee.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn   = document.getElementById('btn-submit-fee');
        var errId = 'fee-modal-error';
        CampusApp.setLoading(btn, true, 'Creating…');
        showFormError(errId, '');
        var payload = simpleFormData(formFee);
        try {
          var res = await CampusApp.apiJson('/api/v1/finance/fee-structures/', { method: 'POST', body: JSON.stringify(payload) });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errId, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-fee')).hide();
          formFee.reset();
          CampusApp.toastSuccess('Fee structure created!');
          loadFees();
        } catch (ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Invoice */
    var formInv = document.getElementById('form-invoice');
    if (formInv) {
      formInv.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn   = document.getElementById('btn-submit-invoice');
        var errId = 'inv-modal-error';
        CampusApp.setLoading(btn, true, 'Creating…');
        showFormError(errId, '');

        /* Build payload with lines array */
        var fd = new FormData(formInv);
        var payload = { student_email: fd.get('student_email'), due_date: fd.get('due_date'), lines: [] };
        if (fd.get('notes')) payload.notes = fd.get('notes');

        /* Collect lines from the line container */
        var linesContainer = document.getElementById('invoice-lines-container');
        var lineGroups = {};
        if (linesContainer) {
          linesContainer.querySelectorAll('[name^="lines["]').forEach(function (inp) {
            var m = inp.name.match(/lines\[(\d+)\]\[(.+)\]/);
            if (!m) return;
            var idx = m[1], field = m[2];
            if (!lineGroups[idx]) lineGroups[idx] = {};
            if (inp.value !== '') lineGroups[idx][field] = inp.value;
          });
          Object.values(lineGroups).forEach(function (line) {
            if (line.unit_price) payload.lines.push(line);
          });
        }

        if (!payload.lines.length) {
          showFormError(errId, 'Please add at least one invoice line.');
          CampusApp.setLoading(btn, false);
          return;
        }

        try {
          var res = await CampusApp.apiJson('/api/v1/finance/invoices/', { method: 'POST', body: JSON.stringify(payload) });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errId, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-invoice')).hide();
          formInv.reset();
          document.getElementById('invoice-lines-container').innerHTML = '';
          _lineCount = 0;
          CampusApp.toastSuccess('Invoice created!');
          loadInvoices();
        } catch (ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Record Payment */
    var formPay = document.getElementById('form-pay');
    if (formPay) {
      formPay.addEventListener('submit', async function (e) {
        e.preventDefault();
        var invId = document.getElementById('pay-invoice-id').value;
        var btn   = document.getElementById('btn-submit-pay');
        var errId = 'pay-modal-error';
        CampusApp.setLoading(btn, true, 'Recording…');
        showFormError(errId, '');
        var payload = simpleFormData(formPay);
        try {
          var res = await CampusApp.apiJson('/api/v1/finance/invoices/' + invId + '/record-payment/', { method: 'POST', body: JSON.stringify(payload) });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errId, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-pay')).hide();
          CampusApp.toastSuccess('Payment recorded!');
          loadInvoices();
          if (_tabLoaded['payments']) loadPayments();
        } catch (ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Pending payment */
    var formPending = document.getElementById('form-pending-pay');
    if (formPending) {
      formPending.addEventListener('submit', async function (e) {
        e.preventDefault();
        var invId = document.getElementById('pending-invoice-id').value;
        var btn   = document.getElementById('btn-submit-pending');
        var errId = 'pending-modal-error';
        CampusApp.setLoading(btn, true, 'Initiating…');
        showFormError(errId, '');
        var payload = simpleFormData(formPending);
        try {
          var res = await CampusApp.apiJson('/api/v1/finance/invoices/' + invId + '/initiate-pending-payment/', { method: 'POST', body: JSON.stringify(payload) });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errId, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-pending-pay')).hide();
          CampusApp.toastSuccess('Pending payment initiated!');
          if (_tabLoaded['pending']) loadPendingPayments();
        } catch (ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Installment Plan */
    var formInst = document.getElementById('form-installment');
    if (formInst) {
      formInst.addEventListener('submit', async function (e) {
        e.preventDefault();
        var invId = document.getElementById('inst-invoice-id').value;
        var btn   = document.getElementById('btn-submit-installment');
        var errId = 'inst-modal-error';
        CampusApp.setLoading(btn, true, 'Creating…');
        showFormError(errId, '');
        var payload = simpleFormData(formInst);
        try {
          var res = await CampusApp.apiJson('/api/v1/finance/invoices/' + invId + '/create-installment-plan/', { method: 'POST', body: JSON.stringify(payload) });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errId, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-installment')).hide();
          CampusApp.toastSuccess('Installment plan created!');
          if (_tabLoaded['installments']) loadInstallmentPlans();
        } catch (ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Invoice line add button */
    var btnAddLine = document.getElementById('btn-add-line');
    if (btnAddLine) btnAddLine.addEventListener('click', function () { addInvoiceLine(); });
  }

  /* ── Role-based UI ── */
  function applyRoleUI() {
    if (!canManage()) return;
    ['btn-add-fee','btn-create-invoice'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('d-none');
    });

    var btnFee = document.getElementById('btn-add-fee');
    if (btnFee) btnFee.addEventListener('click', function () {
      new bootstrap.Modal(document.getElementById('modal-fee')).show();
    });
    var btnInv = document.getElementById('btn-create-invoice');
    if (btnInv) btnInv.addEventListener('click', function () {
      /* Add default first line */
      if (!document.getElementById('invoice-lines-container').children.length) addInvoiceLine();
      new bootstrap.Modal(document.getElementById('modal-invoice')).show();
    });
  }

  /* ── Filter events ── */
  function initFilterEvents() {
    var invStatus = document.getElementById('inv-status-filter');
    if (invStatus) invStatus.addEventListener('change', loadInvoices);
  }

  /* ── Utilities ── */
  function esc(str) {
    return String(str || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function simpleFormData(form) {
    var fd = new FormData(form);
    var obj = {};
    fd.forEach(function (v, k) { if (v !== '') obj[k] = v; });
    return obj;
  }

  function showFormError(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    if (msg) { el.textContent = msg; el.classList.remove('d-none'); }
    else      { el.textContent = ''; el.classList.add('d-none'); }
  }

  /* ── Init ── */
  (async function () {
    try {
      var res = await CampusApp.apiJson('/api/v1/auth/me/');
      if (res.ok) {
        var me = await res.json();
        _roles = me.group_names || [];
      }
    } catch (e) {}

    applyRoleUI();
    initTabs();
    initForms();
    initFilterEvents();

    /* Load fees tab immediately (default active) */
    _tabLoaded['fees'] = true;
    loadFees();
  })();

  /* Expose to global for inline onclick attributes */
  window.CampusFinance = {
    issueInvoice:   issueInvoice,
    voidInvoice:    voidInvoice,
    openPayModal:   openPayModal,
    openPendingModal: openPendingModal,
    openInstallModal: openInstallModal,
    confirmPending: confirmPending,
    cancelPending:  cancelPending,
    downloadPDF:    downloadPDF,
  };
})();
