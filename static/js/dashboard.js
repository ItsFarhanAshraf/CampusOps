/* CampusOps — Dashboard page */
(function () {
  'use strict';

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  async function loadStats() {
    try {
      /* Courses */
      var cr = await CampusApp.apiJson('/api/v1/academic/courses/');
      if (cr.ok) {
        var cd = await cr.json();
        setText('stat-courses', Array.isArray(cd) ? cd.length : (cd.count || '—'));
      } else { setText('stat-courses', '—'); }
    } catch (e) { setText('stat-courses', '—'); }

    try {
      /* Enrollments */
      var er = await CampusApp.apiJson('/api/v1/academic/enrollments/');
      if (er.ok) {
        var ed = await er.json();
        setText('stat-enrollments', Array.isArray(ed) ? ed.length : (ed.count || '—'));
      } else { setText('stat-enrollments', '—'); }
    } catch (e) { setText('stat-enrollments', '—'); }

    try {
      /* Open invoices (issued or partially_paid) */
      var ir = await CampusApp.apiJson('/api/v1/finance/invoices/');
      if (ir.ok) {
        var id_ = await ir.json();
        var list = Array.isArray(id_) ? id_ : (id_.results || []);
        var open = list.filter(function (x) {
          return x.status === 'issued' || x.status === 'partially_paid';
        });
        setText('stat-invoices', open.length);
        renderRecentInvoices(list.slice(0, 5));
      } else { setText('stat-invoices', '—'); }
    } catch (e) { setText('stat-invoices', '—'); }

    try {
      /* Pending payments */
      var pr = await CampusApp.apiJson('/api/v1/finance/payments/?status=pending');
      if (pr.ok) {
        var pd = await pr.json();
        var pl = Array.isArray(pd) ? pd : (pd.results || []);
        setText('stat-pending', pl.length);
      } else { setText('stat-pending', '—'); }
    } catch (e) { setText('stat-pending', '—'); }
  }

  async function loadRecentAttendance() {
    try {
      var res = await CampusApp.apiJson('/api/v1/academic/attendance/');
      if (!res.ok) { renderRecentAttendance([]); return; }
      var data = await res.json();
      var list = Array.isArray(data) ? data : (data.results || []);
      renderRecentAttendance(list.slice(0, 5));
    } catch (e) { renderRecentAttendance([]); }
  }

  function renderRecentInvoices(list) {
    var tbody = document.getElementById('recent-invoices-tbody');
    if (!tbody) return;
    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3" style="font-size:.82rem;">No invoices yet</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (inv) {
      return '<tr>' +
        '<td><span class="fw-500">' + (inv.invoice_number || ('INV-' + inv.id)) + '</span></td>' +
        '<td>' + CampusApp.fmtMoney(inv.total || 0) + '</td>' +
        '<td>' + CampusApp.statusBadge(inv.status) + '</td>' +
      '</tr>';
    }).join('');
  }

  function renderRecentAttendance(list) {
    var tbody = document.getElementById('recent-attendance-tbody');
    if (!tbody) return;
    if (!list || list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3" style="font-size:.82rem;">No attendance records yet</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(function (a) {
      return '<tr>' +
        '<td>' + (a.course_detail && a.course_detail.code ? a.course_detail.code : (a.course || '—')) + '</td>' +
        '<td>' + CampusApp.fmtDate(a.session_date) + '</td>' +
        '<td>' + CampusApp.statusBadge(a.status) + '</td>' +
      '</tr>';
    }).join('');
  }

  /* Init */
  loadStats();
  loadRecentAttendance();
})();
