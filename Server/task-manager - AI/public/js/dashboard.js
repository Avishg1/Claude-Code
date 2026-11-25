'use strict';

(() => {
  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  const state = {
    tasks: [],
    categories: [],
    counts: { all: { total: 0, open: 0 }, uncategorized: { total: 0, open: 0 } },
    view: 'all',        // 'all' | 'none' | <category id>
    status: 'all',      // 'all' | 'open' | 'done'
    assignee: 'all',    // teams only: 'all' | 'me' | 'none' | <user id as string>
    search: '',         // text in the search bar
    sortMode: 'due',    // 'due' | 'manual' — saved per user on the server
    editingTaskId: null,
    highlight: null,    // { id, kind: 'new' | 'updated' } — animates a task on next render
  };

  const detail = { taskId: null }; // task shown in the side panel

  const WS = window.TMWorkspace; // personal list / teams (workspace.js)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const PRIORITY_LABELS = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  function sortTasks(tasks) {
    const sorted = [...tasks];
    if (state.sortMode === 'manual') {
      sorted.sort((a, b) => a.position - b.position || a.id - b.id);
    } else {
      sorted.sort((a, b) => a.dueDate.localeCompare(b.dueDate)
        || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        || a.id - b.id);
    }
    return sorted;
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    email: $('user-email'),
    logout: $('logout-btn'),
    countAll: $('count-all'),
    countNone: $('count-none'),
    fixedViews: $('fixed-views'),
    categoryList: $('category-list'),
    categoryEmpty: $('category-empty'),
    categoryForm: $('category-form'),
    categoryName: $('category-name'),
    viewTitle: $('view-title'),
    viewSubtitle: $('view-subtitle'),
    newTask: $('new-task-btn'),
    statusTabs: document.querySelectorAll('[data-status]'),
    sortButtons: document.querySelectorAll('[data-sort]'),
    dragHint: $('drag-hint'),
    srStatus: $('sr-status'),
    searchInput: $('search-input'),
    searchClear: $('search-clear'),
    searchSummary: $('search-summary'),
    searchCount: $('search-count'),
    searchWiden: $('search-widen'),
    searchReset: $('search-reset'),
    overduePill: $('overdue-pill'),
    taskList: $('task-list'),
    emptyState: $('empty-state'),
    emptyTitle: $('empty-title'),
    emptyText: $('empty-text'),
    taskDialog: $('task-dialog'),
    taskDialogTitle: $('task-dialog-title'),
    taskDialogSubtitle: $('task-dialog-subtitle'),
    taskForm: $('task-form'),
    taskTitle: $('task-title'),
    taskDescription: $('task-description'),
    taskDue: $('task-due'),
    taskAssignee: $('task-assignee'),
    assigneeFilter: $('assignee-filter'),
    taskError: $('task-error'),
    taskSubmit: $('task-submit'),
    confirmDialog: $('confirm-dialog'),
    confirmText: $('confirm-text'),
    toast: $('toast'),
  };

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>',
  };

  /* ---------------------------------------------------------------- */
  /* Helpers                                                          */
  /* ---------------------------------------------------------------- */

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...WS.headers() },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      window.location.replace('/');
      throw new Error('יש להתחבר מחדש');
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (WS.isGone(res, data)) throw new Error(data.error);
    if (!res.ok) throw new Error(data?.error || 'אירעה שגיאה, נסו שוב');
    return data;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const pad = (n) => String(n).padStart(2, '0');

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseISODate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function dayDiff(iso) {
    const ms = parseISODate(iso) - parseISODate(todayISO());
    return Math.round(ms / 86400000);
  }

  function formatDueDate(iso) {
    const diff = dayDiff(iso);
    if (diff === 0) return 'היום';
    if (diff === 1) return 'מחר';
    if (diff === -1) return 'אתמול';
    const date = parseISODate(iso);
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleDateString('he-IL', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  }

  const isOverdue = (task) => !task.completed && task.dueDate < todayISO();

  let toastTimer;
  function toast(message, type = 'info') {
    els.toast.textContent = message;
    els.toast.className = `toast toast--${type}`;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
  }

  // Close a <dialog> with a short fade-out animation.
  const pendingClose = new WeakMap(); // dialog -> token of the fade-out in progress

  function closeDialog(dialog) {
    return new Promise((resolve) => {
      if (!dialog.open) return resolve();
      if (reduceMotion.matches) { dialog.close(); return resolve(); }
      const token = {};
      pendingClose.set(dialog, token);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        // Reopened while fading out? Then this close was cancelled.
        if (pendingClose.get(dialog) === token) {
          pendingClose.delete(dialog);
          dialog.classList.remove('is-closing');
          dialog.close();
        }
        resolve();
      };
      // Let go of focus right away, so keys pressed during the fade don't land in its fields.
      if (dialog.contains(document.activeElement)) document.activeElement.blur();
      dialog.classList.add('is-closing');
      dialog.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 300); // fallback in case animationend doesn't fire
    });
  }

  // Open a dialog, cancelling a fade-out that is still running.
  function showDialog(dialog) {
    if (pendingClose.has(dialog)) {
      pendingClose.delete(dialog);
      dialog.classList.remove('is-closing');
    }
    if (!dialog.open) dialog.showModal();
  }

  // A dialog that is fading out no longer counts as open.
  const openDialog = () => document.querySelector('dialog[open]:not(.is-closing)');

  function confirmAction(message, confirmLabel = 'מחיקה') {
    els.confirmText.textContent = message;
    els.confirmDialog.querySelector('[value="confirm"]').textContent = confirmLabel;
    els.confirmDialog.returnValue = '';
    els.confirmDialog.showModal();
    return new Promise((resolve) => {
      els.confirmDialog.addEventListener('close', () => resolve(els.confirmDialog.returnValue === 'confirm'), { once: true });
    });
  }

  /* ---------------------------------------------------------------- */
  /* Data loading                                                     */
  /* ---------------------------------------------------------------- */

  async function loadAll() {
    await saveChain; // don't read back an order that is still being saved
    const [taskData, categoryData] = await Promise.all([api('/api/tasks'), api('/api/categories')]);
    state.tasks = sortTasks(taskData.tasks);
    state.categories = categoryData.categories;
    state.counts = { all: categoryData.all, uncategorized: categoryData.uncategorized };

    syncPanel();

    // If the selected category was deleted, fall back to "all".
    if (typeof state.view === 'number' && !state.categories.some((c) => c.id === state.view)) {
      state.view = 'all';
    }
    render();
  }

  async function refresh() {
    try {
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  function render() {
    renderSidebar();
    renderTasks();
  }

  function renderSidebar() {
    els.countAll.textContent = state.counts.all.open;
    els.countNone.textContent = state.counts.uncategorized.open;
    els.countAll.title = `${state.counts.all.open} פתוחות מתוך ${state.counts.all.total}`;
    els.countNone.title = `${state.counts.uncategorized.open} פתוחות מתוך ${state.counts.uncategorized.total}`;

    els.fixedViews.querySelectorAll('.nav-item').forEach((btn) => {
      const active = btn.dataset.view === String(state.view);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-current', active ? 'true' : 'false');
    });

    els.categoryList.replaceChildren(...state.categories.map(categoryItem));
    els.categoryEmpty.hidden = state.categories.length > 0;
  }

  function categoryItem(category) {
    const li = el('li', 'category');
    const active = state.view === category.id;

    const btn = el('button', `nav-item${active ? ' is-active' : ''}`);
    btn.type = 'button';
    btn.setAttribute('aria-current', active ? 'true' : 'false');
    btn.append(el('span', 'nav-item__name', category.name));
    const count = el('span', 'count', String(category.open));
    count.title = `${category.open} פתוחות מתוך ${category.total}`;
    btn.append(count);
    btn.addEventListener('click', () => selectView(category.id));

    const actions = el('div', 'category__actions');
    const renameBtn = el('button', 'icon-btn');
    renameBtn.type = 'button';
    renameBtn.innerHTML = ICONS.edit;
    renameBtn.setAttribute('aria-label', `שינוי שם הקטגוריה ${category.name}`);
    renameBtn.title = 'שינוי שם';
    renameBtn.addEventListener('click', () => startRename(li, category));

    const deleteBtn = el('button', 'icon-btn icon-btn--danger');
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.setAttribute('aria-label', `מחיקת הקטגוריה ${category.name}`);
    deleteBtn.title = 'מחיקה';
    deleteBtn.addEventListener('click', () => deleteCategory(category));

    actions.append(renameBtn, deleteBtn);
    li.append(btn, actions);
    return li;
  }

  function startRename(li, category) {
    const form = el('form', 'category-rename');
    const input = el('input');
    input.type = 'text';
    input.maxLength = 50;
    input.value = category.name;
    input.setAttribute('aria-label', 'שם חדש לקטגוריה');
    form.append(input);
    li.replaceChildren(form);
    input.focus();
    input.select();

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== category.name) {
        try {
          await api(`/api/categories/${category.id}`, { method: 'PUT', body: { name } });
          toast('שם הקטגוריה עודכן', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      await refresh();
    };

    form.addEventListener('submit', (e) => { e.preventDefault(); finish(true); });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  /* ----- Search ----- */

  // Case-insensitive, and ignores accents and Hebrew vowel marks (niqqud).
  // Works character by character so positions can be mapped back for highlighting.
  const normalizeChar = (ch) => ch.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he-IL');

  function normalizeWithMap(text) {
    let out = '';
    const starts = [];
    const ends = [];
    let i = 0;
    for (const ch of text) {
      const n = normalizeChar(ch);
      for (let k = 0; k < n.length; k++) {
        out += n[k];
        starts.push(i);
        ends.push(i + ch.length);
      }
      i += ch.length;
    }
    return { out, starts, ends };
  }

  const normalizeText = (text) => normalizeWithMap(text).out;

  // Every word typed must appear in the title or the description.
  function searchTerms() {
    return normalizeText(state.search).split(/\s+/).filter(Boolean);
  }

  function matchesSearch(task, terms) {
    if (!terms.length) return true;
    const haystack = normalizeText(`${task.title}\n${task.description ?? ''}`);
    return terms.every((term) => haystack.includes(term));
  }

  // Append `text` to `parent`, wrapping the parts that match the search in <mark>.
  function appendHighlighted(parent, text, terms) {
    if (!terms.length) { parent.append(text); return; }
    const { out, starts, ends } = normalizeWithMap(text);
    const ranges = [];
    for (const term of terms) {
      for (let i = out.indexOf(term); i !== -1; i = out.indexOf(term, i + term.length)) {
        ranges.push([starts[i], ends[i + term.length - 1]]);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [start, end] of ranges) {
      if (end <= pos) continue; // already covered by an earlier match
      const from = Math.max(start, pos);
      if (from > pos) parent.append(text.slice(pos, from));
      parent.append(el('mark', 'search-hit', text.slice(from, end)));
      pos = end;
    }
    if (pos < text.length) parent.append(text.slice(pos));
  }

  function setSearch(value) {
    state.search = value;
    if (els.searchInput.value !== value) els.searchInput.value = value;
    els.searchClear.hidden = !value;
    els.searchInput.closest('.search').classList.toggle('has-value', Boolean(value));
    renderTasks();
  }

  function visibleTasks(terms = searchTerms()) {
    return state.tasks.filter((task) => {
      if (state.view === 'none' && task.categoryId !== null) return false;
      if (typeof state.view === 'number' && task.categoryId !== state.view) return false;
      if (state.status === 'open' && task.completed) return false;
      if (state.status === 'done' && !task.completed) return false;
      if (!WS.matchesAssignee(task, state.assignee)) return false;
      return matchesSearch(task, terms);
    });
  }

  function currentViewName() {
    if (state.view === 'all') return 'כל המשימות';
    if (state.view === 'none') return 'ללא קטגוריה';
    return state.categories.find((c) => c.id === state.view)?.name ?? 'כל המשימות';
  }

  // "Found N tasks for "query"" line above the list, shown while searching.
  function renderSearchSummary(terms, shown) {
    els.searchSummary.hidden = terms.length === 0;
    if (!terms.length) return;

    let text;
    if (shown === 0) text = 'לא נמצאו משימות עבור ';
    else if (shown === 1) text = 'נמצאה משימה אחת עבור ';
    else text = `נמצאו ${shown} משימות עבור `;
    const query = el('bdi', 'search-summary__query', `"${state.search.trim()}"`);
    els.searchCount.replaceChildren(el('strong', null, text), query);

    // Matches hidden by the current category / status filter.
    const hidden = state.tasks.filter((t) => matchesSearch(t, terms)).length - shown;
    els.searchWiden.hidden = hidden <= 0;
    els.searchWiden.textContent = hidden === 1 ? 'ועוד תוצאה אחת בכל המשימות' : `ועוד ${hidden} תוצאות בכל המשימות`;
  }

  function renderTasks() {
    els.viewTitle.textContent = currentViewName();

    els.statusTabs.forEach((tab) => {
      const active = tab.dataset.status === state.status;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    els.sortButtons.forEach((btn) => {
      const active = btn.dataset.sort === state.sortMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });

    const terms = searchTerms();
    const tasks = visibleTasks(terms);
    renderSearchSummary(terms, tasks.length);
    els.dragHint.hidden = tasks.length < 2;
    els.dragHint.lastChild.textContent = state.sortMode === 'manual'
      ? ' גררו משימות כדי לשנות את הסדר'
      : ' גררו משימה כדי לעבור לסדר ידני';
    const inView = state.tasks.filter((t) =>
      (state.view === 'all' ? true : state.view === 'none' ? t.categoryId === null : t.categoryId === state.view)
      && WS.matchesAssignee(t, state.assignee));
    const openCount = inView.filter((t) => !t.completed).length;
    const overdueCount = inView.filter(isOverdue).length;

    els.viewSubtitle.textContent = inView.length
      ? `${openCount} פתוחות · ${inView.length - openCount} הושלמו`
      : '';

    els.overduePill.hidden = overdueCount === 0;
    els.overduePill.textContent = overdueCount === 1 ? 'משימה אחת באיחור' : `${overdueCount} משימות באיחור`;

    els.taskList.replaceChildren(...tasks.map((task) => taskItem(task, terms)));

    if (state.highlight) {
      const item = els.taskList.querySelector(`[data-id="${state.highlight.id}"]`);
      item?.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      state.highlight = null;
    }

    els.emptyState.hidden = tasks.length > 0;
    if (!tasks.length) {
      if (terms.length) {
        els.emptyTitle.textContent = 'לא נמצאו תוצאות';
        els.emptyText.textContent = 'נסו מילים אחרות, או חפשו בכל המשימות';
      } else if (state.status === 'done') {
        els.emptyTitle.textContent = 'אין משימות שהושלמו';
        els.emptyText.textContent = 'משימות שתסמנו כהושלמו יופיעו כאן';
      } else if (state.status === 'open' && inView.length) {
        els.emptyTitle.textContent = 'כל המשימות הושלמו 🎉';
        els.emptyText.textContent = 'אין משימות פתוחות כרגע';
      } else {
        els.emptyTitle.textContent = 'אין משימות להצגה';
        els.emptyText.textContent = 'לחצו על "משימה חדשה" כדי להתחיל';
      }
    }
  }

  function taskItem(task, terms = []) {
    const overdue = isOverdue(task);
    const li = el('li', 'task');
    li.dataset.id = task.id;
    li.classList.add(`task--${task.priority}`);
    if (detail.taskId === task.id) li.classList.add('is-selected');
    if (state.highlight?.id === task.id) {
      li.classList.add(state.highlight.kind === 'new' ? 'task--enter' : 'task--flash');
    }
    if (task.completed) li.classList.add('task--done');
    if (overdue) li.classList.add('task--overdue');

    // Checkbox
    const check = el('input', 'task__check');
    check.type = 'checkbox';
    check.checked = task.completed;
    check.setAttribute('aria-label', task.completed ? `סימון "${task.title}" כלא הושלמה` : `סימון "${task.title}" כהושלמה`);
    check.addEventListener('change', () => toggleTask(task, check));

    // Body
    const body = el('div', 'task__body');
    const titleBtn = el('button', 'task__title');
    appendHighlighted(titleBtn, task.title, terms);
    titleBtn.type = 'button';
    titleBtn.title = 'הצגת פרטי המשימה';
    titleBtn.setAttribute('aria-haspopup', 'dialog');
    body.append(titleBtn);
    if (task.description) {
      const description = el('p', 'task__description');
      appendHighlighted(description, task.description, terms);
      body.append(description);
    }

    const meta = el('div', 'task__meta');

    const due = el('span', `chip chip--date${overdue ? ' chip--overdue' : ''}`);
    due.innerHTML = ICONS.calendar;
    due.append(document.createTextNode(formatDueDate(task.dueDate)));
    due.title = parseISODate(task.dueDate).toLocaleDateString('he-IL', { dateStyle: 'full' });
    meta.append(due);

    if (overdue) meta.append(el('span', 'chip chip--overdue-label', 'באיחור'));

    meta.append(el('span', `chip chip--priority chip--${task.priority}`, `עדיפות ${PRIORITY_LABELS[task.priority]}`));

    if (task.categoryName) {
      const cat = el('span', 'chip chip--category');
      cat.innerHTML = ICONS.folder;
      cat.append(document.createTextNode(task.categoryName));
      meta.append(cat);
    }

    if (WS.isTeam) meta.append(assigneeChip(task));
    body.append(meta);

    // Actions
    const actions = el('div', 'task__actions');
    const editBtn = el('button', 'icon-btn');
    editBtn.type = 'button';
    editBtn.innerHTML = ICONS.edit;
    editBtn.title = 'עריכה';
    editBtn.setAttribute('aria-label', `עריכת המשימה ${task.title}`);
    editBtn.addEventListener('click', () => openTaskDialog(task));

    const deleteBtn = el('button', 'icon-btn icon-btn--danger');
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.title = 'מחיקה';
    deleteBtn.setAttribute('aria-label', `מחיקת המשימה ${task.title}`);
    deleteBtn.addEventListener('click', () => deleteTask(task));

    actions.append(editBtn, deleteBtn);
    // Drag handle (also keyboard-operable with the arrow keys)
    const handle = el('button', 'task__handle');
    handle.type = 'button';
    handle.innerHTML = ICONS.grip;
    handle.title = 'גררו כדי לשנות את הסדר';
    handle.setAttribute('aria-label', `הזזת המשימה ${task.title}`);
    handle.setAttribute('aria-describedby', 'drag-instructions');
    handle.addEventListener('keydown', (e) => moveWithKeyboard(e, task));

    li.append(handle, check, body, actions);
    return li;
  }

  // Who is responsible for the task (teams only).
  function assigneeChip(task) {
    const person = WS.assigneeOf(task);
    if (!person) {
      const chip = el('span', 'chip chip--unassigned', 'ללא אחראי');
      return chip;
    }
    const chip = el('span', `chip chip--assignee${person.id === WS.me.id ? ' is-me' : ''}`);
    chip.append(WS.avatar(person), document.createTextNode(WS.assigneeLabel(task)));
    chip.title = `אחראי: ${WS.assigneeLabel(task)}`;
    return chip;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  function selectView(view) {
    state.view = view;
    render();
  }

  async function toggleTask(task, checkbox) {
    checkbox.disabled = true;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { completed: checkbox.checked } });
      await loadAll();
    } catch (err) {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      toast(err.message, 'error');
    }
  }

  async function deleteTask(task) {
    const ok = await confirmAction(`למחוק את המשימה "${task.title}"? לא ניתן לבטל פעולה זו.`);
    if (!ok) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (detail.taskId === task.id) closePanel({ flush: false });
      toast('המשימה נמחקה', 'success');
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteCategory(category) {
    const extra = category.total
      ? ` ${category.total === 1 ? 'המשימה שבה תעבור' : `${category.total} המשימות שבה יעברו`} ל"ללא קטגוריה".`
      : '';
    const ok = await confirmAction(`למחוק את הקטגוריה "${category.name}"?${extra}`);
    if (!ok) return;
    try {
      await api(`/api/categories/${category.id}`, { method: 'DELETE' });
      toast('הקטגוריה נמחקה', 'success');
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Category combobox (searchable, can create a new category)        */
  /* ---------------------------------------------------------------- */

  // `prefix` picks the elements: #<prefix>-combo, -input, -options, -toggle, -new-badge.
  // `onChange` (optional) fires whenever the user changes the selection.
  function createCategoryCombo(prefix, { onChange } = {}) {
    const root = $(`${prefix}-combo`);
    const input = $(`${prefix}-input`);
    const list = $(`${prefix}-options`);
    const toggle = $(`${prefix}-toggle`);
    const badge = $(`${prefix}-new-badge`);
    const DEFAULT_PLACEHOLDER = input.placeholder;

    // { type: 'none' } | { type: 'existing', id, name } | { type: 'new', name }
    let selection = { type: 'none' };
    let options = [];
    let activeIndex = -1;
    let promptMode = false; // user chose "create new…" and hasn't typed a name yet

    const norm = (s) => s.trim().toLocaleLowerCase('he-IL');
    const findByName = (name) => state.categories.find((c) => norm(c.name) === norm(name));
    const labelOf = (sel) => (sel.type === 'none' ? '' : sel.name);
    const isOpen = () => !list.hidden;

    const sameSelection = (a, b) => a.type === b.type
      && (a.type === 'none' || (a.type === 'existing' ? a.id === b.id : a.name === b.name));

    function setSelection(sel) {
      selection = sel;
      promptMode = false;
      input.value = labelOf(sel);
      badge.hidden = sel.type !== 'new';
      root.classList.toggle('combo--new', sel.type === 'new');
    }

    // A change made by the user (as opposed to reset/markCreated from code).
    function userSelect(sel) {
      const changed = !sameSelection(selection, sel);
      setSelection(sel);
      if (changed) onChange?.(sel);
    }

    function buildOptions(query) {
      const q = norm(query);
      const result = [];
      if (!q) result.push({ kind: 'none', label: 'ללא קטגוריה' });
      state.categories
        .filter((c) => !q || norm(c.name).includes(q))
        .forEach((c) => result.push({ kind: 'existing', id: c.id, label: c.name }));
      if (q && !findByName(query)) {
        result.push({ kind: 'create', name: query.trim(), label: `יצירת קטגוריה "${query.trim()}"` });
      }
      if (!q) result.push({ kind: 'create-prompt', label: 'יצירת קטגוריה חדשה…' });
      return result;
    }

    function isSelected(opt) {
      if (opt.kind === 'none') return selection.type === 'none';
      if (opt.kind === 'existing') return selection.type === 'existing' && selection.id === opt.id;
      return false;
    }

    // Label with the matching part of the search wrapped in <mark>.
    function labelNode(text, query) {
      const span = el('span', 'combo__label');
      const q = norm(query);
      const i = q ? text.toLocaleLowerCase('he-IL').indexOf(q) : -1;
      if (i === -1) {
        span.textContent = text;
      } else {
        span.append(text.slice(0, i), el('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length));
      }
      return span;
    }

    function renderList(query) {
      options = buildOptions(query);
      list.replaceChildren(...options.map((opt, i) => {
        const li = el('li', `combo__option combo__option--${opt.kind}`);
        li.id = `${prefix}-option-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(isSelected(opt)));
        const icon = el('span', 'combo__icon');
        if (opt.kind === 'create' || opt.kind === 'create-prompt') icon.innerHTML = ICONS.plus;
        else if (isSelected(opt)) icon.innerHTML = ICONS.check;
        li.append(icon, opt.kind === 'existing' ? labelNode(opt.label, query) : el('span', 'combo__label', opt.label));
        li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
        li.addEventListener('click', () => choose(opt));
        return li;
      }));

      const selectedIndex = options.findIndex(isSelected);
      setActive(query.trim() ? 0 : Math.max(selectedIndex, 0));
    }

    function setActive(i) {
      activeIndex = i;
      [...list.children].forEach((li, j) => li.classList.toggle('is-active', j === i));
      if (i >= 0 && list.children[i]) {
        input.setAttribute('aria-activedescendant', list.children[i].id);
        list.children[i].scrollIntoView({ block: 'nearest' });
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function open(query = '') {
      renderList(query);
      list.hidden = false;
      root.classList.add('is-open');
      // Open upward if there isn't room below (e.g. small phone screens).
      const box = input.getBoundingClientRect();
      const spaceBelow = window.innerHeight - box.bottom;
      root.classList.toggle('combo--up', spaceBelow < list.offsetHeight + 12 && box.top > spaceBelow);
      input.setAttribute('aria-expanded', 'true');
    }

    function close() {
      list.hidden = true;
      root.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      setActive(-1);
    }

    function choose(opt) {
      if (opt.kind === 'create-prompt') {
        // Clear the field for typing; the current selection stays until a name is entered.
        input.value = '';
        badge.hidden = true;
        input.placeholder = 'הקלידו שם לקטגוריה החדשה';
        promptMode = true;
        close();
        input.focus();
        return;
      }
      if (opt.kind === 'none') userSelect({ type: 'none' });
      if (opt.kind === 'existing') userSelect({ type: 'existing', id: opt.id, name: opt.label });
      if (opt.kind === 'create') userSelect({ type: 'new', name: opt.name });
      input.placeholder = DEFAULT_PLACEHOLDER;
      close();
    }

    // Turn whatever is typed in the input into a selection.
    function commitTyped() {
      const text = input.value.trim();
      if (promptMode && !text) {
        // Abandoned "create new…" without typing: put the previous value back.
        setSelection(selection);
        input.placeholder = DEFAULT_PLACEHOLDER;
        return;
      }
      if (text === labelOf(selection)) { badge.hidden = selection.type !== 'new'; return; }
      input.placeholder = DEFAULT_PLACEHOLDER;
      if (!text) { userSelect({ type: 'none' }); return; }
      const match = findByName(text);
      userSelect(match ? { type: 'existing', id: match.id, name: match.name } : { type: 'new', name: text });
    }

    input.addEventListener('input', () => {
      badge.hidden = true;
      open(input.value);
    });

    input.addEventListener('click', () => { if (!isOpen()) open(''); });

    toggle.addEventListener('mousedown', (e) => e.preventDefault());
    toggle.addEventListener('click', () => {
      if (isOpen()) { close(); return; }
      input.focus();
      open('');
    });

    input.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!isOpen()) open('');
          else setActive((activeIndex + 1) % options.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!isOpen()) open('');
          else setActive((activeIndex - 1 + options.length) % options.length);
          break;
        case 'Enter':
          if (isOpen() && activeIndex >= 0) {
            e.preventDefault();
            choose(options[activeIndex]);
          }
          break;
        case 'Escape':
          if (isOpen()) {
            e.preventDefault();
            e.stopPropagation();
            input.value = labelOf(selection);
            badge.hidden = selection.type !== 'new';
            close();
          }
          break;
        default:
      }
    });

    root.addEventListener('focusout', (e) => {
      if (root.contains(e.relatedTarget)) return;
      close();
      commitTyped();
    });

    return {
      isOpen,
      close,
      reset(categoryId) {
        const category = state.categories.find((c) => c.id === categoryId);
        setSelection(category ? { type: 'existing', id: category.id, name: category.name } : { type: 'none' });
        input.placeholder = DEFAULT_PLACEHOLDER;
        close();
      },
      value() {
        commitTyped();
        return selection;
      },
      markCreated(category) {
        setSelection({ type: 'existing', id: category.id, name: category.name });
      },
    };
  }

  const combo = createCategoryCombo('category');

  /* ---------------------------------------------------------------- */
  /* Task dialog                                                      */
  /* ---------------------------------------------------------------- */

  function showTaskError(message) {
    els.taskError.textContent = message;
    els.taskError.hidden = !message;
  }

  function openTaskDialog(task = null) {
    state.editingTaskId = task ? task.id : null;
    els.taskDialogTitle.textContent = task ? 'עריכת משימה' : 'משימה חדשה';
    els.taskDialogSubtitle.textContent = task ? 'עדכנו את פרטי המשימה' : 'מלאו את הפרטים ולחצו על יצירה';
    els.taskSubmit.textContent = task ? 'שמירת שינויים' : 'יצירת משימה';
    els.taskTitle.value = task?.title ?? '';
    els.taskDescription.value = task?.description ?? '';
    els.taskDue.value = task?.dueDate ?? todayISO();
    els.taskForm.elements.priority.value = task?.priority ?? 'medium';
    combo.reset(task ? task.categoryId : (typeof state.view === 'number' ? state.view : null));
    // New tasks in a team default to the person shown by the filter, or to nobody.
    const defaultAssignee = state.assignee === 'me' ? WS.me?.id : (/^\d+$/.test(state.assignee) ? Number(state.assignee) : null);
    WS.fillAssigneeSelect(els.taskAssignee, task ? task.assigneeId : defaultAssignee);
    showTaskError('');
    els.taskSubmit.disabled = false;
    showDialog(els.taskDialog);
    els.taskTitle.focus();
  }

  // Make sure a just-saved task is visible with the current view / filter.
  function revealTask(task) {
    if (state.status === 'done' && !task.completed) state.status = 'all';
    if (!WS.matchesAssignee(task, state.assignee)) {
      state.assignee = 'all';
      els.assigneeFilter.value = 'all';
    }
    const v = state.view;
    if ((v === 'none' && task.categoryId !== null) || (typeof v === 'number' && v !== task.categoryId)) {
      state.view = 'all';
    }
  }

  els.taskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (combo.isOpen()) return; // Enter inside the open category list picks an option instead
    showTaskError('');

    const category = combo.value();
    const payload = {
      title: els.taskTitle.value.trim(),
      description: els.taskDescription.value.trim(),
      dueDate: els.taskDue.value,
      priority: els.taskForm.elements.priority.value || 'medium',
      categoryId: category.type === 'existing' ? category.id : null,
    };
    if (WS.isTeam) payload.assigneeId = els.taskAssignee.value ? Number(els.taskAssignee.value) : null;

    if (!payload.title) { showTaskError('יש להזין כותרת למשימה'); els.taskTitle.focus(); return; }
    if (!payload.dueDate) { showTaskError('יש לבחור תאריך יעד'); els.taskDue.focus(); return; }

    els.taskSubmit.disabled = true;
    try {
      // Create the new category only now, so cancelling the dialog doesn't leave one behind.
      if (category.type === 'new') {
        const created = await api('/api/categories', { method: 'POST', body: { name: category.name } });
        state.categories.push(created.category);
        combo.markCreated(created.category); // a retry after a task error won't create it twice
        payload.categoryId = created.category.id;
      }

      const editing = state.editingTaskId;
      const { task } = await api(editing ? `/api/tasks/${editing}` : '/api/tasks', {
        method: editing ? 'PUT' : 'POST',
        body: payload,
      });

      await closeDialog(els.taskDialog);
      revealTask(task);
      state.highlight = { id: task.id, kind: editing ? 'updated' : 'new' };
      toast(editing ? 'המשימה עודכנה' : 'המשימה נוספה', 'success');
      await loadAll();
    } catch (err) {
      showTaskError(err.message);
      els.taskSubmit.disabled = false;
    }
  });

  els.taskDialog.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => closeDialog(els.taskDialog)));

  // Escape closes one layer at a time: an open category list first, then the dialog
  // (with the same fade-out as the close buttons instead of vanishing instantly).
  [els.taskDialog, els.confirmDialog].forEach((dialog) => {
    dialog.addEventListener('cancel', (e) => {
      // Chrome may make "cancel" non-cancelable (repeated Escape without other input);
      // then the browser closes the dialog itself and we must not schedule another close.
      if (!e.cancelable) return;
      e.preventDefault();
      if (dialog === els.taskDialog && combo.isOpen()) combo.close();
      else closeDialog(dialog);
    });
  });

  // Close dialogs when clicking the backdrop.
  [els.taskDialog, els.confirmDialog].forEach((dialog) => {
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(dialog); });
  });

  /* ---------------------------------------------------------------- */
  /* Task detail panel (inline editing with autosave)                 */
  /* ---------------------------------------------------------------- */

  const dp = {
    panel: $('detail-panel'),
    backdrop: $('detail-backdrop'),
    heading: $('detail-heading'),
    close: $('detail-close'),
    status: $('save-status'),
    completed: $('detail-completed'),
    completedLabel: $('detail-completed-label'),
    title: $('detail-title'),
    titleError: $('detail-title-error'),
    description: $('detail-description'),
    priority: $('detail-priority'),
    due: $('detail-due'),
    dueHint: $('detail-due-hint'),
    statusPill: $('detail-status'),
    created: $('detail-created'),
    creator: $('detail-creator'),
    assignee: $('detail-assignee'),
    del: $('detail-delete'),
  };

  const taskById = (id) => state.tasks.find((t) => t.id === id) || null;
  const currentTask = () => taskById(detail.taskId);

  function autoGrow(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }

  // created_at comes from SQLite as UTC "YYYY-MM-DD HH:MM:SS".
  function formatCreated(value) {
    const date = new Date(`${String(value).replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleString('he-IL', { dateStyle: 'long', timeStyle: 'short' });
  }

  function dueHintText(task) {
    if (task.completed) return '';
    const diff = dayDiff(task.dueDate);
    if (diff < -1) return `באיחור של ${-diff} ימים`;
    if (diff === -1) return 'באיחור של יום אחד';
    if (diff === 0) return 'להיום';
    if (diff === 1) return 'למחר';
    return `בעוד ${diff} ימים`;
  }

  // Parts of the panel derived from the task (status, hints) — safe to refresh mid-edit.
  function renderPanelStatus(task) {
    const overdue = isOverdue(task);
    dp.completed.setAttribute('aria-pressed', String(task.completed));
    dp.completed.classList.toggle('is-done', task.completed);
    dp.completedLabel.textContent = task.completed ? 'הושלמה' : 'סימון כהושלמה';
    dp.statusPill.textContent = task.completed ? 'הושלמה' : overdue ? 'באיחור' : 'פתוחה';
    dp.statusPill.className = `status-pill status-pill--${task.completed ? 'done' : overdue ? 'overdue' : 'open'}`;
    dp.dueHint.textContent = dueHintText(task);
    dp.dueHint.classList.toggle('is-overdue', overdue);
  }

  function fillPanel(task) {
    dp.title.value = task.title;
    dp.description.value = task.description ?? '';
    dp.due.value = task.dueDate;
    const radio = dp.priority.querySelector(`input[value="${task.priority}"]`);
    if (radio) radio.checked = true;
    detailCombo.reset(task.categoryId);
    dp.created.textContent = formatCreated(task.createdAt);
    if (WS.isTeam) {
      WS.fillAssigneeSelect(dp.assignee, task.assigneeId);
      const creator = { id: task.createdById, name: task.createdByName, email: task.createdByEmail };
      dp.creator.replaceChildren(WS.avatar(creator),
        document.createTextNode(WS.displayName(creator) + (creator.id === WS.me.id ? ' (אני)' : '')));
    }
    showTitleError(false);
    renderPanelStatus(task);
    requestAnimationFrame(() => { autoGrow(dp.title); autoGrow(dp.description); });
  }

  function showTitleError(show) {
    dp.titleError.hidden = !show;
    if (show) dp.title.setAttribute('aria-invalid', 'true');
    else dp.title.removeAttribute('aria-invalid');
  }

  /* ----- Save status ("saving…" / "saved" / "failed") ----- */

  let statusTimer;
  function setSaveStatus(kind, message = '') {
    clearTimeout(statusTimer);
    const text = { idle: '', saving: 'שומר…', saved: 'נשמר', error: 'השמירה נכשלה' }[kind];
    dp.status.className = `save-status save-status--${kind}`;
    dp.status.textContent = text;
    dp.status.title = message;
    if (kind === 'saved') {
      statusTimer = setTimeout(() => dp.status.classList.add('is-faded'), 2000);
    }
  }

  /* ----- Saving ----- */

  // Saves run one at a time, in order, so quick successive edits can't land out of order.
  let detailChain = Promise.resolve();
  let pendingSaves = 0;
  let lastSaveError = null;

  // `changes` is an object of fields, or an async function that returns one.
  function saveTaskFields(taskId, changes) {
    if (!taskId) return detailChain;
    pendingSaves++;
    setSaveStatus('saving');
    detailChain = detailChain.then(async () => {
      try {
        const body = typeof changes === 'function' ? await changes() : changes;
        const { task } = await api(`/api/tasks/${taskId}`, { method: 'PATCH', body });
        applyTaskUpdate(task, body);
        lastSaveError = null;
      } catch (err) {
        lastSaveError = err;
        toast(err.message, 'error');
        refresh(); // bring the list (and panel, once editing stops) back in line with the server
      } finally {
        pendingSaves--;
        if (pendingSaves === 0) {
          if (lastSaveError) setSaveStatus('error', lastSaveError.message);
          else setSaveStatus('saved');
        }
      }
    });
    return detailChain;
  }

  function applyTaskUpdate(task, body) {
    const local = taskById(task.id);
    if (local) Object.assign(local, task);
    if ('completed' in body || 'categoryId' in body) {
      refresh(); // sidebar counts change too
    } else {
      state.tasks = sortTasks(state.tasks);
      renderTasks();
    }
    if (detail.taskId === task.id) renderPanelStatus(local ?? task);
  }

  // Text fields save shortly after typing stops, and immediately on blur.
  const debounced = new Map(); // field -> { timer, run }

  function debounceSave(field, run, delay) {
    const previous = debounced.get(field);
    if (previous) clearTimeout(previous.timer);
    debounced.set(field, { run, timer: setTimeout(() => { debounced.delete(field); run(); }, delay) });
  }

  function cancelField(field) {
    const entry = debounced.get(field);
    if (entry) { clearTimeout(entry.timer); debounced.delete(field); }
  }

  function flushField(field) {
    const entry = debounced.get(field);
    if (entry) { cancelField(field); entry.run(); }
  }

  function flushPending() {
    [...debounced.keys()].forEach(flushField);
  }

  /* ----- Field handlers ----- */

  const cleanTitle = (value) => value.replace(/\s*\n\s*/g, ' ').trim();

  dp.title.addEventListener('input', () => {
    autoGrow(dp.title);
    const id = detail.taskId;
    const value = cleanTitle(dp.title.value);
    showTitleError(!value);
    if (!value) { cancelField('title'); return; }
    debounceSave('title', () => {
      if (value !== taskById(id)?.title) saveTaskFields(id, { title: value });
    }, 600);
  });

  dp.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); dp.title.blur(); }
  });

  dp.title.addEventListener('blur', () => {
    if (!cleanTitle(dp.title.value)) {
      // Empty title isn't allowed: put the saved one back.
      const task = currentTask();
      if (task) dp.title.value = task.title;
      showTitleError(false);
      autoGrow(dp.title);
      return;
    }
    flushField('title');
  });

  dp.description.addEventListener('input', () => {
    autoGrow(dp.description);
    const id = detail.taskId;
    const value = dp.description.value.trim();
    debounceSave('description', () => {
      if (value !== (taskById(id)?.description ?? '')) saveTaskFields(id, { description: value });
    }, 700);
  });
  dp.description.addEventListener('blur', () => flushField('description'));

  dp.priority.addEventListener('change', (e) => {
    saveTaskFields(detail.taskId, { priority: e.target.value });
  });

  dp.due.addEventListener('change', () => {
    if (!dp.due.value) return; // partially typed / cleared: wait for blur
    const task = currentTask();
    if (task && dp.due.value !== task.dueDate) saveTaskFields(detail.taskId, { dueDate: dp.due.value });
  });
  dp.due.addEventListener('blur', () => {
    if (!dp.due.value) {
      const task = currentTask();
      if (task) dp.due.value = task.dueDate;
    }
  });

  dp.completed.addEventListener('click', () => {
    const task = currentTask();
    if (!task) return;
    // Read the button state (not the task) so quick double clicks toggle back and forth correctly.
    const next = dp.completed.getAttribute('aria-pressed') !== 'true';
    renderPanelStatus({ ...task, completed: next });
    saveTaskFields(task.id, { completed: next });
  });

  const detailCombo = createCategoryCombo('detail-category', {
    onChange(selection) {
      const id = detail.taskId;
      if (!id) return;
      if (selection.type === 'new') {
        saveTaskFields(id, async () => {
          const { category } = await api('/api/categories', { method: 'POST', body: { name: selection.name } });
          state.categories.push(category);
          if (detail.taskId === id) detailCombo.markCreated(category);
          return { categoryId: category.id };
        });
      } else {
        saveTaskFields(id, { categoryId: selection.type === 'existing' ? selection.id : null });
      }
    },
  });

  dp.assignee.addEventListener('change', () => {
    saveTaskFields(detail.taskId, { assigneeId: dp.assignee.value ? Number(dp.assignee.value) : null });
  });

  dp.del.addEventListener('click', () => {
    const task = currentTask();
    if (task) deleteTask(task);
  });

  /* ----- Open / close ----- */

  function markSelected() {
    els.taskList.querySelectorAll('.task').forEach((li) =>
      li.classList.toggle('is-selected', Number(li.dataset.id) === detail.taskId));
  }

  // Commit whatever the user is in the middle of (blur runs the field's own save logic).
  function leavePanelFields() {
    if (dp.panel.contains(document.activeElement)) document.activeElement.blur();
    flushPending();
  }

  function openPanel(taskId) {
    if (detail.taskId === taskId) { dp.heading.focus({ preventScroll: true }); return; }
    const task = taskById(taskId);
    if (!task) return;
    if (detail.taskId) leavePanelFields();

    detail.taskId = taskId;
    fillPanel(task);
    setSaveStatus('idle');
    dp.panel.inert = false;
    dp.panel.classList.add('is-open');
    dp.backdrop.hidden = false;
    document.body.classList.add('panel-open');
    markSelected();
    dp.heading.focus({ preventScroll: true });
  }

  function closePanel({ flush = true } = {}) {
    const id = detail.taskId;
    if (!id) return;
    if (flush) {
      leavePanelFields();
    } else {
      // Task is gone: drop pending edits instead of saving them.
      debounced.forEach((entry) => clearTimeout(entry.timer));
      debounced.clear();
      detail.taskId = null;
      if (dp.panel.contains(document.activeElement)) document.activeElement.blur();
    }
    detail.taskId = null;
    dp.panel.classList.remove('is-open');
    dp.panel.inert = true;
    dp.backdrop.hidden = true;
    document.body.classList.remove('panel-open');
    markSelected();
    if (flush) els.taskList.querySelector(`[data-id="${id}"] .task__title`)?.focus({ preventScroll: true });
  }

  // Called after every reload of the data.
  function syncPanel() {
    if (!detail.taskId) return;
    const task = currentTask();
    if (!task) { closePanel({ flush: false }); return; }
    const active = document.activeElement;
    const editing = debounced.size > 0 || pendingSaves > 0
      || (dp.panel.contains(active) && active.matches('input, textarea'));
    if (editing) renderPanelStatus(task); // don't overwrite what the user is typing
    else fillPanel(task);
  }

  // Clicking a task (anywhere except its controls) opens the panel.
  els.taskList.addEventListener('click', (e) => {
    if (drag.endedAt && performance.now() - drag.endedAt < 350) return;
    const item = e.target.closest('.task');
    if (!item || e.target.closest('button:not(.task__title), input, a, label, textarea, select')) return;
    openPanel(Number(item.dataset.id));
  });

  dp.close.addEventListener('click', () => closePanel());
  dp.backdrop.addEventListener('click', () => closePanel());

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !detail.taskId || e.defaultPrevented) return;
    if (openDialog()) return;
    closePanel();
  });

  /* ---------------------------------------------------------------- */
  /* Manual ordering (drag & drop + keyboard)                         */
  /* ---------------------------------------------------------------- */

  // Saves run one after another so a fast sequence of moves lands in order.
  let saveChain = Promise.resolve();

  function queueSave(fn) {
    saveChain = saveChain.then(fn).catch((err) => {
      toast(`השמירה נכשלה: ${err.message}`, 'error');
      refresh(); // not awaited: refresh waits for this chain to settle first
    });
    return saveChain;
  }

  function announce(message) {
    els.srStatus.textContent = '';
    requestAnimationFrame(() => { els.srStatus.textContent = message; });
  }

  function setSortMode(mode) {
    state.sortMode = mode;
    state.tasks = sortTasks(state.tasks);
    renderTasks();
    queueSave(() => api('/api/settings', { method: 'PUT', body: { sortMode: mode } }));
  }

  /**
   * Apply a new order for the tasks currently shown. The list may be filtered
   * (category / status), so the visible tasks are put back into the slots they
   * occupy in the full list; hidden tasks keep their places.
   */
  function commitVisibleOrder(visibleIds, movedId) {
    const switching = state.sortMode !== 'manual';
    const visibleSet = new Set(visibleIds);
    let k = 0;
    const fullIds = state.tasks.map((t) => (visibleSet.has(t.id) ? visibleIds[k++] : t.id));

    const byId = new Map(state.tasks.map((t) => [t.id, t]));
    state.tasks = fullIds.map((id, index) => Object.assign(byId.get(id), { position: index }));
    state.sortMode = 'manual';
    renderTasks();

    announce(`המשימה הועברה למקום ${visibleIds.indexOf(movedId) + 1} מתוך ${visibleIds.length}`);
    if (switching) toast('המיון עבר לסדר ידני');

    queueSave(async () => {
      if (switching) await api('/api/settings', { method: 'PUT', body: { sortMode: 'manual' } });
      await api('/api/tasks/order', { method: 'PUT', body: { ids: fullIds } });
    });
  }

  function moveWithKeyboard(event, task) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const ids = visibleTasks().map((t) => t.id);
    const from = ids.indexOf(task.id);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, task.id);
    commitVisibleOrder(ids, task.id);
    els.taskList.querySelector(`[data-id="${task.id}"] .task__handle`)?.focus();
  }

  /* Pointer-based dragging: works for mouse, pen and touch. Mouse users can
     grab anywhere on the card; touch users use the handle so the page still
     scrolls normally. */

  const drag = { active: null };
  const DRAG_THRESHOLD = 4;
  const INTERACTIVE = 'button:not(.task__handle):not(.task__title), input, a, textarea, select, label';

  els.taskList.addEventListener('dragstart', (e) => e.preventDefault()); // no native text/image drag

  els.taskList.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag.active) return;
    const item = e.target.closest('.task');
    if (!item || els.taskList.children.length < 2) return;
    const onHandle = Boolean(e.target.closest('.task__handle'));
    if (!onHandle && (e.pointerType !== 'mouse' || e.target.closest(INTERACTIVE))) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let ctx = null;

    const onMove = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      if (!ctx) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        ctx = startDrag(item, startY);
      }
      ev.preventDefault();
      ctx.pointerY = ev.clientY;
      updateDrag(ctx);
    };

    const onEnd = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      window.removeEventListener('keydown', onKey, true);
      if (ctx) {
        drag.endedAt = performance.now(); // the click that follows a drag must not open the panel
        finishDrag(ctx, ev.type === 'pointercancel' || ev.type === 'keydown');
      }
    };

    // Escape cancels a drag in progress.
    const onKey = (ev) => {
      if (ev.key === 'Escape' && ctx) {
        ev.preventDefault();
        ev.stopPropagation();
        onEnd({ pointerId: e.pointerId, type: 'keydown' });
      }
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    window.addEventListener('keydown', onKey, true);
  });

  function startDrag(item, startY) {
    const items = [...els.taskList.children];
    const index = items.indexOf(item);
    const rects = items.map((node) => node.getBoundingClientRect());
    const gap = parseFloat(getComputedStyle(els.taskList).rowGap) || 0;

    window.getSelection()?.removeAllRanges();
    document.body.classList.add('is-dragging-task');
    item.classList.add('task--dragging');
    items.forEach((node) => { if (node !== item) node.classList.add('task--shifting'); });

    const ctx = {
      item, items, index, rects,
      newIndex: index,
      shift: rects[index].height + gap,
      startY,
      startScroll: window.scrollY,
      pointerY: startY,
      raf: 0,
    };
    drag.active = ctx;

    const tick = () => { autoScroll(ctx); ctx.raf = requestAnimationFrame(tick); };
    ctx.raf = requestAnimationFrame(tick);
    return ctx;
  }

  function updateDrag(ctx) {
    // Offset in document coordinates, so scrolling while dragging is accounted for.
    const dy = ctx.pointerY + window.scrollY - (ctx.startY + ctx.startScroll);
    ctx.item.style.transform = `translateY(${dy}px)`;

    const own = ctx.rects[ctx.index];
    const center = own.top + own.height / 2 + dy;
    const mid = (i) => ctx.rects[i].top + ctx.rects[i].height / 2;

    let newIndex = ctx.index;
    for (let i = ctx.index + 1; i < ctx.items.length; i++) if (center > mid(i)) newIndex = i;
    for (let i = ctx.index - 1; i >= 0; i--) if (center < mid(i)) newIndex = i;
    ctx.newIndex = newIndex;

    ctx.items.forEach((node, i) => {
      if (i === ctx.index) return;
      let offset = 0;
      if (i > ctx.index && i <= newIndex) offset = -ctx.shift;
      else if (i < ctx.index && i >= newIndex) offset = ctx.shift;
      node.style.transform = offset ? `translateY(${offset}px)` : '';
    });
  }

  function autoScroll(ctx) {
    const EDGE = 72;
    const top = 64 + EDGE; // below the sticky top bar
    const bottom = window.innerHeight - EDGE;
    let speed = 0;
    if (ctx.pointerY < top) speed = -Math.min(18, Math.ceil((top - ctx.pointerY) / 5));
    else if (ctx.pointerY > bottom) speed = Math.min(18, Math.ceil((ctx.pointerY - bottom) / 5));
    if (!speed) return;
    const before = window.scrollY;
    window.scrollBy(0, speed);
    if (window.scrollY !== before) updateDrag(ctx);
  }

  function finishDrag(ctx, cancelled) {
    cancelAnimationFrame(ctx.raf);
    const { item, items, index, rects } = ctx;
    const newIndex = cancelled ? index : ctx.newIndex;

    // Glide the dragged card into its new slot, then rebuild the list.
    let target = 0;
    if (newIndex > index) target = rects[newIndex].bottom - rects[index].bottom;
    if (newIndex < index) target = rects[newIndex].top - rects[index].top;
    if (cancelled) items.forEach((node) => { if (node !== item) node.style.transform = ''; });

    item.classList.add('task--dropping');
    item.style.transform = `translateY(${target}px)`;

    const done = () => {
      document.body.classList.remove('is-dragging-task');
      items.forEach((node) => {
        node.style.transform = '';
        node.classList.remove('task--dragging', 'task--dropping', 'task--shifting');
      });
      drag.active = null;
      if (newIndex !== index) {
        const ids = items.map((node) => Number(node.dataset.id));
        const [moved] = ids.splice(index, 1);
        ids.splice(newIndex, 0, moved);
        commitVisibleOrder(ids, moved);
      }
    };

    if (reduceMotion.matches) done();
    else setTimeout(done, 190);
  }

  /* ---------------------------------------------------------------- */
  /* Wiring                                                           */
  /* ---------------------------------------------------------------- */

  els.newTask.addEventListener('click', () => openTaskDialog());

  els.fixedViews.querySelectorAll('.nav-item').forEach((btn) =>
    btn.addEventListener('click', () => selectView(btn.dataset.view)));

  els.statusTabs.forEach((tab) => tab.addEventListener('click', () => {
    state.status = tab.dataset.status;
    renderTasks();
  }));

  els.searchInput.addEventListener('input', () => setSearch(els.searchInput.value));

  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.searchInput.value) {
      e.preventDefault(); // first Escape only clears the search
      e.stopPropagation();
      setSearch('');
    } else {
      els.searchInput.blur(); // already empty: Escape continues and closes the panel, if open
    }
  });

  els.searchClear.addEventListener('click', () => {
    setSearch('');
    els.searchInput.focus();
  });

  els.searchReset.addEventListener('click', () => setSearch(''));

  els.searchWiden.addEventListener('click', () => {
    state.view = 'all';
    state.status = 'all';
    render();
  });

  /* ----- Keyboard shortcuts: N = new task, F = search, Escape = close ----- */

  const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file']);

  // True when the key press is meant as typing (so shortcuts must stay out of the way).
  function isTextEntry(target) {
    if (!(target instanceof Element)) return false;
    if (target.isContentEditable || target.matches('textarea, select')) return true;
    return target.matches('input') && !NON_TEXT_INPUTS.has(target.type);
  }

  function focusSearch() {
    els.searchInput.focus();
    els.searchInput.select();
  }

  // e.code is the physical key, so N / F also work with a Hebrew keyboard layout (מ / כ).
  const SHORTCUTS = {
    KeyN: () => openTaskDialog(),
    KeyF: focusSearch,
  };

  document.addEventListener('keydown', (e) => {
    const action = SHORTCUTS[e.code];
    if (!action || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || e.defaultPrevented) return;
    if (isTextEntry(e.target) || openDialog() || drag.active) return;
    e.preventDefault();
    action();
  });

  // Ctrl+K / Cmd+K also focuses the search.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (openDialog()) return;
    e.preventDefault();
    focusSearch();
  });

  els.sortButtons.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.sort === state.sortMode) return;
    setSortMode(btn.dataset.sort);
  }));

  els.categoryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = els.categoryName.value.trim();
    if (!name) { els.categoryName.focus(); return; }
    try {
      const { category } = await api('/api/categories', { method: 'POST', body: { name } });
      els.categoryName.value = '';
      state.view = category.id;
      toast('הקטגוריה נוספה', 'success');
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  els.logout.addEventListener('click', async () => {
    els.logout.disabled = true;
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.replace('/');
    }
  });

  // Re-render at midnight-ish so "overdue" stays accurate if the tab stays open.
  let lastDay = todayISO();
  setInterval(() => {
    if (todayISO() !== lastDay && !drag.active) { lastDay = todayISO(); render(); }
  }, 60 * 1000);

  (async () => {
    try {
      const me = await api('/api/auth/me');
      const { user } = me;
      WS.mount(me);
      els.email.textContent = user.email;
      state.sortMode = user.sortMode === 'manual' ? 'manual' : 'due';
      if (WS.isTeam) {
        state.assignee = WS.fillAssigneeFilter(els.assigneeFilter, state.assignee);
        els.assigneeFilter.addEventListener('change', () => {
          state.assignee = els.assigneeFilter.value;
          renderTasks();
        });
      }
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  })();
})();
