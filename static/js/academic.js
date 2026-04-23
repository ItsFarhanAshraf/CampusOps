(function (global) {
  'use strict';

  function canManageAcademics(me) {
    if (!me) return false;
    if (me.is_staff) return true;
    var groups = me.group_names || [];
    return ['faculty', 'staff', 'campus_administrator'].some(function (g) {
      return groups.indexOf(g) !== -1;
    });
  }

  function courseId(select) {
    var v = select && select.value;
    return v ? String(v) : '';
  }

  async function parseList(res) {
    var data = await res.json().catch(function () { return null; });
    if (!res.ok) return { ok: false, error: data, list: [] };
    if (Array.isArray(data)) return { ok: true, list: data };
    if (data && Array.isArray(data.results)) return { ok: true, list: data.results };
    return { ok: true, list: [] };
  }

  function init(cfg) {
    var loginUrl = cfg.loginUrl;
    var tokenUrl = cfg.tokenUrl || '/api/v1/auth/token/';
    if (!CampusOpsAuth.getAccess()) {
      window.location.href = loginUrl;
      return;
    }

    var errEl = document.getElementById('academic-error');
    var roleEl = document.getElementById('academic-role');
    var courseSelect = document.getElementById('course-select');
    var attendanceBody = document.getElementById('attendance-body');
    var gradesBody = document.getElementById('grades-body');
    var enrollBody = document.getElementById('enroll-body');
    var reportOut = document.getElementById('report-output');
    var manageAttendance = document.getElementById('attendance-manage');
    var manageGrades = document.getElementById('grades-manage');
    var courseCreate = document.getElementById('course-create');

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
      if (canManageAcademics(me)) {
        manageAttendance.classList.remove('hidden');
        manageGrades.classList.remove('hidden');
        if (courseCreate) courseCreate.classList.remove('hidden');
      }
      return true;
    }

    async function loadCourses() {
      var res = await CampusOpsAuth.apiJson(cfg.coursesUrl, { method: 'GET' }, tokenUrl);
      var parsed = await parseList(res);
      if (!parsed.ok) {
        show(CampusOpsAuth.formatFieldErrors(parsed.error) || 'Could not load courses.');
        return;
      }
      courseSelect.innerHTML = '<option value=\"\">Select a course…</option>';
      parsed.list.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = c.code + ' — ' + c.title + (c.term ? ' (' + c.term + ')' : '');
        courseSelect.appendChild(opt);
      });
    }

    async function refreshTables() {
      var cid = courseId(courseSelect);
      if (!cid) {
        attendanceBody.innerHTML =
          '<tr><td colspan=\"4\" class=\"muted\">Pick a course to load rows.</td></tr>';
        gradesBody.innerHTML =
          '<tr><td colspan=\"5\" class=\"muted\">Pick a course to load rows.</td></tr>';
        enrollBody.innerHTML = '<tr><td colspan=\"3\" class=\"muted\">Pick a course.</td></tr>';
        return;
      }
      show('');

      var aUrl = cfg.attendanceUrl + '?course=' + encodeURIComponent(cid);
      var aRes = await CampusOpsAuth.apiJson(aUrl, { method: 'GET' }, tokenUrl);
      var aParsed = await parseList(aRes);
      if (!aParsed.ok) {
        attendanceBody.innerHTML =
          '<tr><td colspan=\"4\" class=\"muted\">Could not load attendance.</td></tr>';
      } else if (!aParsed.list.length) {
        attendanceBody.innerHTML =
          '<tr><td colspan=\"4\" class=\"muted\">No attendance rows yet.</td></tr>';
      } else {
        attendanceBody.innerHTML = aParsed.list
          .map(function (r) {
            return (
              '<tr><td>' +
              r.session_date +
              '</td><td>' +
              (r.student_email || r.student) +
              '</td><td>' +
              r.status +
              '</td><td>' +
              (r.notes || '') +
              '</td></tr>'
            );
          })
          .join('');
      }

      var gUrl = cfg.gradesUrl + '?course=' + encodeURIComponent(cid);
      var gRes = await CampusOpsAuth.apiJson(gUrl, { method: 'GET' }, tokenUrl);
      var gParsed = await parseList(gRes);
      if (!gParsed.ok) {
        gradesBody.innerHTML =
          '<tr><td colspan=\"5\" class=\"muted\">Could not load grades.</td></tr>';
      } else if (!gParsed.list.length) {
        gradesBody.innerHTML =
          '<tr><td colspan=\"5\" class=\"muted\">No grade rows yet.</td></tr>';
      } else {
        gradesBody.innerHTML = gParsed.list
          .map(function (r) {
            var pct =
              r.percentage != null && !isNaN(r.percentage)
                ? r.percentage.toFixed(1) + '%'
                : '—';
            return (
              '<tr><td>' +
              (r.student_email || r.student) +
              '</td><td>' +
              r.category +
              ' — ' +
              r.title +
              '</td><td>' +
              r.score +
              '</td><td>' +
              r.max_points +
              '</td><td>' +
              pct +
              '</td></tr>'
            );
          })
          .join('');
      }

      var eUrl = cfg.enrollmentsUrl + '?course=' + encodeURIComponent(cid);
      var eRes = await CampusOpsAuth.apiJson(eUrl, { method: 'GET' }, tokenUrl);
      var eParsed = await parseList(eRes);
      if (!eParsed.ok) {
        enrollBody.innerHTML =
          '<tr><td colspan=\"3\" class=\"muted\">Could not load enrollments.</td></tr>';
      } else if (!eParsed.list.length) {
        enrollBody.innerHTML =
          '<tr><td colspan=\"3\" class=\"muted\">No enrollments yet.</td></tr>';
      } else {
        enrollBody.innerHTML = eParsed.list
          .map(function (r) {
            return (
              '<tr><td>' +
              r.id +
              '</td><td>' +
              (r.student_email || r.student) +
              '</td><td>' +
              r.status +
              '</td></tr>'
            );
          })
          .join('');
      }
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

    courseSelect.addEventListener('change', function () {
      refreshTables();
    });

    document.getElementById('academic-logout').addEventListener('click', function () {
      CampusOpsAuth.clearTokens();
      window.location.href = loginUrl;
    });

    var courseForm = document.getElementById('course-form');
    if (courseForm) {
      courseForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        show('');
        var fd = new FormData(courseForm);
        var payload = {
          code: fd.get('code'),
          title: fd.get('title'),
          term: fd.get('term') || '',
        };
        var ins = fd.get('instructor');
        if (ins) payload.instructor = Number(ins);
        var btn = document.getElementById('course-submit');
        btn.disabled = true;
        var res = await CampusOpsAuth.apiJson(
          cfg.coursesUrl,
          { method: 'POST', body: JSON.stringify(payload) },
          tokenUrl,
        );
        var data = await res.json().catch(function () { return {}; });
        if (!res.ok) {
          show(CampusOpsAuth.formatFieldErrors(data) || 'Could not create course.');
          btn.disabled = false;
          return;
        }
        btn.disabled = false;
        courseForm.reset();
        await loadCourses();
        if (data && data.id) {
          courseSelect.value = String(data.id);
          await refreshTables();
        }
      });
    }

    document.getElementById('enroll-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      show('');
      var cid = courseId(courseSelect);
      if (!cid) {
        show('Select a course first.');
        return;
      }
      var btn = document.getElementById('enroll-submit');
      btn.disabled = true;
      var res = await CampusOpsAuth.apiJson(
        cfg.enrollmentsUrl,
        {
          method: 'POST',
          body: JSON.stringify({ course: Number(cid) }),
        },
        tokenUrl,
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Enrollment failed.');
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      await refreshTables();
    });

    document.getElementById('attendance-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      show('');
      var cid = courseId(courseSelect);
      if (!cid) {
        show('Select a course first.');
        return;
      }
      var fd = new FormData(e.target);
      var payload = {
        course: Number(cid),
        student: Number(fd.get('student')),
        session_date: fd.get('session_date'),
        status: fd.get('status'),
        notes: fd.get('notes') || '',
      };
      var btn = document.getElementById('attendance-submit');
      btn.disabled = true;
      var res = await CampusOpsAuth.apiJson(
        cfg.attendanceUrl,
        { method: 'POST', body: JSON.stringify(payload) },
        tokenUrl,
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Could not save attendance.');
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      e.target.reset();
      await refreshTables();
    });

    document.getElementById('grade-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      show('');
      var cid = courseId(courseSelect);
      if (!cid) {
        show('Select a course first.');
        return;
      }
      var fd = new FormData(e.target);
      var payload = {
        course: Number(cid),
        student: Number(fd.get('student')),
        category: fd.get('category'),
        title: fd.get('title'),
        max_points: fd.get('max_points'),
        score: fd.get('score'),
      };
      var btn = document.getElementById('grade-submit');
      btn.disabled = true;
      var res = await CampusOpsAuth.apiJson(
        cfg.gradesUrl,
        { method: 'POST', body: JSON.stringify(payload) },
        tokenUrl,
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        show(CampusOpsAuth.formatFieldErrors(data) || 'Could not save grade.');
        btn.disabled = false;
        return;
      }
      btn.disabled = false;
      e.target.reset();
      await refreshTables();
    });

    document.getElementById('btn-attendance-report').addEventListener('click', async function () {
      show('');
      var cid = courseId(courseSelect);
      if (!cid) {
        show('Select a course first.');
        return;
      }
      var url =
        cfg.reportsBase +
        'attendance-summary/?course=' +
        encodeURIComponent(cid);
      var res = await CampusOpsAuth.apiJson(url, { method: 'GET' }, tokenUrl);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        reportOut.textContent = JSON.stringify(data, null, 2);
        show(CampusOpsAuth.formatFieldErrors(data) || 'Report request failed.');
        return;
      }
      reportOut.textContent = JSON.stringify(data, null, 2);
    });

    document.getElementById('btn-grades-report').addEventListener('click', async function () {
      show('');
      var cid = courseId(courseSelect);
      if (!cid) {
        show('Select a course first.');
        return;
      }
      var url =
        cfg.reportsBase + 'grades-summary/?course=' + encodeURIComponent(cid);
      var res = await CampusOpsAuth.apiJson(url, { method: 'GET' }, tokenUrl);
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        reportOut.textContent = JSON.stringify(data, null, 2);
        show(CampusOpsAuth.formatFieldErrors(data) || 'Report request failed.');
        return;
      }
      reportOut.textContent = JSON.stringify(data, null, 2);
    });

    (async function boot() {
      var ok = await loadMe();
      if (!ok) return;
      await loadCourses();
      await refreshTables();
    })();
  }

  global.CampusOpsAcademic = { init: init };
})(window);
