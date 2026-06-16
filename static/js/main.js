// ============================================================
// DATA LAYER â€” localStorage as persistent store
// ============================================================
const DB = {
  get: (key, def=[]) => { try { return JSON.parse(localStorage.getItem('dtp_'+key)) ?? def; } catch(e){ return def; } },
  set: (key, val) => { localStorage.setItem('dtp_'+key, JSON.stringify(val)); },
  getObj: (key, def={}) => { try { return JSON.parse(localStorage.getItem('dtp_'+key)) ?? def; } catch(e){ return def; } }
};

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
let activityChartObj = null, statusChartObj = null, deptChartObj = null, trendChartObj = null;

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

const statusBadge = s => {
  const m = {completed:'success',pending:'warning','in-progress':'info',cancelled:'danger'};
  return `<span class="badge badge-${m[s]||'default'}">${s}</span>`;
};
const priorityBadge = p => {
  const m = {high:'danger',medium:'warning',low:'success'};
  return `<span class="badge badge-${m[p]||'default'}">${p}</span>`;
};

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

function saveRecord() {
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
  if(editId) {
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
  save();
  closeModal();
  renderDashboard(); renderRecordsTable();
  document.getElementById('nav-count').textContent=records.length;
  broadcastUpdate();
}

function deleteRecord(id) {
  if(!confirm('Delete this record permanently?')) return;
  const r=records.find(x=>x.id===id);
  records=records.filter(x=>x.id!==id);
  addAudit('delete',id,r?.title||id,'Record deleted',r,null);
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
  const todayUpdated=records.filter(r=>isToday(r.updatedAt)).length;
  document.getElementById('stat-total').textContent=total;
  document.getElementById('stat-completed').textContent=completed;
  document.getElementById('stat-pending').textContent=pending;
  document.getElementById('stat-updated').textContent=todayUpdated;
  document.getElementById('stat-total-change').innerHTML=`<i class="ti ti-trending-up"></i><span>${records.filter(r=>isToday(r.createdAt)).length} added today</span>`;
  document.getElementById('stat-completed-pct').innerHTML=`<span>${total?Math.round(completed/total*100):0}% completion rate</span>`;
  document.getElementById('nav-count').textContent=total;
  renderRecentRecords(); renderUserActivity(); renderActivityChart(); renderStatusChart();
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

function renderActivityChart() {
  const ctx=document.getElementById('activityChart').getContext('2d');
  if(activityChartObj){ activityChartObj.destroy(); }
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
    {label:'Added',data:added,backgroundColor:'rgba(99,102,241,0.7)',borderRadius:4},
    {label:'Updated',data:updated,backgroundColor:'rgba(56,189,248,0.5)',borderRadius:4}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#5c6180',font:{size:11}},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#5c6180',font:{size:11},stepSize:1},grid:{color:'rgba(255,255,255,0.04)'}}}}});
}

function renderStatusChart() {
  const ctx=document.getElementById('statusChart').getContext('2d');
  if(statusChartObj){ statusChartObj.destroy(); }
  const s={pending:0,'in-progress':0,completed:0,cancelled:0};
  records.forEach(r=>{ if(s[r.status]!==undefined) s[r.status]++; });
  statusChartObj=new Chart(ctx,{type:'doughnut',data:{
    labels:['Pending','In Progress','Completed','Cancelled'],
    datasets:[{data:Object.values(s),backgroundColor:['#f59e0b','#38bdf8','#22c55e','#ef4444'],borderWidth:0,hoverOffset:4}]
  },options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},cutout:'65%'}});
}

// ============================================================
// RECORDS TABLE
// ============================================================
function renderRecordsTable() {
  const statusFilter=document.getElementById('filter-status').value;
  const priorityFilter=document.getElementById('filter-priority').value;
  let data=records;
  if(statusFilter) data=data.filter(r=>r.status===statusFilter);
  if(priorityFilter) data=data.filter(r=>r.priority===priorityFilter);
  if(currentSearchQuery) {
    const q=currentSearchQuery.toLowerCase();
    data=data.filter(r=>r.title?.toLowerCase().includes(q)||r.department?.toLowerCase().includes(q)||r.createdBy?.toLowerCase().includes(q)||r.description?.toLowerCase().includes(q));
  }
  document.getElementById('records-count-label').textContent=`${data.length} record${data.length!==1?'s':''} found`;
  const tbody=document.getElementById('records-tbody');
  if(!data.length){ tbody.innerHTML=`<tr><td colspan="9"><div class="empty-state"><i class="ti ti-inbox"></i>No records found</div></td></tr>`; return; }
  tbody.innerHTML=data.map(r=>`
    <tr>
      <td><span style="font-family:monospace;font-size:11px;color:var(--text3)">${r.id}</span></td>
      <td class="td-main">${r.title}</td>
      <td><span class="badge badge-default">${r.department}</span></td>
      <td>${priorityBadge(r.priority)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${r.createdBy}</td>
      <td style="white-space:nowrap">${fmtDate(r.createdAt)}</td>
      <td style="white-space:nowrap">${fmtDateTime(r.updatedAt)}</td>
      <td>
        <div class="flex-center">
          <button class="icon-btn" onclick="viewRecord('${r.id}')" title="View"><i class="ti ti-eye"></i></button>
          <button class="icon-btn" onclick="openModal('edit','${r.id}')" title="Edit"><i class="ti ti-edit"></i></button>
          <button class="icon-btn" onclick="deleteRecord('${r.id}')" title="Delete" style="color:var(--danger)"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`).join('');
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
  const filterFns={ today:isToday, yesterday:isYesterday, week:isThisWeek, month:isThisMonth };
  const fn=filterFns[dailyTab]||isToday;
  const filtered=records.filter(r=>fn(r.createdAt));
  const titles={ today:"Today's Records", yesterday:"Yesterday's Records", week:"This Week's Records", month:"This Month's Records" };
  document.getElementById('daily-table-title').textContent=titles[dailyTab];
  const completed=filtered.filter(r=>r.status==='completed').length;
  const pending=filtered.filter(r=>r.status==='pending').length;
  document.getElementById('daily-stats').innerHTML=`
    <div class="stat-card"><div class="stat-label">Total Entries</div><div class="stat-value">${filtered.length}</div></div>
    <div class="stat-card"><div class="stat-label"><i class="ti ti-circle-check" style="font-size:14px;color:var(--success)"></i>Completed</div><div class="stat-value">${completed}</div></div>
    <div class="stat-card"><div class="stat-label"><i class="ti ti-clock" style="font-size:14px;color:var(--warning)"></i>Pending</div><div class="stat-value">${pending}</div></div>`;
  const tbody=document.getElementById('daily-tbody');
  if(!filtered.length){ tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><i class="ti ti-calendar-off"></i>No records for this period</div></td></tr>`; return; }
  tbody.innerHTML=filtered.map(r=>`
    <tr>
      <td><span style="font-family:monospace;font-size:11px;color:var(--text3)">${r.id}</span></td>
      <td class="td-main">${r.title}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${priorityBadge(r.priority)}</td>
      <td>${r.createdBy}</td>
      <td style="white-space:nowrap">${fmtTime(r.createdAt)}</td>
    </tr>`).join('');
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
  const depts={};
  records.forEach(r=>{ depts[r.department]=(depts[r.department]||0)+1; });
  const labels=Object.keys(depts), data=Object.values(depts);
  deptChartObj=new Chart(ctx,{type:'bar',data:{labels,datasets:[{data,backgroundColor:'rgba(99,102,241,0.7)',borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',plugins:{legend:{display:false}},
    scales:{x:{ticks:{color:'#5c6180',font:{size:10},stepSize:1},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#9aa0b8',font:{size:10}},grid:{display:false}}}}});
}

function renderTrendChart() {
  const ctx=document.getElementById('trendChart').getContext('2d');
  if(trendChartObj) trendChartObj.destroy();
  const months=[]; const data=[];
  for(let i=5;i>=0;i--){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    months.push(d.toLocaleDateString('en-IN',{month:'short'}));
    data.push(records.filter(r=>{ const rd=new Date(r.createdAt); return rd.getMonth()===d.getMonth()&&rd.getFullYear()===d.getFullYear(); }).length);
  }
  trendChartObj=new Chart(ctx,{type:'line',data:{labels:months,datasets:[{label:'Records',data,borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.1)',tension:0.4,fill:true,pointBackgroundColor:'#6366f1',pointRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#5c6180'},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#5c6180',stepSize:1},grid:{color:'rgba(255,255,255,0.04)'}}}}});
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
  const rows=[['ID','Action','Record','Note','By','Timestamp'],...auditLog.map(a=>[a.id,a.action,a.recordTitle,a.note,a.by,a.at])];
  downloadCSV(rows,'audit_log_'+Date.now()+'.csv');
}

// ============================================================
// BACKUP
// ============================================================
function createBackup() {
  const backup={ id:genId(), createdAt:new Date().toISOString(), by:currentUser(), size:JSON.stringify({records,auditLog}).length, recordCount:records.length };
  backups.unshift(backup);
  if(backups.length>10) backups=backups.slice(0,10);
  save();
  toast('Backup created successfully');
  renderBackup();
}

function renderBackup() {
  document.getElementById('backup-count').textContent=backups.length;
  document.getElementById('last-backup').textContent=backups[0]?fmtDateTime(backups[0].createdAt):'Never';
  document.getElementById('data-size').textContent=Math.round(JSON.stringify({records,auditLog}).length/1024)+' KB';
  const el=document.getElementById('backup-list');
  if(!backups.length){ el.innerHTML='<div class="empty-state"><i class="ti ti-archive"></i>No backups yet. Create one now.</div>'; return; }
  el.innerHTML=`<table style="width:100%;border-collapse:collapse"><thead><tr><th>Backup ID</th><th>Created At</th><th>Created By</th><th>Records</th><th>Size</th><th>Actions</th></tr></thead><tbody>`+
    backups.map(b=>`<tr>
      <td><span style="font-family:monospace;font-size:11px;color:var(--text3)">${b.id}</span></td>
      <td>${fmtDateTime(b.createdAt)}</td><td>${b.by}</td>
      <td>${b.recordCount}</td>
      <td>${Math.round(b.size/1024)} KB</td>
      <td><button class="btn btn-secondary btn-sm" onclick="restoreBackup('${b.id}')"><i class="ti ti-restore"></i>Restore</button></td>
    </tr>`).join('')+'</tbody></table>';
}

function restoreBackup(id) {
  const b=backups.find(x=>x.id===id);
  if(!b||!confirm('Restore from this backup? Current data will be replaced.')) return;
  toast('Backup restored (in a live system, this would reload from stored snapshot)','info');
}

// ============================================================
// USERS
// ============================================================
function renderUsers() {
  const tbody=document.getElementById('users-tbody');
  const counts={};
  records.forEach(r=>{ counts[r.createdBy]=(counts[r.createdBy]||0)+1; });
  const last={};
  records.forEach(r=>{ if(!last[r.createdBy]||r.createdAt>last[r.createdBy]) last[r.createdBy]=r.createdAt; });
  tbody.innerHTML=users.map(u=>`<tr>
    <td><div class="flex-center">
      <div class="user-avatar" style="width:30px;height:30px;font-size:11px">${u.name.split(' ').map(n=>n[0]).join('').slice(0,2)}</div>
      <div><div style="font-size:13px;font-weight:500;color:var(--text1)">${u.name}</div><div class="text-xs">${u.email||'â€”'}</div></div>
    </div></td>
    <td><span class="badge badge-default">${u.role}</span></td>
    <td>${counts[u.name]||0}</td>
    <td>${last[u.name]?fmtDate(last[u.name]):'Never'}</td>
    <td><span class="badge badge-success">Active</span></td>
  </tr>`).join('');
}

function openAddUserModal() { document.getElementById('user-modal-overlay').classList.add('open'); }
function addUser() {
  const name=document.getElementById('nu-name').value.trim();
  if(!name){ toast('Name is required','error'); return; }
  users.push({ id:genId(), name, role:document.getElementById('nu-role').value, email:document.getElementById('nu-email').value, createdAt:new Date().toISOString(), active:true });
  save();
  document.getElementById('user-modal-overlay').classList.remove('open');
  renderUsers();
  toast('User added');
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
function saveSettings() {
  settings.username=document.getElementById('set-username').value||'Admin User';
  settings.role=document.getElementById('set-role').value;
  settings.backup=document.getElementById('set-backup').value;
  settings.defaultStatus=document.getElementById('set-default-status').value;
  save();
  document.getElementById('sidebar-username').textContent=settings.username;
  document.getElementById('sidebar-role').textContent=settings.role;
  document.getElementById('sidebar-avatar').textContent=settings.username.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
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
function seedData() {
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

function clearAllData() {
  if(!confirm('This will permanently delete ALL records and audit logs. Are you sure?')) return;
  records=[]; auditLog=[];
  save(); renderDashboard(); renderRecordsTable();
  document.getElementById('nav-count').textContent=0;
  toast('All data cleared','info');
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('sidebar-username').textContent=settings.username;
  document.getElementById('sidebar-role').textContent=settings.role;
  document.getElementById('sidebar-avatar').textContent=settings.username.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('nav-count').textContent=records.length;
  renderDashboard();
  autoBackup();
});

// Keyboard shortcuts
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='k'){ e.preventDefault(); document.getElementById('global-search').focus(); }
  if((e.ctrlKey||e.metaKey)&&e.key==='n'){ e.preventDefault(); openModal('add'); }
  if(e.key==='Escape'){ closeModal(); closeViewModal(); closeSidebar(); }
});

