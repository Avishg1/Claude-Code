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
    sortMode: 'due',    // 'due' | 'manual' — saved per user on the server
    editingTaskId: null,
    highlight: null,    // { id, kind: 'new' | 'updated' } — animates a task on next render
  };

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
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      window.location.replace('/');
      throw new Error('יש להתחבר מחדש');
    }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
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
  function closeDialog(dialog) {
    return new Promise((resolve) => {
      if (!dialog.open) return resolve();
      if (reduceMotion.matches) { dialog.close(); return resolve(); }
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        dialog.classList.remove('is-closing');
        dialog.close();
        resolve();
      };
      dialog.classList.add('is-closing');
      dialog.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 300); // fallback in case animationend doesn't fire
    });
  }

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

  function visibleTasks() {
    return state.tasks.filter((task) => {
      if (state.view === 'none' && task.categoryId !== null) return false;
      if (typeof state.view === 'number' && task.categoryId !== state.view) return false;
      if (state.status === 'open' && task.completed) return false;
      if (state.status === 'done' && !task.completed) return false;
      return true;
    });
  }

  function currentViewName() {
    if (state.view === 'all') return 'כל המשימות';
    if (state.view === 'none') return 'ללא קטגוריה';
    return state.categories.find((c) => c.id === state.view)?.name ?? 'כל המשימות';
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

    const tasks = visibleTasks();
    els.dragHint.hidden = tasks.length < 2;
    els.dragHint.lastChild.textContent = state.sortMode === 'manual'
      ? ' גררו משימות כדי לשנות את הסדר'
      : ' גררו משימה כדי לעבור לסדר ידני';
    const inView = state.tasks.filter((t) =>
      state.view === 'all' ? true : state.view === 'none' ? t.categoryId === null : t.categoryId === state.view);
    const openCount = inView.filter((t) => !t.completed).length;
    const overdueCount = inView.filter(isOverdue).length;

    els.viewSubtitle.textContent = inView.length
      ? `${openCount} פתוחות · ${inView.length - openCount} הושלמו`
      : '';

    els.overduePill.hidden = overdueCount === 0;
    els.overduePill.textContent = overdueCount === 1 ? 'משימה אחת באיחור' : `${overdueCount} משימות באיחור`;

    els.taskList.replaceChildren(...tasks.map(taskItem));

    if (state.highlight) {
      const item = els.taskList.querySelector(`[data-id="${state.highlight.id}"]`);
      item?.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      state.highlight = null;
    }

    els.emptyState.hidden = tasks.length > 0;
    if (!tasks.length) {
      if (state.status === 'done') {
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

  function taskItem(task) {
    const overdue = isOverdue(task);
    const li = el('li', 'task');
    li.dataset.id = task.id;
    li.classList.add(`task--${task.priority}`);
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
    body.append(el('p', 'task__title', task.title));
    if (task.description) body.append(el('p', 'task__description', task.description));

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

  const combo = (() => {
    const root = $('category-combo');
    const input = $('category-input');
    const list = $('category-options');
    const toggle = $('category-toggle');
    const badge = $('category-new-badge');
    const DEFAULT_PLACEHOLDER = input.placeholder;

    // { type: 'none' } | { type: 'existing', id, name } | { type: 'new', name }
    let selection = { type: 'none' };
    let options = [];
    let activeIndex = -1;

    const norm = (s) => s.trim().toLocaleLowerCase('he-IL');
    const findByName = (name) => state.categories.find((c) => norm(c.name) === norm(name));
    const labelOf = (sel) => (sel.type === 'none' ? '' : sel.name);
    const isOpen = () => !list.hidden;

    function setSelection(sel) {
      selection = sel;
      input.value = labelOf(sel);
      badge.hidden = sel.type !== 'new';
      root.classList.toggle('combo--new', sel.type === 'new');
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
        li.id = `category-option-${i}`;
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
        setSelection({ type: 'none' });
        input.placeholder = 'הקלידו שם לקטגוריה החדשה';
        close();
        input.focus();
        return;
      }
      if (opt.kind === 'none') setSelection({ type: 'none' });
      if (opt.kind === 'existing') setSelection({ type: 'existing', id: opt.id, name: opt.label });
      if (opt.kind === 'create') setSelection({ type: 'new', name: opt.name });
      input.placeholder = DEFAULT_PLACEHOLDER;
      close();
    }

    // Turn whatever is typed in the input into a selection.
    function commitTyped() {
      const text = input.value.trim();
      if (text === labelOf(selection)) { badge.hidden = selection.type !== 'new'; return; }
      if (!text) { setSelection({ type: 'none' }); return; }
      const match = findByName(text);
      setSelection(match ? { type: 'existing', id: match.id, name: match.name } : { type: 'new', name: text });
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
  })();

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
    showTaskError('');
    els.taskSubmit.disabled = false;
    els.taskDialog.showModal();
    els.taskTitle.focus();
  }

  // Make sure a just-saved task is visible with the current view / filter.
  function revealTask(task) {
    if (state.status === 'done' && !task.completed) state.status = 'all';
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

  // Escape closes the category list first, not the whole dialog.
  els.taskDialog.addEventListener('cancel', (e) => {
    if (combo.isOpen()) {
      e.preventDefault();
      combo.close();
    }
  });

  // Close dialogs when clicking the backdrop.
  [els.taskDialog, els.confirmDialog].forEach((dialog) => {
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(dialog); });
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
  const INTERACTIVE = 'button:not(.task__handle), input, a, textarea, select, label';

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
      if (ctx) finishDrag(ctx, ev.type === 'pointercancel' || ev.type === 'keydown');
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
      const { user } = await api('/api/auth/me');
      els.email.textContent = user.email;
      state.sortMode = user.sortMode === 'manual' ? 'manual' : 'due';
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  })();
})();
