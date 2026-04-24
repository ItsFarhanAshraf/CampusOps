/* CampusOps — Academic Hub  (depends on app.js) */
(function () {
  'use strict';

  var PAGE_SIZE = 10;
  var _courses  = [];
  var _roles    = [];
  var _me       = null;

  /* ── Role helpers ── */
  function hasRole() {
    var args = Array.from(arguments);
    return args.some(function (r) { return _roles.indexOf(r) !== -1; });
  }
  function canManage() {
    return hasRole('faculty', 'staff', 'campus_administrator');
  }

  /* ── Tab switching ── */
  var _tabLoaded = {};

  function initTabs() {
    var btns = document.querySelectorAll('#acad-tabs [data-tab]');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        ['courses','attendance','grades','enrollments','reports'].forEach(function (t) {
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
    if (name === 'attendance')  loadAttendance();
    if (name === 'grades')      loadGrades();
    if (name === 'enrollments') loadEnrollments();
    if (name === 'reports')     initReports();
  }

  /* ── Fetch helper ── */
  async function apiFetch(url) {
    var res = await CampusApp.apiJson(url);
    if (!res.ok) return [];
    var data = await res.json();
    return Array.isArray(data) ? data : (data.results || []);
  }

  /* ── Populate course dropdowns ── */
  function populateCourseSelects(list) {
    ['att-course-filter','grade-course-filter',
     'report-att-course','report-grade-course',
     'enroll-course-select'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      /* Keep first option */
      while (sel.options.length > 1) sel.remove(1);
      list.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.code + ' — ' + c.name;
        sel.appendChild(opt);
      });
    });
  }

  /* ── COURSES ── */
  async function loadCourses() {
    CampusApp.showTableLoader('courses-tbody', 5);
    var list = await apiFetch('/api/v1/academic/courses/');
    _courses = list;
    populateCourseSelects(list);
    renderCoursesTable(list);
    CampusApp.initTableSearch('course-search', 'courses-tbody');
  }

  function renderCoursesTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('courses-tbody', 5, 'No courses available.', 'bi-book');
      document.getElementById('courses-info').textContent = '';
      return;
    }
    var rows = list.map(function (c) {
      var tr = document.createElement('tr');
      tr.dataset.search = [c.code, c.name, c.instructor_detail && c.instructor_detail.email || ''].join(' ');
      tr.innerHTML =
        '<td><span class="fw-500">' + esc(c.code) + '</span></td>' +
        '<td>' + esc(c.name) + '</td>' +
        '<td>' + (c.credits || '—') + '</td>' +
        '<td>' + (c.instructor_detail ? esc(c.instructor_detail.email || '') : '—') + '</td>' +
        '<td>' +
          (canManage()
            ? '<button class="btn btn-xs btn-outline-danger" onclick="CampusAcademic.deleteCourse(' + c.id + ')">Delete</button>'
            : '—') +
        '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'courses-tbody', 'courses-pager', 'courses-info');
  }

  /* ── ATTENDANCE ── */
  async function loadAttendance() {
    CampusApp.showTableLoader('attendance-tbody', 5);
    var courseId = document.getElementById('att-course-filter').value;
    var statusV  = document.getElementById('att-status-filter').value;
    var url = '/api/v1/academic/attendance/';
    var params = [];
    if (courseId) params.push('course=' + courseId);
    if (statusV)  params.push('status=' + statusV);
    if (params.length) url += '?' + params.join('&');
    var list = await apiFetch(url);
    renderAttendanceTable(list);
    CampusApp.initTableSearch('att-search', 'attendance-tbody');
  }

  function renderAttendanceTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('attendance-tbody', 5, 'No attendance records found.', 'bi-calendar-x');
      document.getElementById('att-info').textContent = '';
      return;
    }
    var rows = list.map(function (a) {
      var studentEmail = a.enrollment_detail ? (a.enrollment_detail.student_email || '—') : '—';
      var courseCode   = a.course_detail ? (a.course_detail.code || '—') : '—';
      var tr = document.createElement('tr');
      tr.dataset.search = [studentEmail, courseCode, a.session_date, a.status].join(' ');
      tr.innerHTML =
        '<td>' + esc(studentEmail) + '</td>' +
        '<td>' + esc(courseCode) + '</td>' +
        '<td>' + CampusApp.fmtDate(a.session_date) + '</td>' +
        '<td>' + CampusApp.statusBadge(a.status) + '</td>' +
        '<td class="text-muted" style="font-size:.78rem;">' + esc(a.notes || '') + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'attendance-tbody', 'att-pager', 'att-info');
  }

  /* ── GRADES ── */
  async function loadGrades() {
    CampusApp.showTableLoader('grades-tbody', 6);
    var courseId = document.getElementById('grade-course-filter').value;
    var url = '/api/v1/academic/grades/' + (courseId ? '?course=' + courseId : '');
    var list = await apiFetch(url);
    renderGradesTable(list);
    CampusApp.initTableSearch('grade-search', 'grades-tbody');
  }

  function renderGradesTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('grades-tbody', 6, 'No grade records found.', 'bi-star');
      document.getElementById('grades-info').textContent = '';
      return;
    }
    var rows = list.map(function (g) {
      var studentEmail = g.enrollment_detail ? (g.enrollment_detail.student_email || '—') : '—';
      var courseCode   = g.course_detail ? (g.course_detail.code || '—') : '—';
      var pct = g.max_score ? ((parseFloat(g.score) / parseFloat(g.max_score)) * 100).toFixed(1) + '%' : '—';
      var tr = document.createElement('tr');
      tr.dataset.search = [studentEmail, courseCode, g.grade_type, g.letter_grade].join(' ');
      tr.innerHTML =
        '<td>' + esc(studentEmail) + '</td>' +
        '<td>' + esc(courseCode) + '</td>' +
        '<td>' + g.score + ' / ' + (g.max_score || '—') +
          ' <small class="text-muted">(' + pct + ')</small></td>' +
        '<td>' + esc(g.letter_grade || '—') + '</td>' +
        '<td>' + esc(g.grade_type || '—') + '</td>' +
        '<td>' + CampusApp.fmtDate(g.graded_at) + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'grades-tbody', 'grades-pager', 'grades-info');
  }

  /* ── ENROLLMENTS ── */
  async function loadEnrollments() {
    CampusApp.showTableLoader('enrollments-tbody', 4);
    var statusV = document.getElementById('enroll-status-filter').value;
    var url = '/api/v1/academic/enrollments/' + (statusV ? '?status=' + statusV : '');
    var list = await apiFetch(url);

    /* Populate enrollment selects for attendance/grade modals */
    populateEnrollmentSelects(list);
    renderEnrollmentsTable(list);
    CampusApp.initTableSearch('enroll-search', 'enrollments-tbody');
  }

  function populateEnrollmentSelects(list) {
    ['att-enrollment-select','grade-enrollment-select'].forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      while (sel.options.length > 1) sel.remove(1);
      list.forEach(function (e) {
        var opt = document.createElement('option');
        opt.value = e.id;
        var studentLabel = e.student_email || ('Student #' + e.student);
        var courseLabel  = e.course_detail ? e.course_detail.code : ('Course #' + e.course);
        opt.textContent  = studentLabel + ' — ' + courseLabel;
        sel.appendChild(opt);
      });
    });
  }

  function renderEnrollmentsTable(list) {
    if (!list.length) {
      CampusApp.showEmptyState('enrollments-tbody', 4, 'No enrollments found.', 'bi-person-x');
      document.getElementById('enroll-info').textContent = '';
      return;
    }
    var rows = list.map(function (e) {
      var studentEmail = e.student_email || '—';
      var courseCode   = e.course_detail ? e.course_detail.code : '—';
      var tr = document.createElement('tr');
      tr.dataset.search = [studentEmail, courseCode, e.status].join(' ');
      tr.innerHTML =
        '<td>' + esc(studentEmail) + '</td>' +
        '<td>' + esc(courseCode) + '</td>' +
        '<td>' + CampusApp.fmtDate(e.enrolled_on) + '</td>' +
        '<td>' + CampusApp.statusBadge(e.status) + '</td>';
      return tr;
    });
    CampusApp.createPaginator(rows, PAGE_SIZE, 'enrollments-tbody', 'enroll-pager', 'enroll-info');
  }

  /* ── REPORTS ── */
  function initReports() {}

  async function runReport(type) {
    var courseId, resultDiv, btn;
    if (type === 'attendance') {
      courseId  = document.getElementById('report-att-course').value;
      resultDiv = document.getElementById('att-report-result');
      btn       = document.getElementById('btn-att-report');
    } else {
      courseId  = document.getElementById('report-grade-course').value;
      resultDiv = document.getElementById('grade-report-result');
      btn       = document.getElementById('btn-grade-report');
    }
    if (!courseId) { CampusApp.toastWarning('Please select a course first.'); return; }

    CampusApp.setLoading(btn, true, 'Generating…');
    var endpoint = type === 'attendance'
      ? '/api/v1/academic/reports/attendance/?course=' + courseId
      : '/api/v1/academic/reports/grades/?course=' + courseId;

    try {
      var res = await CampusApp.apiJson(endpoint);
      CampusApp.setLoading(btn, false);
      if (!res.ok) { var d = await res.json(); CampusApp.handleApiError(res, d); return; }
      var data = await res.json();
      renderReportResult(resultDiv, data, type);
    } catch (e) {
      CampusApp.setLoading(btn, false);
      CampusApp.toastError('Failed to generate report.');
    }
  }

  function renderReportResult(container, data, type) {
    if (!data || (Array.isArray(data) && !data.length)) {
      container.innerHTML = '<p class="text-muted" style="font-size:.82rem;">No data for this course.</p>';
      return;
    }
    var list = Array.isArray(data) ? data : [data];
    var html = '<div class="table-responsive mt-2"><table class="table table-sm table-bordered" style="font-size:.8rem;">';
    if (type === 'attendance') {
      html += '<thead><tr><th>Student</th><th>Present</th><th>Absent</th><th>Late</th><th>Rate</th></tr></thead><tbody>';
      list.forEach(function (r) {
        html += '<tr>' +
          '<td>' + esc(r.student_email || r.student || '—') + '</td>' +
          '<td>' + (r.present  || 0) + '</td>' +
          '<td>' + (r.absent   || 0) + '</td>' +
          '<td>' + (r.late     || 0) + '</td>' +
          '<td>' + (r.rate !== undefined ? parseFloat(r.rate).toFixed(1) + '%' : '—') + '</td>' +
        '</tr>';
      });
    } else {
      html += '<thead><tr><th>Student</th><th>Avg Score</th><th>Count</th></tr></thead><tbody>';
      list.forEach(function (r) {
        html += '<tr>' +
          '<td>' + esc(r.student_email || r.student || '—') + '</td>' +
          '<td>' + (r.average !== undefined ? parseFloat(r.average).toFixed(2) : '—') + '</td>' +
          '<td>' + (r.count || 0) + '</td>' +
        '</tr>';
      });
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  /* ── FORM SUBMISSIONS ── */
  function initForms() {
    /* Course form */
    var formCourse = document.getElementById('form-course');
    if (formCourse) {
      formCourse.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = document.getElementById('btn-submit-course');
        var errEl = document.getElementById('course-modal-error');
        CampusApp.setLoading(btn, true, 'Creating…');
        showFormError(errEl, '');
        var payload = formDataToJson(new FormData(formCourse));
        try {
          var res = await CampusApp.apiJson('/api/v1/academic/courses/', {
            method: 'POST', body: JSON.stringify(payload),
          });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errEl, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-course')).hide();
          formCourse.reset();
          CampusApp.toastSuccess('Course created!');
          loadCourses();
        } catch(ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Attendance form */
    var formAtt = document.getElementById('form-attendance');
    if (formAtt) {
      formAtt.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = document.getElementById('btn-submit-att');
        var errEl = document.getElementById('att-modal-error');
        CampusApp.setLoading(btn, true, 'Saving…');
        showFormError(errEl, '');
        var payload = formDataToJson(new FormData(formAtt));
        try {
          var res = await CampusApp.apiJson('/api/v1/academic/attendance/', {
            method: 'POST', body: JSON.stringify(payload),
          });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errEl, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-attendance')).hide();
          formAtt.reset();
          CampusApp.toastSuccess('Attendance recorded!');
          loadAttendance();
        } catch(ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Grade form */
    var formGrade = document.getElementById('form-grade');
    if (formGrade) {
      formGrade.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = document.getElementById('btn-submit-grade');
        var errEl = document.getElementById('grade-modal-error');
        CampusApp.setLoading(btn, true, 'Saving…');
        showFormError(errEl, '');
        var payload = formDataToJson(new FormData(formGrade));
        try {
          var res = await CampusApp.apiJson('/api/v1/academic/grades/', {
            method: 'POST', body: JSON.stringify(payload),
          });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errEl, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-grade')).hide();
          formGrade.reset();
          CampusApp.toastSuccess('Grade added!');
          loadGrades();
        } catch(ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Enrollment form */
    var formEnroll = document.getElementById('form-enrollment');
    if (formEnroll) {
      formEnroll.addEventListener('submit', async function (e) {
        e.preventDefault();
        var btn = document.getElementById('btn-submit-enrollment');
        var errEl = document.getElementById('enroll-modal-error');
        CampusApp.setLoading(btn, true, 'Enrolling…');
        showFormError(errEl, '');
        var payload = formDataToJson(new FormData(formEnroll));
        try {
          var res = await CampusApp.apiJson('/api/v1/academic/enrollments/', {
            method: 'POST', body: JSON.stringify(payload),
          });
          CampusApp.setLoading(btn, false);
          var d = await res.json().catch(function () { return {}; });
          if (!res.ok) { showFormError(errEl, CampusApp.formatErrors(d)); return; }
          bootstrap.Modal.getInstance(document.getElementById('modal-enrollment')).hide();
          formEnroll.reset();
          CampusApp.toastSuccess('Student enrolled!');
          loadEnrollments();
        } catch(ex) { CampusApp.setLoading(btn, false); CampusApp.toastError('Network error.'); }
      });
    }

    /* Report buttons */
    var btnAttRep = document.getElementById('btn-att-report');
    if (btnAttRep) btnAttRep.addEventListener('click', function () { runReport('attendance'); });
    var btnGradeRep = document.getElementById('btn-grade-report');
    if (btnGradeRep) btnGradeRep.addEventListener('click', function () { runReport('grades'); });
  }

  /* ── Filter change events ── */
  function initFilterEvents() {
    var attCourse = document.getElementById('att-course-filter');
    var attStatus = document.getElementById('att-status-filter');
    if (attCourse) attCourse.addEventListener('change', loadAttendance);
    if (attStatus) attStatus.addEventListener('change', loadAttendance);

    var gradeCourse = document.getElementById('grade-course-filter');
    if (gradeCourse) gradeCourse.addEventListener('change', loadGrades);

    var enrollStatus = document.getElementById('enroll-status-filter');
    if (enrollStatus) enrollStatus.addEventListener('change', loadEnrollments);
  }

  /* ── Role-based UI ── */
  function applyRoleUI() {
    if (!canManage()) return;

    /* Show add buttons */
    ['btn-add-course','btn-add-attendance','btn-add-grade','btn-add-enrollment'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.remove('d-none');
    });

    /* Wire buttons to modals */
    var btnCourse = document.getElementById('btn-add-course');
    if (btnCourse) {
      btnCourse.addEventListener('click', function () {
        new bootstrap.Modal(document.getElementById('modal-course')).show();
      });
    }
    var btnAtt = document.getElementById('btn-add-attendance');
    if (btnAtt) {
      btnAtt.addEventListener('click', function () {
        /* Make sure enrollments are loaded for the select */
        if (!_tabLoaded['enrollments']) {
          _tabLoaded['enrollments'] = true;
          loadEnrollments();
        }
        new bootstrap.Modal(document.getElementById('modal-attendance')).show();
      });
    }
    var btnGrade = document.getElementById('btn-add-grade');
    if (btnGrade) {
      btnGrade.addEventListener('click', function () {
        if (!_tabLoaded['enrollments']) {
          _tabLoaded['enrollments'] = true;
          loadEnrollments();
        }
        new bootstrap.Modal(document.getElementById('modal-grade')).show();
      });
    }
    var btnEnroll = document.getElementById('btn-add-enrollment');
    if (btnEnroll) {
      btnEnroll.addEventListener('click', function () {
        new bootstrap.Modal(document.getElementById('modal-enrollment')).show();
      });
    }
  }

  /* ── Public: delete course ── */
  async function deleteCourse(id) {
    if (!confirm('Delete this course? This cannot be undone.')) return;
    try {
      var res = await CampusApp.apiJson('/api/v1/academic/courses/' + id + '/', { method: 'DELETE' });
      if (res.status === 204 || res.ok) {
        CampusApp.toastSuccess('Course deleted.');
        loadCourses();
      } else {
        var d = await res.json().catch(function () { return {}; });
        CampusApp.handleApiError(res, d);
      }
    } catch (e) { CampusApp.toastError('Network error.'); }
  }

  /* ── Utilities ── */
  function esc(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formDataToJson(fd) {
    var obj = {};
    fd.forEach(function (v, k) { if (v !== '') obj[k] = v; });
    return obj;
  }

  function showFormError(el, msg) {
    if (!el) return;
    if (msg) { el.textContent = msg; el.classList.remove('d-none'); }
    else      { el.textContent = ''; el.classList.add('d-none'); }
  }

  /* ── Init ── */
  (async function () {
    try {
      var res = await CampusApp.apiJson('/api/v1/auth/me/');
      if (res.ok) {
        _me    = await res.json();
        _roles = _me.group_names || [];
      }
    } catch (e) {}

    applyRoleUI();
    initTabs();
    initForms();
    initFilterEvents();

    /* Load courses tab immediately (it's the default active tab) */
    _tabLoaded['courses'] = true;
    loadCourses();
  })();

  /* Expose to global for inline onclick */
  window.CampusAcademic = { deleteCourse: deleteCourse };
})();
