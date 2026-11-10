import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import '../style/ReportsPage.css';

function fmtDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  }
  if (typeof v === 'object' && v.seconds) return fmtDate(v.seconds*1000);
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[3]+'/'+m[2]+'/'+m[1];
  return s;
}

function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'object' && ts.seconds ? ts.seconds*1000 : ts);
  if (isNaN(d.getTime())) return '';
  return fmtDate(d.getTime())+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
}

function toInputDate(v) {
  const f = fmtDate(v);
  const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return m[3]+'-'+m[2]+'-'+m[1];
}

function parseDateVal(v) {
  if (!v) return null;
  if (typeof v === 'number') { const d=new Date(v); return isNaN(d.getTime())?null:d; }
  if (typeof v === 'object' && v.seconds) return new Date(v.seconds*1000);
  const s = String(v).trim();
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return new Date(+dmy[3], +dmy[2]-1, +dmy[1]);
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function inDateRange(rawVal, from, to) {
  if (!from && !to) return true;
  const ds = toInputDate(rawVal);
  if (!ds) return true;
  if (from && ds < from) return false;
  if (to && ds > to) return false;
  return true;
}

function calcOverdue(deadlineRaw, status) {
  if (status === 'Completed') return '';
  const dl = parseDateVal(deadlineRaw);
  if (!dl) return '';
  const now = new Date();
  now.setHours(0,0,0,0);
  dl.setHours(0,0,0,0);
  const diff = Math.floor((now - dl) / 86400000);
  if (diff <= 0) return '';
  return diff + ' day(s)';
}

function PieChart({ slices, size=150 }) {
  const total = slices.reduce((s,x)=>s+(x.value||0),0);
  const cx=size/2, cy=size/2, r=size*0.42;
  if (total===0) return (
    <svg width={size} height={size}><circle cx={cx} cy={cy} r={r} fill="#f1f5f9"/><text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="11" fill="#94a3b8">No Data</text></svg>
  );
  const valid = slices.filter(s=>s.value>0);
  if (valid.length===1) return (
    <svg width={size} height={size}><circle cx={cx} cy={cy} r={r} fill={valid[0].color}/><text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="700" fill="#fff">100%</text></svg>
  );
  let angle = -Math.PI/2;
  return (
    <svg width={size} height={size}>
      {valid.map((sl,i)=>{
        const a = (sl.value/total)*2*Math.PI;
        const x1=cx+r*Math.cos(angle), y1=cy+r*Math.sin(angle);
        const x2=cx+r*Math.cos(angle+a), y2=cy+r*Math.sin(angle+a);
        const large=a>Math.PI?1:0;
        const d=`M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x2} ${y2}Z`;
        const mid=angle+a/2;
        const pct=Math.round((sl.value/total)*100);
        angle+=a;
        return (
          <g key={i}>
            <path d={d} fill={sl.color} stroke="#fff" strokeWidth="2"/>
            {pct>=7&&<text x={cx+r*0.62*Math.cos(mid)} y={cy+r*0.62*Math.sin(mid)} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700" fill="#fff">{pct}%</text>}
          </g>
        );
      })}
    </svg>
  );
}

function exportToExcel(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename+'.xlsx');
}

const STATUS_COLORS = {
  Assigned:           { bg:'#e0f2fe', color:'#0369a1' },
  'In Progress':      { bg:'#dbeafe', color:'#1d4ed8' },
  'On Hold':          { bg:'#fef3c7', color:'#b45309' },
  'Pending Approval': { bg:'#fdf4ff', color:'#9333ea' },
  'Revision Required':{ bg:'#fff1f2', color:'#be185d' },
  Completed:          { bg:'#dcfce7', color:'#15803d' },
  Active:             { bg:'#dcfce7', color:'#15803d' },
};

export default function ReportsPage({ currentUser, employees, tasks, projects, projectDetails, activityLogs, isAdmin, showSnack }) {
  // staged filter inputs (not applied until Apply is clicked)
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterEmpName, setFilterEmpName] = useState('');
  const [filterEmpId, setFilterEmpId] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  // applied filter state (drives card results)
  const [applied, setApplied] = useState(null);

  function getDetail(name) {
    return projectDetails.find(d=>String(d.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())||null;
  }

  // Build unique project names from projectDetails only — the authoritative source.
  // Using a case-insensitive dedup map so the same project is never counted twice.
  const allProjectNames = useMemo(()=>{
    const seen = new Map(); // normalizedName -> displayName
    projectDetails.forEach(d=>{
      const name = String(d.name||'').trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    });
    return Array.from(seen.values());
  }, [projectDetails]);

  const empOptions = useMemo(()=>Array.from(new Set(employees.map(e=>e['Employee Name']).filter(Boolean))).sort(),[employees]);
  const empIdOptions = useMemo(()=>Array.from(new Set(employees.map(e=>e['Employee ID']).filter(Boolean))).sort(),[employees]);
  const projOptions = useMemo(()=>allProjectNames.slice().sort(),[allProjectNames]);

  // ---- Dashboard Summary ----
  // Computed directly from projectDetails to avoid double-counting.
  // Each doc in projectDetails is one unique project record.
  const dashMetrics = useMemo(()=>{
    // Deduplicate by normalized name, keeping the latest doc per project.
    const byName = new Map();
    projectDetails.forEach(d=>{
      const key = String(d.name||'').trim().toLowerCase();
      if (!key) return;
      // Prefer the doc with a status field; if tie, keep last seen
      if (!byName.has(key) || d.status) byName.set(key, d);
    });
    const docs = Array.from(byName.values());
    const total = docs.length;
    const completed = docs.filter(d=>d.status==='Completed').length;
    const inProgress = docs.filter(d=>d.status==='In Progress').length;
    const onHold = docs.filter(d=>d.status==='On Hold').length;
    const pendingApproval = docs.filter(d=>d.status==='Pending Approval').length;
    const now = new Date(); now.setHours(0,0,0,0);
    const overdue = docs.filter(d=>{
      if (!d.deadline || d.status==='Completed') return false;
      return !!calcOverdue(d.deadline, d.status||'');
    }).length;
    return { total, completed, inProgress, onHold, pendingApproval, overdue };
  }, [projectDetails]);

  const statusDistSlices = useMemo(()=>[
    { label:'Completed', value:dashMetrics.completed, color:'#10b981' },
    { label:'In Progress', value:dashMetrics.inProgress, color:'#3b82f6' },
    { label:'On Hold', value:dashMetrics.onHold, color:'#f59e0b' },
    { label:'Pending Approval', value:dashMetrics.pendingApproval, color:'#8b5cf6' },
    { label:'Other', value:Math.max(0,dashMetrics.total-dashMetrics.completed-dashMetrics.inProgress-dashMetrics.onHold-dashMetrics.pendingApproval), color:'#94a3b8' },
  ], [dashMetrics]);

  // ---- Project Report rows (driven by applied filters) ----
  const projectRows = useMemo(()=>{
    const f = applied || {};
    return allProjectNames.filter(name=>{
      if (f.filterProject && name!==f.filterProject) return false;
      const d=getDetail(name);
      if (f.filterStatus && (d?.status||'')!==f.filterStatus) return false;
      if (f.filterEmpName) {
        const hasEmp = tasks.some(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()&&(t['Employee Name']||'')===f.filterEmpName);
        if (!hasEmp) return false;
      }
      if (f.filterEmpId) {
        const hasEmp = tasks.some(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()&&(t['Employee ID']||'')===f.filterEmpId);
        if (!hasEmp) return false;
      }
      if (!inDateRange(d?.startDate||d?.createdAt, f.fromDate, f.toDate)) return false;
      return true;
    }).map(name=>{
      const d=getDetail(name);
      const projTasks = tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase());
      const assignedEmps = Array.from(new Set(projTasks.map(t=>t['Employee Name']||'').filter(Boolean)));
      const assignedIds = Array.from(new Set(projTasks.map(t=>t['Employee ID']||'').filter(Boolean)));
      const totalTasks = projTasks.length;
      const doneTasks = projTasks.filter(t=>String(t.status||'').toLowerCase()==='completed').length;
      const progress = totalTasks===0 ? 0 : Math.round((doneTasks/totalTasks)*100);
      const taskStatuses = Array.from(new Set(projTasks.map(t=>t.status||'').filter(Boolean)));
      const overdueDuration = d?.deadline ? calcOverdue(d.deadline, d?.status||'') : '';
      return {
        projectName: name,
        assignedEmployee: assignedEmps.join(', ')||'—',
        assignedIds: assignedIds.join(', ')||'—',
        assignedDate: fmtDate(d?.startDate||d?.createdAt)||'—',
        originalDeadline: d?.deadline||'—',
        currentStatus: d?.status||'—',
        completionDate: d?.approvedAt ? fmtDateTime(d.approvedAt) : (d?.status==='Completed' ? fmtDate(d?.updatedAt||'')||'—' : '—'),
        overdueDuration: overdueDuration||'On Time',
        isOverdue: !!overdueDuration,
        progress,
        totalTasks,
        doneTasks,
        taskStatuses,
      };
    });
  }, [applied, allProjectNames, projectDetails, tasks]);

  function handleExport() {
    if (!projectRows.length) { showSnack('No data to export','info'); return; }
    exportToExcel(projectRows.map(r=>({
      'Project Name': r.projectName,
      'Assigned Employee': r.assignedEmployee,
      'Employee ID': r.assignedIds,
      'Assigned Date': r.assignedDate,
      'Original Deadline': r.originalDeadline,
      'Current Status': r.currentStatus,
      'Completion Date': r.completionDate,
      'Overdue Duration': r.overdueDuration,
      'Progress': r.progress+'%',
    })), 'Project_Report');
  }

  function applyFilters() {
    setApplied({ fromDate, toDate, filterEmpName, filterEmpId, filterProject, filterStatus });
  }

  function resetFilters() {
    setFromDate(''); setToDate(''); setFilterEmpName(''); setFilterEmpId('');
    setFilterProject(''); setFilterStatus('');
    setApplied(null);
  }

  const hasFilters = fromDate||toDate||filterEmpName||filterEmpId||filterProject||filterStatus;

  if (!isAdmin) {
    return (
      <div className="rp-wrapper">
        <div className="rp-access-denied">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <h3>Access Restricted</h3>
          <p>Only Admin users can access the Reports module.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rp-wrapper rp-print-area">
      {/* Header */}
      <div className="rp-header rp-no-print">
        <div>
          <h2 className="rp-title">Reports</h2>
          <p className="rp-subtitle">Admin analytics — all data from live database</p>
        </div>
        <div className="rp-export-btns">
          <button className="rp-export-btn rp-export-excel" onClick={handleExport}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Export Excel
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="rp-summary-cards rp-no-print">
        {[
          { label:'Total Projects', value:dashMetrics.total, color:'#3b82f6' },
          { label:'Completed', value:dashMetrics.completed, color:'#10b981' },
          { label:'In Progress', value:dashMetrics.inProgress, color:'#2563eb' },
          { label:'On Hold', value:dashMetrics.onHold, color:'#f59e0b' },
          { label:'Pending Approval', value:dashMetrics.pendingApproval, color:'#8b5cf6' },
          { label:'Overdue', value:dashMetrics.overdue, color:'#ef4444' },
        ].map(c=>(
          <div key={c.label} className="rp-summary-card" style={{borderTop:`3px solid ${c.color}`}}>
            <div className="rp-summary-num" style={{color:c.color}}>{c.value}</div>
            <div className="rp-summary-label">{c.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="rp-charts-row rp-no-print">
        <div className="rp-chart-card">
          <h4 className="rp-chart-title">Project Status Distribution</h4>
          <div className="rp-chart-inner">
            <PieChart slices={statusDistSlices} size={150}/>
            <div className="rp-legend">
              {statusDistSlices.filter(s=>s.value>0).map((s,i)=>(
                <div key={i} className="rp-legend-item">
                  <span className="rp-legend-dot" style={{background:s.color}}/>
                  <span className="rp-legend-label">{s.label}</span>
                  <span className="rp-legend-val">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="rp-chart-card">
          <h4 className="rp-chart-title">Employee Performance Overview</h4>
          <div className="rp-chart-inner">
            <PieChart slices={[
              { label:'Completed Tasks', value:tasks.filter(t=>String(t.status||'').toLowerCase()==='completed').length, color:'#10b981' },
              { label:'In Progress', value:tasks.filter(t=>String(t.status||'').toLowerCase().includes('progress')).length, color:'#3b82f6' },
              { label:'Pending', value:tasks.filter(t=>String(t.status||'').toLowerCase()==='pending').length, color:'#f59e0b' },
            ]} size={150}/>
            <div className="rp-legend">
              {[
                { label:'Completed', value:tasks.filter(t=>String(t.status||'').toLowerCase()==='completed').length, color:'#10b981' },
                { label:'In Progress', value:tasks.filter(t=>String(t.status||'').toLowerCase().includes('progress')).length, color:'#3b82f6' },
                { label:'Pending', value:tasks.filter(t=>String(t.status||'').toLowerCase()==='pending').length, color:'#f59e0b' },
              ].map((s,i)=>(
                <div key={i} className="rp-legend-item">
                  <span className="rp-legend-dot" style={{background:s.color}}/>
                  <span className="rp-legend-label">{s.label}</span>
                  <span className="rp-legend-val">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="rp-filters rp-no-print">
        <div className="rp-filter-group">
          <label className="rp-filter-label">From Date</label>
          <input type="date" className="rp-filter-input" value={fromDate} onChange={e=>setFromDate(e.target.value)}/>
        </div>
        <div className="rp-filter-group">
          <label className="rp-filter-label">To Date</label>
          <input type="date" className="rp-filter-input" value={toDate} min={fromDate||undefined} onChange={e=>setToDate(e.target.value)}/>
        </div>
        <div className="rp-filter-group">
          <label className="rp-filter-label">Employee Name</label>
          <select className="rp-filter-select" value={filterEmpName} onChange={e=>setFilterEmpName(e.target.value)}>
            <option value="">All Employees</option>
            {empOptions.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="rp-filter-group">
          <label className="rp-filter-label">Employee ID</label>
          <select className="rp-filter-select" value={filterEmpId} onChange={e=>setFilterEmpId(e.target.value)}>
            <option value="">All IDs</option>
            {empIdOptions.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="rp-filter-group">
          <label className="rp-filter-label">Project</label>
          <select className="rp-filter-select" value={filterProject} onChange={e=>setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {projOptions.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="rp-filter-group">
          <label className="rp-filter-label">Project Status</label>
          <select className="rp-filter-select" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {['Assigned','In Progress','On Hold','Pending Approval','Revision Required','Completed'].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="rp-filter-actions">
          <button className="rp-apply-btn" onClick={applyFilters}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Apply Filters
          </button>
          <button className="rp-reset-btn" onClick={resetFilters}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            Reset
          </button>
        </div>
      </div>

      {/* Results: cards when filters applied, table by default */}
      {applied ? (
        <div className="rp-results-section">
          <div className="rp-results-header">
            <h3 className="rp-results-title">
              Filtered Results
              <span className="rp-results-count">({projectRows.length} Record{projectRows.length!==1?'s':''} Found)</span>
            </h3>
          </div>
          {projectRows.length===0 ? (
            <div className="rp-no-records">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <p>No Records Found</p>
              <span>Try adjusting your filter criteria.</span>
            </div>
          ) : (
            <div className="rp-rows-list">
              {projectRows.map((r,i)=>{
                const sc = STATUS_COLORS[r.currentStatus]||{bg:'#f1f5f9',color:'#475569'};
                const progressColor = r.progress===100?'#16a34a':r.progress>=60?'#2563eb':'#3b82f6';
                const taskSc = STATUS_COLORS[r.taskStatuses[0]]||{bg:'#f1f5f9',color:'#475569'};
                return (
                  <div key={i} className="rp-result-row">
                    {/* Employee */}
                    <div className="rp-rr-emp">
                      <div className="rp-rr-avatar">
                        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#2563eb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                      </div>
                      <div>
                        <div className="rp-rr-name">{r.assignedEmployee}</div>
                        <div className="rp-rr-id">{r.assignedIds}</div>
                      </div>
                    </div>
                    <div className="rp-rr-divider"/>
                    {/* Project + Dates */}
                    <div className="rp-rr-proj">
                      <div className="rp-rr-proj-name">Project: {r.projectName}</div>
                      <div className="rp-rr-dates">
                        <span className="rp-rr-date-item">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                          Start: {r.assignedDate}
                        </span>
                        <span className="rp-rr-date-item">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          Deadline: {fmtDate(r.originalDeadline)}
                        </span>
                      </div>
                    </div>
                    <div className="rp-rr-divider"/>
                    {/* Status + Progress */}
                    <div className="rp-rr-status">
                      <span className="rp-status-badge" style={{background:sc.bg,color:sc.color}}>
                        {r.currentStatus==='Completed'&&<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:4,verticalAlign:'middle'}}><polyline points="20 6 9 17 4 12"/></svg>}
                        {r.currentStatus}
                      </span>
                      <div className="rp-rr-prog-wrap">
                        <div className="rp-rr-prog-track">
                          <div className="rp-rr-prog-fill" style={{width:r.progress+'%',background:progressColor}}/>
                        </div>
                        <span className="rp-rr-prog-pct" style={{color:progressColor}}>{r.progress}%</span>
                      </div>
                    </div>
                    <div className="rp-rr-divider"/>
                    {/* Task Status */}
                    <div className="rp-rr-task">
                      <div className="rp-rr-task-label">Task Status</div>
                      {r.taskStatuses.length ? r.taskStatuses.map((ts,j)=>{
                        const tsc = STATUS_COLORS[ts]||{bg:'#f1f5f9',color:'#475569'};
                        return <span key={j} className="rp-status-badge" style={{background:tsc.bg,color:tsc.color,display:'block',marginTop:j>0?4:0}}>{ts}</span>;
                      }) : <span className="rp-rr-task-label">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      <div className="rp-table-card">
        <div className="rp-table-header">
          <h3 className="rp-table-title">Project Report</h3>
          <span className="rp-row-count">{projectRows.length} records</span>
        </div>
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead><tr>
              <th>S.No</th>
              <th>Project Name</th>
              <th>Assigned Employee</th>
              <th>Assigned Date</th>
              <th>Original Deadline</th>
              <th>Current Status</th>
              <th>Completion Date</th>
              <th>Overdue Duration</th>
            </tr></thead>
            <tbody>
              {projectRows.length===0
                ? <tr><td colSpan={8} className="rp-empty">No data found</td></tr>
                : projectRows.map((r,i)=>{
                    const sc=STATUS_COLORS[r.currentStatus]||{bg:'#f1f5f9',color:'#475569'};
                    return (
                      <tr key={i} className="rp-tr">
                        <td>{i+1}</td>
                        <td className="rp-td-name">{r.projectName}</td>
                        <td>{r.assignedEmployee}</td>
                        <td>{r.assignedDate}</td>
                        <td>{r.originalDeadline}</td>
                        <td><span className="rp-status-badge" style={{background:sc.bg,color:sc.color}}>{r.currentStatus}</span></td>
                        <td>{r.completionDate}</td>
                        <td><span className={r.isOverdue?'rp-overdue-badge':'rp-ontime-badge'}>{r.overdueDuration}</span></td>
                      </tr>
                    );
                  })
              }
            </tbody>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}
