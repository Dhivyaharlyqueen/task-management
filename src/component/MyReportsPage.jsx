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
  if (dmy) return new Date(+dmy[3],+dmy[2]-1,+dmy[1]);
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(+ymd[1],+ymd[2]-1,+ymd[3]);
  const d = new Date(s);
  return isNaN(d.getTime())?null:d;
}

function inRange(rawVal, from, to) {
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
  const now = new Date(); now.setHours(0,0,0,0); dl.setHours(0,0,0,0);
  const diff = Math.floor((now-dl)/86400000);
  return diff > 0 ? diff+' day(s)' : '';
}

function calcDaysLeft(deadlineRaw, status) {
  if (status === 'Completed') return '';
  const dl = parseDateVal(deadlineRaw);
  if (!dl) return '';
  const now = new Date(); now.setHours(0,0,0,0); dl.setHours(0,0,0,0);
  const diff = Math.floor((dl-now)/86400000);
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Due Today';
  return diff+' day(s) left';
}

function exportToExcel(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename+'.xlsx');
}

function exportToPDF(title) {
  const prev = document.title;
  document.title = title;
  window.print();
  setTimeout(()=>{ document.title = prev; }, 1000);
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

const MY_REPORT_TYPES = [
  { key:'project',     label:'My Projects' },
  { key:'task',        label:'My Tasks' },
  { key:'daily',       label:'Daily Activity' },
  { key:'performance', label:'My Performance' },
  { key:'submission',  label:'My Submissions' },
  { key:'deadline',    label:'My Deadlines' },
];

export default function MyReportsPage({ currentUser, tasks, projectDetails, activityLogs, showSnack }) {
  const myEmail = String(currentUser?.email || '').toLowerCase();
  const [activeReport, setActiveReport] = useState('project');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterTaskStatus, setFilterTaskStatus] = useState('');
  const [filterProjStatus, setFilterProjStatus] = useState('');
  const [filterSubStatus, setFilterSubStatus] = useState('');

  // Scope all tasks to current user only
  const myTasks = useMemo(()=>
    tasks.filter(t=>String(t.userEmail||'').toLowerCase()===myEmail),
    [tasks, myEmail]
  );

  // My project names (from tasks)
  const myProjectNames = useMemo(()=>
    Array.from(new Set(myTasks.map(t=>String(t.Project||'').trim()).filter(Boolean))).sort(),
    [myTasks]
  );

  // Get project_details doc for a project (user-scoped first, then global)
  function getDetail(name) {
    const lower = String(name||'').trim().toLowerCase();
    const userDoc = projectDetails.find(d=>
      String(d.name||'').trim().toLowerCase()===lower &&
      String(d.userEmail||'').toLowerCase()===myEmail
    );
    return userDoc || projectDetails.find(d=>String(d.name||'').trim().toLowerCase()===lower) || null;
  }

  // Project progress for my tasks only
  function myProgress(name) {
    const pt = myTasks.filter(t=>String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
    if (!pt.length) return 0;
    return Math.round((pt.filter(t=>String(t.status||'').toLowerCase()==='completed').length/pt.length)*100);
  }

  // Earliest task date for a project = assigned date
  function myAssignedDate(name) {
    const pt = myTasks.filter(t=>String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
    if (!pt.length) return '';
    const sorted = [...pt].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    return fmtDate(sorted[0].Date||sorted[0].createdAt);
  }

  // 1. My Project Report
  const projectRows = useMemo(()=>
    myProjectNames.filter(name=>{
      if (filterProject && name!==filterProject) return false;
      const d = getDetail(name);
      if (filterProjStatus && (d?.status||'')!==filterProjStatus) return false;
      if (!inRange(d?.startDate||d?.createdAt, fromDate, toDate)) return false;
      return true;
    }).map(name=>{
      const d = getDetail(name);
      return {
        projectName: name,
        description: d?.description||'—',
        assignedDate: myAssignedDate(name)||'—',
        originalDeadline: d?.deadline||'—',
        currentStatus: d?.status||'—',
        progressPercent: myProgress(name)+'%',
      };
    }),
    [myProjectNames, projectDetails, filterProject, filterProjStatus, fromDate, toDate, myTasks]
  );

  // 2. My Task Report
  const taskRows = useMemo(()=>
    myTasks.filter(t=>{
      if (filterProject && (t.Project||'')!==filterProject) return false;
      if (filterTaskStatus && String(t.status||'').toLowerCase()!==filterTaskStatus.toLowerCase()) return false;
      if (!inRange(t.Date||t.createdAt, fromDate, toDate)) return false;
      return true;
    }).map(t=>{
      const st = String(t.status||'').toLowerCase();
      const completionDate = st==='completed' ? fmtDate(t.Date||t.createdAt)||'—' : '—';
      return {
        taskName: (t['Task Done']||'').split('\n')[0].slice(0,80)||'—',
        taskDescription: t['Task Done']||'—',
        projectName: t.Project||'—',
        taskAssignedDate: fmtDate(t.Date||t.createdAt)||'—',
        taskStatus: t.status||'—',
        completionDate,
      };
    }),
    [myTasks, filterProject, filterTaskStatus, fromDate, toDate]
  );

  // 3. My Daily Activity Report
  const dailyRows = useMemo(()=>
    myTasks.filter(t=>{
      if (filterProject && (t.Project||'')!==filterProject) return false;
      if (!inRange(t.Date||t.createdAt, fromDate, toDate)) return false;
      return true;
    }).map(t=>{
      const s = t.startTime ? new Date(t.startTime) : null;
      const e = t.endTime ? new Date(t.endTime) : null;
      const hrs = (s&&e&&!isNaN(s)&&!isNaN(e)&&e>s) ? ((e-s)/3600000).toFixed(1)+'h' : '—';
      return {
        activityDate: fmtDate(t.Date||t.createdAt)||'—',
        projectName: t.Project||'—',
        taskName: (t['Task Done']||'').split('\n')[0].slice(0,60)||'—',
        startTime: t.startTime||'—',
        endTime: t.endTime||'—',
        totalWorkingHours: hrs,
      };
    }),
    [myTasks, filterProject, fromDate, toDate]
  );

  // 4. My Performance Report (single summary object)
  const perfData = useMemo(()=>{
    const totalProjects = myProjectNames.length;
    const completedProjects = myProjectNames.filter(n=>getDetail(n)?.status==='Completed').length;
    const inProgressProjects = myProjectNames.filter(n=>getDetail(n)?.status==='In Progress').length;
    const onHoldProjects = myProjectNames.filter(n=>getDetail(n)?.status==='On Hold').length;
    const pendingApproval = myProjectNames.filter(n=>getDetail(n)?.status==='Pending Approval').length;
    const revisionRequired = myProjectNames.filter(n=>getDetail(n)?.status==='Revision Required').length;
    const totalTasks = myTasks.length;
    const completedTasks = myTasks.filter(t=>String(t.status||'').toLowerCase()==='completed').length;
    const taskCompletionPct = totalTasks===0?0:Math.round((completedTasks/totalTasks)*100);
    return { totalProjects, completedProjects, inProgressProjects, onHoldProjects, pendingApproval, revisionRequired, totalTasks, completedTasks, taskCompletionPct };
  }, [myProjectNames, myTasks, projectDetails]);

  // 5. My Submission Report
  const submissionRows = useMemo(()=>
    myProjectNames.filter(name=>{
      const d = getDetail(name);
      if (!d?.submittedAt && d?.status!=='Completed' && d?.status!=='Pending Approval' && d?.status!=='Revision Required') return false;
      if (filterProject && name!==filterProject) return false;
      if (filterSubStatus) {
        const st = d?.status||'';
        if (filterSubStatus==='Pending' && st!=='Pending Approval') return false;
        if (filterSubStatus==='Approved' && st!=='Completed') return false;
        if (filterSubStatus==='Revision' && st!=='Revision Required') return false;
      }
      if (!inRange(d?.submittedAt, fromDate, toDate)) return false;
      return true;
    }).map(name=>{
      const d = getDetail(name);
      let submissionStatus = '—';
      if (d?.status==='Pending Approval') submissionStatus = 'Pending Review';
      else if (d?.status==='Completed') submissionStatus = 'Approved';
      else if (d?.status==='Revision Required') submissionStatus = 'Revision Required';
      else if (d?.submittedAt) submissionStatus = 'Submitted';
      return {
        projectName: name,
        submissionDate: d?.submittedAt ? fmtDateTime(d.submittedAt) : '—',
        submissionStatus,
        adminApprovalStatus: d?.status==='Completed' ? 'Approved' : d?.status==='Revision Required' ? 'Rejected' : 'Pending',
        adminRemarks: d?.adminRemark||'—',
        approvalDate: d?.approvedAt ? fmtDateTime(d.approvedAt) : '—',
      };
    }),
    [myProjectNames, projectDetails, filterProject, filterSubStatus, fromDate, toDate]
  );

  // 6. My Deadline Report
  const deadlineRows = useMemo(()=>
    myProjectNames.filter(name=>{
      const d = getDetail(name);
      if (!d?.deadline) return false;
      if (filterProject && name!==filterProject) return false;
      if (filterProjStatus && (d?.status||'')!==filterProjStatus) return false;
      return true;
    }).map(name=>{
      const d = getDetail(name);
      const overdue = calcOverdue(d?.deadline, d?.status||'');
      const daysLeft = calcDaysLeft(d?.deadline, d?.status||'');
      return {
        projectName: name,
        originalDeadline: d?.deadline||'—',
        upcomingDeadline: daysLeft||'—',
        overdueStatus: overdue ? 'Overdue ('+overdue+')' : (d?.status==='Completed'?'Completed':'On Time'),
        currentStatus: d?.status||'—',
        isOverdue: !!overdue,
      };
    }),
    [myProjectNames, projectDetails, filterProject, filterProjStatus]
  );

  function getActiveRows() {
    switch(activeReport) {
      case 'project': return projectRows.map(r=>({'Project Name':r.projectName,'Description':r.description,'Assigned Date':r.assignedDate,'Original Deadline':r.originalDeadline,'Status':r.currentStatus,'Progress':r.progressPercent}));
      case 'task': return taskRows.map(r=>({'Task Name':r.taskName,'Description':r.taskDescription,'Project':r.projectName,'Assigned Date':r.taskAssignedDate,'Status':r.taskStatus,'Completion Date':r.completionDate}));
      case 'daily': return dailyRows.map(r=>({'Date':r.activityDate,'Project':r.projectName,'Task':r.taskName,'Start Time':r.startTime,'End Time':r.endTime,'Total Hours':r.totalWorkingHours}));
      case 'performance': return [{'Total Projects':perfData.totalProjects,'Completed Projects':perfData.completedProjects,'In Progress':perfData.inProgressProjects,'On Hold':perfData.onHoldProjects,'Pending Approval':perfData.pendingApproval,'Revision Required':perfData.revisionRequired,'Total Tasks':perfData.totalTasks,'Completed Tasks':perfData.completedTasks,'Task Completion %':perfData.taskCompletionPct+'%'}];
      case 'submission': return submissionRows.map(r=>({'Project Name':r.projectName,'Submission Date':r.submissionDate,'Submission Status':r.submissionStatus,'Admin Approval':r.adminApprovalStatus,'Admin Remarks':r.adminRemarks,'Approval Date':r.approvalDate}));
      case 'deadline': return deadlineRows.map(r=>({'Project Name':r.projectName,'Original Deadline':r.originalDeadline,'Upcoming Deadline':r.upcomingDeadline,'Overdue Status':r.overdueStatus,'Current Status':r.currentStatus}));
      default: return [];
    }
  }

  function handleExport(type) {
    const rows = getActiveRows();
    if (!rows.length) { showSnack('No data to export','info'); return; }
    const label = MY_REPORT_TYPES.find(r=>r.key===activeReport)?.label||activeReport;
    const filename = 'My_'+label.replace(/\s+/g,'_')+'_Report';
    if (type==='excel') exportToExcel(rows, filename);
    else exportToPDF('My '+label+' Report');
  }

  function clearFilters() {
    setFromDate(''); setToDate(''); setFilterProject('');
    setFilterTaskStatus(''); setFilterProjStatus(''); setFilterSubStatus('');
  }

  const hasFilters = fromDate||toDate||filterProject||filterTaskStatus||filterProjStatus||filterSubStatus;

  const activeCount = (() => {
    switch(activeReport) {
      case 'project': return projectRows.length;
      case 'task': return taskRows.length;
      case 'daily': return dailyRows.length;
      case 'performance': return 1;
      case 'submission': return submissionRows.length;
      case 'deadline': return deadlineRows.length;
      default: return 0;
    }
  })();

  return (
    <div className="rp-wrapper">
      {/* Header */}
      <div className="rp-header rp-no-print">
        <div>
          <h2 className="rp-title">My Reports</h2>
          <p className="rp-subtitle">Your personal reports — only your own data</p>
        </div>
        <div className="rp-export-btns">
          <button className="rp-export-btn rp-export-excel" onClick={()=>handleExport('excel')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Excel
          </button>
          <button className="rp-export-btn rp-export-pdf" onClick={()=>handleExport('pdf')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            PDF
          </button>
        </div>
      </div>

      {/* Report Tabs */}
      <div className="rp-tabs rp-no-print">
        {MY_REPORT_TYPES.map(r=>(
          <button key={r.key} className={'rp-tab'+(activeReport===r.key?' active':'')} onClick={()=>setActiveReport(r.key)}>
            {r.label}
          </button>
        ))}
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
          <label className="rp-filter-label">Project</label>
          <select className="rp-filter-select" value={filterProject} onChange={e=>setFilterProject(e.target.value)}>
            <option value="">All Projects</option>
            {myProjectNames.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {(activeReport==='task'||activeReport==='daily') && (
          <div className="rp-filter-group">
            <label className="rp-filter-label">Task Status</label>
            <select className="rp-filter-select" value={filterTaskStatus} onChange={e=>setFilterTaskStatus(e.target.value)}>
              <option value="">All</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        )}
        {(activeReport==='project'||activeReport==='deadline') && (
          <div className="rp-filter-group">
            <label className="rp-filter-label">Project Status</label>
            <select className="rp-filter-select" value={filterProjStatus} onChange={e=>setFilterProjStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {['Assigned','In Progress','On Hold','Pending Approval','Revision Required','Completed'].map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
        {activeReport==='submission' && (
          <div className="rp-filter-group">
            <label className="rp-filter-label">Submission Status</label>
            <select className="rp-filter-select" value={filterSubStatus} onChange={e=>setFilterSubStatus(e.target.value)}>
              <option value="">All</option>
              <option value="Pending">Pending Review</option>
              <option value="Approved">Approved</option>
              <option value="Revision">Revision Required</option>
            </select>
          </div>
        )}
        {hasFilters && <button className="rp-clear-btn" onClick={clearFilters}>Clear</button>}
      </div>

      {/* Performance Report — card layout */}
      {activeReport==='performance' && (
        <div className="mrp-perf-section">
          <div className="mrp-perf-grid">
            {[
              { label:'Total Projects', value:perfData.totalProjects, color:'#3b82f6' },
              { label:'Completed Projects', value:perfData.completedProjects, color:'#10b981' },
              { label:'In Progress', value:perfData.inProgressProjects, color:'#2563eb' },
              { label:'On Hold', value:perfData.onHoldProjects, color:'#f59e0b' },
              { label:'Pending Approval', value:perfData.pendingApproval, color:'#8b5cf6' },
              { label:'Revision Required', value:perfData.revisionRequired, color:'#ef4444' },
              { label:'Total Tasks', value:perfData.totalTasks, color:'#0284c7' },
              { label:'Completed Tasks', value:perfData.completedTasks, color:'#16a34a' },
            ].map(c=>(
              <div key={c.label} className="rp-summary-card" style={{borderTop:`3px solid ${c.color}`}}>
                <div className="rp-summary-num" style={{color:c.color}}>{c.value}</div>
                <div className="rp-summary-label">{c.label}</div>
              </div>
            ))}
          </div>
          <div className="mrp-completion-bar-wrap">
            <div className="mrp-completion-label">
              <span>Task Completion Rate</span>
              <strong>{perfData.taskCompletionPct}%</strong>
            </div>
            <div className="mrp-completion-track">
              <div className="mrp-completion-fill" style={{width:perfData.taskCompletionPct+'%', background: perfData.taskCompletionPct===100?'#10b981':perfData.taskCompletionPct>=60?'#3b82f6':'#f59e0b'}}/>
            </div>
          </div>
        </div>
      )}

      {/* Table Card */}
      {activeReport !== 'performance' && (
        <div className="rp-table-card">
          <div className="rp-table-header">
            <h3 className="rp-table-title">{MY_REPORT_TYPES.find(r=>r.key===activeReport)?.label}</h3>
            <span className="rp-row-count">{activeCount} records</span>
          </div>
          <div className="rp-table-wrap">

            {activeReport==='project' && (
              <table className="rp-table">
                <thead><tr><th>S.No</th><th>Project Name</th><th>Description</th><th>Assigned Date</th><th>Deadline</th><th>Status</th><th>Progress</th></tr></thead>
                <tbody>
                  {projectRows.length===0 ? <tr><td colSpan={7} className="rp-empty">No projects found</td></tr> :
                    projectRows.map((r,i)=>{
                      const sc=STATUS_COLORS[r.currentStatus]||{bg:'#f1f5f9',color:'#475569'};
                      const pct=parseInt(r.progressPercent)||0;
                      return (
                        <tr key={i} className="rp-tr">
                          <td>{i+1}</td>
                          <td className="rp-td-name">{r.projectName}</td>
                          <td className="rp-td-task">{r.description}</td>
                          <td>{r.assignedDate}</td>
                          <td>{r.originalDeadline}</td>
                          <td><span className="rp-status-badge" style={{background:sc.bg,color:sc.color}}>{r.currentStatus}</span></td>
                          <td>
                            <div className="mrp-prog-wrap">
                              <div className="mrp-prog-track"><div className="mrp-prog-fill" style={{width:pct+'%',background:pct===100?'#10b981':pct>=60?'#3b82f6':'#f59e0b'}}/></div>
                              <span className="mrp-prog-pct">{r.progressPercent}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            )}

            {activeReport==='task' && (
              <table className="rp-table">
                <thead><tr><th>S.No</th><th>Task Name</th><th>Project</th><th>Assigned Date</th><th>Status</th><th>Completion Date</th></tr></thead>
                <tbody>
                  {taskRows.length===0 ? <tr><td colSpan={6} className="rp-empty">No tasks found</td></tr> :
                    taskRows.map((r,i)=>(
                      <tr key={i} className="rp-tr">
                        <td>{i+1}</td>
                        <td className="rp-td-name" title={r.taskDescription}>{r.taskName}</td>
                        <td>{r.projectName}</td>
                        <td>{r.taskAssignedDate}</td>
                        <td><span className={'rp-task-status rp-ts-'+String(r.taskStatus).toLowerCase().replace(/\s+/g,'-')}>{r.taskStatus}</span></td>
                        <td>{r.completionDate}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            )}

            {activeReport==='daily' && (
              <table className="rp-table">
                <thead><tr><th>S.No</th><th>Date</th><th>Project</th><th>Task</th><th>Start Time</th><th>End Time</th><th>Total Hours</th></tr></thead>
                <tbody>
                  {dailyRows.length===0 ? <tr><td colSpan={7} className="rp-empty">No activity found</td></tr> :
                    dailyRows.map((r,i)=>(
                      <tr key={i} className="rp-tr">
                        <td>{i+1}</td>
                        <td>{r.activityDate}</td>
                        <td>{r.projectName}</td>
                        <td className="rp-td-task">{r.taskName}</td>
                        <td>{r.startTime}</td>
                        <td>{r.endTime}</td>
                        <td><strong>{r.totalWorkingHours}</strong></td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            )}

            {activeReport==='submission' && (
              <table className="rp-table">
                <thead><tr><th>S.No</th><th>Project Name</th><th>Submission Date</th><th>Submission Status</th><th>Admin Approval</th><th>Admin Remarks</th><th>Approval Date</th></tr></thead>
                <tbody>
                  {submissionRows.length===0 ? <tr><td colSpan={7} className="rp-empty">No submissions found</td></tr> :
                    submissionRows.map((r,i)=>{
                      const approvalColor = r.adminApprovalStatus==='Approved'?{bg:'#dcfce7',color:'#15803d'}:r.adminApprovalStatus==='Rejected'?{bg:'#fff1f2',color:'#be185d'}:{bg:'#fdf4ff',color:'#9333ea'};
                      return (
                        <tr key={i} className="rp-tr">
                          <td>{i+1}</td>
                          <td className="rp-td-name">{r.projectName}</td>
                          <td>{r.submissionDate}</td>
                          <td><span className="rp-status-badge" style={{background:'#eff6ff',color:'#2563eb'}}>{r.submissionStatus}</span></td>
                          <td><span className="rp-status-badge" style={{background:approvalColor.bg,color:approvalColor.color}}>{r.adminApprovalStatus}</span></td>
                          <td className="rp-td-task">{r.adminRemarks}</td>
                          <td>{r.approvalDate}</td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            )}

            {activeReport==='deadline' && (
              <table className="rp-table">
                <thead><tr><th>S.No</th><th>Project Name</th><th>Original Deadline</th><th>Upcoming / Status</th><th>Overdue</th><th>Project Status</th></tr></thead>
                <tbody>
                  {deadlineRows.length===0 ? <tr><td colSpan={6} className="rp-empty">No deadline data found</td></tr> :
                    deadlineRows.map((r,i)=>{
                      const sc=STATUS_COLORS[r.currentStatus]||{bg:'#f1f5f9',color:'#475569'};
                      return (
                        <tr key={i} className="rp-tr">
                          <td>{i+1}</td>
                          <td className="rp-td-name">{r.projectName}</td>
                          <td>{r.originalDeadline}</td>
                          <td><span className={r.isOverdue?'rp-overdue-badge':'rp-ontime-badge'}>{r.upcomingDeadline}</span></td>
                          <td><span className={r.isOverdue?'rp-overdue-badge':'rp-ontime-badge'}>{r.overdueStatus}</span></td>
                          <td><span className="rp-status-badge" style={{background:sc.bg,color:sc.color}}>{r.currentStatus}</span></td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            )}

          </div>
        </div>
      )}
    </div>
  );
}
