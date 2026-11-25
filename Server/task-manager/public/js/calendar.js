'use strict';

(() => {
  /* ---------------------------------------------------------------- */
  /* State                                                            */
  /* ---------------------------------------------------------------- */

  const now = new Date();
  const state = {
    tasks: [],
    categories: [],
    category: 'all',         // 'all' | 'none' | <category id as string>
    search: '',
    hideDone: false,
    year: now.getFullYear(),
    month: now.getMonth(),   // 0-11
    selected: null,          // ISO date of the selected day
    editing: null,           // task being edited in the dialog, or null when creating
  };

  const PRIORITY_LABELS = { low: 'נמוכה', medium: 'בינונית', high: 'גבוהה' };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

  const $ = (id) => document.getElementById(id);
  const els = {
    email: $('user-email'),
    logout: $('logout-btn'),
    search: $('search-input'),
    categoryFilter: $('category-filter'),
    hideDone: $('hide-done'),
    monthLabel: $('month-label'),
    prev: $('prev-month'),
    next: $('next-month'),
    today: $('today-btn'),
    grid: $('cal-grid'),
    dayTitle: $('day-panel-title'),
    dayList: $('day-list'),
    dayEmpty: $('day-empty'),
    dayAdd: $('day-add-btn'),
    newTask: $('new-task-btn'),
    taskDialog: $('task-dialog'),
    taskDialogTitle: $('task-dialog-title'),
    taskDialogSubtitle: $('task-dialog-subtitle'),
    taskForm: $('task-form'),
    taskTitle: $('task-title'),
    taskDescription: $('task-description'),
    taskDue: $('task-due'),
    taskDoneRow: $('task-done-row'),
    taskDone: $('task-done'),
    taskError: $('task-error'),
    taskSubmit: $('task-submit'),
    taskDelete: $('task-delete'),
    confirmDialog: $('confirm-dialog'),
    confirmText: $('confirm-text'),
    toast: $('toast'),
  };

  const ICONS = {
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

  const isOverdue = (task) => !task.completed && task.dueDate < todayISO();

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
  const collator = new Intl.Collator('he-IL', { sensitivity: 'base', numeric: true });

  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const monthFormat = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
  const dayFormat = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  const longDate = (iso) => dayFormat.format(parseISODate(iso));

  const countLabel = (n) => (n === 0 ? 'אין משימות' : n === 1 ? 'משימה אחת' : `${n} משימות`);

  /* ---------------------------------------------------------------- */
  /* Filtering                                                        */
  /* ---------------------------------------------------------------- */

  function visibleTasks() {
    const terms = normalize(state.search).split(/\s+/).filter(Boolean);
    return state.tasks
      .filter((t) => !(state.hideDone && t.completed))
      .filter((t) => state.category === 'all'
        || (state.category === 'none' ? t.categoryId == null : String(t.categoryId) === state.category))
      .filter((t) => {
        if (!terms.length) return true;
        const hay = normalize(`${t.title} ${t.description ?? ''} ${t.categoryName ?? ''}`);
        return terms.every((term) => hay.includes(term));
      });
  }

  // Map of ISO date -> that day's tasks (open first, then by priority and title).
  function tasksByDay() {
    const map = new Map();
    for (const t of visibleTasks()) {
      if (!map.has(t.dueDate)) map.set(t.dueDate, []);
      map.get(t.dueDate).push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.completed - b.completed
        || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
        || collator.compare(a.title, b.title));
    }
    return map;
  }

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  function renderCategoryFilter() {
    const current = state.category;
    const options = [['all', 'הכל'], ['none', 'ללא קטגוריה'], ...state.categories.map((c) => [String(c.id), c.name])];
    els.categoryFilter.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    els.categoryFilter.value = options.some(([v]) => v === current) ? current : 'all';
    state.category = els.categoryFilter.value;
  }

  function inMonth(iso) {
    const d = parseISODate(iso);
    return d.getFullYear() === state.year && d.getMonth() === state.month;
  }

  function render() {
    const first = new Date(state.year, state.month, 1);
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const offset = first.getDay(); // Sunday = 0 = the first (rightmost) column
    const weeks = Math.ceil((offset + daysInMonth) / 7);
    const today = todayISO();
    const byDay = tasksByDay();

    if (!state.selected || !inMonth(state.selected)) {
      state.selected = inMonth(today) ? today : toISO(first);
    }

    els.monthLabel.textContent = monthFormat.format(first);
    els.grid.style.setProperty('--weeks', weeks);

    const cells = [];
    for (let i = 0; i < weeks * 7; i += 1) {
      const date = new Date(state.year, state.month, 1 - offset + i);
      const iso = toISO(date);
      cells.push(buildCell(iso, date, byDay.get(iso) ?? [], today));
    }
    els.grid.replaceChildren(...cells);
    renderDayPanel(byDay);
  }

  function buildCell(iso, date, tasks, today) {
    const cell = el('div', 'cal-cell');
    cell.dataset.date = iso;
    cell.classList.toggle('is-outside', date.getMonth() !== state.month);
    cell.classList.toggle('is-today', iso === today);
    cell.classList.toggle('is-past', iso < today);
    cell.classList.toggle('is-selected', iso === state.selected);
    cell.classList.toggle('is-weekend', date.getDay() >= 5);
    cell.classList.toggle('has-tasks', tasks.length > 0);

    const head = el('div', 'cal-cell__head');
    const num = el('button', 'cal-cell__num', String(date.getDate()));
    num.type = 'button';
    num.setAttribute('aria-label', `${longDate(iso)}, ${countLabel(tasks.length)}`);
    num.setAttribute('aria-pressed', String(iso === state.selected));
    num.addEventListener('click', () => selectDay(iso));

    const add = el('button', 'cal-cell__add');
    add.type = 'button';
    add.innerHTML = ICONS.plus;
    add.title = 'משימה חדשה ביום זה';
    add.setAttribute('aria-label', `הוספת משימה ב${longDate(iso)}`);
    add.addEventListener('click', () => openTaskDialog({ date: iso }));
    head.append(num, add);

    const list = el('ul', 'cal-cell__list');
    list.append(...tasks.map((t) => {
      const li = el('li');
      li.append(buildChip(t));
      return li;
    }));

    cell.append(head, list);

    // Clicking empty space in a day selects it (drives the day list on small screens).
    cell.addEventListener('click', (e) => {
      if (e.target.closest('button') && !compactView()) return;
      selectDay(iso);
    });

    // Drop target for rescheduling a dragged task.
    cell.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-task-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      cell.classList.add('is-drop');
    });
    cell.addEventListener('dragleave', (e) => {
      if (!cell.contains(e.relatedTarget)) cell.classList.remove('is-drop');
    });
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('is-drop');
      const task = state.tasks.find((t) => t.id === Number(e.dataTransfer.getData('text/x-task-id')));
      if (task) reschedule(task, iso);
    });

    return cell;
  }

  // On small screens the chips shrink to dots, so a tap selects the day instead.
  const compactQuery = window.matchMedia('(max-width: 720px)');
  const compactView = () => compactQuery.matches;

  function buildChip(task) {
    const chip = el('button', 'cal-chip');
    chip.type = 'button';
    chip.dataset.priority = task.priority;
    chip.dataset.id = task.id;
    chip.classList.toggle('is-done', task.completed);
    chip.classList.toggle('is-overdue', isOverdue(task));
    chip.append(el('span', 'cal-chip__dot'), el('span', 'cal-chip__title', task.title));

    const status = task.completed ? 'הושלמה' : isOverdue(task) ? 'באיחור' : 'פתוחה';
    const details = [`עדיפות ${PRIORITY_LABELS[task.priority]}`, status, task.categoryName].filter(Boolean).join(' · ');
    chip.title = `${task.title}\n${details}`;
    chip.setAttribute('aria-label', `${task.title}, ${details}. לחצו לעריכה`);

    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/x-task-id', String(task.id));
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => chip.classList.add('is-dragging'));
    });
    chip.addEventListener('dragend', () => chip.classList.remove('is-dragging'));
    chip.addEventListener('click', () => { if (!compactView()) openTaskDialog({ task }); });
    return chip;
  }

  function renderDayPanel(byDay = tasksByDay()) {
    const tasks = byDay.get(state.selected) ?? [];
    els.dayTitle.textContent = longDate(state.selected);
    els.dayEmpty.hidden = tasks.length > 0;
    els.dayList.replaceChildren(...tasks.map((task) => {
      const li = el('li', 'cal-day__item');
      li.dataset.priority = task.priority;
      li.classList.toggle('is-done', task.completed);
      li.classList.toggle('is-overdue', isOverdue(task));

      const check = el('input', 'row-check');
      check.type = 'checkbox';
      check.checked = task.completed;
      check.setAttribute('aria-label', `סימון "${task.title}" כהושלמה`);
      check.addEventListener('change', () => toggleDone(task, check.checked));

      const open = el('button', 'cal-day__open');
      open.type = 'button';
      open.append(el('span', 'cal-chip__dot'), el('span', 'cal-day__name', task.title));
      if (task.categoryName) open.append(el('span', 'cal-day__cat', task.categoryName));
      open.setAttribute('aria-label', `עריכת "${task.title}"`);
      open.addEventListener('click', () => openTaskDialog({ task }));

      li.append(check, open);
      return li;
    }));
  }

  function selectDay(iso) {
    state.selected = iso;
    for (const cell of els.grid.children) {
      const active = cell.dataset.date === iso;
      cell.classList.toggle('is-selected', active);
      cell.querySelector('.cal-cell__num').setAttribute('aria-pressed', String(active));
    }
    renderDayPanel();
  }

  function goToMonth(year, month) {
    const d = new Date(year, month, 1);
    state.year = d.getFullYear();
    state.month = d.getMonth();
    render();
  }

  function goToDate(iso) {
    const d = parseISODate(iso);
    state.selected = iso;
    goToMonth(d.getFullYear(), d.getMonth());
  }

  function flashTask(id) {
    const chip = els.grid.querySelector(`.cal-chip[data-id="${id}"]`);
    if (chip) chip.classList.add('is-new');
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                          */
  /* ---------------------------------------------------------------- */

  async function patchTask(task, changes) {
    const { task: updated } = await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: changes });
    Object.assign(task, updated);
    return task;
  }

  async function reschedule(task, iso) {
    if (task.dueDate === iso) return;
    const previous = task.dueDate;
    task.dueDate = iso; // optimistic
    render();
    try {
      await patchTask(task, { dueDate: iso });
      render();
      flashTask(task.id);
      toast(`המשימה הועברה ל${longDate(iso)}`, 'success');
    } catch (err) {
      task.dueDate = previous;
      render();
      toast(err.message, 'error');
    }
  }

  async function toggleDone(task, completed) {
    try {
      await patchTask(task, { completed });
      render();
      if (completed) toast('המשימה הושלמה', 'success');
    } catch (err) {
      render();
      toast(err.message, 'error');
    }
  }

  async function deleteTask(task) {
    if (!(await confirmAction(`למחוק את המשימה "${task.title}"? לא ניתן לבטל פעולה זו.`))) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      state.tasks = state.tasks.filter((t) => t.id !== task.id);
      await closeDialog(els.taskDialog);
      render();
      toast('המשימה נמחקה', 'success');
    } catch (err) {
      showTaskError(err.message);
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
  /* Task dialog: create (with a preset date) or edit                 */
  /* ---------------------------------------------------------------- */

  function showTaskError(message) {
    els.taskError.textContent = message;
    els.taskError.hidden = !message;
  }

  function openTaskDialog({ task = null, date = null } = {}) {
    state.editing = task;
    els.taskForm.reset();
    showTaskError('');
    els.taskSubmit.disabled = false;

    if (task) {
      els.taskDialogTitle.textContent = 'עריכת משימה';
      els.taskDialogSubtitle.textContent = 'עדכנו את הפרטים ולחצו על שמירה';
      els.taskSubmit.textContent = 'שמירה';
      els.taskTitle.value = task.title;
      els.taskDescription.value = task.description ?? '';
      els.taskDue.value = task.dueDate;
      els.taskForm.elements.priority.value = task.priority;
      els.taskDone.checked = task.completed;
      combo.reset(task.categoryId);
    } else {
      els.taskDialogTitle.textContent = 'משימה חדשה';
      els.taskDialogSubtitle.textContent = 'מלאו את הפרטים ולחצו על יצירה';
      els.taskSubmit.textContent = 'יצירת משימה';
      els.taskTitle.value = '';
      els.taskDescription.value = '';
      els.taskDue.value = date ?? state.selected ?? todayISO();
      els.taskForm.elements.priority.value = 'medium';
      combo.reset(/^\d+$/.test(state.category) ? Number(state.category) : null);
    }
    els.taskDoneRow.hidden = !task;
    els.taskDelete.hidden = !task;

    showDialog(els.taskDialog);
    els.taskTitle.focus();
  }

  // Make sure a saved task is visible with the current filters.
  function revealTask(task) {
    if (state.hideDone && task.completed) { state.hideDone = false; els.hideDone.checked = false; }
    const c = state.category;
    if ((c === 'none' && task.categoryId !== null) || (/^\d+$/.test(c) && Number(c) !== task.categoryId)) {
      state.category = 'all';
      els.categoryFilter.value = 'all';
    }
    if (state.search) { state.search = ''; els.search.value = ''; }
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

    if (!payload.title) { showTaskError('יש להזין כותרת למשימה'); els.taskTitle.focus(); return; }
    if (!payload.dueDate) { showTaskError('יש לבחור תאריך יעד'); els.taskDue.focus(); return; }

    els.taskSubmit.disabled = true;
    const editing = state.editing;
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

      let task;
      if (editing) {
        task = await patchTask(editing, { ...payload, completed: els.taskDone.checked });
      } else {
        ({ task } = await api('/api/tasks', { method: 'POST', body: payload }));
        state.tasks.push(task);
      }
      await closeDialog(els.taskDialog);
      revealTask(task);
      goToDate(task.dueDate);
      flashTask(task.id);
      toast(editing ? 'השינויים נשמרו' : 'המשימה נוספה', 'success');
    } catch (err) {
      showTaskError(err.message);
      els.taskSubmit.disabled = false;
    }
  });

  els.taskDelete.addEventListener('click', () => { if (state.editing) deleteTask(state.editing); });

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

  /* ---------------------------------------------------------------- */
  /* Keyboard                                                         */
  /* ---------------------------------------------------------------- */

  const isTextEntry = (node) => node instanceof HTMLElement
    && (node.isContentEditable || node.matches('input, textarea, select'));

  // N = new task, T = today, PageUp / PageDown = previous / next month.
  // Physical keys, so they also work with a Hebrew keyboard layout.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented) return;
    if (isTextEntry(e.target) || openDialog()) return;
    if (e.code === 'KeyN' && !e.repeat) { e.preventDefault(); openTaskDialog(); }
    else if (e.code === 'KeyT' && !e.repeat) { e.preventDefault(); goToDate(todayISO()); }
    else if (e.key === 'PageUp') { e.preventDefault(); goToMonth(state.year, state.month - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); goToMonth(state.year, state.month + 1); }
  });

  /* ---------------------------------------------------------------- */
  /* Events & init                                                    */
  /* ---------------------------------------------------------------- */

  els.prev.addEventListener('click', () => goToMonth(state.year, state.month - 1));
  els.next.addEventListener('click', () => goToMonth(state.year, state.month + 1));
  els.today.addEventListener('click', () => goToDate(todayISO()));
  els.dayAdd.addEventListener('click', () => openTaskDialog({ date: state.selected }));
  els.newTask.addEventListener('click', () => openTaskDialog());

  els.categoryFilter.addEventListener('change', () => { state.category = els.categoryFilter.value; render(); });
  els.hideDone.addEventListener('change', () => { state.hideDone = els.hideDone.checked; render(); });
  els.search.addEventListener('input', () => { state.search = els.search.value; render(); });
  els.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { els.search.value = ''; state.search = ''; render(); } });

  els.logout.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } finally { window.location.replace('/'); }
  });

  // Coming back to the tab (e.g. the next day) refreshes "today" and the overdue markers.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  async function init() {
    try {
      const [{ user }, { tasks }, { categories }] = await Promise.all([
        api('/api/auth/me'),
        api('/api/tasks'),
        api('/api/categories'),
      ]);
      els.email.textContent = user.email;
      state.tasks = tasks;
      state.categories = categories;
      renderCategoryFilter();
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  render();
  init();
})();
