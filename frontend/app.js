/**
 * Forge Fitness frontend shared configuration.
 */
const runtimeConfig = window.FORGE_FITNESS_CONFIG || {};
const SUPABASE_URL = runtimeConfig.SUPABASE_URL || 'https://mpakawelhqypmkqzwmub.supabase.co';
const SUPABASE_KEY = runtimeConfig.SUPABASE_KEY || 'sb_publishable_EF_eGeh2z68-ZL4XURkvRA_i2H6-Qwm';
const BACKEND_API_URL = runtimeConfig.BACKEND_API_URL
  || (window.location.protocol === 'file:' ? 'http://localhost:5000' : window.location.origin);
const DEMO_MODE = Boolean(runtimeConfig.DEMO_MODE);

if (!window.ironcoreConfig) {
  window.ironcoreConfig = {
    SUPABASE_URL,
    SUPABASE_KEY,
    BACKEND_API_URL,
    DEMO_MODE,
  };
}

if (!window.ironcoreSupabaseClient) {
  window.ironcoreSupabaseClient = null;
  if (!DEMO_MODE && window.supabase && typeof window.supabase.createClient === 'function') {
    window.ironcoreSupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
}

var supabase = window.ironcoreSupabaseClient;

// ============================================================
// STATE
// ============================================================
let members = [];
let notifications = [];
let activityLog = [];
let deleteTarget = null;
let sortKey = 'name';
let sortAsc = true;
let currentView = 'dashboard';
let isLoggedIn = false;
let backendHealthy = false;
let backendDatabaseMode = 'unknown';
let sidebarOpen = false;
let intervalsStarted = false;
let toastTimeout;
let memberSaveInFlight = false;

const DEMO_EMAIL = 'admin@forgefitness.gym';
const DEMO_PASSWORD = 'admin123';

const VIEW_META = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Monitor renewals, member activity, and outreach from one place.',
  },
  members: {
    title: 'Members',
    subtitle: 'Search, update, and organize every member profile with less friction.',
  },
  dues: {
    title: 'Due dates',
    subtitle: 'Work the renewal queue by urgency and stay ahead of overdue accounts.',
  },
  notifications: {
    title: 'Notifications',
    subtitle: 'Review reminder activity and send pending renewal nudges when needed.',
  },
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  if (!isAdminPortal()) return;

  updateViewMeta(currentView);
  updateSystemHealthChip();
  startClock();

  if (DEMO_MODE) {
    initDemoData();
    if (sessionStorage.getItem('ironcore_auth') === 'ok') {
      showApp();
    }
    return;
  }

  checkSession();
});

function isAdminPortal() {
  return Boolean(document.getElementById('loginScreen') && document.getElementById('app'));
}

function startClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;

  const tick = () => {
    el.textContent = new Date().toLocaleString('en-IN', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  tick();
  setInterval(tick, 1000);
}

// ============================================================
// AUTH
// ============================================================
async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');

  errEl.classList.add('hidden');

  if (!email || !password) {
    showError(errEl, 'Please enter email and password.');
    return;
  }

  if (DEMO_MODE) {
    if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
      sessionStorage.setItem('ironcore_auth', 'ok');
      showApp();
    } else {
      showError(errEl, 'Invalid credentials. Use admin@ironcore.gym / admin123');
    }
    return;
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await showApp();
  } catch (error) {
    showError(errEl, error.message || 'Login failed.');
  }
}

async function handleLogout() {
  if (!DEMO_MODE && supabase) await supabase.auth.signOut();
  sessionStorage.removeItem('ironcore_auth');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  isLoggedIn = false;
  setSidebarOpen(false);
  updateSystemHealthChip();
}

async function checkSession() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  if (data.session) await showApp();
}

async function showApp() {
  isLoggedIn = true;
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  updateViewMeta(currentView);
  updateSystemHealthChip();
  setSidebarOpen(false);

  if (!DEMO_MODE) {
    await checkBackendHealth({ refreshNotifications: false });
  }

  await loadMembers();
  await loadNotifications();
  scheduleNotificationCheck();
}

// ============================================================
// DEMO DATA
// ============================================================
function initDemoData() {
  if (localStorage.getItem('ironcore_members')) return;

  const today = new Date();
  const fmt = date => formatDateInputValue(date);
  const addDays = (date, days) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };

  const demoMembers = [
    { id: uid(), name: 'Arjun Sharma', email: 'arjun@email.com', phone: '+91 9876543210', plan: 'Monthly', membership_type: 'Strength Training', due_date: fmt(addDays(today, -3)), join_date: fmt(addDays(today, -33)), notes: '' },
    { id: uid(), name: 'Priya Patel', email: 'priya@email.com', phone: '+91 9876543211', plan: 'Quarterly', membership_type: 'Strength / Cardio', due_date: fmt(addDays(today, 1)), join_date: fmt(addDays(today, -89)), notes: 'Prefers morning sessions' },
    { id: uid(), name: 'Rohit Kumar', email: 'rohit@email.com', phone: '+91 9876543212', plan: 'Annual', membership_type: 'Strength Training', due_date: fmt(addDays(today, 45)), join_date: fmt(addDays(today, -320)), notes: '' },
    { id: uid(), name: 'Sneha Reddy', email: 'sneha@email.com', phone: '+91 9876543213', plan: 'Monthly', membership_type: 'Strength / Cardio', due_date: fmt(addDays(today, 2)), join_date: fmt(addDays(today, -28)), notes: '' },
    { id: uid(), name: 'Vikram Singh', email: 'vikram@email.com', phone: '+91 9876543214', plan: 'Quarterly', membership_type: 'Strength Training', due_date: fmt(addDays(today, -1)), join_date: fmt(addDays(today, -91)), notes: 'Powerlifter' },
    { id: uid(), name: 'Anita Desai', email: 'anita@email.com', phone: '+91 9876543215', plan: 'Monthly', membership_type: 'Strength / Cardio', due_date: fmt(addDays(today, 15)), join_date: fmt(addDays(today, -15)), notes: '' },
    { id: uid(), name: 'Rajan Mehta', email: 'rajan@email.com', phone: '+91 9876543216', plan: 'Annual', membership_type: 'Strength Training', due_date: fmt(addDays(today, 200)), join_date: fmt(addDays(today, -165)), notes: '' },
    { id: uid(), name: 'Kavya Nair', email: 'kavya@email.com', phone: '+91 9876543217', plan: 'Monthly', membership_type: 'Strength / Cardio', due_date: fmt(addDays(today, 0)), join_date: fmt(addDays(today, -30)), notes: 'Yoga + gym combo' },
  ];

  localStorage.setItem('ironcore_members', JSON.stringify(demoMembers));
  localStorage.setItem('ironcore_activity', JSON.stringify([]));
  localStorage.setItem('ironcore_notifications', JSON.stringify([]));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

function formatDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMembersNeedingNotifications(daysAhead = 2) {
  return members
    .filter(member => member && member.due_date && getDaysLeft(member.due_date) <= daysAhead)
    .sort((left, right) => getDaysLeft(left.due_date) - getDaysLeft(right.due_date));
}

// ============================================================
// DATA LAYER
// ============================================================
function apiUrl(path) {
  return `${BACKEND_API_URL}${path}`;
}

function canUseBackendApi() {
  return !DEMO_MODE && backendHealthy && backendDatabaseMode === 'supabase';
}

function canUseSupabaseDirect() {
  return !DEMO_MODE && Boolean(supabase);
}

function markBackendUnavailable() {
  backendHealthy = false;
  backendDatabaseMode = 'offline';
  updateSystemHealthChip();
}

async function fetchApi(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

async function loadActivityLog() {
  if (DEMO_MODE) {
    activityLog = JSON.parse(localStorage.getItem('ironcore_activity') || '[]');
    return;
  }

  if (canUseBackendApi()) {
    try {
      const data = await fetchApi('/api/activity?limit=30');
      activityLog = data.activity || [];
      return;
    } catch (error) {
      markBackendUnavailable();
      console.warn('Activity API failed, falling back to Supabase:', error.message);
    }
  }

  if (!canUseSupabaseDirect()) {
    activityLog = [];
    return;
  }

  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.warn('Supabase activity query failed:', error.message);
    activityLog = [];
    return;
  }

  activityLog = data || [];
}

async function loadMembers() {
  if (DEMO_MODE) {
    members = JSON.parse(localStorage.getItem('ironcore_members') || '[]');
    activityLog = JSON.parse(localStorage.getItem('ironcore_activity') || '[]');
    renderAll();
    return;
  }

  if (canUseBackendApi()) {
    try {
      const data = await fetchApi('/api/members');
      members = data.members || [];
      await loadActivityLog();
      renderAll();
      return;
    } catch (error) {
      markBackendUnavailable();
      console.warn('Members API failed, falling back to Supabase:', error.message);
    }
  }

  if (!canUseSupabaseDirect()) {
    showToast('Failed to load members: no Supabase client is available.', 'error');
    return;
  }

  const { data, error: memberError } = await supabase.from('members').select('*').order('name');
  if (memberError) {
    showToast(`Failed to load members: ${memberError.message}`, 'error');
    return;
  }

  members = data || [];
  await loadActivityLog();
  renderAll();
}

async function loadNotifications() {
  if (DEMO_MODE) {
    notifications = JSON.parse(localStorage.getItem('ironcore_notifications') || '[]');
  } else {
    if (canUseBackendApi()) {
      try {
        const data = await fetchApi('/api/notifications');
        notifications = data.notifications || [];
      } catch (error) {
        markBackendUnavailable();
        console.warn('Notifications API failed, falling back to Supabase:', error.message);
      }
    }

    if (!canUseBackendApi()) {
      if (canUseSupabaseDirect()) {
        const { data, error } = await supabase
          .from('notifications')
          .select('*, members(name,email)')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('Supabase notifications query failed:', error.message);
          notifications = [];
        } else {
          notifications = data || [];
        }
      } else {
        notifications = [];
      }
    }
  }

  renderNotifications();
  updateNotifBadge();
  if (currentView === 'dashboard') renderDashboard();
}

async function saveMemberToDB(member, isNew) {
  if (DEMO_MODE) {
    const stored = JSON.parse(localStorage.getItem('ironcore_members') || '[]');

    if (isNew) {
      member.id = uid();
      stored.push(member);
      logActivity(`Member added: ${member.name}`, 'add');
    } else {
      const index = stored.findIndex(item => item.id === member.id);
      if (index > -1) stored[index] = member;
      logActivity(`Member updated: ${member.name}`, 'edit');
    }

    localStorage.setItem('ironcore_members', JSON.stringify(stored));
    members = stored;
    return { ok: true, member };
  }

  const shouldCreate = isNew || !isUuid(member.id);

  if (canUseBackendApi()) {
    try {
      const { id, ...memberPayload } = member;
      const data = await fetchApi(shouldCreate ? '/api/members' : `/api/members/${id}`, {
        method: shouldCreate ? 'POST' : 'PUT',
        body: JSON.stringify(shouldCreate ? memberPayload : member),
      });
      const savedMember = data.member || member;

      if (shouldCreate) {
        members = members.filter(item => item.id !== id);
        members.push(savedMember);
      } else {
        const index = members.findIndex(item => item.id === savedMember.id);
        if (index > -1) members[index] = savedMember;
      }

      await loadActivityLog();
      // Preserve temporary_password if present (for display to admin)
      return { ok: true, member: savedMember, temporary_password: data.temporary_password };
    } catch (error) {
      markBackendUnavailable();
      console.warn('Members API save failed, falling back to Supabase:', error.message);
      if (!canUseSupabaseDirect()) return { ok: false, error };
    }
  }

  if (!canUseSupabaseDirect()) {
    return { ok: false, error: new Error('No Supabase client is available.') };
  }

  if (shouldCreate) {
    const { id, ...memberPayload } = member;
    const { data, error: insertError } = await supabase.from('members').insert([memberPayload]).select().single();
    if (insertError) return { ok: false, error: insertError };
    await supabase.from('activity_log').insert([{ action: 'add', detail: `Member added: ${member.name}` }]);
    members = members.filter(item => item.id !== member.id);
    members.push(data);
    return { ok: true, member: data };
  }

  const { id, ...rest } = member;
  const { error: updateError } = await supabase.from('members').update(rest).eq('id', id);
  if (updateError) return { ok: false, error: updateError };
  await supabase.from('activity_log').insert([{ action: 'edit', detail: `Member updated: ${member.name}` }]);
  const index = members.findIndex(item => item.id === id);
  if (index > -1) members[index] = member;
  return { ok: true, member };
}

async function deleteMemberFromDB(id) {
  const member = members.find(item => item.id === id);

  if (DEMO_MODE) {
    const stored = JSON.parse(localStorage.getItem('ironcore_members') || '[]').filter(item => item.id !== id);
    localStorage.setItem('ironcore_members', JSON.stringify(stored));
    members = stored;
    logActivity(`Member deleted: ${member ? member.name : 'Unknown member'}`, 'delete');
    return { ok: true };
  }

  if (canUseBackendApi()) {
    try {
      await fetchApi(`/api/members/${id}`, { method: 'DELETE' });
      members = members.filter(item => item.id !== id);
      await loadActivityLog();
      return { ok: true };
    } catch (error) {
      markBackendUnavailable();
      console.warn('Members API delete failed, falling back to Supabase:', error.message);
      if (!canUseSupabaseDirect()) return { ok: false, error };
    }
  }

  if (!canUseSupabaseDirect()) {
    return { ok: false, error: new Error('No Supabase client is available.') };
  }

  const { error: deleteError } = await supabase.from('members').delete().eq('id', id);
  if (deleteError) return { ok: false, error: deleteError };
  await supabase.from('activity_log').insert([{ action: 'delete', detail: `Member deleted: ${member ? member.name : 'Unknown member'}` }]);
  members = members.filter(item => item.id !== id);
  return { ok: true };
}

function logActivity(detail, type = 'edit') {
  const entry = {
    id: uid(),
    action: type,
    detail,
    created_at: new Date().toISOString(),
  };

  let stored = JSON.parse(localStorage.getItem('ironcore_activity') || '[]');
  stored.unshift(entry);
  stored = stored.slice(0, 50);
  localStorage.setItem('ironcore_activity', JSON.stringify(stored));
  activityLog = stored;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
function scheduleNotificationCheck() {
  if (!intervalsStarted) {
    checkAndSendNotifications();
    setInterval(checkAndSendNotifications, 60 * 60 * 1000);

    if (!DEMO_MODE) {
      checkBackendHealth();
      setInterval(checkBackendHealth, 30 * 60 * 1000);
    }

    intervalsStarted = true;
  }
}

async function checkBackendHealth(options = {}) {
  const refreshNotifications = options.refreshNotifications !== false;

  if (DEMO_MODE) {
    updateSystemHealthChip();
    return;
  }

  try {
    const data = await fetchApi('/health');
    backendHealthy = Boolean(data.ok);
    backendDatabaseMode = data.database_mode || 'unknown';
    updateSystemHealthChip();
    if (refreshNotifications && canUseBackendApi()) loadNotifications();
  } catch (error) {
    markBackendUnavailable();
    console.warn('Backend health check failed:', error.message);
  }
}

async function checkAndSendNotifications() {
  if (DEMO_MODE) {
    const dueSoon = getMembersNeedingNotifications(2);
    let created = 0;

    for (const member of dueSoon) {
      const alreadySent = await notificationAlreadySent(member.id, member.due_date);
      if (!alreadySent) {
        await recordNotification(member, 'pending');
        created += 1;
      }
    }

    if (created > 0) {
      showToast(`${created} notification${created === 1 ? '' : 's'} queued for members due in 2 days.`, 'success');
      loadNotifications();
    }
    return;
  }

  if (!canUseBackendApi()) {
    if (!canUseSupabaseDirect()) return;

    try {
      const dueSoon = getMembersNeedingNotifications(2);
      let created = 0;

      for (const member of dueSoon) {
        const alreadySent = await notificationAlreadySent(member.id, member.due_date);
        if (!alreadySent) {
          await recordNotification(member, 'pending');
          created += 1;
        }
      }

      if (created > 0) {
        showToast(`${created} notification${created === 1 ? '' : 's'} queued in Supabase for overdue or due-soon members.`, 'success');
      }

      await loadNotifications();
    } catch (error) {
      console.warn('Supabase notification queue failed:', error.message);
      showToast(`Failed to queue notifications: ${error.message}`, 'error');
    }

    return;
  }

  try {
    const data = await fetchApi('/api/notifications/queue', {
      method: 'POST',
      body: JSON.stringify({ days_ahead: 2 }),
    });
    const created = data.summary && data.summary.created ? data.summary.created : 0;
    if (created > 0) {
      showToast(`${created} notification${created === 1 ? '' : 's'} queued for members due in 2 days.`, 'success');
    }
    loadNotifications();
  } catch (error) {
    console.warn('Notification queue failed:', error.message);
  }
}

async function sendPendingNotifications() {
  if (DEMO_MODE) {
    let stored = JSON.parse(localStorage.getItem('ironcore_notifications') || '[]');
    let count = 0;

    stored = stored.map(item => {
      if (item.status === 'pending') {
        count += 1;
        return {
          ...item,
          status: 'sent',
          sent_at: new Date().toISOString(),
        };
      }
      return item;
    });

    localStorage.setItem('ironcore_notifications', JSON.stringify(stored));
    notifications = stored;
    renderNotifications();
    updateNotifBadge();
    logActivity(`${count} notification${count === 1 ? '' : 's'} sent`, 'notif');
    showToast(`${count} notification${count === 1 ? '' : 's'} marked as sent.`, 'success');
    return;
  }

  if (!canUseBackendApi()) {
    showToast('Email sending needs the backend connected to Supabase. Member data is loading directly from Supabase right now.', 'error');
    return;
  }

  try {
    const data = await fetchApi('/api/notify/run', {
      method: 'POST',
      body: JSON.stringify({ days_ahead: 2 }),
    });
    const summary = data.summary || { sent: 0, skipped: 0, failed: 0 };
    showToast(`Sent: ${summary.sent}, Skipped: ${summary.skipped}, Failed: ${summary.failed}`, 'success');
    await loadActivityLog();
    renderActivityLog();
    loadNotifications();
  } catch (error) {
    showToast(`Backend connection error: ${error.message}`, 'error');
  }
}

async function notificationAlreadySent(memberId, dueDate) {
  if (DEMO_MODE) {
    const stored = JSON.parse(localStorage.getItem('ironcore_notifications') || '[]');
    return stored.some(item => item.member_id === memberId && item.due_date === dueDate);
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('member_id', memberId)
    .eq('due_date', dueDate)
    .limit(1);

  if (error) throw error;

  return Boolean(data && data.length);
}

async function recordNotification(member, status = 'pending') {
  const notification = {
    id: uid(),
    member_id: member.id,
    member_name: member.name,
    member_email: member.email,
    due_date: member.due_date,
    status,
    created_at: new Date().toISOString(),
    sent_at: null,
  };

  if (DEMO_MODE) {
    const stored = JSON.parse(localStorage.getItem('ironcore_notifications') || '[]');
    stored.unshift(notification);
    localStorage.setItem('ironcore_notifications', JSON.stringify(stored));
    notifications = stored;
    return;
  }

  const { error } = await supabase.from('notifications').insert([{
    member_id: member.id,
    member_name: member.name,
    member_email: member.email,
    due_date: member.due_date,
    status,
    created_at: new Date().toISOString(),
  }]);

  if (error) throw error;
}

// ============================================================
// UTILS
// ============================================================
function getDaysLeft(dueDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  return Math.round((due - today) / 86400000);
}

function getMemberStatus(dueDateStr) {
  const days = getDaysLeft(dueDateStr);
  if (days < 0) return 'overdue';
  if (days <= 2) return 'expiring';
  return 'active';
}

function statusBadgeHTML(status) {
  const labels = {
    active: 'Active',
    overdue: 'Overdue',
    expiring: 'Due soon',
  };

  return `<span class="status-badge status-${status}">${labels[status] || status}</span>`;
}

function dueDateHTML(dueDateStr) {
  const days = getDaysLeft(dueDateStr);
  const cls = days < 0 ? 'due-overdue' : days <= 2 ? 'due-soon' : 'due-ok';
  const formatted = new Date(dueDateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  let label = 'On track';
  if (days < 0) label = `${Math.abs(days)}d overdue`;
  else if (days === 0) label = 'Due today';
  else if (days <= 2) label = `${days}d left`;

  return `<span class="due-date ${cls}"><span>${formatted}</span><span class="due-note">${label}</span></span>`;
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// RENDER
// ============================================================
function renderAll() {
  renderDashboard();
  renderMembersTable();
  renderDuesTable();
  renderActivityLog();
}

function renderDashboard() {
  const total = members.length;
  const overdue = members.filter(member => getMemberStatus(member.due_date) === 'overdue').length;
  const expiring = members.filter(member => getMemberStatus(member.due_date) === 'expiring').length;
  const active = members.filter(member => getMemberStatus(member.due_date) === 'active').length;
  const urgentCount = overdue + expiring;
  const pendingCount = notifications.filter(item => item.status === 'pending').length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statOverdue').textContent = overdue;
  document.getElementById('statDueSoon').textContent = expiring;
  document.getElementById('statActive').textContent = active;

  document.getElementById('statTotalMeta').textContent = total === 1
    ? '1 member currently tracked in your roster.'
    : `${total} members currently tracked across all plans.`;
  document.getElementById('statOverdueMeta').textContent = overdue
    ? `${overdue} account${overdue === 1 ? '' : 's'} already overdue and worth immediate outreach.`
    : 'No overdue accounts at the moment.';
  document.getElementById('statDueSoonMeta').textContent = expiring
    ? `${expiring} member${expiring === 1 ? '' : 's'} will renew within the next 48 hours.`
    : 'No members are due in the next two days.';
  document.getElementById('statActiveMeta').textContent = active
    ? `${active} member${active === 1 ? '' : 's'} are comfortably active right now.`
    : 'No members are currently outside the urgency window.';

  document.getElementById('dashboardSummary').textContent = urgentCount
    ? `${urgentCount} member${urgentCount === 1 ? '' : 's'} need attention right now. Focus first on ${overdue} overdue account${overdue === 1 ? '' : 's'}, then the ${expiring} due-soon membership${expiring === 1 ? '' : 's'}.`
    : 'Everything looks healthy right now. No renewals need urgent action, so this is a good time to clean records and prep future outreach.';
  document.getElementById('dashboardRange').textContent = `${urgentCount} urgent`;
  document.getElementById('heroPendingCount').textContent = pendingCount;
  document.getElementById('heroPendingText').textContent = pendingCount
    ? `${pendingCount} reminder${pendingCount === 1 ? '' : 's'} waiting to be sent.`
    : 'All messages are caught up.';

  const urgentMembers = members
    .filter(member => ['overdue', 'expiring'].includes(getMemberStatus(member.due_date)))
    .sort((a, b) => getDaysLeft(a.due_date) - getDaysLeft(b.due_date));

  const urgentEl = document.getElementById('urgentList');
  if (!urgentMembers.length) {
    urgentEl.innerHTML = '<p class="empty-state">No urgent renewals right now.</p>';
    return;
  }

  urgentEl.innerHTML = urgentMembers.map(member => `
    <div class="urgent-row">
      <div>
        <div class="urgent-name">${esc(member.name)}</div>
        <div class="urgent-email">${esc(member.email)}</div>
      </div>
      <div>${dueDateHTML(member.due_date)}</div>
      <div>${statusBadgeHTML(getMemberStatus(member.due_date))}</div>
      <div>${memberActionButtonsHTML(member.id)}</div>
    </div>
  `).join('');
}

function memberActionButtonsHTML(memberId, options = {}) {
  const {
    includeEdit = true,
    includeRenew = false,
    includeRemove = true,
  } = options;
  const actions = [];

  if (includeEdit) {
    actions.push(`<button class="btn-icon" onclick="openEditMemberModal('${memberId}')" title="Edit">Edit</button>`);
  }

  if (includeRenew) {
    actions.push(`<button class="btn-icon" onclick="renewMember('${memberId}')" title="Renew">Renew</button>`);
  }

  if (includeRemove) {
    actions.push(`<button class="btn-icon danger" onclick="openDeleteModal('${memberId}')" title="Remove">Remove</button>`);
  }

  return `<div class="member-actions">${actions.join('')}</div>`;
}

function renderMembersTable() {
  const search = (document.getElementById('memberSearch') && document.getElementById('memberSearch').value || '').toLowerCase();
  const plan = document.getElementById('planFilter') ? document.getElementById('planFilter').value : '';
  const status = document.getElementById('statusFilter') ? document.getElementById('statusFilter').value : '';

  let filtered = members.filter(member => {
    const matchSearch = !search
      || member.name.toLowerCase().includes(search)
      || member.email.toLowerCase().includes(search)
      || (member.phone || '').toLowerCase().includes(search);
    const matchPlan = !plan || member.plan === plan;
    const matchStatus = !status || getMemberStatus(member.due_date) === status;
    return matchSearch && matchPlan && matchStatus;
  });

  filtered.sort((a, b) => {
    let left = a[sortKey] || '';
    let right = b[sortKey] || '';

    if (sortKey === 'due_date') {
      left = new Date(left);
      right = new Date(right);
    }

    if (left < right) return sortAsc ? -1 : 1;
    if (left > right) return sortAsc ? 1 : -1;
    return 0;
  });

  const tbody = document.getElementById('membersTableBody');
  const noMsg = document.getElementById('noMembersMsg');

  if (!filtered.length) {
    tbody.innerHTML = '';
    noMsg.classList.remove('hidden');
    return;
  }

  noMsg.classList.add('hidden');
  tbody.innerHTML = filtered.map(member => `
    <tr>
      <td><div class="member-name">${esc(member.name)}</div></td>
      <td><span class="member-email">${esc(member.email)}</span></td>
      <td>${esc(member.phone || '-')}</td>
      <td>${esc(member.plan)}</td>
      <td>${esc(member.membership_type || 'Strength Training')}</td>
      <td>${dueDateHTML(member.due_date)}</td>
      <td>${statusBadgeHTML(getMemberStatus(member.due_date))}</td>
      <td>${memberActionButtonsHTML(member.id)}</td>
    </tr>
  `).join('');
}

function renderDuesTable() {
  const sorted = [...members].sort((a, b) => getDaysLeft(a.due_date) - getDaysLeft(b.due_date));
  const tbody = document.getElementById('duesTableBody');

  tbody.innerHTML = sorted.map(member => {
    const days = getDaysLeft(member.due_date);
    const status = getMemberStatus(member.due_date);

    let daysLabel = `<span class="due-ok">${days}d</span>`;
    if (days < 0) daysLabel = `<span class="due-overdue">${Math.abs(days)}d overdue</span>`;
    else if (days === 0) daysLabel = `<span class="due-soon">Due today</span>`;
    else if (days <= 2) daysLabel = `<span class="due-soon">${days}d</span>`;

    return `
      <tr>
        <td>
          <div class="member-name">${esc(member.name)}</div>
          <div class="member-email">${esc(member.email)}</div>
        </td>
        <td>${esc(member.plan)}</td>
        <td>${dueDateHTML(member.due_date)}</td>
        <td>${daysLabel}</td>
        <td>${statusBadgeHTML(status)}</td>
        <td>${memberActionButtonsHTML(member.id, { includeEdit: false, includeRenew: true })}</td>
      </tr>
    `;
  }).join('');
}

function renderActivityLog() {
  const el = document.getElementById('activityLog');
  const logs = activityLog.slice(0, 15);

  if (!logs.length) {
    el.innerHTML = '<p class="empty-state">No recent activity yet.</p>';
    return;
  }

  el.innerHTML = logs.map(item => {
    const time = new Date(item.created_at).toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    return `
      <div class="activity-item act-${item.action}">
        <span class="act-time">${time}</span>
        <span>${esc(item.detail)}</span>
      </div>
    `;
  }).join('');
}

function renderNotifications() {
  const el = document.getElementById('notifLog');
  if (!el) return;

  if (!notifications.length) {
    el.innerHTML = '<p class="empty-state">No notifications yet. Overdue and next-2-day reminders will appear here.</p>';
    return;
  }

  el.innerHTML = notifications.map(item => {
    const sentTime = item.sent_at
      ? new Date(item.sent_at).toLocaleString('en-IN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : 'Not sent yet';
    const dueDate = new Date(item.due_date).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const name = item.member_name || item.members && item.members.name || 'Member';
    const email = item.member_email || item.members && item.members.email || '';

    return `
      <div class="notif-item ${item.status}">
        <div>
          <div class="notif-member">${esc(name)}</div>
          <div class="notif-detail">Email: ${esc(email)} | Due: ${dueDate}${item.status === 'sent' ? ` | Sent: ${sentTime}` : ` | Status: ${sentTime}`}</div>
        </div>
        <span class="notif-status ${item.status}">${item.status === 'sent' ? 'Sent' : 'Pending'}</span>
      </div>
    `;
  }).join('');
}

function updateNotifBadge() {
  const pending = notifications.filter(item => item.status === 'pending').length;
  const badge = document.getElementById('notifBadge');
  if (badge) {
    badge.textContent = pending;
    badge.style.display = pending > 0 ? 'inline-flex' : 'none';
  }

  const heroCount = document.getElementById('heroPendingCount');
  const heroText = document.getElementById('heroPendingText');
  if (heroCount) heroCount.textContent = pending;
  if (heroText) {
    heroText.textContent = pending
      ? `${pending} reminder${pending === 1 ? '' : 's'} waiting to be sent.`
      : 'All messages are caught up.';
  }
}

// ============================================================
// NAVIGATION
// ============================================================
function showView(view, el) {
  document.querySelectorAll('.view').forEach(node => {
    node.classList.add('hidden');
    node.classList.remove('active');
  });
  document.querySelectorAll('.nav-item').forEach(node => node.classList.remove('active'));

  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) {
    viewEl.classList.remove('hidden');
    viewEl.classList.add('active');
  }
  if (el) el.classList.add('active');

  currentView = view;
  updateViewMeta(view);
  setSidebarOpen(false);

  if (view === 'members') renderMembersTable();
  if (view === 'dues') renderDuesTable();
  if (view === 'notifications') renderNotifications();
}

function updateViewMeta(view) {
  const meta = VIEW_META[view] || { title: view, subtitle: '' };
  const titleEl = document.getElementById('pageTitle');
  const subtitleEl = document.getElementById('pageSubtitle');
  if (titleEl) titleEl.textContent = meta.title;
  if (subtitleEl) subtitleEl.textContent = meta.subtitle;
}

function updateSystemHealthChip() {
  const chip = document.getElementById('systemHealthChip');
  if (!chip) return;

  chip.className = 'status-chip';

  if (DEMO_MODE) {
    chip.textContent = 'Demo mode';
    return;
  }

  if (!isLoggedIn) {
    chip.textContent = 'Connecting';
    return;
  }

  if (canUseBackendApi()) {
    chip.textContent = 'Backend + Supabase';
    chip.classList.add('online');
  } else if (canUseSupabaseDirect()) {
    chip.textContent = 'Supabase direct';
    chip.classList.add('online');
  } else if (backendHealthy) {
    chip.textContent = 'Local backend';
    chip.classList.add('online');
  } else {
    chip.textContent = 'Backend offline';
    chip.classList.add('offline');
  }
}

function setSidebarOpen(open) {
  sidebarOpen = Boolean(open);
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar || !backdrop) return;

  sidebar.classList.toggle('is-open', sidebarOpen);
  backdrop.classList.toggle('active', sidebarOpen);
}

function toggleSidebar(forceOpen) {
  if (typeof forceOpen === 'boolean') {
    setSidebarOpen(forceOpen);
    return;
  }
  setSidebarOpen(!sidebarOpen);
}

// ============================================================
// MEMBER CRUD
// ============================================================
function openAddMemberModal() {
  document.getElementById('modalTitle').textContent = 'Add new member';
  document.getElementById('memberId').value = '';
  document.getElementById('memberName').value = '';
  document.getElementById('memberEmail').value = '';
  document.getElementById('memberPhone').value = '';
  document.getElementById('memberPlan').value = 'Monthly';
  document.getElementById('memberTier').value = 'Strength Training';
  document.getElementById('memberNotes').value = '';
  document.getElementById('memberDue').value = '';
  document.getElementById('memberJoin').value = formatDateInputValue(new Date());
  document.getElementById('modalError').classList.add('hidden');
  document.getElementById('memberModal').classList.remove('hidden');
}

function openEditMemberModal(id) {
  const member = members.find(item => item.id === id);
  if (!member) return;

  document.getElementById('modalTitle').textContent = 'Edit member';
  document.getElementById('memberId').value = member.id;
  document.getElementById('memberName').value = member.name;
  document.getElementById('memberEmail').value = member.email;
  document.getElementById('memberPhone').value = member.phone || '';
  document.getElementById('memberPlan').value = member.plan;
  document.getElementById('memberTier').value = member.membership_type || 'Strength Training';
  document.getElementById('memberDue').value = member.due_date;
  document.getElementById('memberJoin').value = member.join_date || '';
  document.getElementById('memberNotes').value = member.notes || '';
  document.getElementById('modalError').classList.add('hidden');
  document.getElementById('memberModal').classList.remove('hidden');
}

function closeMemberModal() {
  const modal = document.getElementById('memberModal');
  if (modal) modal.classList.add('hidden');
}

async function saveMember() {
  if (memberSaveInFlight) return;

  const id = document.getElementById('memberId').value;
  const name = document.getElementById('memberName').value.trim();
  const email = document.getElementById('memberEmail').value.trim();
  const due = document.getElementById('memberDue').value;
  const plan = document.getElementById('memberPlan').value;
  const membershipType = document.getElementById('memberTier').value;
  const errEl = document.getElementById('modalError');
  const saveBtn = document.getElementById('saveMemberBtn');

  errEl.classList.add('hidden');

  if (!name) {
    showError(errEl, 'Name is required.');
    return;
  }
  if (!email) {
    showError(errEl, 'Email is required.');
    return;
  }
  if (!due) {
    showError(errEl, 'Due date is required.');
    return;
  }

  const member = {
    id: id || uid(),
    name,
    email,
    phone: document.getElementById('memberPhone').value.trim(),
    plan,
    membership_type: membershipType,
    due_date: due,
    join_date: document.getElementById('memberJoin').value || formatDateInputValue(new Date()),
    notes: document.getElementById('memberNotes').value.trim(),
  };

  const isNew = !id;
  memberSaveInFlight = true;
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  let result;
  try {
    result = await saveMemberToDB(member, isNew);
  } catch (error) {
    showError(errEl, `Save failed: ${error.message || 'Unexpected error'}`);
    return;
  } finally {
    memberSaveInFlight = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save member';
    }
  }

  if (!result.ok) {
    showError(errEl, `Save failed: ${result.error && result.error.message ? result.error.message : 'Unknown error'}`);
    return;
  }

  closeMemberModal();
  renderAll();

  if (isNew && result.temporary_password) {
    showToast(`${name} added! Initial password: ${result.temporary_password}`, 'success');
    navigator.clipboard.writeText(result.temporary_password).catch(err => {
      console.warn('Could not copy password to clipboard:', err);
    });
  } else if (isNew && result.auth_status && result.auth_status !== 'created') {
    showToast(`${name} added, but ${result.auth_message || 'portal login was not created.'}`, 'error');
  } else {
    showToast(isNew ? `${name} added successfully.` : `${name} updated.`, 'success');
  }
}

function openDeleteModal(id) {
  const member = members.find(item => item.id === id);
  if (!member) return;

  deleteTarget = id;
  document.getElementById('deleteMemberName').textContent = member.name;
  document.getElementById('deleteModal').classList.remove('hidden');
}

function closeDeleteModal() {
  const modal = document.getElementById('deleteModal');
  if (modal) modal.classList.add('hidden');
  deleteTarget = null;
}

async function confirmDelete() {
  if (!deleteTarget) return;

  const result = await deleteMemberFromDB(deleteTarget);
  if (!result.ok) {
    showToast(`Remove failed: ${result.error && result.error.message ? result.error.message : 'Unknown error'}`, 'error');
    return;
  }

  closeDeleteModal();
  renderAll();
  showToast('Member removed.', 'success');
}

function renewMember(id) {
  openEditMemberModal(id);
  const member = members.find(item => item.id === id);
  if (!member) return;

  const today = new Date();
  const planDays = { Monthly: 30, Quarterly: 90, Annual: 365 };
  const days = planDays[member.plan] || 30;
  today.setDate(today.getDate() + days);
  document.getElementById('memberDue').value = formatDateInputValue(today);
}

// ============================================================
// FILTERS AND SORT
// ============================================================
function filterMembers() {
  renderMembersTable();
}

function sortTable(key) {
  if (sortKey === key) {
    sortAsc = !sortAsc;
  } else {
    sortKey = key;
    sortAsc = true;
  }
  renderMembersTable();
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', event => {
  if (!isAdminPortal()) return;

  if (event.key === 'Escape') {
    closeMemberModal();
    closeDeleteModal();
    setSidebarOpen(false);
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openAddMemberModal();
  }

  const loginScreen = document.getElementById('loginScreen');
  if (event.key === 'Enter' && loginScreen && !loginScreen.classList.contains('hidden')) {
    handleLogin();
  }
});
