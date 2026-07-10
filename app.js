(function () {
  "use strict";

  var sb = window.supabase.createClient(
    window.SUPABASE_CONFIG.url,
    window.SUPABASE_CONFIG.publishableKey
  );

  // In-memory mirror of the user's rows. Reloaded on sign-in, patched on write.
  var state = { exercises: [], routines: [], sessions: [] };
  var currentUser = null;

  var SEED_EXERCISES = [
    { name: "Barbell Bench Press", category: "Chest" },
    { name: "Back Squat", category: "Legs" },
    { name: "Deadlift", category: "Legs" },
    { name: "Overhead Press", category: "Shoulders" },
    { name: "Pull-up", category: "Back" },
    { name: "Barbell Row", category: "Back" },
  ];

  // =====================================================
  // HELPERS
  // =====================================================
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escapeAttr(v) {
    return v === undefined || v === null ? "" : String(v).replace(/"/g, "&quot;");
  }

  var toastEl = $("toast");
  var toastTimer = null;
  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", !!isError);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, isError ? 4000 : 2200);
  }

  // Every Supabase call funnels through here so a failed write is never silent.
  function check(res, what) {
    if (res.error) {
      console.error(what, res.error);
      toast("Couldn't " + what + ": " + res.error.message, true);
      throw res.error;
    }
    return res.data;
  }

  function exerciseById(id) {
    return state.exercises.find(function (e) { return e.id === id; });
  }
  function routineById(id) {
    return state.routines.find(function (r) { return r.id === id; });
  }
  function activeExercises() {
    return state.exercises.filter(function (e) { return !e.archived; });
  }

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtLong(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  // Local-date ISO string. Deliberately not toISOString(), which converts to UTC
  // and can hand back yesterday for anyone west of Greenwich.
  function isoOf(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function parseISO(iso) { return new Date(iso + "T00:00:00"); }
  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }
  function startOfWeek(d) {
    var c = new Date(d.getTime());
    var dow = (c.getDay() + 6) % 7; // Monday = 0
    return addDays(c, -dow);
  }

  // =====================================================
  // WEEK STRIP
  // =====================================================
  var selectedDate = isoOf(new Date());
  var weekAnchor = startOfWeek(new Date());

  var DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  function setSelectedDate(iso) {
    selectedDate = iso;
    weekAnchor = startOfWeek(parseISO(iso));
    renderWeekStrip();
  }

  function renderWeekStrip() {
    var today = isoOf(new Date());
    var logged = {};
    state.sessions.forEach(function (s) { logged[s.date] = true; });

    var html = "";
    for (var i = 0; i < 7; i++) {
      var d = addDays(weekAnchor, i);
      var iso = isoOf(d);
      var cls = "week-day";
      if (iso === selectedDate) cls += " selected";
      if (iso === today) cls += " today";
      if (logged[iso]) cls += " has-session";
      html += '<button class="' + cls + '" data-date="' + iso + '">' +
        '<span class="dow">' + DOW[i] + "</span>" +
        '<span class="num">' + d.getDate() + "</span>" +
        "</button>";
    }
    $("week-days").innerHTML = html;
    $("week-days").querySelectorAll("[data-date]").forEach(function (b) {
      b.addEventListener("click", function () { setSelectedDate(b.getAttribute("data-date")); });
    });

    $("log-date").value = selectedDate;
    $("log-date-label").textContent = fmtLong(selectedDate);
  }

  $("week-prev").addEventListener("click", function () {
    weekAnchor = addDays(weekAnchor, -7);
    renderWeekStrip();
  });
  $("week-next").addEventListener("click", function () {
    weekAnchor = addDays(weekAnchor, 7);
    renderWeekStrip();
  });
  $("log-date").addEventListener("change", function () {
    if (this.value) setSelectedDate(this.value);
  });

  // Draws a rounded progress arc on a canvas.
  //
  // The logical size lives in data-size, NOT in canvas.width. Reading back the
  // mutated width each redraw compounds the devicePixelRatio scale and the ring
  // grows on every render.
  function drawRing(canvas, pct, color) {
    var size = Number(canvas.getAttribute("data-size"));
    var dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    var lw = 12;
    var r = size / 2 - lw / 2 - 2;
    var cx = size / 2, cy = size / 2;
    var start = -Math.PI / 2;

    ctx.lineWidth = lw;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#232733";
    ctx.stroke();

    var frac = Math.max(0, Math.min(1, pct));
    if (frac > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + Math.PI * 2 * frac);
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  // =====================================================
  // AUTH
  // =====================================================
  var authMode = "signin";

  function setAuthMsg(text, kind) {
    var el = $("auth-msg");
    if (!text) { el.classList.remove("show"); return; }
    el.textContent = text;
    el.className = "auth-msg show " + kind;
  }

  function applyAuthMode() {
    var signin = authMode === "signin";
    $("auth-subtitle").textContent = signin
      ? "Sign in to reach your workouts from any device."
      : "Create an account to sync your workouts.";
    $("auth-submit").textContent = signin ? "Sign in" : "Create account";
    $("auth-switch-text").textContent = signin ? "Don't have an account?" : "Already have an account?";
    $("auth-switch-btn").textContent = signin ? "Create one" : "Sign in";
    $("auth-password").setAttribute("autocomplete", signin ? "current-password" : "new-password");
    setAuthMsg("");
  }

  $("auth-switch-btn").addEventListener("click", function () {
    authMode = authMode === "signin" ? "signup" : "signin";
    applyAuthMode();
  });

  $("auth-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var email = $("auth-email").value.trim();
    var password = $("auth-password").value;
    var btn = $("auth-submit");

    btn.disabled = true;
    btn.textContent = authMode === "signin" ? "Signing in…" : "Creating account…";
    setAuthMsg("");

    try {
      if (authMode === "signin") {
        var res = await sb.auth.signInWithPassword({ email: email, password: password });
        if (res.error) { setAuthMsg(res.error.message, "error"); return; }
        // onAuthStateChange takes it from here.
      } else {
        var up = await sb.auth.signUp({ email: email, password: password });
        if (up.error) { setAuthMsg(up.error.message, "error"); return; }
        if (!up.data.session) {
          // Email confirmation is on for this project, so there's no session yet.
          // Flip to the sign-in form first: applyAuthMode() clears the message box.
          authMode = "signin";
          applyAuthMode();
          setAuthMsg("Check your inbox to confirm " + email + ", then sign in.", "info");
          return;
        }
      }
    } catch (err) {
      setAuthMsg(err.message || "Something went wrong.", "error");
    } finally {
      btn.disabled = false;
      applyAuthModeButtonLabel();
    }
  });

  function applyAuthModeButtonLabel() {
    $("auth-submit").textContent = authMode === "signin" ? "Sign in" : "Create account";
  }

  $("btn-signout").addEventListener("click", async function () {
    await sb.auth.signOut();
  });

  function showAuth() {
    $("app-loading").classList.add("hidden");
    $("app").classList.add("hidden");
    $("auth-screen").classList.remove("hidden");
  }
  function showApp() {
    $("app-loading").classList.add("hidden");
    $("auth-screen").classList.add("hidden");
    $("app").classList.remove("hidden");
  }
  function showLoading() {
    $("auth-screen").classList.add("hidden");
    $("app").classList.add("hidden");
    $("app-loading").classList.remove("hidden");
  }

  sb.auth.onAuthStateChange(function (event, session) {
    if (session && session.user) {
      if (currentUser && currentUser.id === session.user.id) return; // token refresh, not a new login
      currentUser = session.user;
      $("account-email").textContent = session.user.email;
      showLoading();
      bootApp();
    } else {
      currentUser = null;
      state = { exercises: [], routines: [], sessions: [] };
      logEntries = [];
      applyAuthMode();
      showAuth();
    }
  });

  // =====================================================
  // DATA LOADING
  // =====================================================
  async function loadAll() {
    var exRes = await sb
      .from("exercises")
      .select("id,name,category,archived")
      .order("name", { ascending: true });
    var exercises = check(exRes, "load exercises");

    var rtRes = await sb
      .from("routines")
      .select("id,name,routine_exercises(exercise_id,position)")
      .order("created_at", { ascending: true });
    var routines = check(rtRes, "load routines");

    var seRes = await sb
      .from("sessions")
      .select("id,date,routine_id,notes,session_entries(id,exercise_id,position,sets(set_index,weight,reps))")
      .order("date", { ascending: true });
    var sessions = check(seRes, "load sessions");

    state.exercises = exercises.map(function (e) {
      return { id: e.id, name: e.name, category: e.category, archived: e.archived };
    });

    state.routines = routines.map(function (r) {
      var links = (r.routine_exercises || []).slice().sort(function (a, b) { return a.position - b.position; });
      return { id: r.id, name: r.name, exerciseIds: links.map(function (l) { return l.exercise_id; }) };
    });

    state.sessions = sessions.map(function (s) {
      var entries = (s.session_entries || []).slice().sort(function (a, b) { return a.position - b.position; });
      return {
        id: s.id,
        date: s.date,
        routineId: s.routine_id,
        notes: s.notes || "",
        entries: entries.map(function (en) {
          var sets = (en.sets || []).slice().sort(function (a, b) { return a.set_index - b.set_index; });
          return {
            exerciseId: en.exercise_id,
            sets: sets.map(function (st) { return { weight: Number(st.weight), reps: Number(st.reps) }; }),
          };
        }),
      };
    });
  }

  async function seedIfEmpty() {
    if (state.exercises.length || state.routines.length || state.sessions.length) return;
    var res = await sb.from("exercises").insert(SEED_EXERCISES).select("id,name,category,archived");
    var rows = check(res, "add starter exercises");
    state.exercises = rows.map(function (e) {
      return { id: e.id, name: e.name, category: e.category, archived: e.archived };
    });
  }

  async function bootApp() {
    try {
      await loadAll();
      await seedIfEmpty();
    } catch (err) {
      showAuth();
      setAuthMsg("Couldn't load your data: " + (err.message || err), "error");
      return;
    }
    setSelectedDate(isoOf(new Date()));
    refreshLogDropdowns();
    renderLogBlocks();
    renderExerciseList();
    renderRoutineList();
    showApp();
  }

  // =====================================================
  // NAV
  // =====================================================
  var tabBtns = document.querySelectorAll(".tab-btn");
  var views = document.querySelectorAll(".view");
  tabBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabBtns.forEach(function (b) { b.classList.remove("active"); });
      views.forEach(function (v) { v.classList.remove("active"); });
      btn.classList.add("active");
      $("view-" + btn.dataset.view).classList.add("active");
      if (btn.dataset.view === "history") renderHistory();
      if (btn.dataset.view === "progress") renderProgress();
      if (btn.dataset.view === "exercises") { renderExerciseList(); renderRoutineList(); }
      if (btn.dataset.view === "log") refreshLogDropdowns();
    });
  });

  // =====================================================
  // EXERCISES
  // =====================================================
  function renderExerciseList() {
    var el = $("exercise-list");
    var list = activeExercises();
    if (list.length === 0) {
      el.innerHTML = '<div class="empty-state">No exercises yet. Add your first one above.</div>';
      return;
    }
    var byCat = {};
    list.forEach(function (ex) {
      byCat[ex.category] = byCat[ex.category] || [];
      byCat[ex.category].push(ex);
    });
    var html = "";
    Object.keys(byCat).sort().forEach(function (cat) {
      html += '<div style="margin-top:10px;"><div class="pill">' + escapeHtml(cat) + '</div></div><div style="margin-top:6px;">';
      byCat[cat].forEach(function (ex) {
        html += '<span class="exercise-chip">' + escapeHtml(ex.name) +
          ' <button data-del-exercise="' + ex.id + '" title="Delete">&times;</button></span>';
      });
      html += "</div>";
    });
    el.innerHTML = html;

    el.querySelectorAll("[data-del-exercise]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-del-exercise");
        var usedInSessions = state.sessions.some(function (s) {
          return s.entries.some(function (en) { return en.exerciseId === id; });
        });
        var msg = usedInSessions
          ? "This exercise has logged history. Remove it anyway? (past sessions keep their data, but it will no longer appear in dropdowns)"
          : "Delete this exercise?";
        if (!confirm(msg)) return;

        try {
          if (usedInSessions) {
            // Archive: the FK from session_entries would block a real delete,
            // and we want the history to stay readable.
            check(await sb.from("exercises").update({ archived: true }).eq("id", id), "archive exercise");
            exerciseById(id).archived = true;
          } else {
            check(await sb.from("exercises").delete().eq("id", id), "delete exercise");
            state.exercises = state.exercises.filter(function (e) { return e.id !== id; });
          }
          state.routines.forEach(function (r) {
            r.exerciseIds = r.exerciseIds.filter(function (i) { return i !== id; });
          });
          renderExerciseList();
          renderRoutineList();
          refreshLogDropdowns();
          toast(usedInSessions ? "Exercise removed from dropdowns" : "Exercise deleted");
        } catch (e) { /* check() already surfaced it */ }
      });
    });
  }

  $("btn-add-exercise").addEventListener("click", async function () {
    var nameInput = $("new-exercise-name");
    var name = nameInput.value.trim();
    var cat = $("new-exercise-category").value;
    if (!name) { toast("Enter an exercise name"); return; }

    var existing = state.exercises.find(function (e) {
      return e.name.toLowerCase() === name.toLowerCase();
    });
    if (existing && !existing.archived) { toast("That exercise already exists"); return; }

    try {
      if (existing && existing.archived) {
        // Name is taken by an archived row; bring it back rather than colliding
        // with the unique index on (user_id, lower(name)).
        check(await sb.from("exercises").update({ archived: false, category: cat }).eq("id", existing.id), "restore exercise");
        existing.archived = false;
        existing.category = cat;
      } else {
        var rows = check(
          await sb.from("exercises").insert({ name: name, category: cat }).select("id,name,category,archived"),
          "add exercise"
        );
        state.exercises.push({ id: rows[0].id, name: rows[0].name, category: rows[0].category, archived: rows[0].archived });
      }
      nameInput.value = "";
      renderExerciseList();
      refreshLogDropdowns();
      toast("Exercise added");
    } catch (e) { /* handled */ }
  });

  // =====================================================
  // ROUTINES
  // =====================================================
  function renderRoutineList() {
    var el = $("routine-list");
    var sel = $("new-routine-exercises");
    sel.innerHTML = activeExercises().map(function (ex) {
      return '<option value="' + ex.id + '">' + escapeHtml(ex.name) + "</option>";
    }).join("");

    if (state.routines.length === 0) {
      el.innerHTML = '<div class="empty-state">No routines yet. Routines are optional templates to speed up logging.</div>';
      return;
    }
    el.innerHTML = state.routines.map(function (r) {
      var names = r.exerciseIds.map(function (id) {
        var ex = exerciseById(id);
        return ex ? ex.name : null;
      }).filter(Boolean);
      return '<div class="exercise-log-block">' +
        '<div class="head"><strong>' + escapeHtml(r.name) + "</strong>" +
        '<button class="icon-btn" data-del-routine="' + r.id + '">&#128465;</button></div>' +
        '<div style="font-size:12px;color:var(--text-dim);">' + (escapeHtml(names.join(", ")) || "No exercises") + "</div>" +
        "</div>";
    }).join("");

    el.querySelectorAll("[data-del-routine]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-del-routine");
        if (!confirm("Delete this routine?")) return;
        try {
          check(await sb.from("routines").delete().eq("id", id), "delete routine");
          state.routines = state.routines.filter(function (r) { return r.id !== id; });
          state.sessions.forEach(function (s) { if (s.routineId === id) s.routineId = null; });
          renderRoutineList();
          refreshLogDropdowns();
          toast("Routine deleted");
        } catch (e) { /* handled */ }
      });
    });
  }

  $("btn-add-routine").addEventListener("click", async function () {
    var nameInput = $("new-routine-name");
    var name = nameInput.value.trim();
    var sel = $("new-routine-exercises");
    var ids = Array.from(sel.selectedOptions).map(function (o) { return o.value; });
    if (!name) { toast("Enter a routine name"); return; }
    if (ids.length === 0) { toast("Select at least one exercise"); return; }

    try {
      var routine = check(await sb.from("routines").insert({ name: name }).select("id,name"), "save routine")[0];
      check(
        await sb.from("routine_exercises").insert(ids.map(function (id, i) {
          return { routine_id: routine.id, exercise_id: id, position: i };
        })),
        "save routine exercises"
      );
      state.routines.push({ id: routine.id, name: routine.name, exerciseIds: ids });
      nameInput.value = "";
      sel.selectedIndex = -1;
      renderRoutineList();
      refreshLogDropdowns();
      toast("Routine saved");
    } catch (e) { /* handled */ }
  });

  // =====================================================
  // LOG SESSION
  // =====================================================
  var logEntries = []; // { exerciseId, sets: [{weight,reps}] }

  function refreshLogDropdowns() {
    var actives = activeExercises();

    $("log-routine-select").innerHTML = '<option value="">&mdash; none &mdash;</option>' +
      state.routines.map(function (r) { return '<option value="' + r.id + '">' + escapeHtml(r.name) + "</option>"; }).join("");

    $("log-add-exercise").innerHTML = '<option value="">Choose exercise&hellip;</option>' +
      actives.map(function (e) { return '<option value="' + e.id + '">' + escapeHtml(e.name) + "</option>"; }).join("");

    $("history-filter-exercise").innerHTML = '<option value="">All exercises</option>' +
      actives.map(function (e) { return '<option value="' + e.id + '">' + escapeHtml(e.name) + "</option>"; }).join("");

    var progSel = $("progress-exercise-select");
    var prevVal = progSel.value;
    progSel.innerHTML = actives.map(function (e) { return '<option value="' + e.id + '">' + escapeHtml(e.name) + "</option>"; }).join("");
    if (prevVal && actives.some(function (e) { return e.id === prevVal; })) progSel.value = prevVal;
  }

  $("log-routine-select").addEventListener("change", function () {
    var r = routineById(this.value);
    if (!r) return;
    r.exerciseIds.forEach(function (id) {
      if (!logEntries.some(function (en) { return en.exerciseId === id; })) {
        logEntries.push({ exerciseId: id, sets: [{ weight: "", reps: "" }] });
      }
    });
    renderLogBlocks();
  });

  $("btn-add-exercise-to-log").addEventListener("click", function () {
    var sel = $("log-add-exercise");
    var id = sel.value;
    if (!id) { toast("Choose an exercise first"); return; }
    if (logEntries.some(function (en) { return en.exerciseId === id; })) {
      toast("Already added to this session"); return;
    }
    logEntries.push({ exerciseId: id, sets: [{ weight: "", reps: "" }] });
    sel.value = "";
    renderLogBlocks();
  });

  function lastSetsForExercise(exerciseId) {
    for (var i = state.sessions.length - 1; i >= 0; i--) {
      var entry = state.sessions[i].entries.find(function (en) { return en.exerciseId === exerciseId; });
      if (entry) return entry.sets;
    }
    return null;
  }

  function renderLogBlocks() {
    var container = $("log-exercise-blocks");
    if (logEntries.length === 0) {
      container.innerHTML = '<div class="empty-state">Add exercises above to start logging sets.</div>';
      return;
    }
    container.innerHTML = "";
    logEntries.forEach(function (entry, entryIdx) {
      var ex = exerciseById(entry.exerciseId);
      var block = document.createElement("div");
      block.className = "exercise-log-block";
      var lastSets = lastSetsForExercise(entry.exerciseId);
      var lastHint = lastSets ? lastSets.map(function (s) { return s.weight + "&times;" + s.reps; }).join(", ") : null;

      var setsHtml = entry.sets.map(function (s, setIdx) {
        return '<div class="set-row">' +
          '<div class="set-num">' + (setIdx + 1) + "</div>" +
          '<input type="number" step="0.5" min="0" placeholder="Weight" value="' + escapeAttr(s.weight) + '" data-entry="' + entryIdx + '" data-set="' + setIdx + '" data-field="weight">' +
          '<input type="number" step="1" min="0" placeholder="Reps" value="' + escapeAttr(s.reps) + '" data-entry="' + entryIdx + '" data-set="' + setIdx + '" data-field="reps">' +
          '<button class="icon-btn" data-remove-set="' + entryIdx + "|" + setIdx + '" title="Remove set">&times;</button>' +
          "</div>";
      }).join("");

      block.innerHTML =
        '<div class="head"><strong>' + escapeHtml(ex ? ex.name : "Unknown exercise") + "</strong>" +
        '<button class="icon-btn" data-remove-exercise="' + entryIdx + '" title="Remove exercise">&#128465;</button></div>' +
        (lastHint ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Last time: ' + lastHint + "</div>" : "") +
        setsHtml +
        '<button class="btn secondary small" data-add-set="' + entryIdx + '" style="margin-top:4px;">+ Add set</button>';
      container.appendChild(block);
    });

    container.querySelectorAll("input[data-entry]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var e = parseInt(inp.getAttribute("data-entry"), 10);
        var s = parseInt(inp.getAttribute("data-set"), 10);
        var f = inp.getAttribute("data-field");
        logEntries[e].sets[s][f] = inp.value;
      });
    });
    container.querySelectorAll("[data-add-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var e = parseInt(btn.getAttribute("data-add-set"), 10);
        var sets = logEntries[e].sets;
        var last = sets[sets.length - 1];
        sets.push({ weight: last ? last.weight : "", reps: last ? last.reps : "" });
        renderLogBlocks();
      });
    });
    container.querySelectorAll("[data-remove-set]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var parts = btn.getAttribute("data-remove-set").split("|");
        var e = parseInt(parts[0], 10), s = parseInt(parts[1], 10);
        logEntries[e].sets.splice(s, 1);
        if (logEntries[e].sets.length === 0) logEntries[e].sets.push({ weight: "", reps: "" });
        renderLogBlocks();
      });
    });
    container.querySelectorAll("[data-remove-exercise]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var e = parseInt(btn.getAttribute("data-remove-exercise"), 10);
        logEntries.splice(e, 1);
        renderLogBlocks();
      });
    });
  }

  $("btn-clear-log").addEventListener("click", function () {
    if (logEntries.length && !confirm("Clear the current unsaved session?")) return;
    logEntries = [];
    $("log-notes").value = "";
    $("log-routine-select").value = "";
    renderLogBlocks();
  });

  $("btn-save-session").addEventListener("click", async function () {
    var btn = this;
    var date = selectedDate;
    if (!date) { toast("Pick a date"); return; }
    if (logEntries.length === 0) { toast("Add at least one exercise"); return; }

    var cleanEntries = [];
    logEntries.forEach(function (entry) {
      var sets = entry.sets
        .filter(function (s) { return s.weight !== "" || s.reps !== ""; })
        .map(function (s) { return { weight: parseFloat(s.weight) || 0, reps: parseInt(s.reps, 10) || 0 }; });
      if (sets.length > 0) cleanEntries.push({ exerciseId: entry.exerciseId, sets: sets });
    });
    if (cleanEntries.length === 0) { toast("Enter weight/reps for at least one set"); return; }

    var routineId = $("log-routine-select").value || null;
    var notes = $("log-notes").value.trim();

    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      var sessionId = await insertSession({ date: date, routineId: routineId, notes: notes, entries: cleanEntries });

      state.sessions.push({ id: sessionId, date: date, routineId: routineId, notes: notes, entries: cleanEntries });
      state.sessions.sort(function (a, b) { return a.date.localeCompare(b.date); });

      logEntries = [];
      $("log-notes").value = "";
      $("log-routine-select").value = "";
      renderLogBlocks();
      renderWeekStrip(); // the saved day now gets a coral ring
      toast("Session saved ✓");
    } catch (e) {
      /* handled */
    } finally {
      btn.disabled = false;
      btn.textContent = "Save session";
    }
  });

  // Writes a session + its entries + its sets. Three round trips because each
  // level needs the generated ids from the level above.
  async function insertSession(session) {
    var row = check(
      await sb.from("sessions").insert({
        date: session.date,
        routine_id: session.routineId,
        notes: session.notes || "",
      }).select("id"),
      "save session"
    )[0];

    var entryRows = check(
      await sb.from("session_entries").insert(
        session.entries.map(function (en, i) {
          return { session_id: row.id, exercise_id: en.exerciseId, position: i };
        })
      ).select("id,position"),
      "save session exercises"
    );
    entryRows.sort(function (a, b) { return a.position - b.position; });

    var setRows = [];
    session.entries.forEach(function (en, i) {
      en.sets.forEach(function (st, j) {
        setRows.push({ entry_id: entryRows[i].id, set_index: j, weight: st.weight, reps: st.reps });
      });
    });
    check(await sb.from("sets").insert(setRows), "save sets");

    return row.id;
  }

  // =====================================================
  // HISTORY
  // =====================================================
  function renderHistory() {
    var list = $("history-list");
    var filterId = $("history-filter-exercise").value;
    var sessions = state.sessions.slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    if (filterId) {
      sessions = sessions.filter(function (s) {
        return s.entries.some(function (en) { return en.exerciseId === filterId; });
      });
    }
    if (sessions.length === 0) {
      list.innerHTML = '<div class="empty-state">No sessions logged yet.</div>';
      return;
    }
    list.innerHTML = sessions.map(function (s) {
      var r = s.routineId ? routineById(s.routineId) : null;
      var body = s.entries.map(function (en) {
        var ex = exerciseById(en.exerciseId);
        var setsStr = en.sets.map(function (st, i) { return (i + 1) + ") " + st.weight + " &times; " + st.reps; }).join("&nbsp;&nbsp;");
        return '<div class="ex-block"><h4>' + escapeHtml(ex ? ex.name : "Deleted exercise") + "</h4>" +
          '<div style="font-size:12px;color:var(--text-dim);">' + setsStr + "</div></div>";
      }).join("");
      var n = s.entries.length;
      return '<div class="session-card">' +
        '<div class="session-header" data-toggle-session="' + s.id + '">' +
          "<div><strong>" + fmtDate(s.date) + "</strong>" + (r ? ' &middot; <span class="meta">' + escapeHtml(r.name) + "</span>" : "") + "</div>" +
          '<div class="meta">' + n + " exercise" + (n === 1 ? "" : "s") + "</div>" +
        "</div>" +
        '<div class="session-body" id="sbody-' + s.id + '">' +
          body +
          (s.notes ? '<div style="font-size:12px;color:var(--text-dim);margin-top:8px;font-style:italic;">"' + escapeHtml(s.notes) + '"</div>' : "") +
          '<div class="toolbar"><button class="btn danger small" data-del-session="' + s.id + '">Delete session</button></div>' +
        "</div>" +
      "</div>";
    }).join("");

    list.querySelectorAll("[data-toggle-session]").forEach(function (h) {
      h.addEventListener("click", function () {
        $("sbody-" + h.getAttribute("data-toggle-session")).classList.toggle("open");
      });
    });
    list.querySelectorAll("[data-del-session]").forEach(function (btn) {
      btn.addEventListener("click", async function (e) {
        e.stopPropagation();
        var id = btn.getAttribute("data-del-session");
        if (!confirm("Delete this session? This can't be undone.")) return;
        try {
          check(await sb.from("sessions").delete().eq("id", id), "delete session");
          state.sessions = state.sessions.filter(function (s) { return s.id !== id; });
          renderHistory();
          renderWeekStrip();
          toast("Session deleted");
        } catch (err) { /* handled */ }
      });
    });
  }
  $("history-filter-exercise").addEventListener("change", renderHistory);

  // =====================================================
  // PROGRESS
  // =====================================================
  var progressChart = null;
  function renderProgress() {
    var exSel = $("progress-exercise-select");
    var content = $("progress-content");
    var actives = activeExercises();
    if (actives.length === 0) {
      content.innerHTML = '<div class="empty-state">Add exercises first to see progress charts.</div>';
      return;
    }
    var exerciseId = exSel.value || actives[0].id;
    exSel.value = exerciseId;

    var points = [];
    state.sessions.slice().sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (s) {
      var entry = s.entries.find(function (en) { return en.exerciseId === exerciseId; });
      if (!entry) return;
      var topWeight = Math.max.apply(null, entry.sets.map(function (st) { return st.weight; }));
      var volume = entry.sets.reduce(function (sum, st) { return sum + st.weight * st.reps; }, 0);
      var maxReps = Math.max.apply(null, entry.sets.map(function (st) { return st.reps; }));
      points.push({ date: s.date, topWeight: topWeight, volume: volume, maxReps: maxReps });
    });

    if (points.length === 0) {
      content.innerHTML = '<div class="empty-state">No logged sessions for this exercise yet.</div>';
      if (progressChart) { progressChart.destroy(); progressChart = null; }
      return;
    }

    var bestWeight = Math.max.apply(null, points.map(function (p) { return p.topWeight; }));
    var bestVolume = Math.max.apply(null, points.map(function (p) { return p.volume; }));
    var bestReps = Math.max.apply(null, points.map(function (p) { return p.maxReps; }));

    var latest = points[points.length - 1];
    var pct = function (a, b) { return b > 0 ? a / b : 0; };
    var bar = function (label, value, best, cls) {
      var w = Math.round(pct(value, best) * 100);
      return '<div class="legend-row">' +
        '<div class="top"><span class="k">' + label + '</span><span class="v">' + value + " / " + best + "</span></div>" +
        '<span class="track"><span class="fill ' + cls + '" style="width:' + w + '%"></span></span>' +
        "</div>";
    };

    content.innerHTML =
      '<div class="ring-card">' +
        '<div class="ring-wrap">' +
          '<canvas id="ring-canvas" data-size="168"></canvas>' +
          '<div class="ring-center">' +
            '<div class="num">' + latest.topWeight + "</div>" +
            '<div class="unit">latest top set</div>' +
          "</div>" +
        "</div>" +
        '<div class="ring-legend">' +
          bar("Top set", latest.topWeight, bestWeight, "accent") +
          bar("Volume", Math.round(latest.volume), Math.round(bestVolume), "teal") +
          bar("Best reps", latest.maxReps, bestReps, "purple") +
        "</div>" +
      "</div>" +
      '<div class="stat-grid">' +
        '<div class="stat-box"><div class="label">Best top-set weight</div><div class="value accent">' + bestWeight + "</div></div>" +
        '<div class="stat-box"><div class="label">Best session volume</div><div class="value teal">' + Math.round(bestVolume) + "</div></div>" +
        '<div class="stat-box"><div class="label">Best reps (single set)</div><div class="value amber">' + bestReps + "</div></div>" +
        '<div class="stat-box"><div class="label">Sessions logged</div><div class="value">' + points.length + "</div></div>" +
      "</div>" +
      // Built in the same pass as the ring: an `innerHTML +=` here would re-parse
      // the subtree and hand back a blank canvas, wiping whatever we'd painted.
      (typeof Chart === "undefined"
        ? '<div class="empty-state">Chart library couldn\'t load (needs an internet connection). Your stats above are still accurate &mdash; the chart will appear once you\'re back online.</div>'
        : '<canvas id="progress-canvas" height="220"></canvas>');

    // Ring shows the latest top set as a fraction of the all-time best, so a PR fills it.
    drawRing($("ring-canvas"), pct(latest.topWeight, bestWeight), "#FF4D5E");

    if (typeof Chart === "undefined") return;

    var ctx = $("progress-canvas").getContext("2d");
    if (progressChart) progressChart.destroy();
    progressChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: points.map(function (p) { return fmtDate(p.date); }),
        datasets: [
          {
            label: "Top set weight",
            data: points.map(function (p) { return p.topWeight; }),
            borderColor: "#FF4D5E",
            backgroundColor: "rgba(255,77,94,0.14)",
            pointBackgroundColor: "#FF4D5E",
            pointRadius: 3,
            tension: 0.3,
            yAxisID: "y",
            fill: true,
          },
          {
            label: "Session volume",
            data: points.map(function (p) { return p.volume; }),
            borderColor: "#4FD6C0",
            backgroundColor: "rgba(79,214,192,0.1)",
            pointBackgroundColor: "#4FD6C0",
            pointRadius: 3,
            tension: 0.3,
            yAxisID: "y1",
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#F2F3F5", usePointStyle: true, boxWidth: 6 } } },
        scales: {
          x: { ticks: { color: "#8B92A0" }, grid: { color: "#262A34" } },
          y: { position: "left", ticks: { color: "#8B92A0" }, grid: { color: "#262A34" }, title: { display: true, text: "Weight", color: "#8B92A0" } },
          y1: { position: "right", ticks: { color: "#8B92A0" }, grid: { display: false }, title: { display: true, text: "Volume", color: "#8B92A0" } },
        },
      },
    });
  }
  $("progress-exercise-select").addEventListener("change", renderProgress);

  // =====================================================
  // SETTINGS: export / import / reset
  // =====================================================
  $("btn-export").addEventListener("click", function () {
    var payload = {
      exportedAt: new Date().toISOString(),
      exercises: state.exercises,
      routines: state.routines,
      sessions: state.sessions,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "workout-tracker-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Backup downloaded");
  });

  $("btn-import-trigger").addEventListener("click", function () { $("import-file").click(); });

  $("import-file").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function () {
      try {
        var parsed = JSON.parse(reader.result);
        if (!parsed.exercises || !parsed.sessions) throw new Error("not a valid backup file");
        if (!confirm("Import this backup? It will replace ALL data on your account.")) { e.target.value = ""; return; }

        toast("Importing…");
        await eraseAll();
        await importBackup(parsed);
        await loadAll();
        refreshLogDropdowns();
        renderWeekStrip();
        renderExerciseList();
        renderRoutineList();
        renderHistory();
        renderProgress();
        toast("Backup imported");
      } catch (err) {
        alert("Couldn't import that file: " + (err.message || err));
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // Old ids in the backup map to fresh uuids the database hands us.
  async function importBackup(parsed) {
    var idMap = {};

    var exercises = parsed.exercises || [];
    if (exercises.length) {
      var exRows = check(
        await sb.from("exercises").insert(exercises.map(function (ex) {
          return { name: ex.name, category: ex.category || "Other", archived: !!ex.archived };
        })).select("id,name"),
        "import exercises"
      );
      // Match on name — insert order is not guaranteed to come back in order.
      exercises.forEach(function (ex) {
        var row = exRows.find(function (r) { return r.name === ex.name; });
        if (row) idMap[ex.id] = row.id;
      });
    }

    var routines = parsed.routines || [];
    for (var i = 0; i < routines.length; i++) {
      var r = routines[i];
      var newRoutine = check(await sb.from("routines").insert({ name: r.name }).select("id"), "import routines")[0];
      idMap[r.id] = newRoutine.id;
      var links = (r.exerciseIds || []).map(function (oldId, pos) {
        return idMap[oldId] ? { routine_id: newRoutine.id, exercise_id: idMap[oldId], position: pos } : null;
      }).filter(Boolean);
      if (links.length) check(await sb.from("routine_exercises").insert(links), "import routine exercises");
    }

    var sessions = parsed.sessions || [];
    for (var j = 0; j < sessions.length; j++) {
      var s = sessions[j];
      var entries = (s.entries || [])
        .filter(function (en) { return idMap[en.exerciseId]; })
        .map(function (en) {
          return {
            exerciseId: idMap[en.exerciseId],
            sets: (en.sets || []).map(function (st) {
              return { weight: Number(st.weight) || 0, reps: Number(st.reps) || 0 };
            }),
          };
        })
        .filter(function (en) { return en.sets.length > 0; });
      if (!entries.length) continue;
      await insertSession({
        date: s.date,
        routineId: s.routineId && idMap[s.routineId] ? idMap[s.routineId] : null,
        notes: s.notes || "",
        entries: entries,
      });
    }
  }

  // Order matters: session_entries holds a RESTRICT foreign key onto exercises,
  // so sessions must go first. Routines and sessions cascade to their children.
  async function eraseAll() {
    var uid = currentUser.id;
    check(await sb.from("sessions").delete().eq("user_id", uid), "erase sessions");
    check(await sb.from("routines").delete().eq("user_id", uid), "erase routines");
    check(await sb.from("exercises").delete().eq("user_id", uid), "erase exercises");
  }

  $("btn-reset-all").addEventListener("click", async function () {
    if (!confirm("Erase ALL workouts, exercises, and history from your account? This cannot be undone. Consider exporting a backup first.")) return;
    if (!confirm("Really erase everything? Last chance.")) return;
    try {
      await eraseAll();
      state = { exercises: [], routines: [], sessions: [] };
      logEntries = [];
      refreshLogDropdowns();
      renderWeekStrip();
      renderExerciseList();
      renderRoutineList();
      renderHistory();
      renderProgress();
      renderLogBlocks();
      toast("All data erased");
    } catch (e) { /* handled */ }
  });

  // ---------- init ----------
  applyAuthMode();
  sb.auth.getSession().then(function (res) {
    if (!res.data.session) showAuth();
    // A session triggers onAuthStateChange, which boots the app.
  });
})();
