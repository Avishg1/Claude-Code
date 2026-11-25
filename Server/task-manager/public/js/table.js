'use strict';

(() => {
  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  const state = {
    tasks: [],
    categories: [],
    status: 'all',           // 'all' | 'open' | 'overdue' | 'done'
    category: 'all',         // 'all' | 'none' | <category id as string>
    assignee: 'all',         // teams only: 'all' | 'me' | 'none' | <user id as string>
    search: '',
    sort: { key: 'dueDate', dir: 1 },
  };

  const WS = window.TMWorkspace; // personal list / teams (workspace.js)

  const PRIORITY_LABELS = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  const $ = (id) => document.getElementById(id);
  const els = {
    email: $('user-email'),
    logout: $('logout-btn'),
    search: $('search-input'),
    stats: $('stats'),
    statusTabs: document.querySelectorAll('[data-status]'),
    categoryFilter: $('category-filter'),
    assigneeFilter: $('assignee-filter'),
    taskAssignee: $('task-assignee'),
    headers: document.querySelectorAll('th[data-sort]'),
    body: $('grid-body'),
    empty: $('table-empty'),
    emptyText: $('table-empty-text'),
    newTask: $('new-task-btn'),
    taskDialog: $('task-dialog'),
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
    trash: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    comboCheck: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

  const daysLate = (task) => Math.round((parseISODate(todayISO()) - parseISODate(task.dueDate)) / 86400000);
  const isOverdue = (task) => !task.completed && task.dueDate < todayISO();
  const statusOf = (task) => (task.completed ? 'done' : isOverdue(task) ? 'overdue' : 'open');

  function formatCreated(value) {
    // SQLite datetime('now') is UTC without a zone marker.
    const date = new Date(`${String(value).replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  let toastTimer;
  function toast(message, type = 'info') {
    els.toast.textContent = message;
    els.toast.className = `toast toast--${type}`;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3200);
  }

  // Close a <dialog> with a short fade-out animation (same as the dashboard).
  const pendingClose = new WeakMap();

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
        if (pendingClose.get(dialog) === token) {
          pendingClose.delete(dialog);
          dialog.classList.remove('is-closing');
          dialog.close();
        }
        resolve();
      };
      if (dialog.contains(document.activeElement)) document.activeElement.blur();
      dialog.classList.add('is-closing');
      dialog.addEventListener('animationend', finish, { once: true });
      setTimeout(finish, 300);
    });
  }

  function showDialog(dialog) {
    if (pendingClose.has(dialog)) {
      pendingClose.delete(dialog);
      dialog.classList.remove('is-closing');
    }
    if (!dialog.open) dialog.showModal();
  }

  const openDialog = () => document.querySelector('dialog[open]:not(.is-closing)');

  function confirmAction(message) {
    els.confirmText.textContent = message;
    els.confirmDialog.returnValue = '';
    els.confirmDialog.showModal();
    return new Promise((resolve) => {
      els.confirmDialog.addEventListener('close', () => resolve(els.confirmDialog.returnValue === 'confirm'), { once: true });
    });
  }

  const normalize = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('he-IL');

  /* ---------------------------------------------------------------- */
  /* Filtering & sorting                                              */
  /* ---------------------------------------------------------------- */

  const STATUS_RANK = { overdue: 0, open: 1, done: 2 };
  const collator = new Intl.Collator('he-IL', { sensitivity: 'base', numeric: true });

  const SORTERS = {
    title: (a, b) => collator.compare(a.title, b.title),
    description: (a, b) => collator.compare(a.description ?? '', b.description ?? ''),
    category: (a, b) => collator.compare(a.categoryName ?? '￿', b.categoryName ?? '￿'),
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
    // Tasks without a responsible person sort last.
    assignee: (a, b) => (!a.assigneeId - !b.assigneeId) || collator.compare(WS.assigneeLabel(a), WS.assigneeLabel(b)),
    dueDate: (a, b) => a.dueDate.localeCompare(b.dueDate),
    status: (a, b) => STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)],
    createdAt: (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)),
  };

  function visibleTasks() {
    const terms = normalize(state.search).split(/\s+/).filter(Boolean);
    const { key, dir } = state.sort;
    return state.tasks
      .filter((t) => state.status === 'all' || statusOf(t) === state.status || (state.status === 'open' && !t.completed))
      .filter((t) => state.category === 'all'
        || (state.category === 'none' ? t.categoryId == null : String(t.categoryId) === state.category))
      .filter((t) => WS.matchesAssignee(t, state.assignee))
      .filter((t) => {
        if (!terms.length) return true;
        const hay = normalize(`${t.title} ${t.description ?? ''} ${t.categoryName ?? ''}`);
        return terms.every((term) => hay.includes(term));
      })
      .sort((a, b) => dir * SORTERS[key](a, b) || SORTERS.dueDate(a, b) || a.id - b.id);
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  function renderStats() {
    const open = state.tasks.filter((t) => !t.completed).length;
    const overdue = state.tasks.filter(isOverdue).length;
    const done = state.tasks.length - open;
    els.stats.replaceChildren(
      stat(state.tasks.length, 'סה״כ'),
      stat(open, 'פתוחות'),
      stat(overdue, 'באיחור', overdue ? 'stat--danger' : ''),
      stat(done, 'הושלמו', 'stat--success'),
    );
  }

  function stat(value, label, extra = '') {
    const node = el('div', `stat ${extra}`.trim());
    node.append(el('span', 'stat__value', String(value)), el('span', 'stat__label', label));
    return node;
  }

  function renderCategoryFilter() {
    const current = state.category;
    const options = [['all', 'הכל'], ['none', 'ללא קטגוריה'], ...state.categories.map((c) => [String(c.id), c.name])];
    els.categoryFilter.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    els.categoryFilter.value = options.some(([v]) => v === current) ? current : 'all';
    state.category = els.categoryFilter.value;
  }

  function renderHeaders() {
    for (const th of els.headers) {
      const active = th.dataset.sort === state.sort.key;
      th.setAttribute('aria-sort', active ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
      th.classList.toggle('is-sorted', active);
    }
  }

  function render() {
    renderStats();
    renderHeaders();
    const tasks = visibleTasks();
    els.body.replaceChildren(...tasks.map(buildRow));
    els.empty.hidden = tasks.length > 0;
    if (!tasks.length) {
      els.emptyText.textContent = state.tasks.length ? 'אין משימות שתואמות את הסינון' : 'עדיין אין משימות. הוסיפו את הראשונה למעלה.';
    }
  }

  function categoryOptions(select, task) {
    select.replaceChildren(
      new Option('ללא קטגוריה', ''),
      ...state.categories.map((c) => new Option(c.name, String(c.id))),
    );
    select.value = task.categoryId == null ? '' : String(task.categoryId);
  }

  function buildRow(task) {
    const tr = el('tr', 'row');
    tr.dataset.id = task.id;

    // Completed checkbox
    const checkCell = el('td', 'col-check');
    const check = el('input', 'row-check');
    check.type = 'checkbox';
    check.checked = task.completed;
    check.setAttribute('aria-label', `סימון "${task.title}" כהושלמה`);
    check.addEventListener('change', () => save(task, tr, 'completed', check.checked, () => { check.checked = task.completed; }));
    checkCell.append(check);

    // Title
    const titleCell = el('td', 'col-title');
    const title = textInput(task.title, 'כותרת', 200);
    title.classList.add('cell-input--title');
    bindText(title, task, tr, 'title', { required: true });
    titleCell.append(title);

    // Description
    const descCell = el('td', 'col-desc');
    const desc = textInput(task.description ?? '', 'תיאור', 2000);
    desc.placeholder = 'הוספת תיאור…';
    bindText(desc, task, tr, 'description');
    descCell.append(desc);

    // Category
    const catCell = el('td', 'col-cat');
    const cat = el('select', 'cell-input cell-select');
    cat.setAttribute('aria-label', 'קטגוריה');
    categoryOptions(cat, task);
    cat.addEventListener('change', () => {
      const value = cat.value === '' ? null : Number(cat.value);
      save(task, tr, 'categoryId', value, () => { cat.value = task.categoryId == null ? '' : String(task.categoryId); });
    });
    catCell.append(cat);

    // Responsible (teams only; the column is hidden in the personal list)
    const assigneeCell = el('td', 'col-assignee team-only');
    const assignee = el('select', 'cell-input cell-select');
    assignee.setAttribute('aria-label', 'אחראי');
    if (WS.isTeam) WS.fillAssigneeSelect(assignee, task.assigneeId);
    assignee.addEventListener('change', () => {
      const value = assignee.value === '' ? null : Number(assignee.value);
      save(task, tr, 'assigneeId', value, () => { WS.fillAssigneeSelect(assignee, task.assigneeId); });
    });
    assigneeCell.append(assignee);

    // Priority
    const prioCell = el('td', 'col-prio');
    const prioWrap = el('div', 'prio');
    const prio = el('select', 'cell-input cell-select');
    prio.setAttribute('aria-label', 'עדיפות');
    for (const [value, label] of Object.entries(PRIORITY_LABELS)) prio.append(new Option(label, value));
    prio.value = task.priority;
    prioWrap.dataset.priority = task.priority;
    prio.addEventListener('change', () => {
      prioWrap.dataset.priority = prio.value;
      save(task, tr, 'priority', prio.value, () => { prio.value = task.priority; prioWrap.dataset.priority = task.priority; });
    });
    prioWrap.append(prio);
    prioCell.append(prioWrap);

    // Due date
    const dueCell = el('td', 'col-due');
    const due = el('input', 'cell-input cell-date');
    due.type = 'date';
    due.required = true;
    due.value = task.dueDate;
    due.setAttribute('aria-label', 'תאריך יעד');
    due.addEventListener('change', () => {
      if (!due.value) { due.value = task.dueDate; toast('יש לבחור תאריך יעד', 'error'); return; }
      save(task, tr, 'dueDate', due.value, () => { due.value = task.dueDate; });
    });
    dueCell.append(due);

    // Status
    const statusCell = el('td', 'col-status');
    statusCell.append(el('span', 'status-pill'));

    // Created
    const createdCell = el('td', 'col-created', formatCreated(task.createdAt));

    // Actions
    const actionsCell = el('td', 'col-actions');
    const indicator = el('span', 'save-dot');
    indicator.setAttribute('aria-hidden', 'true');
    const del = el('button', 'row-delete');
    del.type = 'button';
    del.innerHTML = ICONS.trash;
    del.setAttribute('aria-label', `מחיקת "${task.title}"`);
    del.title = 'מחיקה';
    del.addEventListener('click', () => deleteTask(task, tr));
    actionsCell.append(indicator, del);

    tr.append(checkCell, titleCell, descCell, catCell, assigneeCell, prioCell, dueCell, statusCell, createdCell, actionsCell);
    updateRowState(tr, task);
    return tr;
  }

  function textInput(value, label, maxLength) {
    const input = el('input', 'cell-input');
    input.type = 'text';
    input.value = value;
    input.maxLength = maxLength;
    input.setAttribute('aria-label', label);
    input.title = value;
    return input;
  }

  // Text cells save on blur / Enter; Escape restores the saved value.
  function bindText(input, task, tr, field, { required = false } = {}) {
    const current = () => task[field] ?? '';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = current(); input.blur(); }
    });
    input.addEventListener('blur', () => {
      const value = input.value.trim();
      if (value === current()) { input.value = current(); return; }
      if (required && !value) {
        input.value = current();
        toast('יש להזין כותרת למשימה', 'error');
        return;
      }
      save(task, tr, field, value, () => { input.value = current(); });
    });
  }

  function updateRowState(tr, task) {
    const status = statusOf(task);
    tr.classList.toggle('is-overdue', status === 'overdue');
    tr.classList.toggle('is-done', status === 'done');

    const pill = tr.querySelector('.col-status .status-pill');
    pill.className = `status-pill status-pill--${status}`;
    if (status === 'overdue') {
      const days = daysLate(task);
      pill.textContent = days === 1 ? 'באיחור · יום' : `באיחור · ${days} ימים`;
    } else {
      pill.textContent = status === 'done' ? 'הושלמה' : 'פתוחה';
    }

    const title = tr.querySelector('.cell-input--title');
    title.title = task.title;
    tr.querySelector('.row-check').setAttribute('aria-label', `סימון "${task.title}" כהושלמה`);
    tr.querySelector('.row-delete').setAttribute('aria-label', `מחיקת "${task.title}"`);
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  async function save(task, tr, field, value, revert) {
    if (task[field] === value) return;
    const dot = tr.querySelector('.save-dot');
    dot.className = 'save-dot is-saving';
    try {
      const { task: updated } = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { [field]: value } });
      Object.assign(task, updated);
      updateRowState(tr, task);
      renderStats();
      dot.className = 'save-dot is-saved';
      dot.innerHTML = ICONS.check;
      setTimeout(() => { if (dot.classList.contains('is-saved')) { dot.className = 'save-dot'; dot.innerHTML = ''; } }, 1400);
    } catch (err) {
      dot.className = 'save-dot';
      revert();
      toast(err.message, 'error');
    }
  }

  async function deleteTask(task, tr) {
    if (!(await confirmAction(`למחוק את המשימה "${task.title}"? לא ניתן לבטל פעולה זו.`))) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      tr.classList.add('is-removing');
      setTimeout(render, 180);
      toast('המשימה נמחקה', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Category combobox (same behavior as the dashboard dialog)        */
  /* ---------------------------------------------------------------- */

  function createCategoryCombo(prefix) {
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
    let promptMode = false;

    const norm = (s) => s.trim().toLocaleLowerCase('he-IL');
    const findByName = (name) => state.categories.find((c) => norm(c.name) === norm(name));
    const labelOf = (sel) => (sel.type === 'none' ? '' : sel.name);
    const isOpen = () => !list.hidden;

    function setSelection(sel) {
      selection = sel;
      promptMode = false;
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

    function labelNode(text, query) {
      const span = el('span', 'combo__label');
      const q = norm(query);
      const i = q ? text.toLocaleLowerCase('he-IL').indexOf(q) : -1;
      if (i === -1) span.textContent = text;
      else span.append(text.slice(0, i), el('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length));
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
        else if (isSelected(opt)) icon.innerHTML = ICONS.comboCheck;
        li.append(icon, opt.kind === 'existing' ? labelNode(opt.label, query) : el('span', 'combo__label', opt.label));
        li.addEventListener('mousedown', (e) => e.preventDefault());
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
        input.value = '';
        badge.hidden = true;
        input.placeholder = 'הקלידו שם לקטגוריה החדשה';
        promptMode = true;
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

    function commitTyped() {
      const text = input.value.trim();
      if (promptMode && !text) {
        setSelection(selection);
        input.placeholder = DEFAULT_PLACEHOLDER;
        return;
      }
      if (text === labelOf(selection)) { badge.hidden = selection.type !== 'new'; return; }
      input.placeholder = DEFAULT_PLACEHOLDER;
      if (!text) { setSelection({ type: 'none' }); return; }
      const match = findByName(text);
      setSelection(match ? { type: 'existing', id: match.id, name: match.name } : { type: 'new', name: text });
    }

    input.addEventListener('input', () => { badge.hidden = true; open(input.value); });
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
          if (isOpen() && activeIndex >= 0) { e.preventDefault(); choose(options[activeIndex]); }
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
  /* New task dialog (same as "משימה חדשה" on the dashboard)          */
  /* ---------------------------------------------------------------- */

  function showTaskError(message) {
    els.taskError.textContent = message;
    els.taskError.hidden = !message;
  }

  function openTaskDialog() {
    els.taskForm.reset();
    els.taskTitle.value = '';
    els.taskDescription.value = '';
    els.taskDue.value = todayISO();
    els.taskForm.elements.priority.value = 'medium';
    // Like the dashboard: preselect the category currently being viewed.
    combo.reset(/^\d+$/.test(state.category) ? Number(state.category) : null);
    const defaultAssignee = state.assignee === 'me' ? WS.me?.id : (/^\d+$/.test(state.assignee) ? Number(state.assignee) : null);
    WS.fillAssigneeSelect(els.taskAssignee, defaultAssignee);
    showTaskError('');
    els.taskSubmit.disabled = false;
    showDialog(els.taskDialog);
    els.taskTitle.focus();
  }

  // Make sure a just-created task is visible with the current filters.
  function revealTask(task) {
    if (state.status === 'done' || (state.status === 'overdue' && !isOverdue(task))) setStatus('all');
    const c = state.category;
    if ((c === 'none' && task.categoryId !== null) || (/^\d+$/.test(c) && Number(c) !== task.categoryId)) {
      state.category = 'all';
      els.categoryFilter.value = 'all';
    }
    if (state.search) { state.search = ''; els.search.value = ''; }
    if (!WS.matchesAssignee(task, state.assignee)) { state.assignee = 'all'; els.assigneeFilter.value = 'all'; }
  }

  els.taskForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (combo.isOpen()) return;
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
      // Create a new category only on submit, so cancelling doesn't leave one behind.
      if (category.type === 'new') {
        const created = await api('/api/categories', { method: 'POST', body: { name: category.name } });
        state.categories.push(created.category);
        state.categories.sort((a, b) => collator.compare(a.name, b.name));
        combo.markCreated(created.category);
        payload.categoryId = created.category.id;
        renderCategoryFilter();
      }

      const { task } = await api('/api/tasks', { method: 'POST', body: payload });
      state.tasks.push(task);
      await closeDialog(els.taskDialog);
      revealTask(task);
      render();
      const row = els.body.querySelector(`tr[data-id="${task.id}"]`);
      if (row) {
        row.classList.add('is-new');
        row.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
      toast('המשימה נוספה', 'success');
    } catch (err) {
      showTaskError(err.message);
      els.taskSubmit.disabled = false;
    }
  });

  els.taskDialog.querySelectorAll('[data-close]').forEach((btn) =>
    btn.addEventListener('click', () => closeDialog(els.taskDialog)));

  // Escape closes an open category list first, then the dialog.
  [els.taskDialog, els.confirmDialog].forEach((dialog) => {
    dialog.addEventListener('cancel', (e) => {
      if (!e.cancelable) return;
      e.preventDefault();
      if (dialog === els.taskDialog && combo.isOpen()) combo.close();
      else if (dialog === els.confirmDialog) dialog.close('cancel');
      else closeDialog(dialog);
    });
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return;
      if (dialog === els.confirmDialog) dialog.close('cancel');
      else closeDialog(dialog);
    });
  });

  // N opens the new task dialog (physical key, so it also works with a Hebrew layout).
  const isTextEntry = (node) => node instanceof HTMLElement
    && (node.isContentEditable || node.matches('input, textarea, select'));

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || e.defaultPrevented) return;
    if (isTextEntry(e.target) || openDialog()) return;
    e.preventDefault();
    openTaskDialog();
  });

  /* ---------------------------------------------------------------- */
  /* Events & init                                                    */
  /* ---------------------------------------------------------------- */

  for (const th of els.headers) {
    th.querySelector('button').addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: 1 };
      render();
    });
  }

  function setStatus(status) {
    state.status = status;
    for (const t of els.statusTabs) {
      const active = t.dataset.status === status;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    }
  }

  for (const tab of els.statusTabs) {
    tab.addEventListener('click', () => { setStatus(tab.dataset.status); render(); });
  }

  els.categoryFilter.addEventListener('change', () => { state.category = els.categoryFilter.value; render(); });
  els.search.addEventListener('input', () => { state.search = els.search.value; render(); });
  els.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.search.value = ''; state.search = ''; render(); } });
  els.newTask.addEventListener('click', () => openTaskDialog());

  els.logout.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { window.location.replace('/'); }
  });

  async function init() {
    try {
      // Load "me" first: it decides which workspace the other requests ask for.
      const me = await api('/api/auth/me');
      WS.mount(me);
      const [{ tasks }, { categories }] = await Promise.all([api('/api/tasks'), api('/api/categories')]);
      const { user } = me;
      els.email.textContent = user.email;
      if (WS.isTeam) {
        state.assignee = WS.fillAssigneeFilter(els.assigneeFilter, state.assignee);
        els.assigneeFilter.addEventListener('change', () => { state.assignee = els.assigneeFilter.value; render(); });
      }
      state.tasks = tasks;
      state.categories = categories;
      renderCategoryFilter();
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  init();
})();
