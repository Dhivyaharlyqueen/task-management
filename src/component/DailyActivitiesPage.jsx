import { useState, useMemo } from 'react';
import '../style/DailyActivitiesPage.css';

const ADMIN_EMAIL = 'admin@hepl.com';
function isAdminEmail(e) { return String(e||'').trim().toLowerCase() === ADMIN_EMAIL; }

function formatDate(v) {
  if (!v) return '';
  if (typeof v === 'number') {
    const d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
  }
  if (typeof v === 'object' && v.seconds) return formatDate(v.seconds*1000);
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return m[3]+'/'+m[2]+'/'+m[1];
  return s;
}

function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'object' && ts.seconds ? ts.seconds*1000 : ts);
  if (isNaN(d.getTime())) return '';
  return formatDate(d.getTime())+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
}

function toInputDate(v) {
  const f = formatDate(v);
  const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  return m[3]+'-'+m[2]+'-'+m[1];
}

function calcHours(start, end) {
  if (!start || !end) return '—';
  const s = new Date(start), e = new Date(end);
  if (isNaN(s.getTime())||isNaN(e.getTime())) return '—';
  const diff = (e - s) / 3600000;
  if (diff < 0) return '—';
  return diff.toFixed(1)+'h';
}

const STATUS_COLORS = {
  Assigned:           { bg:'#e0f2fe', color:'#0369a1' },
  'In Progress':      { bg:'#e0f2fe', color:'#0284c7' },
  'On Hold':          { bg:'#fef3c7', color:'#b45309' },
  'Pending Approval': { bg:'#fdf4ff', color:'#9333ea' },
  'Revision Required':{ bg:'#fff1f2', color:'#be185d' },
  Completed:          { bg:'#dcfce7', color:'#15803d' },
  Active:             { bg:'#dcfce7', color:'#15803d' },
};

const PAGE_SIZE = 15;

export default function DailyActivitiesPage({ currentUser, employees, tasks, projects, projectDetails, activityLogs, isAdmin, showSnack }) {
  const [dateFilter, setDateFilter] = useState('');
  const [empFilter, setEmpFilter] = useState('');
  const [projFilter, setProjFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [viewModal, setViewModal] = useState(null);

  const myEmail = String(currentUser?.email||'').toLowerCase();

  // Build project detail lookup
  function getDetail(name) {
    return projectDetails.find(d=>String(d.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())||null;
  }
  function getUserDetail(name, userEmail) {
    const email = String(userEmail||'').toLowerCase();
    const userDoc = projectDetails.find(d=>
      String(d.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase() &&
      String(d.userEmail||'').toLowerCase()===email
    );
    return userDoc || getDetail(name);
  }

  function getProjectActivity(name) {
    return activityLogs.filter(a=>String(a.projectName||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
  }

  // Build activity rows from tasks
  const allRows = useMemo(() => {
    const source = isAdmin
      ? tasks
      : tasks.filter(t=>String(t.userEmail||'').toLowerCase()===myEmail);

    return source.map(t => {
      const projName = String(t.Project||'').trim();
      const det = isAdmin ? getDetail(projName) : getUserDetail(projName, t.userEmail||myEmail);
      const acts = getProjectActivity(projName);
      const holdAct = [...acts].reverse().find(a=>a.type==='Hold' && String(a.byEmail||'').toLowerCase()===String(t.userEmail||'').toLowerCase());
      const resumeAct = [...acts].reverse().find(a=>a.type==='Resume' && String(a.byEmail||'').toLowerCase()===String(t.userEmail||'').toLowerCase());
      const submitAct = [...acts].reverse().find(a=>a.type==='Submit');
      const approveAct = [...acts].reverse().find(a=>a.type==='Approve');
      const rejectAct = [...acts].reverse().find(a=>a.type==='Reject');

      const taskStatus = String(t.status||'').toLowerCase();
      let approvalStatus = '—';
      if (det?.status === 'Completed') approvalStatus = 'Approved';
      else if (det?.status === 'Pending Approval') approvalStatus = 'Pending';
      else if (det?.status === 'Revision Required') approvalStatus = 'Revision Required';
      else if (taskStatus === 'completed') approvalStatus = 'Completed';
      else if (taskStatus === 'pending') approvalStatus = 'Pending Review';
      else approvalStatus = '—';

      return {
        id: t.id,
        activityDate: formatDate(t.Date||t.createdAt),
        activityDateRaw: t.Date||t.createdAt,
        empName: t['Employee Name']||'—',
        empId: t['Employee ID']||'—',
        empEmail: t.userEmail||'—',
        projectName: projName||'—',
        taskName: t['Task Done']?.split('\n')[0]?.slice(0,60)||'—',
        taskDescription: t['Task Done']||'—',
        startTime: t.startTime||'—',
        endTime: t.endTime||'—',
        totalHours: calcHours(t.startTime, t.endTime),
        deadline: det?.deadline||'—',
        projectStatus: det?.status||'—',
        holdDate: isAdmin ? (det?.holdDate ? formatDateTime(det.holdDate) : '—') : '—',
        holdReason: isAdmin ? (det?.holdReason||'—') : '—', // admin only
        resumeDate: resumeAct ? formatDateTime(resumeAct.timestamp) : '—',
        submissionDate: det?.submittedAt ? formatDateTime(det.submittedAt) : '—',
        approvalStatus,
        adminRemarks: det?.adminRemark||'—',
        rejectReason: isAdmin ? (det?.rejectReason||'—') : '—',
        raw: { t, det, acts, holdAct, resumeAct, submitAct, approveAct, rejectAct },
      };
    });
  }, [tasks, projectDetails, activityLogs, isAdmin, myEmail]);

  // Filter options
  const empOptions = useMemo(()=>Array.from(new Set(allRows.map(r=>r.empName).filter(n=>n&&n!=='—'))).sort(),[allRows]);
  const projOptions = useMemo(()=>Array.from(new Set(allRows.map(r=>r.projectName).filter(n=>n&&n!=='—'))).sort(),[allRows]);
  const statusOptions = useMemo(()=>Array.from(new Set(allRows.map(r=>r.projectStatus).filter(s=>s&&s!=='—'))).sort(),[allRows]);

  const filtered = useMemo(()=>{
    return allRows.filter(r=>{
      if (dateFilter) {
        const rowDate = toInputDate(r.activityDateRaw);
        if (rowDate !== dateFilter) return false;
      }
      if (empFilter && r.empName !== empFilter) return false;
      if (projFilter && r.projectName !== projFilter) return false;
      if (statusFilter && r.projectStatus !== statusFilter) return false;
      return true;
    });
  }, [allRows, dateFilter, empFilter, projFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
  const safePage = Math.min(Math.max(1,page), totalPages);
  const pageItems = filtered.slice((safePage-1)*PAGE_SIZE, safePage*PAGE_SIZE);

  function clearFilters() {
    setDateFilter(''); setEmpFilter(''); setProjFilter(''); setStatusFilter(''); setPage(1);
  }

  const hasFilters = dateFilter||empFilter||projFilter||statusFilter;

  return (
    <div className="da-wrapper">
      <div className="da-header">
        <div>
          <h2 className="da-title">{isAdmin ? 'Daily Activities' : 'My Daily Activities'}</h2>
          <p className="da-subtitle">{isAdmin ? 'View all employee daily activities, project status, hold/resume history and approvals' : 'Your task activities, project deadlines and submission status'}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="da-filters">
        <div className="da-filter-group">
          <label className="da-filter-label">Date</label>
          <input type="date" className="da-filter-input" value={dateFilter} onChange={e=>{setDateFilter(e.target.value);setPage(1);}}/>
        </div>
        {isAdmin && (
          <div className="da-filter-group">
            <label className="da-filter-label">Employee</label>
            <select className="da-filter-select" value={empFilter} onChange={e=>{setEmpFilter(e.target.value);setPage(1);}}>
              <option value="">All Employees</option>
              {empOptions.map(n=><option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        <div className="da-filter-group">
          <label className="da-filter-label">Project</label>
          <select className="da-filter-select" value={projFilter} onChange={e=>{setProjFilter(e.target.value);setPage(1);}}>
            <option value="">All Projects</option>
            {projOptions.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="da-filter-group">
          <label className="da-filter-label">Status</label>
          <select className="da-filter-select" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}>
            <option value="">All Statuses</option>
            {statusOptions.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {hasFilters && (
          <button className="da-clear-btn" onClick={clearFilters}>Clear Filters</button>
        )}
      </div>

      {/* Summary bar */}
      <div className="da-summary-bar">
        <span className="da-summary-item"><strong>{filtered.length}</strong> activities</span>
        {hasFilters && <span className="da-filter-badge">Filtered</span>}
      </div>

      {/* Table */}
      <div className="da-table-card">
        {filtered.length === 0 ? (
          <div className="da-empty">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <p>No activities found</p>
          </div>
        ) : (
          <div className="da-table-wrap">
            <table className="da-table">
              <thead>
                <tr>
                  <th>S.No</th>
                  <th>Date</th>
                  {isAdmin && <th>Employee</th>}
                  {isAdmin && <th>Emp ID</th>}
                  <th>Project</th>
                  <th>Task</th>
                  <th>Deadline</th>
                  <th>Project Status</th>
                  {isAdmin && <th>Hold Date</th>}
                  {isAdmin && <th>Hold Reason</th>}
                  <th>Resume Date</th>
                  <th>Submitted</th>
                  <th>Approval</th>
                  {isAdmin && <th>Admin Remarks</th>}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r,i)=>{
                  const sc = STATUS_COLORS[r.projectStatus]||{bg:'#f1f5f9',color:'#475569'};
                  const sno = (safePage-1)*PAGE_SIZE+i+1;
                  return (
                    <tr key={r.id} className="da-tr">
                      <td className="da-td-sno">{sno}</td>
                      <td className="da-td-date">{r.activityDate||'—'}</td>
                      {isAdmin && <td className="da-td-emp"><span className="da-emp-name">{r.empName}</span></td>}
                      {isAdmin && <td className="da-td-empid"><span className="da-emp-id-badge">{r.empId}</span></td>}
                      <td className="da-td-proj"><span className="da-proj-name">{r.projectName}</span></td>
                      <td className="da-td-task"><span className="da-task-text" title={r.taskDescription}>{r.taskName}</span></td>
                      <td className="da-td-date">{r.deadline}</td>
                      <td className="da-td-status">
                        <span className="da-status-badge" style={{background:sc.bg,color:sc.color}}>{r.projectStatus}</span>
                      </td>
                      {isAdmin && <td className="da-td-date">{r.holdDate}</td>}
                      {isAdmin && <td className="da-td-reason">
                        {r.holdReason!=='—'
                          ? <span className="da-reason-text" title={r.holdReason}>{r.holdReason.slice(0,35)}{r.holdReason.length>35?'…':''}</span>
                          : <span className="da-dash">—</span>}
                      </td>}
                      <td className="da-td-date">{r.resumeDate}</td>
                      <td className="da-td-date">{r.submissionDate}</td>
                      <td className="da-td-approval">
                        <span className={'da-approval-badge da-approval-'+String(r.approvalStatus).toLowerCase().replace(/\s+/g,'-')}>{r.approvalStatus}</span>
                      </td>
                      {isAdmin && <td className="da-td-remark">
                        {r.adminRemarks!=='—'
                          ? <span className="da-remark-text" title={r.adminRemarks}>{r.adminRemarks.slice(0,30)}{r.adminRemarks.length>30?'…':''}</span>
                          : <span className="da-dash">—</span>}
                      </td>}
                      <td className="da-td-actions">
                        <button className="da-view-btn" onClick={()=>setViewModal(r)} title="View Details">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filtered.length > PAGE_SIZE && (
          <div className="da-pagination">
            <span className="da-page-info">Showing {Math.min((safePage-1)*PAGE_SIZE+1,filtered.length)}–{Math.min(safePage*PAGE_SIZE,filtered.length)} of {filtered.length}</span>
            <div className="da-page-btns">
              <button className="da-page-btn" disabled={safePage<=1} onClick={()=>setPage(p=>p-1)}>Previous</button>
              {Array.from({length:totalPages},(_,i)=>i+1).map(n=>(
                <button key={n} className={'da-page-btn'+(safePage===n?' active':'')} onClick={()=>setPage(n)}>{n}</button>
              ))}
              <button className="da-page-btn" disabled={safePage>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {viewModal && (
        <div className="da-overlay" onClick={()=>setViewModal(null)}>
          <div className="da-modal" onClick={e=>e.stopPropagation()}>
            <div className="da-modal-header">
              <div className="da-modal-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div>
                <h3>Activity Details</h3>
                <span className="da-modal-sub">{viewModal.projectName}</span>
              </div>
              <button className="da-modal-close" onClick={()=>setViewModal(null)}>&#x2715;</button>
            </div>
            <div className="da-modal-body">
              <div className="da-detail-grid">
                <div className="da-detail-field"><span className="da-detail-label">Activity Date</span><span className="da-detail-val">{viewModal.activityDate||'—'}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Employee</span><span className="da-detail-val">{viewModal.empName} ({viewModal.empId})</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Project</span><span className="da-detail-val">{viewModal.projectName}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Original Deadline</span><span className="da-detail-val">{viewModal.deadline}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Project Status</span>
                  <span className="da-status-badge" style={{background:STATUS_COLORS[viewModal.projectStatus]?.bg,color:STATUS_COLORS[viewModal.projectStatus]?.color}}>{viewModal.projectStatus}</span>
                </div>
                <div className="da-detail-field"><span className="da-detail-label">Approval Status</span><span className="da-detail-val">{viewModal.approvalStatus}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Start Time</span><span className="da-detail-val">{viewModal.startTime}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">End Time</span><span className="da-detail-val">{viewModal.endTime}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Total Hours</span><span className="da-detail-val">{viewModal.totalHours}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Submission Date</span><span className="da-detail-val">{viewModal.submissionDate}</span></div>
                <div className="da-detail-field"><span className="da-detail-label">Resume Date</span><span className="da-detail-val">{viewModal.resumeDate}</span></div>
                {viewModal.adminRemarks!=='—' && <div className="da-detail-field da-detail-full"><span className="da-detail-label">Admin Remarks</span><span className="da-detail-val">{viewModal.adminRemarks}</span></div>}
                <div className="da-detail-field da-detail-full"><span className="da-detail-label">Task Description</span><div className="da-task-box">{viewModal.taskDescription}</div></div>
                {/* Admin-only fields */}
                {isAdmin && viewModal.holdDate!=='—' && (
                  <div className="da-detail-field"><span className="da-detail-label">Hold Date (Admin)</span><span className="da-detail-val">{viewModal.holdDate}</span></div>
                )}
                {isAdmin && viewModal.holdReason!=='—' && (
                  <div className="da-detail-field da-detail-full"><span className="da-detail-label">Hold Reason (Admin Only)</span><span className="da-detail-val da-hold-reason-val">{viewModal.holdReason}</span></div>
                )}
                {isAdmin && viewModal.rejectReason!=='—' && (
                  <div className="da-detail-field da-detail-full"><span className="da-detail-label">Rejection Reason (Admin Only)</span><span className="da-detail-val" style={{color:'#be185d'}}>{viewModal.rejectReason}</span></div>
                )}
              </div>
            </div>
            <div className="da-modal-footer">
              <button className="da-btn-close" onClick={()=>setViewModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
