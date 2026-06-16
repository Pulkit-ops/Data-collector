// ============================================================
// DATA LAYER â€” localStorage as persistent store
// ============================================================
const DB = {
  get: (key, def=[]) => { try { return JSON.parse(localStorage.getItem('dtp_'+key)) ?? def; } catch(e){ return def; } },
  set: (key, val) => { localStorage.setItem('dtp_'+key, JSON.stringify(val)); },
  getObj: (key, def={}) => { try { return JSON.parse(localStorage.getItem('dtp_'+key)) ?? def; } catch(e){ return def; } }
};

// ============================================================
// THEME
// ============================================================
const THEME_KEY = 'dtp_theme';

function preferredTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || preferredTheme();
  } catch(e) {
    return preferredTheme();
  }
}

function setTheme(theme, persist=true) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  if(persist) localStorage.setItem(THEME_KEY, nextTheme);
  updateThemeToggle(nextTheme);
  refreshChartsForTheme();
}

function toggleTheme() {
  setTheme((document.documentElement.dataset.theme || getTheme()) === 'dark' ? 'light' : 'dark');
}

function updateThemeToggle(theme) {
  const btn = document.getElementById('theme-toggle');
  if(!btn) return;
  const dark = theme === 'dark';
  btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  btn.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

function themeVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  const value = clean.length === 3 ? clean.split('').map(ch=>ch+ch).join('') : clean;
  const num = parseInt(value, 16);
  return { r:(num >> 16) & 255, g:(num >> 8) & 255, b:num & 255 };
}

function alphaColor(name, alpha) {
  const value = themeVar(name);
  if(value.startsWith('#')) {
    const rgb = hexToRgb(value);
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
  return value;
}

function refreshChartsForTheme() {
  if(!window.Chart) return;
  if(activityChartObj) renderActivityChart();
  if(statusChartObj) renderStatusChart();
  if(deptChartObj) renderDeptChart();
  if(trendChartObj) renderTrendChart();
  if(dailyRecordsChartObj) renderDailyRecordsChart();
  if(weeklyTrendChartObj) renderWeeklyTrendChart();
  if(monthlyGrowthChartObj) renderMonthlyGrowthChart();
  if(categoryDistributionChartObj) renderCategoryDistributionChart();
}

// ============================================================
// STATE
// ============================================================
let records = DB.get('records', []);
let auditLog = DB.get('audit', []);
let backups = DB.get('backups', []);
let users = DB.get('users', [
  { id:'u1', name:'Admin User', role:'Administrator', email:'admin@company.com', createdAt: new Date().toISOString(), active:true },
  { id:'u2', name:'Jane Smith', role:'Manager', email:'jane@company.com', createdAt: new Date().toISOString(), active:true },
  { id:'u3', name:'Bob Chen', role:'Analyst', email:'bob@company.com', createdAt: new Date().toISOString(), active:true }
]);
let settings = DB.getObj('settings', { username:'Admin User', role:'Administrator', backup:'Daily', defaultStatus:'pending' });
let dailyTab = 'today';
let currentSearchQuery = '';
let isServerBacked = true;
let selectedRecordId = null;
let recordsLoading = true;
let activityChartObj = null, statusChartObj = null, deptChartObj = null, trendChartObj = null;
let dailyRecordsChartObj = null, weeklyTrendChartObj = null, monthlyGrowthChartObj = null, categoryDistributionChartObj = null;
const tableState = {
  records: { page:1, pageSize:10, sortKey:'updatedAt', sortDir:'desc', query:'', filters:{ status:'', priority:'', department:'' } },
  daily: { page:1, pageSize:10, sortKey:'createdAt', sortDir:'desc', query:'', filters:{ status:'', priority:'' } },
  users: { page:1, pageSize:10, sortKey:'name', sortDir:'asc', query:'', filters:{ role:'', status:'' } },
  backups: { page:1, pageSize:10, sortKey:'createdAt', sortDir:'desc', query:'', filters:{} }
};

// ============================================================
// UTILS
// ============================================================
function genId() { return 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5).toUpperCase(); }
function fmtDate(iso) { if(!iso) return 'â€”'; const d=new Date(iso); return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtTime(iso) { if(!iso) return 'â€”'; const d=new Date(iso); return d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}); }
function fmtDateTime(iso) { if(!iso) return 'â€”'; return fmtDate(iso)+' '+fmtTime(iso); }
function isToday(iso) { const d=new Date(iso),t=new Date(); return d.toDateString()===t.toDateString(); }
function isYesterday(iso) { const d=new Date(iso),y=new Date(); y.setDate(y.getDate()-1); return d.toDateString()===y.toDateString(); }
function isThisWeek(iso) { const d=new Date(iso),n=new Date(); const s=new Date(n); s.setDate(n.getDate()-n.getDay()); return d>=s; }
function isThisMonth(iso) { const d=new Date(iso),n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }
function save() { DB.set('records',records); DB.set('audit',auditLog); DB.set('backups',backups); DB.set('users',users); DB.set('settings',settings); }
function currentUser() { return settings.username || 'Admin User'; }

function normalizeRecord(r={}) {
  return {
    ...r,
    assignedTo: r.assignedTo ?? r.assigned_to ?? '',
    dueDate: r.dueDate ?? r.due_date ?? '',
    createdAt: r.createdAt ?? r.created_at ?? '',
    createdBy: r.createdBy ?? r.created_by ?? '',
    updatedAt: r.updatedAt ?? r.updated_at ?? '',
    updatedBy: r.updatedBy ?? r.updated_by ?? '',
    tags: Array.isArray(r.tags) ? r.tags : []
  };
}

function normalizeAudit(a={}) {
  return {
    ...a,
    recordId: a.recordId ?? a.record_id ?? '',
    recordTitle: a.recordTitle ?? a.record_title ?? '',
    at: a.at ?? a.created_at ?? ''
  };
}

function normalizeBackup(b={}) {
  return {
    ...b,
    createdAt: b.createdAt ?? b.created_at ?? '',
    recordCount: b.recordCount ?? b.record_count ?? 0,
    size: b.size ?? 0
  };
}

function recordPayload(data) {
  return {
    title: data.title,
    department: data.department,
    priority: data.priority,
    status: data.status,
    assigned_to: data.assignedTo,
    description: data.description,
    due_date: data.dueDate,
    tags: data.tags,
    created_by: currentUser(),
    updated_by: currentUser()
  };
}

async function api(path, options={}) {
  const res = await fetch(path, {
    headers: { 'Content-Type':'application/json', ...(options.headers || {}) },
    ...options
  });
  if(!res.ok) {
    let message = 'Request failed';
    try { message = (await res.json()).error || message; } catch(e) {}
    throw new Error(message);
  }
  return res.json();
}

async function loadServerData() {
  recordsLoading = true;
  renderRecordsTable();
  try {
    const [recordRes, auditRes, backupRes, userRes, settingsRes] = await Promise.all([
      api('/api/records'),
      api('/api/audit'),
      api('/api/backups'),
      api('/api/users'),
      api('/api/settings')
    ]);
    records = (recordRes.records || []).map(normalizeRecord);
    auditLog = (auditRes.log || []).map(normalizeAudit);
    backups = (backupRes.backups || []).map(normalizeBackup);
    users = userRes.users || users;
    settings = {
      username: settingsRes.username || settings.username,
      role: settingsRes.role || settings.role,
      backup: settingsRes.backup_freq || settingsRes.backup || settings.backup,
      defaultStatus: settingsRes.default_status || settingsRes.defaultStatus || settings.defaultStatus
    };
    isServerBacked = true;
    save();
  } catch(err) {
    isServerBacked = false;
    toast('Using local data because the API is unavailable','info');
  } finally {
    recordsLoading = false;
    syncShell();
    refreshCurrentPage();
  }
}

function syncShell() {
  document.getElementById('sidebar-username').textContent=settings.username;
  document.getElementById('sidebar-role').textContent=settings.role;
  document.getElementById('sidebar-avatar').textContent=settings.username.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('nav-count').textContent=records.length;
}

function refreshCurrentPage() {
  const active = document.querySelector('.page.active')?.id?.replace('page-','') || 'dashboard';
  refreshPage(active);
}

const statusBadge = s => {
  const m = {completed:'success',pending:'warning','in-progress':'info',cancelled:'danger'};
  return `<span class="badge badge-${m[s]||'default'}">${s}</span>`;
};
const priorityBadge = p => {
  const m = {high:'danger',medium:'warning',low:'success'};
  return `<span class="badge badge-${m[p]||'default'}">${p}</span>`;
};

function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

function getValue(row, key) {
  const val = row?.[key];
  return val == null ? '' : val;
}

function compareRows(key, dir) {
  return (a,b) => {
    const av = getValue(a, key);
    const bv = getValue(b, key);
    const ad = Date.parse(av), bd = Date.parse(bv);
    let result;
    if(!Number.isNaN(ad) && !Number.isNaN(bd)) result = ad - bd;
    else if(typeof av === 'number' && typeof bv === 'number') result = av - bv;
    else result = String(av).localeCompare(String(bv), undefined, { numeric:true, sensitivity:'base' });
    return dir === 'asc' ? result : -result;
  };
}

function setTableQuery(name, value) {
  tableState[name].query = value.toLowerCase();
  tableState[name].page = 1;
  if(name === 'records') renderRecordsTable();
  if(name === 'daily') renderDaily();
  if(name === 'users') renderUsers();
  if(name === 'backups') renderBackup();
}

function setTableSort(name, key) {
  const state = tableState[name];
  if(state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  else { state.sortKey = key; state.sortDir = 'asc'; }
  if(name === 'records') renderRecordsTable();
  if(name === 'daily') renderDaily();
  if(name === 'users') renderUsers();
  if(name === 'backups') renderBackup();
}

function setTablePage(name, page) {
  const state = tableState[name];
  state.page = Math.max(1, page);
  if(name === 'records') renderRecordsTable();
  if(name === 'daily') renderDaily();
  if(name === 'users') renderUsers();
  if(name === 'backups') renderBackup();
}

function renderTableHead(theadId, name, columns) {
  const state = tableState[name];
  const el = document.getElementById(theadId);
  if(!el) return;
  el.innerHTML = `<tr>${columns.map(col => {
    if(!col.sortKey) return `<th>${col.label}</th>`;
    const active = state.sortKey === col.sortKey;
    const icon = active ? (state.sortDir === 'asc' ? 'ti-chevron-up' : 'ti-chevron-down') : 'ti-selector';
    return `<th><button class="th-sort ${active ? 'active' : ''}" onclick="setTableSort('${name}','${col.sortKey}')">${col.label}<i class="ti ${icon}"></i></button></th>`;
  }).join('')}</tr>`;
}

function paginateData(name, data) {
  const state = tableState[name];
  const totalPages = Math.max(1, Math.ceil(data.length / state.pageSize));
  if(state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * state.pageSize;
  return { rows: data.slice(start, start + state.pageSize), totalPages, start };
}

function renderPagination(name, total, totalPages) {
  const el = document.getElementById(`${name}-pagination`);
  if(!el) return;
  const state = tableState[name];
  const from = total ? ((state.page - 1) * state.pageSize) + 1 : 0;
  const to = Math.min(total, state.page * state.pageSize);
  el.innerHTML = `
    <div class="table-meta">${total ? `Showing ${from}-${to} of ${total}` : 'No rows to show'}</div>
    <div class="pagination-controls">
      <button class="icon-btn" ${state.page===1?'disabled':''} onclick="setTablePage('${name}', ${state.page-1})" title="Previous page"><i class="ti ti-chevron-left"></i></button>
      <span class="page-pill">${state.page} / ${totalPages}</span>
      <button class="icon-btn" ${state.page===totalPages?'disabled':''} onclick="setTablePage('${name}', ${state.page+1})" title="Next page"><i class="ti ti-chevron-right"></i></button>
    </div>`;
}

function rowLoading(colspan, label='Loading data...') {
  return `<tr><td colspan="${colspan}"><div class="loading-state"><span class="spinner"></span>${label}</div></td></tr>`;
}

function rowEmpty(colspan, icon, label) {
  return `<tr><td colspan="${colspan}"><div class="empty-state"><i class="ti ${icon}"></i>${label}</div></td></tr>`;
}

function populateDepartmentFilter() {
  const select = document.getElementById('filter-department');
  if(!select) return;
  const current = select.value;
  const depts = [...new Set(records.map(r => r.department).filter(Boolean))].sort();
  select.innerHTML = '<option value="">All Departments</option>' + depts.map(d=>`<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  select.value = depts.includes(current) ? current : '';
}

// ============================================================
// TOAST
// ============================================================
function toast(msg, type='success') {
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  const icons={success:'ti-circle-check',error:'ti-circle-x',info:'ti-info-circle'};
  t.className=`toast ${type}`;
  t.innerHTML=`<i class="ti ${icons[type]||icons.success}" style="font-size:18px;color:var(--${type==='success'?'success':type==='error'?'danger':'info'})"></i><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>t.remove(),3500);
}

// ============================================================
// NAVIGATION
// ============================================================
const pages = { dashboard:'Dashboard', records:'All Records', daily:'Daily View', reports:'Reports', audit:'Audit Trail', backup:'Backup & Recovery', users:'Users', settings:'Settings' };
const subs = { dashboard:'Overview of all data', records:'Browse, filter, and manage records', daily:'View records by date', reports:'Automated daily reports', audit:'Track all changes', backup:'Manage backups', users:'Manage system users', settings:'Configure system' };

function setSidebarState(open) {
  document.body.classList.toggle('sidebar-open', open);
  const toggle = document.querySelector('.sidebar-toggle');
  if(toggle) toggle.setAttribute('aria-expanded', String(open));
}

function toggleSidebar() {
  setSidebarState(!document.body.classList.contains('sidebar-open'));
}

function closeSidebar() {
  setSidebarState(false);
}

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(el) el.classList.add('active');
  else { document.querySelectorAll('.nav-item').forEach(n=>{ if(n.textContent.trim().startsWith(pages[name]||name)) n.classList.add('active'); }); }
  document.getElementById('topbar-title').textContent = pages[name]||name;
  document.getElementById('topbar-breadcrumb').textContent = subs[name]||'';
  refreshPage(name);
  closeSidebar();
}

function refreshPage(name) {
  if(name==='dashboard') renderDashboard();
  if(name==='records') renderRecordsTable();
  if(name==='daily') renderDaily();
  if(name==='reports') generateReport();
  if(name==='audit') renderAudit();
  if(name==='backup') renderBackup();
  if(name==='users') renderUsers();
  if(name==='settings') loadSettings();
}

// ============================================================
// MODAL
// ============================================================
function openModal(mode, id=null) {
  const m=document.getElementById('modal-overlay');
  const isEdit = mode==='edit' && id;
  document.getElementById('modal-title').textContent = isEdit?'Edit Record':'New Record';
  document.getElementById('save-btn-text').textContent = isEdit?'Save Changes':'Create Record';
  document.getElementById('edit-id').value = id||'';
  if(isEdit) {
    const r=records.find(x=>x.id===id);
    if(!r) return;
    document.getElementById('f-title').value=r.title||'';
    document.getElementById('f-dept').value=r.department||'Engineering';
    document.getElementById('f-priority').value=r.priority||'medium';
    document.getElementById('f-status').value=r.status||'pending';
    document.getElementById('f-assigned').value=r.assignedTo||'';
    document.getElementById('f-desc').value=r.description||'';
    document.getElementById('f-due').value=r.dueDate||'';
    document.getElementById('f-tags').value=(r.tags||[]).join(', ');
  } else {
    ['f-title','f-assigned','f-desc','f-due','f-tags'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('f-dept').value='Engineering';
    document.getElementById('f-priority').value='medium';
    document.getElementById('f-status').value=settings.defaultStatus||'pending';
    document.getElementById('edit-id').value='';
  }
  m.classList.add('open');
  setTimeout(()=>document.getElementById('f-title').focus(),100);
}

function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
function closeViewModal() { document.getElementById('view-modal-overlay').classList.remove('open'); }

async function saveRecord() {
  const title = document.getElementById('f-title').value.trim();
  if(!title) { toast('Record title is required','error'); return; }
  const editId = document.getElementById('edit-id').value;
  const now = new Date().toISOString();
  const tags = document.getElementById('f-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const data = {
    title, department:document.getElementById('f-dept').value,
    priority:document.getElementById('f-priority').value,
    status:document.getElementById('f-status').value,
    assignedTo:document.getElementById('f-assigned').value,
    description:document.getElementById('f-desc').value,
    dueDate:document.getElementById('f-due').value, tags
  };
  try {
    if(isServerBacked) {
      if(editId) {
        const res = await api(`/api/records/${editId}`, { method:'PUT', body:JSON.stringify(recordPayload(data)) });
        const updated = normalizeRecord(res.record);
        records = records.map(r => r.id === editId ? updated : r);
        toast('Record updated successfully');
      } else {
        const res = await api('/api/records', { method:'POST', body:JSON.stringify(recordPayload(data)) });
        records.unshift(normalizeRecord(res.record));
        toast('Record created successfully');
      }
      const auditRes = await api('/api/audit');
      auditLog = (auditRes.log || []).map(normalizeAudit);
    } else if(editId) {
      const idx=records.findIndex(r=>r.id===editId);
      if(idx===-1) return;
      const old={...records[idx]};
      records[idx]={...records[idx],...data,updatedAt:now,updatedBy:currentUser()};
      addAudit('update',editId,records[idx].title,'Record updated',old,records[idx]);
      toast('Record updated successfully');
    } else {
      const rec={ id:genId(), ...data, createdAt:now, createdBy:currentUser(), updatedAt:now, updatedBy:currentUser(), changes:[] };
      records.unshift(rec);
      addAudit('create',rec.id,rec.title,'Record created',null,rec);
      toast('Record created successfully');
    }
  } catch(err) {
    toast(err.message || 'Could not save record','error');
    return;
  }
  save();
  closeModal();
  renderDashboard(); renderRecordsTable();
  document.getElementById('nav-count').textContent=records.length;
  broadcastUpdate();
}

async function deleteRecord(id) {
  if(!confirm('Delete this record permanently?')) return;
  const r=records.find(x=>x.id===id);
  try {
    if(isServerBacked) {
      await api(`/api/records/${id}`, { method:'DELETE' });
      const auditRes = await api('/api/audit');
      auditLog = (auditRes.log || []).map(normalizeAudit);
    } else {
      addAudit('delete',id,r?.title||id,'Record deleted',r,null);
    }
  } catch(err) {
    toast(err.message || 'Could not delete record','error');
    return;
  }
  records=records.filter(x=>x.id!==id);
  save();
  renderDashboard(); renderRecordsTable();
  document.getElementById('nav-count').textContent=records.length;
  toast('Record deleted','info');
}

// ============================================================
// AUDIT LOG
// ============================================================
function addAudit(action, recordId, recordTitle, note, before, after) {
  const entry = { id:genId(), action, recordId, recordTitle, note, by:currentUser(), at:new Date().toISOString(), before:JSON.stringify(before||{}), after:JSON.stringify(after||{}) };
  auditLog.unshift(entry);
  if(auditLog.length>500) auditLog=auditLog.slice(0,500);
  save();
}

// ============================================================
// DASHBOARD
// ============================================================
function renderDashboard() {
  const total=records.length;
  const completed=records.filter(r=>r.status==='completed').length;
  const pending=records.filter(r=>r.status==='pending').length;
  const todayAdded=records.filter(r=>isToday(r.createdAt)).length;
  const yesterdayAdded=records.filter(r=>isYesterday(r.createdAt)).length;
  const todayUpdated=records.filter(r=>isToday(r.updatedAt)&&!isToday(r.createdAt)).length;
  const inProgress=records.filter(r=>r.status==='in-progress').length;
  document.getElementById('stat-total').textContent=total;
  document.getElementById('stat-completed').textContent=completed;
  document.getElementById('stat-pending').textContent=pending;
  document.getElementById('stat-updated').textContent=todayUpdated;
  const delta = todayAdded - yesterdayAdded;
  document.getElementById('stat-total-change').className = `stat-change ${delta >= 0 ? 'up' : 'down'}`;
  document.getElementById('stat-total-change').innerHTML=`<i class="ti ${delta >= 0 ? 'ti-trending-up' : 'ti-trending-down'}"></i><span>${todayAdded} added today</span>`;
  document.getElementById('stat-total-compare').textContent=`${Math.abs(delta)} ${delta >= 0 ? 'more' : 'fewer'} than yesterday`;
  document.getElementById('stat-completed-pct').innerHTML=`<span>${total?Math.round(completed/total*100):0}% completion rate</span>`;
  document.getElementById('stat-completed-compare').textContent=`${completed} of ${total} records closed`;
  document.getElementById('stat-pending-sub').innerHTML=`<i class="ti ti-hourglass-high"></i><span>${inProgress} in progress</span>`;
  document.getElementById('stat-pending-compare').textContent=`${pending + inProgress} active records need attention`;
  document.getElementById('stat-updated-change').innerHTML=`<i class="ti ti-refresh"></i><span>${todayUpdated} changed today</span>`;
  document.getElementById('stat-updated-compare').textContent=`Real-time ${isServerBacked ? 'API' : 'local'} tracking`;
  document.getElementById('nav-count').textContent=total;
  renderRecentRecords(); renderUserActivity();
  renderDailyRecordsChart(); renderWeeklyTrendChart(); renderMonthlyGrowthChart(); renderCategoryDistributionChart();
}

function renderRecentRecords() {
  const el=document.getElementById('recent-records-list');
  const recent=records.slice(0,5);
  if(!recent.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-inbox"></i>No records yet</div>'; return; }
  el.innerHTML=recent.map(r=>`
    <div class="audit-item">
      <div style="flex:1">
        <div class="audit-title">${r.title}</div>
        <div class="audit-meta">${r.department} â€¢ ${r.createdBy} â€¢ ${fmtDateTime(r.createdAt)}</div>
      </div>
      ${statusBadge(r.status)}
    </div>`).join('');
}

function renderUserActivity() {
  const el=document.getElementById('user-activity-list');
  const counts={};
  records.forEach(r=>{ counts[r.createdBy]=(counts[r.createdBy]||0)+1; });
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const max=sorted[0]?.[1]||1;
  if(!sorted.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-users"></i>No activity yet</div>'; return; }
  el.innerHTML=sorted.map(([name,count])=>`
    <div style="margin-bottom:14px">
      <div class="flex-center" style="margin-bottom:6px">
        <span style="font-size:13px;color:var(--text1)">${name}</span>
        <span class="ml-auto text-xs">${count} record${count!==1?'s':''}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(count/max*100)}%;background:var(--accent)"></div></div>
    </div>`).join('');
}

function chartBaseOptions(extra={}) {
  return {
    responsive:true,
    maintainAspectRatio:false,
    animation:{ duration:750, easing:'easeOutQuart' },
    plugins:{
      legend:{ labels:{ color:themeVar('--chart-tick-strong'), boxWidth:10, usePointStyle:true } },
      tooltip:{ backgroundColor:themeVar('--bg2'), titleColor:themeVar('--text1'), bodyColor:themeVar('--text2'), borderColor:themeVar('--border2'), borderWidth:1 }
    },
    ...extra
  };
}

function lastNDays(n) {
  const out = [];
  for(let i=n-1;i>=0;i--) {
    const d = new Date();
    d.setHours(0,0,0,0);
    d.setDate(d.getDate()-i);
    out.push(d);
  }
  return out;
}

function sameDay(a, b) {
  const d = new Date(a);
  return d.toDateString() === b.toDateString();
}

function renderDailyRecordsChart() {
  const canvas = document.getElementById('dailyRecordsChart');
  if(!canvas || !window.Chart) return;
  const ctx=canvas.getContext('2d');
  if(dailyRecordsChartObj) dailyRecordsChartObj.destroy();
  const days = lastNDays(7);
  dailyRecordsChartObj = new Chart(ctx, {
    type:'bar',
    data:{
      labels:days.map(d=>d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric'})),
      datasets:[
        { label:'Created', data:days.map(d=>records.filter(r=>sameDay(r.createdAt,d)).length), backgroundColor:alphaColor('--accent',0.78), borderRadius:6 },
        { label:'Updated', data:days.map(d=>records.filter(r=>r.updatedAt && !sameDay(r.createdAt,d) && sameDay(r.updatedAt,d)).length), backgroundColor:alphaColor('--info',0.62), borderRadius:6 }
      ]
    },
    options: chartBaseOptions({
      scales:{
        x:{ ticks:{ color:themeVar('--chart-tick'), font:{ size:11 } }, grid:{ display:false } },
        y:{ beginAtZero:true, ticks:{ color:themeVar('--chart-tick'), precision:0 }, grid:{ color:themeVar('--chart-grid') } }
      }
    })
  });
}

function renderWeeklyTrendChart() {
  const canvas = document.getElementById('weeklyTrendChart');
  if(!canvas || !window.Chart) return;
  const ctx=canvas.getContext('2d');
  if(weeklyTrendChartObj) weeklyTrendChartObj.destroy();
  const days = lastNDays(7);
  const created = days.map(d=>records.filter(r=>sameDay(r.createdAt,d)).length);
  const cumulative = created.reduce((acc, count, idx)=>{ acc.push((acc[idx-1]||0)+count); return acc; }, []);
  weeklyTrendChartObj = new Chart(ctx, {
    type:'line',
    data:{ labels:days.map(d=>d.toLocaleDateString('en-IN',{weekday:'short'})), datasets:[
      { label:'Daily', data:created, borderColor:themeVar('--accent'), backgroundColor:alphaColor('--accent',0.14), tension:0.38, fill:true, pointRadius:4, pointBackgroundColor:themeVar('--accent') },
      { label:'Cumulative', data:cumulative, borderColor:themeVar('--success'), backgroundColor:alphaColor('--success',0.08), tension:0.38, borderDash:[5,5], pointRadius:3 }
    ]},
    options: chartBaseOptions({
      scales:{
        x:{ ticks:{ color:themeVar('--chart-tick') }, grid:{ color:themeVar('--chart-grid') } },
        y:{ beginAtZero:true, ticks:{ color:themeVar('--chart-tick'), precision:0 }, grid:{ color:themeVar('--chart-grid') } }
      }
    })
  });
}

function renderMonthlyGrowthChart() {
  const canvas = document.getElementById('monthlyGrowthChart');
  if(!canvas || !window.Chart) return;
  const ctx=canvas.getContext('2d');
  if(monthlyGrowthChartObj) monthlyGrowthChartObj.destroy();
  const months=[]; const data=[];
  for(let i=5;i>=0;i--){
    const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
    months.push(d.toLocaleDateString('en-IN',{month:'short'}));
    data.push(records.filter(r=>{ const rd=new Date(r.createdAt); return rd.getMonth()===d.getMonth()&&rd.getFullYear()===d.getFullYear(); }).length);
  }
  monthlyGrowthChartObj = new Chart(ctx, {
    type:'line',
    data:{ labels:months, datasets:[{ label:'Records', data, borderColor:themeVar('--purple'), backgroundColor:alphaColor('--purple',0.13), fill:true, tension:0.42, pointRadius:4, pointBackgroundColor:themeVar('--purple') }] },
    options: chartBaseOptions({
      plugins:{ ...chartBaseOptions().plugins, legend:{ display:false } },
      scales:{
        x:{ ticks:{ color:themeVar('--chart-tick') }, grid:{ display:false } },
        y:{ beginAtZero:true, ticks:{ color:themeVar('--chart-tick'), precision:0 }, grid:{ color:themeVar('--chart-grid') } }
      }
    })
  });
}

function renderCategoryDistributionChart() {
  const canvas = document.getElementById('categoryDistributionChart');
  if(!canvas || !window.Chart) return;
  const ctx=canvas.getContext('2d');
  if(categoryDistributionChartObj) categoryDistributionChartObj.destroy();
  const counts={};
  records.forEach(r=>{ counts[r.department || 'Other']=(counts[r.department || 'Other']||0)+1; });
  const labels=Object.keys(counts);
  categoryDistributionChartObj = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data:Object.values(counts), backgroundColor:[themeVar('--accent'),themeVar('--success'),themeVar('--warning'),themeVar('--info'),themeVar('--purple'),themeVar('--danger'),alphaColor('--accent',0.45),alphaColor('--success',0.45)], borderWidth:0, hoverOffset:8 }] },
    options: chartBaseOptions({ cutout:'62%', plugins:{ ...chartBaseOptions().plugins, legend:{ position:'bottom', labels:{ color:themeVar('--chart-tick-strong'), boxWidth:9, usePointStyle:true } } } })
  });
}

function renderActivityChart() {
  const ctx=document.getElementById('activityChart').getContext('2d');
  if(activityChartObj){ activityChartObj.destroy(); }
  const tickColor = themeVar('--chart-tick');
  const gridColor = themeVar('--chart-grid');
  const days=[]; const added=[]; const updated=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const label=d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric'});
    days.push(label);
    const ds=d.toDateString();
    added.push(records.filter(r=>new Date(r.createdAt).toDateString()===ds).length);
    updated.push(records.filter(r=>r.updatedAt&&new Date(r.updatedAt).toDateString()===ds&&new Date(r.updatedAt)>new Date(r.createdAt)).length);
  }
  activityChartObj=new Chart(ctx,{type:'bar',data:{labels:days,datasets:[
    {label:'Added',data:added,backgroundColor:alphaColor('--accent',0.7),borderRadius:4},
    {label:'Updated',data:updated,backgroundColor:alphaColor('--info',0.5),borderRadius:4}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:tickColor,font:{size:11}},grid:{color:gridColor}},y:{ticks:{color:tickColor,font:{size:11},stepSize:1},grid:{color:gridColor}}}}});
}

function renderStatusChart() {
  const ctx=document.getElementById('statusChart').getContext('2d');
  if(statusChartObj){ statusChartObj.destroy(); }
  const s={pending:0,'in-progress':0,completed:0,cancelled:0};
  records.forEach(r=>{ if(s[r.status]!==undefined) s[r.status]++; });
  statusChartObj=new Chart(ctx,{type:'doughnut',data:{
    labels:['Pending','In Progress','Completed','Cancelled'],
    datasets:[{data:Object.values(s),backgroundColor:[themeVar('--warning'),themeVar('--info'),themeVar('--success'),themeVar('--danger')],borderWidth:0,hoverOffset:4}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},cutout:'65%'}});
}

// ============================================================
// RECORDS TABLE
// ============================================================
function renderRecordsTable() {
  populateDepartmentFilter();
  renderTableHead('records-thead','records',[
    {label:'ID',sortKey:'id'},{label:'Title',sortKey:'title'},{label:'Department',sortKey:'department'},
    {label:'Priority',sortKey:'priority'},{label:'Status',sortKey:'status'},{label:'Created By',sortKey:'createdBy'},
    {label:'Created',sortKey:'createdAt'},{label:'Last Updated',sortKey:'updatedAt'},{label:'Actions'}
  ]);
  const statusFilter=document.getElementById('filter-status').value;
  const priorityFilter=document.getElementById('filter-priority').value;
  const deptFilter=document.getElementById('filter-department')?.value || '';
  tableState.records.filters = { status:statusFilter, priority:priorityFilter, department:deptFilter };
  let data=records;
  if(statusFilter) data=data.filter(r=>r.status===statusFilter);
  if(priorityFilter) data=data.filter(r=>r.priority===priorityFilter);
  if(deptFilter) data=data.filter(r=>r.department===deptFilter);
  const tableQuery = tableState.records.query || currentSearchQuery.toLowerCase();
  if(tableQuery) {
    const q=tableQuery.toLowerCase();
    data=data.filter(r=>r.title?.toLowerCase().includes(q)||r.department?.toLowerCase().includes(q)||r.createdBy?.toLowerCase().includes(q)||r.description?.toLowerCase().includes(q));
  }
  const countLabel = document.getElementById('records-count-label');
  countLabel.classList.remove('loading-text');
  countLabel.textContent=`${data.length} record${data.length!==1?'s':''} found`;
  const tbody=document.getElementById('records-tbody');
  if(recordsLoading){ tbody.innerHTML=rowLoading(9); renderPagination('records',0,1); return; }
  if(!data.length){ tbody.innerHTML=rowEmpty(9,'ti-inbox','No records found'); renderPagination('records',0,1); return; }
  data = data.sort(compareRows(tableState.records.sortKey, tableState.records.sortDir));
  const paged = paginateData('records', data);
  tbody.innerHTML=paged.rows.map(r=>`
    <tr class="${selectedRecordId===r.id?'row-selected':''}" onclick="highlightRow('${r.id}')">
      <td><span style="font-family:monospace;font-size:11px;color:var(--text3)">${r.id}</span></td>
      <td class="td-main">${escapeHtml(r.title)}</td>
      <td><span class="badge badge-default">${escapeHtml(r.department)}</span></td>
      <td>${priorityBadge(r.priority)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${escapeHtml(r.createdBy)}</td>
      <td style="white-space:nowrap">${fmtDate(r.createdAt)}</td>
      <td style="white-space:nowrap">${fmtDateTime(r.updatedAt)}</td>
      <td>
        <div class="flex-center">
          <button class="icon-btn" onclick="event.stopPropagation(); viewRecord('${r.id}')" title="View"><i class="ti ti-eye"></i></button>
          <button class="icon-btn" onclick="event.stopPropagation(); openModal('edit','${r.id}')" title="Edit"><i class="ti ti-edit"></i></button>
          <button class="icon-btn" onclick="event.stopPropagation(); deleteRecord('${r.id}')" title="Delete" style="color:var(--danger)"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
  renderPagination('records', data.length, paged.totalPages);
}

function highlightRow(id) {
  selectedRecordId = id;
  renderRecordsTable();
}

function viewRecord(id) {
  const r=records.find(x=>x.id===id);
  if(!r) return;
  const history=auditLog.filter(a=>a.recordId===id);
  document.getElementById('view-modal-title').textContent=r.title;
  document.getElementById('view-modal-content').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div><div class="text-xs">Record ID</div><div style="font-family:monospace;font-size:12px;margin-top:3px">${r.id}</div></div>
      <div><div class="text-xs">Status</div><div style="margin-top:4px">${statusBadge(r.status)}</div></div>
      <div><div class="text-xs">Department</div><div class="fw-5 mt-8">${r.department}</div></div>
      <div><div class="text-xs">Priority</div><div style="margin-top:4px">${priorityBadge(r.priority)}</div></div>
      <div><div class="text-xs">Assigned To</div><div class="fw-5 mt-8">${r.assignedTo||'â€”'}</div></div>
      <div><div class="text-xs">Due Date</div><div class="fw-5 mt-8">${fmtDate(r.dueDate)||'â€”'}</div></div>
      <div><div class="text-xs">Created By</div><div class="fw-5 mt-8">${r.createdBy}</div></div>
      <div><div class="text-xs">Created At</div><div class="fw-5 mt-8">${fmtDateTime(r.createdAt)}</div></div>
      <div><div class="text-xs">Last Updated By</div><div class="fw-5 mt-8">${r.updatedBy||'â€”'}</div></div>
      <div><div class="text-xs">Last Updated At</div><div class="fw-5 mt-8">${fmtDateTime(r.updatedAt)}</div></div>
    </div>
    ${r.description?`<div style="margin-bottom:14px"><div class="text-xs" style="margin-bottom:6px">Description</div><div style="background:var(--bg3);border-radius:8px;padding:12px;font-size:13px;color:var(--text2);line-height:1.6">${r.description}</div></div>`:''}
    ${r.tags?.length?`<div style="margin-bottom:14px"><div class="text-xs" style="margin-bottom:6px">Tags</div><div class="tag-row">${r.tags.map(t=>`<span class="badge badge-default">${t}</span>`).join('')}</div></div>`:''}
    <div class="divider"></div>
    <div class="section-title">Change History (${history.length})</div>
    ${history.length?history.slice(0,5).map(h=>`
      <div class="audit-item" style="padding:8px 0">
        <div><div class="audit-title">${h.note}</div><div class="audit-meta">${h.by} â€¢ ${fmtDateTime(h.at)}</div></div>
        <span class="badge badge-${h.action==='create'?'success':h.action==='update'?'info':'danger'}">${h.action}</span>
      </div>`).join(''):`<div class="text-xs" style="padding:8px 0">No change history available</div>`}`;
  document.getElementById('view-edit-btn').onclick=()=>{ closeViewModal(); openModal('edit',id); };
  document.getElementById('view-modal-overlay').classList.add('open');
}

// ============================================================
// DAILY VIEW
// ============================================================
function setDailyTab(tab, el) {
  dailyTab=tab;
  document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
  if(el) el.classList.add('active');
  renderDaily();
}

function renderDaily() {
  renderTableHead('daily-thead','daily',[
    {label:'ID',sortKey:'id'},{label:'Title',sortKey:'title'},{label:'Status',sortKey:'status'},
    {label:'Priority',sortKey:'priority'},{label:'Created By',sortKey:'createdBy'},{label:'Time',sortKey:'createdAt'}
  ]);
  const filterFns={ today:isToday, yesterday:isYesterday, week:isThisWeek, month:isThisMonth };
  const fn=filterFns[dailyTab]||isToday;
  let filtered=records.filter(r=>fn(r.createdAt));
  const statusFilter=document.getElementById('daily-filter-status')?.value || '';
  const priorityFilter=document.getElementById('daily-filter-priority')?.value || '';
  if(statusFilter) filtered=filtered.filter(r=>r.status===statusFilter);
  if(priorityFilter) filtered=filtered.filter(r=>r.priority===priorityFilter);
  if(tableState.daily.query) {
    const q=tableState.daily.query;
    filtered=filtered.filter(r=>r.title?.toLowerCase().includes(q)||r.createdBy?.toLowerCase().includes(q)||r.department?.toLowerCase().includes(q)||r.status?.toLowerCase().includes(q));
  }
  const titles={ today:"Today's Records", yesterday:"Yesterday's Records", week:"This Week's Records", month:"This Month's Records" };
  document.getElementById('daily-table-title').textContent=titles[dailyTab];
  const completed=filtered.filter(r=>r.status==='completed').length;
  const pending=filtered.filter(r=>r.status==='pending').length;
  document.getElementById('daily-count-label').textContent=`${filtered.length} matching record${filtered.length!==1?'s':''}`;
  document.getElementById('daily-stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">Total Entries</div><div class="stat-value">${filtered.length}</div></div>
    <div class="stat-card"><div class="stat-label"><i class="ti ti-circle-check" style="font-size:14px;color:var(--success)"></i>Completed</div><div class="stat-value">${completed}</div></div>
    <div class="stat-card"><div class="stat-label"><i class="ti ti-clock" style="font-size:14px;color:var(--warning)"></i>Pending</div><div class="stat-value">${pending}</div></div>`;
  const tbody=document.getElementById('daily-tbody');
  if(recordsLoading){ tbody.innerHTML=rowLoading(6); renderPagination('daily',0,1); return; }
  if(!filtered.length){ tbody.innerHTML=rowEmpty(6,'ti-calendar-off','No records for this period'); renderPagination('daily',0,1); return; }
  filtered = filtered.sort(compareRows(tableState.daily.sortKey, tableState.daily.sortDir));
  const paged = paginateData('daily', filtered);
  tbody.innerHTML=paged.rows.map(r=>`
    <tr class="${selectedRecordId===r.id?'row-selected':''}" onclick="selectedRecordId='${r.id}'; renderDaily();">
      <td><span style="font-family:monospace;font-size:11px;color:var(--text3)">${r.id}</span></td>
      <td class="td-main">${escapeHtml(r.title)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${priorityBadge(r.priority)}</td>
      <td>${escapeHtml(r.createdBy)}</td>
      <td style="white-space:nowrap">${fmtTime(r.createdAt)}</td>
    </tr>`).join('');
  renderPagination('daily', filtered.length, paged.totalPages);
}

// ============================================================
// REPORTS
// ============================================================
function generateReport() {
  const today=new Date();
  document.getElementById('report-date').textContent=today.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const todayRecs=records.filter(r=>isToday(r.createdAt));
  const updatedToday=records.filter(r=>isToday(r.updatedAt)&&!isToday(r.createdAt));
  const pending=records.filter(r=>r.status==='pending').length;
  const completed=records.filter(r=>r.status==='completed').length;
  document.getElementById('report-stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">Records Added Today</div><div class="stat-value">${todayRecs.length}</div></div>
    <div class="stat-card"><div class="stat-label">Records Updated Today</div><div class="stat-value">${updatedToday.length}</div></div>
    <div class="stat-card"><div class="stat-label"><i class="ti ti-clock" style="font-size:14px;color:var(--warning)"></i>Pending</div><div class="stat-value">${pending}</div></div>
    <div class="stat-card"><div class="stat-label"><i class="ti ti-circle-check" style="font-size:14px;color:var(--success)"></i>Completed</div><div class="stat-value">${completed}</div></div>`;
  const counts={};
  records.forEach(r=>{ counts[r.createdBy]=(counts[r.createdBy]||0)+1; });
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  document.getElementById('user-performance').innerHTML=sorted.map(([name,count])=>`
    <div style="margin-bottom:14px">
      <div class="flex-center" style="margin-bottom:6px">
        <div class="user-avatar" style="width:28px;height:28px;font-size:10px">${name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
        <span style="font-size:13px">${name}</span>
        <span class="ml-auto badge badge-info">${count} records</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(count/(sorted[0]?.[1]||1)*100)}%;background:var(--accent)"></div></div>
    </div>`).join('')||'<div class="empty-state"><i class="ti ti-users"></i>No data</div>';
  renderDeptChart(); renderTrendChart();
}

function renderDeptChart() {
  const ctx=document.getElementById('deptChart').getContext('2d');
  if(deptChartObj) deptChartObj.destroy();
  const tickColor = themeVar('--chart-tick');
  const tickStrong = themeVar('--chart-tick-strong');
  const gridColor = themeVar('--chart-grid');
  const depts={};
  records.forEach(r=>{ depts[r.department]=(depts[r.department]||0)+1; });
  const labels=Object.keys(depts), data=Object.values(depts);
  deptChartObj=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:alphaColor('--accent',0.7),borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},
    scales:{x:{ticks:{color:tickColor,font:{size:10},stepSize:1},grid:{color:gridColor}},y:{ticks:{color:tickStrong,font:{size:10}},grid:{display:false}}}}});
}

function renderTrendChart() {
  const ctx=document.getElementById('trendChart').getContext('2d');
  if(trendChartObj) trendChartObj.destroy();
  const tickColor = themeVar('--chart-tick');
  const gridColor = themeVar('--chart-grid');
  const months=[]; const data=[];
  for(let i=5;i>=0;i--){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    months.push(d.toLocaleDateString('en-IN',{month:'short'}));
    data.push(records.filter(r=>{ const rd=new Date(r.createdAt); return rd.getMonth()===d.getMonth()&&rd.getFullYear()===d.getFullYear(); }).length);
  }
  trendChartObj=new Chart(ctx,{type:'line',data:{labels:months,datasets:[{label:'Records',data,borderColor:themeVar('--accent'),backgroundColor:alphaColor('--accent',0.1),tension:0.4,fill:true,pointBackgroundColor:themeVar('--accent'),pointRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:tickColor},grid:{color:gridColor}},y:{ticks:{color:tickColor,stepSize:1},grid:{color:gridColor}}}}});
}

// ============================================================
// AUDIT TRAIL
// ============================================================
function renderAudit() {
  const el=document.getElementById('audit-list');
  if(!auditLog.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-shield"></i>No audit entries yet</div>'; return; }
  const icons={create:'ti-plus',update:'ti-edit',delete:'ti-trash'};
  const colors={create:'var(--success-bg)',update:'var(--info-bg)',delete:'var(--danger-bg)'};
  const tc={create:'var(--success)',update:'var(--info)',delete:'var(--danger)'};
  el.innerHTML=auditLog.slice(0,50).map(a=>`
    <div class="audit-item">
      <div class="audit-icon" style="background:${colors[a.action]};color:${tc[a.action]}"><i class="ti ${icons[a.action]}"></i></div>
      <div class="audit-content">
        <div class="audit-title">${a.recordTitle} <span style="color:var(--text3);font-weight:400">â€¢ ${a.note}</span></div>
        <div class="audit-meta">by ${a.by} â€¢ ${fmtDateTime(a.at)} â€¢ ID: ${a.recordId}</div>
      </div>
      <span class="badge badge-${a.action==='create'?'success':a.action==='update'?'info':'danger'} audit-badge">${a.action}</span>
    </div>`).join('');
}

function exportAudit() {
  if(isServerBacked) {
    window.location.href = '/api/audit/export';
    toast('Audit export started');
    return;
  }
  const rows=[['ID','Action','Record','Note','By','Timestamp'],...auditLog.map(a=>[a.id,a.action,a.recordTitle,a.note,a.by,a.at])];
  downloadCSV(rows,'audit_log_'+Date.now()+'.csv');
}

// ============================================================
// BACKUP
// ============================================================
async function createBackup() {
  try {
    if(isServerBacked) {
      const res = await api('/api/backups', { method:'POST', body:JSON.stringify({}) });
      backups.unshift(normalizeBackup(res.backup));
    } else {
      const backup={ id:genId(), createdAt:new Date().toISOString(), by:currentUser(), size:JSON.stringify({records,auditLog}).length, recordCount:records.length };
      backups.unshift(backup);
    }
    if(backups.length>10) backups=backups.slice(0,10);
    save();
    toast('Backup created successfully');
    renderBackup();
  } catch(err) {
    toast(err.message || 'Could not create backup','error');
  }
}

function renderBackup() {
  document.getElementById('backup-count').textContent=backups.length;
  document.getElementById('last-backup').textContent=backups[0]?fmtDateTime(backups[0].createdAt):'Never';
  document.getElementById('data-size').textContent=Math.round(JSON.stringify({records,auditLog}).length/1024)+' KB';
  const el=document.getElementById('backup-list');
  let data = backups;
  if(tableState.backups.query) {
    const q = tableState.backups.query;
    data = data.filter(b=>String(b.id).toLowerCase().includes(q)||String(b.by||'').toLowerCase().includes(q)||String(b.recordCount).includes(q));
  }
  data = data.sort(compareRows(tableState.backups.sortKey, tableState.backups.sortDir));
  const paged = paginateData('backups', data);
  el.innerHTML=`<div class="table-wrap"><table class="data-table"><thead id="backups-thead"></thead><tbody id="backups-tbody"></tbody></table></div><div class="table-footer" id="backups-pagination"></div>`;
  renderTableHead('backups-thead','backups',[
    {label:'Backup ID',sortKey:'id'},{label:'Created At',sortKey:'createdAt'},{label:'Created By',sortKey:'by'},
    {label:'Records',sortKey:'recordCount'},{label:'Size',sortKey:'size'},{label:'Actions'}
  ]);
  const tbody=document.getElementById('backups-tbody');
  if(!data.length){ tbody.innerHTML=rowEmpty(6,'ti-archive','No backups found'); renderPagination('backups',0,1); return; }
  tbody.innerHTML=paged.rows.map(b=>`<tr>
      <td><span style="font-family:monospace;font-size:11px;color:var(--text3)">${b.id}</span></td>
      <td>${fmtDateTime(b.createdAt)}</td><td>${escapeHtml(b.by || currentUser())}</td>
      <td>${b.recordCount}</td>
      <td>${Math.round(b.size/1024)} KB</td>
      <td><button class="btn btn-secondary btn-sm" onclick="restoreBackup('${b.id}')"><i class="ti ti-restore"></i>Restore</button></td>
    </tr>`).join('');
  renderPagination('backups', data.length, paged.totalPages);
}

async function restoreBackup(id) {
  const b=backups.find(x=>x.id===id);
  if(!b||!confirm('Restore from this backup? Current data will be replaced.')) return;
  try {
    if(isServerBacked) {
      await api(`/api/backups/${id}/restore`, { method:'POST', body:JSON.stringify({}) });
      await loadServerData();
      toast('Backup restored','info');
    } else {
      toast('Backup restored (local demo backup metadata only)','info');
    }
  } catch(err) {
    toast(err.message || 'Could not restore backup','error');
  }
}

// ============================================================
// USERS
// ============================================================
function renderUsers() {
  renderTableHead('users-thead','users',[
    {label:'User',sortKey:'name'},{label:'Role',sortKey:'role'},{label:'Records Created',sortKey:'recordCount'},
    {label:'Last Active',sortKey:'lastActive'},{label:'Status',sortKey:'active'}
  ]);
  const tbody=document.getElementById('users-tbody');
  const counts={};
  records.forEach(r=>{ counts[r.createdBy]=(counts[r.createdBy]||0)+1; });
  const last={};
  records.forEach(r=>{ if(!last[r.createdBy]||r.createdAt>last[r.createdBy]) last[r.createdBy]=r.createdAt; });
  let data = users.map(u=>({
    ...u,
    recordCount: u.record_count ?? counts[u.name] ?? 0,
    lastActive: u.last_active ?? last[u.name] ?? ''
  }));
  const roleFilter = document.getElementById('users-filter-role')?.value || '';
  if(roleFilter) data = data.filter(u=>u.role===roleFilter);
  if(tableState.users.query) {
    const q=tableState.users.query;
    data=data.filter(u=>u.name?.toLowerCase().includes(q)||u.email?.toLowerCase().includes(q)||u.role?.toLowerCase().includes(q));
  }
  data = data.sort(compareRows(tableState.users.sortKey, tableState.users.sortDir));
  const paged = paginateData('users', data);
  if(!data.length){ tbody.innerHTML=rowEmpty(5,'ti-users','No users found'); renderPagination('users',0,1); return; }
  tbody.innerHTML=paged.rows.map(u=>`<tr>
    <td><div class="flex-center">
      <div class="user-avatar" style="width:30px;height:30px;font-size:11px">${escapeHtml(u.name.split(' ').map(n=>n[0]).join('').slice(0,2))}</div>
      <div><div style="font-size:13px;font-weight:500;color:var(--text1)">${escapeHtml(u.name)}</div><div class="text-xs">${escapeHtml(u.email||'â€”')}</div></div>
    </div></td>
    <td><span class="badge badge-default">${escapeHtml(u.role)}</span></td>
    <td>${u.recordCount}</td>
    <td>${u.lastActive?fmtDate(u.lastActive):'Never'}</td>
    <td><span class="badge badge-${u.active===false?'warning':'success'}">${u.active===false?'Inactive':'Active'}</span></td>
  </tr>`).join('');
  renderPagination('users', data.length, paged.totalPages);
}

function openAddUserModal() { document.getElementById('user-modal-overlay').classList.add('open'); }
async function addUser() {
  const name=document.getElementById('nu-name').value.trim();
  if(!name){ toast('Name is required','error'); return; }
  const payload = { name, role:document.getElementById('nu-role').value, email:document.getElementById('nu-email').value };
  try {
    if(isServerBacked) {
      const res = await api('/api/users', { method:'POST', body:JSON.stringify(payload) });
      users.push(res.user);
    } else {
      users.push({ id:genId(), ...payload, createdAt:new Date().toISOString(), active:true });
    }
    save();
    document.getElementById('user-modal-overlay').classList.remove('open');
    document.getElementById('nu-name').value='';
    document.getElementById('nu-email').value='';
    renderUsers();
    toast('User added');
  } catch(err) {
    toast(err.message || 'Could not add user','error');
  }
}

// ============================================================
// SETTINGS
// ============================================================
function loadSettings() {
  document.getElementById('set-username').value=settings.username||'';
  document.getElementById('set-role').value=settings.role||'Administrator';
  document.getElementById('set-backup').value=settings.backup||'Daily';
  document.getElementById('set-default-status').value=settings.defaultStatus||'pending';
}
async function saveSettings() {
  settings.username=document.getElementById('set-username').value||'Admin User';
  settings.role=document.getElementById('set-role').value;
  settings.backup=document.getElementById('set-backup').value;
  settings.defaultStatus=document.getElementById('set-default-status').value;
  try {
    if(isServerBacked) {
      await api('/api/settings', { method:'PUT', body:JSON.stringify({
        username: settings.username,
        role: settings.role,
        backup_freq: settings.backup,
        default_status: settings.defaultStatus
      }) });
    }
  } catch(err) {
    toast(err.message || 'Could not save settings','error');
    return;
  }
  save();
  syncShell();
  toast('Settings saved');
}

// ============================================================
// SEARCH
// ============================================================
function globalSearch(q) {
  currentSearchQuery=q;
  if(document.getElementById('page-records').classList.contains('active')) renderRecordsTable();
}

// ============================================================
// EXPORT
// ============================================================
function exportCSV() {
  if(isServerBacked) {
    window.location.href = '/api/export/csv';
    toast('Export started');
    return;
  }
  const rows=[['ID','Title','Department','Priority','Status','Assigned To','Created By','Created At','Updated By','Updated At','Tags','Description'],
    ...records.map(r=>[r.id,r.title,r.department,r.priority,r.status,r.assignedTo||'',r.createdBy,r.createdAt,r.updatedBy||'',r.updatedAt,(r.tags||[]).join(';'),r.description||''])];
  downloadCSV(rows,'records_export_'+Date.now()+'.csv');
}

function downloadCSV(rows, filename) {
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=filename; a.click();
  toast('Export downloaded');
}

function printReport() { window.print(); }

// ============================================================
// REAL-TIME SIMULATION
// ============================================================
function broadcastUpdate() {
  document.getElementById('stat-total').style.transform='scale(1.05)';
  setTimeout(()=>document.getElementById('stat-total').style.transform='',300);
}

// Auto-refresh dashboard every 30s
setInterval(()=>{ if(document.getElementById('page-dashboard').classList.contains('active')) renderDashboard(); }, 30000);

// Simulated real-time notification every 45s (demo)
let rtNotifCount=0;
setInterval(()=>{
  if(records.length>0 && ++rtNotifCount<=3) {
    const names=['Jane Smith','Bob Chen','Sarah Lee'];
    const actions=['updated a record','added a new entry','completed a task'];
    const nm=names[Math.floor(Math.random()*names.length)];
    const ac=actions[Math.floor(Math.random()*actions.length)];
    toast(`ðŸ”” ${nm} ${ac}`,'info');
    if(document.getElementById('page-dashboard').classList.contains('active')) renderDashboard();
  }
}, 45000);

// Auto-backup daily (simulated)
function autoBackup() {
  if(!backups.length||new Date()-new Date(backups[0].createdAt)>86400000) createBackup();
}

// ============================================================
// SEED DATA
// ============================================================
async function seedData() {
  if(isServerBacked) {
    try {
      await api('/api/seed', { method:'POST', body:JSON.stringify({}) });
      await loadServerData();
      toast('10 sample records added');
    } catch(err) {
      toast(err.message || 'Could not seed data','error');
    }
    return;
  }
  const titles=['Q3 Performance Review','Client Onboarding â€” TechCorp','Marketing Campaign Launch','Infrastructure Upgrade','Budget Reconciliation Q4','Product Roadmap Update','Security Audit','Team Restructuring','Vendor Contract Renewal','Annual Compliance Review'];
  const depts=['Engineering','Marketing','Sales','HR','Finance','Operations','Product','Design'];
  const statuses=['pending','in-progress','completed','cancelled'];
  const priorities=['high','medium','low'];
  const usernames=['Admin User','Jane Smith','Bob Chen','Sarah Lee','Mike Patel'];
  titles.forEach((title,i)=>{
    const d=new Date(); d.setDate(d.getDate()-Math.floor(Math.random()*30));
    const rec={
      id:genId(),title,
      department:depts[Math.floor(Math.random()*depts.length)],
      priority:priorities[Math.floor(Math.random()*priorities.length)],
      status:statuses[Math.floor(Math.random()*statuses.length)],
      assignedTo:usernames[Math.floor(Math.random()*usernames.length)],
      description:`Description for ${title}. This is a sample record created for demonstration purposes.`,
      dueDate:new Date(d.getTime()+Math.random()*30*86400000).toISOString().split('T')[0],
      tags:['sample','demo',depts[i%depts.length].toLowerCase()],
      createdAt:d.toISOString(),createdBy:usernames[Math.floor(Math.random()*usernames.length)],
      updatedAt:d.toISOString(),updatedBy:usernames[Math.floor(Math.random()*usernames.length)]
    };
    records.unshift(rec);
    addAudit('create',rec.id,rec.title,'Record created (seeded)',null,rec);
  });
  save();
  renderDashboard(); renderRecordsTable();
  document.getElementById('nav-count').textContent=records.length;
  toast('10 sample records added');
}

async function clearAllData() {
  if(!confirm('This will permanently delete ALL records and audit logs. Are you sure?')) return;
  if(isServerBacked) {
    try {
      await api('/api/clear', { method:'POST', body:JSON.stringify({}) });
      await loadServerData();
      toast('All data cleared','info');
    } catch(err) {
      toast(err.message || 'Could not clear data','error');
    }
    return;
  }
  records=[]; auditLog=[];
  save(); renderDashboard(); renderRecordsTable();
  document.getElementById('nav-count').textContent=0;
  toast('All data cleared','info');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  setTheme(getTheme(), false);
  syncShell();
  renderDashboard();
  renderRecordsTable();
  loadServerData();
  document.body.classList.remove('app-loading');
});

if(window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e=>{
    if(!localStorage.getItem(THEME_KEY)) setTheme(e.matches ? 'dark' : 'light', false);
  });
}

// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){ e.preventDefault(); document.getElementById('global-search').focus(); }
  if((e.ctrlKey||e.metaKey)&&e.key==='n'){ e.preventDefault(); openModal('add'); }
  if(e.key==='Escape'){ closeModal(); closeViewModal(); closeSidebar(); }
});

