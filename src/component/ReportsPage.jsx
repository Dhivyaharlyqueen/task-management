import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import '../style/ReportsPage.css';

const ADMIN_EMAIL = 'admin@hepl.com';

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
  const d = parseDateVal(rawVal);
  if (!d) return true;
  const ds = toInputDate(rawVal);
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
            {pct>=7&&<text x={cx+r*0.62*Math.cos(mid-a/2+a/2)} y={cy+r*0.62*Math.sin(mid-a/2+a/2)} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="700" fill="#fff">{pct}%</text>}
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

function exportToCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map(r=>keys.map(k=>'"'+String(r[k]??'').replace(/"/g,'""')+'"').join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename+'.csv';
  a.click();
}

function exportToPDF(title) {
  const style = document.createElement('style');
  style.innerHTML = '@media print { .rp-wrapper > *:not(.rp-print-area) { display:none!important; } .rp-no-print { display:none!important; } }';
  document.head.appendChild(style);
  document.title = title;
  window.print();
  setTimeout(()=>{ document.head.removeChild(style); }, 1000);
}

const REPORT_TYPES = [
  { key: 'performance', label: 'Employee Performance' },
  { key: 'project', label: 'Project Report' },
  { key: 'daily', label: 'Daily Activity' },
  { key: 'completed', label: 'Completed Projects' },
  { key: 'pending', label: 'Pending Approval' },
  { key: 'hold', label: 'Project Hold' },
  { key: 'overdue', label: 'Deadline & Overdue' },
];

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
  const [activeReport, setActiveReport] = useState('performance');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterEmpName, setFilterEmpName] = useState('');
  const [filterEmpId, setFilterEmpId] = useState('');
  const [filterProject, setFilterProject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTaskStatus, setFilterTaskStatus] = useState('');

  function getDetail(name) {
    return projectDetails.find(d=>String(d.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())||null;
  }

  const allProjectNames = useMemo(()=>Array.from(new Set([
    ...projects.map(p=>String(p?.name||p).trim()).filter(Boolean),
    ...projectDetails.map(d=>String(d.name||'').trim()).filter(Boolean),
    ...tasks.map(t=>String(t.Project||'').trim()).filter(Boolean),
  ])), [projects, projectDetails, tasks]);

  const empOptions = useMemo(()=>Array.from(new Set(employees.map(e=>e['Employee Name']).filter(Boolean))).sort(),[employees]);
  const empIdOptions = useMemo(()=>Array.from(new Set(employees.map(e=>e['Employee ID']).filter(Boolean))).sort(),[employees]);
  const projOptions = useMemo(()=>allProjectNames.sort(),[allProjectNames]);
  const statusOptions = useMemo(()=>Array.from(new Set(projectDetails.map(d=>d.status).filter(Boolean))).sort(),[projectDetails]);

  // ---- Dashboard Summary ----
  const dashMetrics = useMemo(()=>{
    const total = allProjectNames.length;
    const completed = allProjectNames.filter(n=>{ const d=getDetail(n); return d?.status==='Completed'; }).length;
    const inProgress = allProjectNames.filter(n=>{ const d=getDetail(n); return d?.status==='In Progress'; }).length;
    const onHold = allProjectNames.filter(n=>{ const d=getDetail(n); return d?.status==='On Hold'; }).length;
    const pendingApproval = allProjectNames.filter(n=>{ const d=getDetail(n); return d?.status==='Pending Approval'; }).length;
    const overdue = allProjectNames.filter(n=>{
      const d=getDetail(n);
      if (!d?.deadline) return false;
      if (d?.status==='Completed') return false;
      return !!calcOverdue(d.deadline, d?.status||'');
    }).length;
    return { total, completed, inProgress, onHold, pendingApproval, overdue };
  }, [allProjectNames, projectDetails]);

  const statusDistSlices = useMemo(()=>[
    { label:'Completed', value:dashMetrics.completed, color:'#10b981' },
    { label:'In Progress', value:dashMetrics.inProgress, color:'#3b82f6' },
    { label:'On Hold', value:dashMetrics.onHold, color:'#f59e0b' },
    { label:'Pending Approval', value:dashMetrics.pendingApproval, color:'#8b5cf6' },
    { label:'Other', value:Math.max(0,dashMetrics.total-dashMetrics.completed-dashMetrics.inProgress-dashMetrics.onHold-dashMetrics.pendingApproval), color:'#94a3b8' },
  ], [dashMetrics]);

  // ---- Employee Performance Report ----
  const perfRows = useMemo(()=>{
    const map = new Map();
    employees.forEach(e=>{
      const key = e['Employee ID']||e['Email ID']||e.id;
      if (!key) return;
      map.set(key,{ empName:e['Employee Name']||'', empId:e['Employee ID']||'', assigned:0, completed:0, pending:0, onHold:0 });
    });
    tasks.forEach(t=>{
      const key = t['Employee ID']||t.userEmail||'';
      if (!key) return;
      if (!map.has(key)) map.set(key,{ empName:t['Employee Name']||'', empId:t['Employee ID']||'', assigned:0, completed:0, pending:0, onHold:0 });
      const r = map.get(key);
      r.assigned++;
      const st = String(t.status||'').toLowerCase();
      if (st==='completed') r.completed++;
      else if (st==='pending') r.pending++;
    });
    allProjectNames.forEach(name=>{
      const d=getDetail(name);
      if (d?.status==='On Hold' && d?.heldByEmpId) {
        const key=d.heldByEmpId;
        if (map.has(key)) map.get(key).onHold++;
      }
    });
    return Array.from(map.values()).filter(r=>{
      if (filterEmpName && r.empName!==filterEmpName) return false;
      if (filterEmpId && r.empId!==filterEmpId) return false;
      return true;
    }).map(r=>({
      ...r,
      completionRate: r.assigned===0?'0%':Math.round((r.completed/r.assigned)*100)+'%'
    }));
  }, [employees, tasks, allProjectNames, projectDetails, filterEmpName, filterEmpId]);

  // ---- Project Report ----
  const projectRows = useMemo(()=>{
    return allProjectNames.filter(name=>{
      if (filterProject && name!==filterProject) return false;
      const d=getDetail(name);
      if (filterStatus && (d?.status||'')!==filterStatus) return false;
      if (!inDateRange(d?.startDate||d?.createdAt, fromDate, toDate)) return false;
      return true;
    }).map(name=>{
      const d=getDetail(name);
      const assigned = Array.from(new Set(tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()).map(t=>t['Employee Name']||'').filter(Boolean))).join(', ')||'—';
      return {
        projectName: name,
        assignedEmployee: assigned,
        assignedDate: fmtDate(d?.startDate||d?.createdAt)||'—',
        originalDeadline: d?.deadline||'—',
        currentStatus: d?.status||'—',
        completionDate: d?.approvedAt ? fmtDateTime(d.approvedAt) : (d?.status==='Completed'?fmtDate(d?.updatedAt||'')||'—':'—'),
      };
    });
  }, [allProjectNames, projectDetails, tasks, filterProject, filterStatus, fromDate, toDate]);

  // ---- Daily Activity Report ----
  const dailyRows = useMemo(()=>{
    return tasks.filter(t=>{
      if (filterEmpName && (t['Employee Name']||'')!==filterEmpName) return false;
      if (filterEmpId && (t['Employee ID']||'')!==filterEmpId) return false;
      if (filterProject && (t.Project||'')!==filterProject) return false;
      if (filterTaskStatus && String(t.status||'').toLowerCase()!==filterTaskStatus.toLowerCase()) return false;
      if (!inDateRange(t.Date||t.createdAt, fromDate, toDate)) return false;
      return true;
    }).map(t=>({
      activityDate: fmtDate(t.Date||t.createdAt)||'—',
      employeeName: t['Employee Name']||'—',
      employeeId: t['Employee ID']||'—',
      projectName: t.Project||'—',
      taskName: t['Task Done']||'—',
      startTime: t.startTime||'—',
      endTime: t.endTime||'—',
      totalWorkingHours: (t.startTime&&t.endTime) ? (()=>{ const s=new Date(t.startTime),e=new Date(t.endTime); const d=(e-s)/3600000; return d>0?d.toFixed(1)+'h':'—'; })() : '—',
      taskStatus: t.status||'—',
    }));
  }, [tasks, filterEmpName, filterEmpId, filterProject, filterTaskStatus, fromDate, toDate]);

  // ---- Completed Projects Report ----
  const completedRows = useMemo(()=>{
    return allProjectNames.filter(name=>{
      const d=getDetail(name);
      if (d?.status!=='Completed') return false;
      if (filterProject && name!==filterProject) return false;
      if (filterEmpName) {
        const hasEmp = tasks.some(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()&&(t['Employee Name']||'')===filterEmpName);
        if (!hasEmp) return false;
      }
      if (!inDateRange(d?.approvedAt||d?.submittedAt, fromDate, toDate)) return false;
      return true;
    }).map(name=>{
      const d=getDetail(name);
      const emps = Array.from(new Set(tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()).map(t=>t['Employee Name']||'').filter(Boolean))).join(', ')||'—';
      return {
        projectName: name,
        employeeName: emps,
        submissionDate: d?.submittedAt ? fmtDateTime(d.submittedAt) : '—',
        adminApprovalDate: d?.approvedAt ? fmtDateTime(d.approvedAt) : '—',
        completionStatus: d?.status||'Completed',
      };
    });
  }, [allProjectNames, projectDetails, tasks, filterProject, filterEmpName, fromDate, toDate]);

  // ---- Pending Approval Report ----
  const pendingRows = useMemo(()=>{
    return allProjectNames.filter(name=>{
      const d=getDetail(name);
      if (d?.status!=='Pending Approval') return false;
      if (filterProject && name!==filterProject) return false;
      if (filterEmpName) {
        const hasEmp = tasks.some(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()&&(t['Employee Name']||'')===filterEmpName);
        if (!hasEmp) return false;
      }
      if (!inDateRange(d?.submittedAt, fromDate, toDate)) return false;
      return true;
    }).map(name=>{
      const d=getDetail(name);
      const emps = Array.from(new Set(tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()).map(t=>t['Employee Name']||'').filter(Boolean))).join(', ')||'—';
      return {
        projectName: name,
        employeeName: emps,
        submissionDate: d?.submittedAt ? fmtDateTime(d.submittedAt) : '—',
        approvalStatus: 'Pending Approval',
      };
    });
  }, [allProjectNames, projectDetails, tasks, filterProject, filterEmpName, fromDate, toDate]);

  // ---- Project Hold Report ----
  const holdRows = useMemo(()=>{
    return allProjectNames.filter(name=>{
      const d=getDetail(name);
      if (!d?.holdDate && !activityLogs.some(a=>a.projectName===name&&a.type==='Hold')) return false;
      if (filterProject && name!==filterProject) return false;
      if (filterEmpName) {
        const hasEmp = tasks.some(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()&&(t['Employee Name']||'')===filterEmpName);
        if (!hasEmp) return false;
      }
      if (!inDateRange(d?.holdDate, fromDate, toDate)) return false;
      return true;
    }).map(name=>{
      const d=getDetail(name);
      const emps = Array.from(new Set(tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()).map(t=>t['Employee Name']||'').filter(Boolean))).join(', ')||'—';
      const holdHistory = activityLogs.filter(a=>a.projectName===name&&a.type==='Hold').map(a=>`${fmtDateTime(a.timestamp)}: ${a.reason||'—'} (by ${a.byName||'—'})`).join(' | ')||'—';
      const resumeAct = [...activityLogs].reverse().find(a=>a.projectName===name&&a.type==='Resume');
      return {
        projectName: name,
        employeeName: emps,
        holdDate: d?.holdDate ? fmtDateTime(d.holdDate) : '—',
        holdReason: d?.holdReason||'—',
        resumeDate: resumeAct ? fmtDateTime(resumeAct.timestamp) : '—',
        holdHistory,
      };
    });
  }, [allProjectNames, projectDetails, tasks, activityLogs, filterProject, filterEmpName, fromDate, toDate]);

  // ---- Deadline & Overdue Report ----
  const overdueRows = useMemo(()=>{
    return allProjectNames.filter(name=>{
      const d=getDetail(name);
      if (!d?.deadline) return false;
      if (filterProject && name!==filterProject) return false;
      if (filterStatus && (d?.status||'')!==filterStatus) return false;
      if (filterEmpName) {
        const hasEmp = tasks.some(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()&&(t['Employee Name']||'')===filterEmpName);
        if (!hasEmp) return false;
      }
      return true;
    }).map(name=>{
      const d=getDetail(name);
      const emps = Array.from(new Set(tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===name.toLowerCase()).map(t=>t['Employee Name']||'').filter(Boolean))).join(', ')||'—';
      const overdueDuration = calcOverdue(d?.deadline, d?.status||'');
      return {
        projectName: name,
        employeeName: emps,
        originalDeadline: d?.deadline||'—',
        currentStatus: d?.status||'—',
        overdueDuration: overdueDuration||'On Time',
        isOverdue: !!overdueDuration,
      };
    });
  }, [allProjectNames, projectDetails, tasks, filterProject, filterStatus, filterEmpName]);

  function getActiveRows() {
    switch(activeReport) {
      case 'performance': return perfRows.map(r=>({ 'Employee Name':r.empName,'Employee ID':r.empId,'Total Assigned':r.assigned,'Completed':r.completed,'Pending':r.pending,'On Hold':r.onHold,'Completion Rate':r.completionRate }));
      case 'project': return projectRows.map(r=>({ 'Project Name':r.projectName,'Assigned Employee':r.assignedEmployee,'Assigned Date':r.assignedDate,'Original Deadline':r.originalDeadline,'Current Status':r.currentStatus,'Completion Date':r.completionDate }));
      case 'daily': return dailyRows.map(r=>({ 'Date':r.activityDate,'Employee Name':r.employeeName,'Employee ID':r.employeeId,'Project':r.projectName,'Task':r.taskName,'Start Time':r.startTime,'End Time':r.endTime,'Total Hours':r.totalWorkingHours,'Status':r.taskStatus }));
      case 'completed': return completedRows.map(r=>({ 'Project Name':r.projectName,'Employee Name':r.employeeName,'Submission Date':r.submissionDate,'Admin Approval Date':r.adminApprovalDate,'Completion Status':r.completionStatus }));
      case 'pending': return pendingRows.map(r=>({ 'Project Name':r.projectName,'Employee Name':r.employeeName,'Submission Date':r.submissionDate,'Approval Status':r.approvalStatus }));
      case 'hold': return holdRows.map(r=>({ 'Project Name':r.projectName,'Employee Name':r.employeeName,'Hold Date':r.holdDate,'Hold Reason':r.holdReason,'Resume Date':r.resumeDate,'Hold History':r.holdHistory }));
      case 'overdue': return overdueRows.map(r=>({ 'Project Name':r.projectName,'Employee Name':r.employeeName,'Original Deadline':r.originalDeadline,'Current Status':r.currentStatus,'Overdue Duration':r.overdueDuration }));
      default: return [];
    }
  }

  const activeRows = getActiveRows();

  function handleExport(type) {
    const rows = activeRows;
    if (!rows.length) { showSnack('No data to export','info'); return; }
    const label = REPORT_TYPES.find(r=>r.key===activeReport)?.label||activeReport;
    const filename = label.replace(/\s+/g,'_')+'_Report';
    if (type==='excel') exportToExcel(rows, filename);
    else if (type==='csv') exportToCSV(rows, filename);
    else exportToPDF(label+' Report');
  }

  function clearFilters() {
    setFromDate(''); setToDate(''); setFilterEmpName(''); setFilterEmpId('');
    setFilterProject(''); setFilterStatus(''); setFilterTaskStatus('');
  }

  const hasFilters = fromDate||toDate||filterEmpName||filterEmpId||filterProject||filterStatus||filterTaskStatus;

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
          <button className="rp-export-btn rp-export-excel" onClick={()=>handleExport('excel')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Excel
          </button>
          <button className="rp-export-btn rp-export-csv" onClick={()=>handleExport('csv')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
            CSV
          </button>
          <button className="rp-export-btn rp-export-pdf" onClick={()=>handleExport('pdf')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            PDF
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="rp-summary-cards rp-no-print">
        {[
          { label:'Total Projects', value:dashMetrics.total, color:'#3b82f6', bg:'#eff6ff' },
          { label:'Completed', value:dashMetrics.completed, color:'#10b981', bg:'#f0fdf4' },
          { label:'In Progress', value:dashMetrics.inProgress, color:'#2563eb', bg:'#dbeafe' },
          { label:'On Hold', value:dashMetrics.onHold, color:'#f59e0b', bg:'#fffbeb' },
          { label:'Pending Approval', value:dashMetrics.pendingApproval, color:'#8b5cf6', bg:'#fdf4ff' },
          { label:'Overdue', value:dashMetrics.overdue, color:'#ef4444', bg:'#fef2f2' },
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

      {/* Report Type Tabs */}
      <div className="rp-tabs rp-no-print">
        {REPORT_TYPES.map(r=>(
          <button key={r.key} className={'rp-tab'+(activeReport===r.key?' active':'')} onClick={()=>setActiveReport(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rp-filters rp-no-print">
        <div className="rp-filter-group">
          <label className="rp-filter-label">From Date</label>
          <input type="date" className="rp-filter-input" value={fromDate} onChange={e=>{setFromDate(e.target.value);}}/>
        </div>
        <div className="rp-filter-group">
          <label className="rp-filter-label">To Date</label>
          <input type="date" className="rp-filter-input" value={toDate} min={fromDate||undefined} onChange={e=>{setToDate(e.target.value);}}/>
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
        <div className="rp-filter-group">
          <label className="rp-filter-label">Task Status</label>
          <select className="rp-filter-select" value={filterTaskStatus} onChange={e=>setFilterTaskStatus(e.target.value)}>
            <option value="">All</option>
            <option value="In Progress">In Progress</option>
            <option value="Pending">Pending</option>
            <option value="Completed">Completed</option>
          </select>
        </div>
        {hasFilters && (
          <button className="rp-clear-btn" onClick={clearFilters}>Clear Filters</button>
        )}
      </div>

      {/* Report Tables */}
      <div className="rp-table-card">
        <div className="rp-table-header">
          <h3 className="rp-table-title">{REPORT_TYPES.find(r=>r.key===activeReport)?.label} Report</h3>
          <span className="rp-row-count">{activeRows.length} records</span>
        </div>
        <div className="rp-table-wrap">

          {activeReport==='performance' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Employee Name</th><th>Employee ID</th>
                <th>Total Assigned</th><th>Completed</th><th>Pending</th><th>On Hold</th><th>Completion Rate</th>
              </tr></thead>
              <tbody>
                {perfRows.length===0 ? <tr><td colSpan={8} className="rp-empty">No data found</td></tr> :
                  perfRows.map((r,i)=>(
                    <tr key={i} className="rp-tr">
                      <td>{i+1}</td>
                      <td className="rp-td-name">{r.empName||'—'}</td>
                      <td><span className="rp-id-badge">{r.empId||'—'}</span></td>
                      <td className="rp-td-num">{r.assigned}</td>
                      <td className="rp-td-num rp-green">{r.completed}</td>
                      <td className="rp-td-num rp-amber">{r.pending}</td>
                      <td className="rp-td-num rp-orange">{r.onHold}</td>
                      <td><span className="rp-rate-badge">{r.completionRate}</span></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {activeReport==='project' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Project Name</th><th>Assigned Employee</th>
                <th>Assigned Date</th><th>Original Deadline</th><th>Current Status</th><th>Completion Date</th>
              </tr></thead>
              <tbody>
                {projectRows.length===0 ? <tr><td colSpan={7} className="rp-empty">No data found</td></tr> :
                  projectRows.map((r,i)=>{
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
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          )}

          {activeReport==='daily' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Date</th><th>Employee Name</th><th>Emp ID</th>
                <th>Project</th><th>Task</th><th>Start Time</th><th>End Time</th><th>Total Hours</th><th>Status</th>
              </tr></thead>
              <tbody>
                {dailyRows.length===0 ? <tr><td colSpan={10} className="rp-empty">No data found</td></tr> :
                  dailyRows.map((r,i)=>(
                    <tr key={i} className="rp-tr">
                      <td>{i+1}</td>
                      <td>{r.activityDate}</td>
                      <td className="rp-td-name">{r.employeeName}</td>
                      <td><span className="rp-id-badge">{r.employeeId}</span></td>
                      <td>{r.projectName}</td>
                      <td className="rp-td-task" title={r.taskName}>{r.taskName.length>50?r.taskName.slice(0,50)+'…':r.taskName}</td>
                      <td>{r.startTime}</td>
                      <td>{r.endTime}</td>
                      <td>{r.totalWorkingHours}</td>
                      <td><span className={'rp-task-status rp-ts-'+String(r.taskStatus).toLowerCase().replace(/\s+/g,'-')}>{r.taskStatus}</span></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {activeReport==='completed' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Project Name</th><th>Employee Name</th>
                <th>Submission Date</th><th>Admin Approval Date</th><th>Completion Status</th>
              </tr></thead>
              <tbody>
                {completedRows.length===0 ? <tr><td colSpan={6} className="rp-empty">No completed projects found</td></tr> :
                  completedRows.map((r,i)=>(
                    <tr key={i} className="rp-tr">
                      <td>{i+1}</td>
                      <td className="rp-td-name">{r.projectName}</td>
                      <td>{r.employeeName}</td>
                      <td>{r.submissionDate}</td>
                      <td>{r.adminApprovalDate}</td>
                      <td><span className="rp-status-badge" style={{background:'#dcfce7',color:'#15803d'}}>{r.completionStatus}</span></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {activeReport==='pending' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Project Name</th><th>Employee Name</th>
                <th>Submission Date</th><th>Approval Status</th>
              </tr></thead>
              <tbody>
                {pendingRows.length===0 ? <tr><td colSpan={5} className="rp-empty">No pending approval projects</td></tr> :
                  pendingRows.map((r,i)=>(
                    <tr key={i} className="rp-tr">
                      <td>{i+1}</td>
                      <td className="rp-td-name">{r.projectName}</td>
                      <td>{r.employeeName}</td>
                      <td>{r.submissionDate}</td>
                      <td><span className="rp-status-badge" style={{background:'#fdf4ff',color:'#9333ea'}}>{r.approvalStatus}</span></td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {activeReport==='hold' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Project Name</th><th>Employee Name</th>
                <th>Hold Date</th><th>Hold Reason</th><th>Resume Date</th><th>Hold History</th>
              </tr></thead>
              <tbody>
                {holdRows.length===0 ? <tr><td colSpan={7} className="rp-empty">No projects on hold</td></tr> :
                  holdRows.map((r,i)=>(
                    <tr key={i} className="rp-tr">
                      <td>{i+1}</td>
                      <td className="rp-td-name">{r.projectName}</td>
                      <td>{r.employeeName}</td>
                      <td>{r.holdDate}</td>
                      <td className="rp-td-reason" title={r.holdReason}>{r.holdReason.length>60?r.holdReason.slice(0,60)+'…':r.holdReason}</td>
                      <td>{r.resumeDate}</td>
                      <td className="rp-td-history" title={r.holdHistory}>{r.holdHistory.length>80?r.holdHistory.slice(0,80)+'…':r.holdHistory}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          )}

          {activeReport==='overdue' && (
            <table className="rp-table">
              <thead><tr>
                <th>S.No</th><th>Project Name</th><th>Employee Name</th>
                <th>Original Deadline</th><th>Current Status</th><th>Overdue Duration</th>
              </tr></thead>
              <tbody>
                {overdueRows.length===0 ? <tr><td colSpan={6} className="rp-empty">No data found</td></tr> :
                  overdueRows.map((r,i)=>{
                    const sc=STATUS_COLORS[r.currentStatus]||{bg:'#f1f5f9',color:'#475569'};
                    return (
                      <tr key={i} className="rp-tr">
                        <td>{i+1}</td>
                        <td className="rp-td-name">{r.projectName}</td>
                        <td>{r.employeeName}</td>
                        <td>{r.originalDeadline}</td>
                        <td><span className="rp-status-badge" style={{background:sc.bg,color:sc.color}}>{r.currentStatus}</span></td>
                        <td><span className={r.isOverdue?'rp-overdue-badge':'rp-ontime-badge'}>{r.overdueDuration}</span></td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          )}

        </div>
      </div>
    </div>
  );
}
