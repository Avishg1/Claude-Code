'use strict';

/*
 * Workspaces (personal list + teams), shared by the dashboard, table and calendar.
 *
 *   TMWorkspace.headers()      headers every API call must send (which workspace the page shows)
 *   TMWorkspace.mount(me)      after GET /api/auth/me: renders the switcher into #workspace-slot
 *   TMWorkspace.isTeam         true when the page shows a team
 *   TMWorkspace.members        members of the current workspace (for "responsible" pickers)
 *   TMWorkspace.avatar(user)   small initials avatar element
 *   TMWorkspace.fillAssigneeSelect / fillAssigneeFilter / matchesAssignee
 *
 * Pages hide team-only controls with the "team-only" class (body.ws-personal hides them).
 */
(() => {
  const $ = (id) => document.getElementById(id);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const svg = (inner, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.6a3.5 3.5 0 010 6.8"/><path d="M18 14a6.5 6.5 0 013.5 6"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
    exit: '<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  };

  const WS = {
    id: null,
    me: null,
    workspace: null,
    workspaces: [],
    members: [],
    isTeam: false,
  };

  /* ---------------------------------------------------------------- */
  /* People                                                           */
  /* ---------------------------------------------------------------- */

  WS.displayName = (user) => {
    if (!user) return '';
    return user.name || String(user.email || '').split('@')[0];
  };

  WS.memberById = (id) => WS.members.find((m) => m.id === id) || null;

  // The responsible person of a task, as a user-like object (or null).
  WS.assigneeOf = (task) => (task.assigneeId
    ? { id: task.assigneeId, name: task.assigneeName, email: task.assigneeEmail }
    : null);

  WS.assigneeLabel = (task) => {
    const a = WS.assigneeOf(task);
    if (!a) return '';
    return a.id === WS.me?.id ? `${WS.displayName(a)} (אני)` : WS.displayName(a);
  };

  const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#65a30d', '#0891b2', '#9333ea'];

  function initials(user) {
    const name = WS.displayName(user).trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name.slice(0, 2) || '?').toUpperCase();
  }

  WS.avatar = (user, { size = 22 } = {}) => {
    const node = el('span', 'avatar', initials(user));
    node.style.setProperty('--avatar-bg', AVATAR_COLORS[(user?.id ?? 0) % AVATAR_COLORS.length]);
    node.style.setProperty('--avatar-size', `${size}px`);
    node.setAttribute('aria-hidden', 'true');
    return node;
  };

  // <select> of members for choosing who is responsible.
  WS.fillAssigneeSelect = (select, selectedId = null) => {
    select.replaceChildren(
      new Option('ללא אחראי', ''),
      ...WS.members.map((m) => new Option(m.id === WS.me?.id ? `${WS.displayName(m)} (אני)` : WS.displayName(m), String(m.id))),
    );
    // A task may point at someone who has left; keep it visible until changed.
    select.value = selectedId == null ? '' : String(selectedId);
    if (selectedId != null && select.value !== String(selectedId)) select.value = '';
  };

  // <select> for filtering lists by the responsible person.
  WS.fillAssigneeFilter = (select, current = 'all') => {
    select.replaceChildren(
      new Option('כולם', 'all'),
      new Option('המשימות שלי', 'me'),
      new Option('ללא אחראי', 'none'),
      ...WS.members.filter((m) => m.id !== WS.me?.id).map((m) => new Option(WS.displayName(m), String(m.id))),
    );
    select.value = [...select.options].some((o) => o.value === current) ? current : 'all';
    return select.value;
  };

  WS.matchesAssignee = (task, filter) => {
    if (!WS.isTeam || !filter || filter === 'all') return true;
    if (filter === 'me') return task.assigneeId === WS.me?.id;
    if (filter === 'none') return task.assigneeId == null;
    return String(task.assigneeId) === filter;
  };

  /* ---------------------------------------------------------------- */
  /* API                                                              */
  /* ---------------------------------------------------------------- */

  WS.headers = () => (WS.id ? { 'X-Workspace-Id': String(WS.id) } : {});

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...WS.headers() },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) { window.location.replace('/'); throw new Error('יש להתחבר מחדש'); }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (WS.isGone(res, data)) throw new Error(data.error);
    if (!res.ok) throw new Error(data?.error || 'אירעה שגיאה, נסו שוב');
    return data;
  }

  // The page's workspace is gone (team deleted, or you were removed): reload into another one.
  WS.isGone = (res, data) => {
    if (res.status !== 409 || data?.code !== 'workspace_gone') return false;
    window.location.reload();
    return true;
  };

  /* ---------------------------------------------------------------- */
  /* Small dialogs                                                    */
  /* ---------------------------------------------------------------- */

  function makeDialog(className = 'dialog dialog--small ws-dialog') {
    const dialog = el('dialog', className);
    document.body.append(dialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    return dialog;
  }

  function header(title, subtitle) {
    const head = el('div', 'dialog__header');
    const text = el('div');
    const h2 = el('h2', null, title);
    h2.id = `ws-title-${Math.random().toString(36).slice(2)}`;
    text.append(h2);
    if (subtitle) text.append(el('p', 'dialog__subtitle', subtitle));
    const close = el('button', 'btn btn--icon btn--ghost');
    close.type = 'button';
    close.innerHTML = svg(ICONS.close);
    close.setAttribute('aria-label', 'סגירה');
    head.append(text, close);
    return { head, h2, close };
  }

  function confirmAction(message, confirmLabel) {
    return new Promise((resolve) => {
      const dialog = makeDialog();
      const form = el('form');
      form.method = 'dialog';
      const h2 = el('h2', null, 'אישור');
      h2.id = 'ws-confirm-title';
      dialog.setAttribute('aria-labelledby', h2.id);
      const p = el('p', 'confirm-text', message);
      const actions = el('div', 'dialog__actions');
      const cancel = el('button', 'btn btn--ghost', 'ביטול');
      cancel.value = 'cancel';
      const ok = el('button', 'btn btn--danger', confirmLabel);
      ok.value = 'confirm';
      actions.append(cancel, ok);
      form.append(h2, p, actions);
      dialog.append(form);
      dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'confirm'); dialog.remove(); }, { once: true });
      dialog.showModal();
      cancel.focus();
    });
  }

  // A one-field form dialog (create team, my name). `submit` returns a promise; errors show inline.
  function promptDialog({ title, subtitle, label, value = '', placeholder = '', maxLength = 60, submitLabel, submit }) {
    const dialog = makeDialog();
    const { head, h2, close } = header(title, subtitle);
    dialog.setAttribute('aria-labelledby', h2.id);
    const form = el('form', 'form');
    form.noValidate = true;
    const field = el('div', 'field');
    const id = `ws-input-${Math.random().toString(36).slice(2)}`;
    const lab = el('label', null, label);
    lab.htmlFor = id;
    const input = el('input');
    input.type = 'text';
    input.id = id;
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    field.append(lab, input);
    const error = el('p', 'form-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = el('div', 'dialog__actions');
    const cancel = el('button', 'btn btn--ghost', 'ביטול');
    cancel.type = 'button';
    const ok = el('button', 'btn btn--primary', submitLabel);
    ok.type = 'submit';
    actions.append(cancel, ok);
    form.append(head, field, error, actions);
    dialog.append(form);

    const done = () => dialog.close();
    close.addEventListener('click', done);
    cancel.addEventListener('click', done);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) { error.textContent = 'יש למלא את השדה'; error.hidden = false; input.focus(); return; }
      ok.disabled = true;
      try {
        await submit(text);
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        ok.disabled = false;
      }
    });

    dialog.showModal();
    input.focus();
    input.select();
  }

  function createTeam() {
    promptDialog({
      title: 'צוות חדש',
      subtitle: 'אחרי היצירה תוכלו להוסיף חברים לצוות',
      label: 'שם הצוות',
      placeholder: 'לדוגמה: צוות שיווק',
      maxLength: 50,
      submitLabel: 'יצירת צוות',
      async submit(name) {
        const { workspace } = await api('/api/workspaces', { method: 'POST', body: { name } });
        goTo(workspace.id);
      },
    });
  }

  function editMyName() {
    promptDialog({
      title: 'השם שלי',
      subtitle: 'כך חברי הצוות יראו אתכם, למשל כשמשימה באחריותכם',
      label: 'שם',
      value: WS.me?.name ?? '',
      maxLength: 60,
      submitLabel: 'שמירה',
      async submit(name) {
        await api('/api/profile', { method: 'PUT', body: { name } });
        window.location.reload();
      },
    });
  }

  async function goTo(workspaceId) {
    await api('/api/workspaces/active', { method: 'PUT', body: { id: workspaceId } });
    // Reload without the old header, so the page opens in the newly chosen workspace.
    window.location.reload();
  }

  /* ---------------------------------------------------------------- */
  /* Team management dialog                                           */
  /* ---------------------------------------------------------------- */

  function manageTeam() {
    const owner = WS.workspace.isOwner;
    let changed = false;

    const dialog = makeDialog('dialog ws-dialog ws-manage');
    const { head, h2, close } = header('ניהול הצוות', owner
      ? 'כל חברי הצוות רואים ועורכים את כל המשימות של הצוות'
      : 'רק מנהל הצוות יכול להוסיף או להסיר חברים');
    dialog.setAttribute('aria-labelledby', h2.id);
    const body = el('div', 'ws-team__body');
    dialog.append(head, body);

    // ----- Team name -----
    const nameSection = el('section', 'ws-team__section');
    nameSection.append(el('h3', 'ws-team__heading', 'שם הצוות'));
    if (owner) {
      const form = el('form', 'ws-inline-form');
      const input = el('input');
      input.type = 'text';
      input.value = WS.workspace.name;
      input.maxLength = 50;
      input.setAttribute('aria-label', 'שם הצוות');
      const save = el('button', 'btn btn--secondary', 'שמירה');
      save.type = 'submit';
      form.append(input, save);
      const msg = el('p', 'ws-msg');
      msg.setAttribute('role', 'status');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/api/workspace', { method: 'PUT', body: { name: input.value } });
          changed = true;
          showMsg(msg, 'השם עודכן', 'success');
        } catch (err) {
          showMsg(msg, err.message, 'error');
        }
      });
      nameSection.append(form, msg);
    } else {
      nameSection.append(el('p', 'ws-team__name', WS.workspace.name));
    }
    body.append(nameSection);

    // ----- Members -----
    const membersSection = el('section', 'ws-team__section');
    const membersHeading = el('h3', 'ws-team__heading');
    const list = el('ul', 'ws-members');
    membersSection.append(membersHeading, list);

    function renderMembers() {
      membersHeading.textContent = `חברי הצוות (${WS.members.length})`;
      list.replaceChildren(...WS.members.map((m) => {
        const li = el('li', 'ws-member');
        const info = el('div', 'ws-member__info');
        const name = el('span', 'ws-member__name', WS.displayName(m) + (m.id === WS.me.id ? ' (אני)' : ''));
        const email = el('span', 'ws-member__email', m.email);
        email.dir = 'ltr';
        info.append(name, email);
        li.append(WS.avatar(m, { size: 34 }), info);
        if (m.role === 'owner') li.append(el('span', 'ws-badge', 'מנהל/ת'));

        if (owner && m.role !== 'owner') {
          const remove = el('button', 'icon-btn icon-btn--danger');
          remove.type = 'button';
          remove.innerHTML = svg(ICONS.trash, 17);
          remove.title = 'הסרה מהצוות';
          remove.setAttribute('aria-label', `הסרת ${WS.displayName(m)} מהצוות`);
          remove.addEventListener('click', async () => {
            const ok = await confirmAction(`להסיר את ${WS.displayName(m)} מהצוות? המשימות שבאחריותו יישארו בצוות בלי אחראי.`, 'הסרה');
            if (!ok) return;
            try {
              await api(`/api/workspace/members/${m.id}`, { method: 'DELETE' });
              WS.members = WS.members.filter((x) => x.id !== m.id);
              changed = true;
              renderMembers();
            } catch (err) {
              showMsg(addMsg, err.message, 'error');
            }
          });
          li.append(remove);
        }
        return li;
      }));
    }
    renderMembers();
    body.append(membersSection);

    // ----- Add member (owner) -----
    let addMsg = null;
    if (owner) {
      const addSection = el('section', 'ws-team__section');
      addSection.append(el('h3', 'ws-team__heading', 'הוספת חבר לצוות'));
      const form = el('form', 'ws-inline-form');
      form.noValidate = true;
      const input = el('input');
      input.type = 'email';
      input.dir = 'ltr';
      input.placeholder = 'name@example.com';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'אימייל של החבר החדש');
      const add = el('button', 'btn btn--primary');
      add.type = 'submit';
      add.innerHTML = `${svg(ICONS.plus, 16)} הוספה`;
      form.append(input, add);
      addMsg = el('p', 'ws-msg');
      addMsg.setAttribute('role', 'status');
      const hint = el('p', 'field__hint', 'החבר צריך להיות רשום לאפליקציה. מזינים את האימייל שאיתו נרשם.');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = input.value.trim();
        if (!email) { input.focus(); return; }
        add.disabled = true;
        try {
          const { member } = await api('/api/workspace/members', { method: 'POST', body: { email } });
          WS.members.push(member);
          changed = true;
          input.value = '';
          renderMembers();
          showMsg(addMsg, `${WS.displayName(member)} נוסף/ה לצוות`, 'success');
        } catch (err) {
          showMsg(addMsg, err.message, 'error');
        } finally {
          add.disabled = false;
        }
      });
      addSection.append(form, hint, addMsg);
      body.append(addSection);
    }

    // ----- Leave / delete -----
    const danger = el('section', 'ws-team__section ws-team__danger');
    const dangerMsg = el('p', 'ws-msg');
    dangerMsg.setAttribute('role', 'status');
    if (owner) {
      const del = el('button', 'btn btn--danger-ghost');
      del.type = 'button';
      del.innerHTML = `${svg(ICONS.trash, 16)} מחיקת הצוות`;
      del.addEventListener('click', async () => {
        const ok = await confirmAction(`למחוק את הצוות "${WS.workspace.name}"? כל המשימות והקטגוריות של הצוות יימחקו לכל החברים. לא ניתן לבטל פעולה זו.`, 'מחיקת הצוות');
        if (!ok) return;
        try {
          await api('/api/workspace', { method: 'DELETE' });
          window.location.reload(); // opens in the personal list
        } catch (err) {
          showMsg(dangerMsg, err.message, 'error');
        }
      });
      danger.append(del);
    } else {
      const leave = el('button', 'btn btn--danger-ghost');
      leave.type = 'button';
      leave.innerHTML = `${svg(ICONS.exit, 16)} עזיבת הצוות`;
      leave.addEventListener('click', async () => {
        const ok = await confirmAction(`לעזוב את הצוות "${WS.workspace.name}"? לא תוכלו לראות את המשימות שלו עד שיוסיפו אתכם שוב.`, 'עזיבה');
        if (!ok) return;
        try {
          await api(`/api/workspace/members/${WS.me.id}`, { method: 'DELETE' });
          window.location.reload(); // opens in the personal list
        } catch (err) {
          showMsg(dangerMsg, err.message, 'error');
        }
      });
      danger.append(leave);
    }
    danger.append(dangerMsg);
    body.append(danger);

    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (changed) window.location.reload(); // names and pickers on the page need the new members
    }, { once: true });
    dialog.showModal();
    close.focus();
  }

  function showMsg(node, text, kind) {
    if (!node) return;
    node.textContent = text;
    node.className = `ws-msg ws-msg--${kind}`;
  }

  /* ---------------------------------------------------------------- */
  /* Switcher                                                         */
  /* ---------------------------------------------------------------- */

  function renderSwitcher(slot) {
    const wrap = el('div', 'ws-switcher');
    const button = el('button', 'ws-switcher__btn');
    button.type = 'button';
    button.id = 'ws-switcher-btn';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'ws-menu');
    button.title = 'החלפה בין הרשימה האישית לצוותים';
    button.innerHTML = svg(WS.isTeam ? ICONS.team : ICONS.person, 18);
    button.append(el('span', 'ws-switcher__name', WS.workspace.name));
    button.insertAdjacentHTML('beforeend', svg(ICONS.chevron, 15));
    button.setAttribute('aria-label', `${WS.isTeam ? 'צוות' : 'רשימה אישית'}: ${WS.workspace.name}. החלפה`);

    const menu = el('div', 'ws-menu');
    menu.id = 'ws-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-labelledby', 'ws-switcher-btn');
    menu.hidden = true;

    const items = [];
    const addItem = (node) => { node.setAttribute('tabindex', '-1'); items.push(node); menu.append(node); };

    menu.append(el('p', 'ws-menu__label', 'הרשימות שלי'));
    for (const w of WS.workspaces) {
      const item = el('button', 'ws-menu__item');
      item.type = 'button';
      item.setAttribute('role', 'menuitemradio');
      const current = w.id === WS.id;
      item.setAttribute('aria-checked', String(current));
      item.innerHTML = svg(w.personal ? ICONS.person : ICONS.team, 17);
      item.append(el('span', 'ws-menu__name', w.name));
      if (!w.personal) item.append(el('span', 'ws-menu__meta', w.memberCount === 1 ? 'חבר אחד' : `${w.memberCount} חברים`));
      if (current) item.insertAdjacentHTML('beforeend', `<span class="ws-menu__check">${svg(ICONS.check, 16)}</span>`);
      item.addEventListener('click', () => {
        closeMenu();
        // If switching fails the workspace is gone; reloading shows what's left.
        if (!current) goTo(w.id).catch(() => window.location.reload());
      });
      addItem(item);
    }

    menu.append(el('hr', 'ws-menu__sep'));
    const action = (icon, label, run) => {
      const item = el('button', 'ws-menu__item');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.innerHTML = svg(icon, 17);
      item.append(el('span', 'ws-menu__name', label));
      item.addEventListener('click', () => { closeMenu({ focus: false }); run(); });
      addItem(item);
    };
    action(ICONS.plus, 'יצירת צוות חדש…', createTeam);
    if (WS.isTeam) action(ICONS.gear, 'ניהול הצוות…', manageTeam);
    action(ICONS.pencil, 'השם שלי…', editMyName);

    function openMenu() {
      menu.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      (items.find((i) => i.getAttribute('aria-checked') === 'true') || items[0]).focus();
    }
    function closeMenu({ focus = true } = {}) {
      if (menu.hidden) return;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (focus) button.focus();
    }

    button.addEventListener('click', () => (menu.hidden ? openMenu() : closeMenu()));
    button.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && menu.hidden) { e.preventDefault(); openMenu(); }
    });
    menu.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
      else if (e.key === 'Tab') closeMenu({ focus: false });
    });
    document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) closeMenu({ focus: false }); });

    wrap.append(button, menu);
    slot.replaceChildren(wrap);
  }

  /* ---------------------------------------------------------------- */
  /* Mount                                                            */
  /* ---------------------------------------------------------------- */

  WS.mount = (me) => {
    WS.me = me.user;
    WS.workspace = me.workspace;
    WS.workspaces = me.workspaces;
    WS.members = me.members;
    WS.id = me.workspace.id;
    WS.isTeam = !me.workspace.personal;
    document.body.classList.toggle('ws-team', WS.isTeam);
    document.body.classList.toggle('ws-personal', !WS.isTeam);
    const slot = $('workspace-slot');
    if (slot) renderSwitcher(slot);
  };

  window.TMWorkspace = WS;
})();
