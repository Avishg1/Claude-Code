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
    editingTaskId: null,
  };

  const PRIORITY_LABELS = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };

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
    overduePill: $('overdue-pill'),
    taskList: $('task-list'),
    emptyState: $('empty-state'),
    emptyTitle: $('empty-title'),
    emptyText: $('empty-text'),
    taskDialog: $('task-dialog'),
    taskDialogTitle: $('task-dialog-title'),
    taskForm: $('task-form'),
    taskTitle: $('task-title'),
    taskDescription: $('task-description'),
    taskDue: $('task-due'),
    taskPriority: $('task-priority'),
    taskCategory: $('task-category'),
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
    const [taskData, categoryData] = await Promise.all([api('/api/tasks'), api('/api/categories')]);
    state.tasks = taskData.tasks;
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

    const tasks = visibleTasks();
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
    li.classList.add(`task--${task.priority}`);
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
    li.append(check, body, actions);
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
  /* Task dialog                                                      */
  /* ---------------------------------------------------------------- */

  function fillCategorySelect(selectedId) {
    const options = [new Option('ללא קטגוריה', '')];
    state.categories.forEach((c) => options.push(new Option(c.name, String(c.id))));
    els.taskCategory.replaceChildren(...options);
    els.taskCategory.value = selectedId ? String(selectedId) : '';
  }

  function showTaskError(message) {
    els.taskError.textContent = message;
    els.taskError.hidden = !message;
  }

  function openTaskDialog(task = null) {
    state.editingTaskId = task ? task.id : null;
    els.taskDialogTitle.textContent = task ? 'עריכת משימה' : 'משימה חדשה';
    els.taskSubmit.textContent = task ? 'שמירת שינויים' : 'יצירת משימה';
    els.taskTitle.value = task?.title ?? '';
    els.taskDescription.value = task?.description ?? '';
    els.taskDue.value = task?.dueDate ?? todayISO();
    els.taskPriority.value = task?.priority ?? 'medium';
    fillCategorySelect(task ? task.categoryId : (typeof state.view === 'number' ? state.view : null));
    showTaskError('');
    els.taskSubmit.disabled = false;
    els.taskDialog.showModal();
    els.taskTitle.focus();
  }

  els.taskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showTaskError('');

    const payload = {
      title: els.taskTitle.value.trim(),
      description: els.taskDescription.value.trim(),
      dueDate: els.taskDue.value,
      priority: els.taskPriority.value,
      categoryId: els.taskCategory.value ? Number(els.taskCategory.value) : null,
    };

    if (!payload.title) { showTaskError('יש להזין כותרת למשימה'); els.taskTitle.focus(); return; }
    if (!payload.dueDate) { showTaskError('יש לבחור תאריך יעד'); els.taskDue.focus(); return; }

    els.taskSubmit.disabled = true;
    try {
      const editing = state.editingTaskId;
      await api(editing ? `/api/tasks/${editing}` : '/api/tasks', { method: editing ? 'PUT' : 'POST', body: payload });
      els.taskDialog.close();
      toast(editing ? 'המשימה עודכנה' : 'המשימה נוספה', 'success');
      await loadAll();
    } catch (err) {
      showTaskError(err.message);
      els.taskSubmit.disabled = false;
    }
  });

  els.taskDialog.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => els.taskDialog.close()));

  // Close dialogs when clicking the backdrop.
  [els.taskDialog, els.confirmDialog].forEach((dialog) => {
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  });

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
    if (todayISO() !== lastDay) { lastDay = todayISO(); render(); }
  }, 60 * 1000);

  (async () => {
    try {
      const { user } = await api('/api/auth/me');
      els.email.textContent = user.email;
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
    }
  })();
})();
