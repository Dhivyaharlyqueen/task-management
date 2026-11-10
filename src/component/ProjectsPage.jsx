import { useState, useEffect, useRef } from 'react';
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { notifyRecipients } from '../services/notifyService';
import '../style/ProjectsPage.css';

const ADMIN_EMAIL = 'admin@hepl.com';
function isAdminEmail(e) { return String(e||'').trim().toLowerCase() === ADMIN_EMAIL; }

const RE_DMY = new RegExp("^(\\d{2})/(\\d{2})/(\\d{4})$");
const RE_YMD = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
function formatDate(v) {
  if (!v) return '';
  if (typeof v === 'number') { const d=new Date(v); if(isNaN(d.getTime())) return ''; return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear(); }
  if (typeof v === 'object' && v.seconds) return formatDate(v.seconds*1000);
  const s=String(v).trim();
  if (RE_DMY.test(s)) return s;
  const m=s.match(RE_YMD);
  if (m) return m[3]+'/'+m[2]+'/'+m[1];
  return s;
}
function formatDateTime(ts) {
  if (!ts) return '';
  const d = new Date(typeof ts === 'object' && ts.seconds ? ts.seconds*1000 : ts);
  if (isNaN(d.getTime())) return '';
  return formatDate(d.getTime())+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
}
function toInputDate(v) { const f=formatDate(v); const m=f.match(RE_DMY); if(!m) return ''; return m[3]+'-'+m[2]+'-'+m[1]; }
function fromInputDate(v) { const m=String(v).match(RE_YMD); if(!m) return ''; return m[3]+'/'+m[2]+'/'+m[1]; }
function todayInput() { return toInputDate(Date.now()); }

const STATUS_COLORS = {
  Assigned:           { bg:'#e0f2fe', color:'#0369a1' },
  'In Progress':      { bg:'#e0f2fe', color:'#0284c7' },
  'On Hold':          { bg:'#fef3c7', color:'#b45309' },
  'Pending Approval': { bg:'#fdf4ff', color:'#9333ea' },
  'Revision Required':{ bg:'#fff1f2', color:'#be185d' },
  Completed:          { bg:'#dcfce7', color:'#15803d' },
  Active:             { bg:'#dcfce7', color:'#15803d' },
};
const PROJECT_STATUSES = ['Open','In Progress','Hold','Pre-Closed','Closed'];
const PROJECT_STATUS_COLORS = {
  'Open':        { bg:'#dbeafe', color:'#1d4ed8' },
  'In Progress': { bg:'#e0f2fe', color:'#0284c7' },
  'Hold':        { bg:'#fef3c7', color:'#b45309' },
  'Pre-Closed':  { bg:'#f3e8ff', color:'#7c3aed' },
  'Closed':      { bg:'#dcfce7', color:'#15803d' },
  'On Hold (Client)': { bg:'#ffedd5', color:'#c2410c' },
};
const AV_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
function avColor(name) { let h=0; for(let i=0;i<(name||'').length;i++) h=(h+name.charCodeAt(i))%AV_COLORS.length; return AV_COLORS[h]; }
function initials(name) { return (name||'?').split(' ').map(w=>w[0]||'').join('').toUpperCase().slice(0,2)||'?'; }

const PAGE_SIZE = 10;

function CircularProgress({ pct }) {
  const r = 18, c = 2 * Math.PI * r;
  const color = pct === 100 ? '#16a34a' : pct >= 60 ? '#2563eb' : '#38bdf8';
  return (
    <div className="pp-circ-wrap">
      <svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e2e8f0" strokeWidth="4"/>
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c}
          strokeLinecap="round" transform="rotate(-90 22 22)"
          style={{transition:'stroke-dashoffset 0.4s ease'}}/>
      </svg>
      <span className="pp-circ-pct" style={{color}}>{pct}%</span>
    </div>
  );
}

export default function ProjectsPage({ currentUser, employees, tasks, projects, isAdmin, showSnack }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [empFilter, setEmpFilter] = useState('');
  const [page, setPage] = useState(1);
  const [projectDetails, setProjectDetails] = useState([]);
  const [deadlineRequests, setDeadlineRequests] = useState([]);
  const [messages, setMessages] = useState([]);
  const [allMessages, setAllMessages] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [holdModal, setHoldModal] = useState(null);
  const [holdReason, setHoldReason] = useState('');
  const [holdReasonError, setHoldReasonError] = useState(false);
  const [detailModal, setDetailModal] = useState(null);
  const [msgModal, setMsgModal] = useState(null);
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [msgText, setMsgText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [form, setForm] = useState({ name:'', description:'', startDate:todayInput(), deadline:'', assignedEmails:[] });
  const [openMenu, setOpenMenu] = useState(null);
  const [projStatusSaving, setProjStatusSaving] = useState(null);
  const [preCloseModal, setPreCloseModal] = useState(null);
  const [submitModal, setSubmitModal] = useState(null);
  const [submitNote, setSubmitNote] = useState('');
  const [reviewModal, setReviewModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [adminRemark, setAdminRemark] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleteMyDetailsConfirm, setDeleteMyDetailsConfirm] = useState(null);
  const msgEndRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenu(null);
    }
    if (openMenu) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openMenu]);

  useEffect(() => {
    const q = query(collection(db,'project_details'), orderBy('createdAt'));
    return onSnapshot(q, snap => setProjectDetails(snap.docs.map(d=>({id:d.id,...d.data()}))));
  }, []);

  useEffect(() => {
    const q = query(collection(db,'deadline_requests'), orderBy('createdAt'));
    return onSnapshot(q, snap => setDeadlineRequests(snap.docs.map(d=>({id:d.id,...d.data()}))));
  }, []);

  useEffect(() => {
    const q = query(collection(db,'project_activity'), orderBy('timestamp'));
    return onSnapshot(q, snap => setActivityLogs(snap.docs.map(d=>({id:d.id,...d.data()}))));
  }, []);

  useEffect(() => {
    const q = query(collection(db,'project_messages'), orderBy('createdAt'));
    return onSnapshot(q, snap => setAllMessages(snap.docs.map(d=>({id:d.id,...d.data()}))));
  }, []);

  useEffect(() => {
    if (!msgModal) return;
    const projectId = msgModal.id;
    const filtered = allMessages.filter(m => m.projectId === projectId);
    setMessages(filtered);
  }, [msgModal, allMessages]);

  useEffect(() => {
    if (msgEndRef.current) msgEndRef.current.scrollIntoView({ behavior:'smooth' });
  }, [messages]);

  function getDetail(name) {
    return projectDetails.find(d=>String(d.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())||null;
  }
  function getProjectStatus(name) {
    const det = getDetail(name);
    return det?.projectStatus || 'Open';
  }
  async function handleProjectStatusChange(name, newStatus) {
    setProjStatusSaving(name);
    const det = getDetail(name);
    const updates = { projectStatus: newStatus };
    if (newStatus === 'Closed') updates.closedAt = Date.now();
    if (det) {
      await updateDoc(doc(db,'project_details',det.id), updates);
    } else {
      await addDoc(collection(db,'project_details'),{name,createdAt:Date.now(),...updates});
    }
    if (newStatus === 'Closed') {
      await notifyRecipients(emailsForProject(name), {
        type:'project_update', summary:'closed the project', actorName:'Admin', projectName:name, createdAt:Date.now()
      }, currentUser?.email);
    }
    setProjStatusSaving(null);
    showSnack('Project status updated to '+newStatus,'success');
  }
  async function handleFinalClose(p) {
    const det = getDetail(p.name);
    const updates = { projectStatus:'Closed', closedAt:Date.now(), closedBy:currentUser?.email||'' };
    if (det) { await updateDoc(doc(db,'project_details',det.id), updates); }
    else { await addDoc(collection(db,'project_details'),{name:p.name,createdAt:Date.now(),...updates}); }
    await logActivity(p.name,'Close',{closedAt:Date.now()});
    await notifyRecipients(emailsForProject(p.name), {
      type:'project_update', summary:'finalized and closed the project', actorName:'Admin', projectName:p.name, createdAt:Date.now()
    }, currentUser?.email);
    setPreCloseModal(null);
    showSnack('Project closed successfully','success');
  }
  function getUserDetail(name, userEmail) {
    const email = String(userEmail||'').toLowerCase();
    const userDoc = projectDetails.find(d=>
      String(d.name||'').trim().toLowerCase()===String(name||'').trim().toLowerCase() &&
      String(d.userEmail||'').toLowerCase()===email
    );
    return userDoc || getDetail(name);
  }
  function getStatus(name, userEmail) {
    const det = userEmail ? getUserDetail(name, userEmail) : getDetail(name);
    if (det?.status) return det.status;
    const pt = tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
    if (pt.length===0) return 'Assigned';
    if (pt.every(t=>String(t.status||'').toLowerCase()==='completed')) return 'Completed';
    if (pt.some(t=>String(t.status||'').toLowerCase().includes('progress'))) return 'In Progress';
    return 'Assigned';
  }
  function getProgress(name) {
    const pt = tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
    if (pt.length===0) return 0;
    return Math.round((pt.filter(t=>String(t.status||'').toLowerCase()==='completed').length/pt.length)*100);
  }
  function getAssigned(name) {
    const seen=new Set(); const res=[];
    tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase())
      .forEach(t=>{
        const key=String(t['Employee ID']||t.userEmail||'').trim();
        if(key&&!seen.has(key)){ seen.add(key); res.push({id:t['Employee ID']||'',name:t['Employee Name']||'',email:t.userEmail||''}); }
      });
    return res;
  }
  function getEmpContributions(name) {
    const projTasks = tasks.filter(t=>String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
    const total = projTasks.length;
    const map = new Map();
    projTasks.forEach(t=>{
      const key = String(t['Employee ID']||t.userEmail||'').trim();
      if (!key) return;
      if (!map.has(key)) map.set(key,{id:t['Employee ID']||'',name:t['Employee Name']||'',email:t.userEmail||'',done:0,count:0});
      const entry = map.get(key);
      entry.count++;
      if (String(t.status||'').toLowerCase()==='completed') entry.done++;
    });
    return Array.from(map.values()).map(e=>({
      ...e,
      pct: total===0 ? 0 : Math.round((e.count/total)*100),
      compPct: e.count===0 ? 0 : Math.round((e.done/e.count)*100),
    }));
  }
  function getMyProgress(name) {
    const myTasks = tasks.filter(t=>
      String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase() &&
      String(t.userEmail||'').toLowerCase()===String(currentUser?.email||'').toLowerCase()
    );
    if (myTasks.length===0) return 0;
    return Math.round((myTasks.filter(t=>String(t.status||'').toLowerCase()==='completed').length/myTasks.length)*100);
  }
  function getMyAssignedDate(name) {
    const myTasks = tasks.filter(t=>
      String(t.Project||'').trim().toLowerCase()===String(name||'').trim().toLowerCase() &&
      String(t.userEmail||'').toLowerCase()===String(currentUser?.email||'').toLowerCase()
    );
    if (myTasks.length===0) return '';
    const sorted = [...myTasks].sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    return formatDate(sorted[0].Date||sorted[0].createdAt);
  }
  function getEmpRecord() {
    return employees.find(e=>String(e['Email ID']||'').toLowerCase()===String(currentUser?.email||'').toLowerCase())||null;
  }
  function getSenderName() { const emp=getEmpRecord(); return emp?.['Employee Name']||currentUser?.email||''; }
  function getSenderEmpId() { const emp=getEmpRecord(); return emp?.['Employee ID']||''; }

  async function logActivity(projectName, type, extra={}) {
    await addDoc(collection(db,'project_activity'),{
      projectName, type,
      byName: getSenderName(), byEmail: currentUser?.email||'', byEmpId: getSenderEmpId(),
      timestamp: Date.now(), ...extra
    });
  }
  function getProjectActivity(name) {
    return activityLogs.filter(a=>String(a.projectName||'').trim().toLowerCase()===String(name||'').trim().toLowerCase());
  }

  async function handleHoldConfirm() {
    if (!holdModal) return;
    if (!holdReason.trim()) { setHoldReasonError(true); return; }
    setHoldReasonError(false);
    const myEmail = currentUser?.email||'';
    const holdData = { status:'On Hold', holdDate:Date.now(), holdReason:holdReason.trim(), heldBy:getSenderName(), heldByEmail:myEmail, heldByEmpId:getSenderEmpId() };
    const det = getUserDetail(holdModal.name, myEmail);
    if (det) { await updateDoc(doc(db,'project_details',det.id), holdData); }
    else { await addDoc(collection(db,'project_details'),{name:holdModal.name,userEmail:myEmail,createdAt:Date.now(),deadline:holdModal.det?.deadline||'',...holdData}); }
    await logActivity(holdModal.name,'Hold',{reason:holdReason.trim(),holdDate:Date.now()});
    setHoldModal(null); setHoldReason(''); setHoldReasonError(false);
    showSnack('Project placed on hold','success');
  }

  async function handleResume(p) {
    const myEmail = currentUser?.email||'';
    const det = getUserDetail(p.name, myEmail);
    const resumeData = { status:'In Progress', resumedAt:Date.now() };
    if (det) { await updateDoc(doc(db,'project_details',det.id), resumeData); }
    else { await addDoc(collection(db,'project_details'),{name:p.name,userEmail:myEmail,createdAt:Date.now(),deadline:p.det?.deadline||'',...resumeData}); }
    await logActivity(p.name,'Resume',{resumedAt:Date.now()});
    showSnack('Project resumed','success');
  }

  async function handleDeadlineAction(reqId, action) {
    await updateDoc(doc(db,'deadline_requests',reqId),{status:action,reviewedAt:Date.now(),reviewedBy:currentUser?.email||''});
    showSnack('Deadline request '+action.toLowerCase(),'success');
  }

  async function handleSubmitProject() {
    if (!submitModal) return;
    const myEmail = currentUser?.email||'';
    const det = getUserDetail(submitModal.name, myEmail);
    const submitData = { status:'Pending Approval', submittedAt:Date.now(), submittedBy:getSenderName(), submittedByEmail:myEmail, submittedByEmpId:getSenderEmpId(), submissionNote:submitNote.trim() };
    if (det) { await updateDoc(doc(db,'project_details',det.id), submitData); }
    else { await addDoc(collection(db,'project_details'),{name:submitModal.name,userEmail:myEmail,createdAt:Date.now(),deadline:submitModal.det?.deadline||'',...submitData}); }
    await logActivity(submitModal.name,'Submit',{note:submitNote.trim(),submittedAt:Date.now()});
    await notifyRecipients([ADMIN_EMAIL], {
      type: 'project_update',
      summary: 'submitted a project for approval',
      actorName: getSenderName(),
      projectName: submitModal.name,
      createdAt: Date.now(),
    }, myEmail);
    setSubmitModal(null); setSubmitNote('');
    showSnack('Project submitted for approval','success');
  }

  function emailsForProject(name) {
    const det = getDetail(name);
    const projectTasks = tasks.filter(t => String(t.Project || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
    const fromTasks = projectTasks.map(t => t.userEmail);
    const fromIds = projectTasks.map(t => {
      const emp = (employees || []).find(item => String(item['Employee ID'] || '').trim() === String(t['Employee ID'] || '').trim());
      return emp ? emp['Email ID'] : '';
    });
    return [
      ...(det?.assignedEmails || []),
      det?.submittedByEmail,
      det?.userEmail,
      ...fromTasks,
      ...fromIds,
      ...(employees || []).map(item => item['Email ID']),
    ];
  }

  async function handleApproveProject(p) {
    const det = getDetail(p.name);
    if (!det) return;
    await updateDoc(doc(db,'project_details',det.id),{status:'Completed',approvedAt:Date.now(),approvedBy:currentUser?.email||'',adminRemark:adminRemark.trim()});
    await logActivity(p.name,'Approve',{approvedAt:Date.now(),remark:adminRemark.trim()});
    await notifyRecipients(emailsForProject(p.name), {
      type: 'project_update',
      summary: 'approved your project',
      actorName: 'Admin',
      projectName: p.name,
      createdAt: Date.now(),
    }, currentUser?.email);
    setReviewModal(null); setAdminRemark('');
    showSnack('Project approved','success');
  }

  async function handleRejectProject(p) {
    if (!rejectReason.trim()) { showSnack('Enter rejection reason','error'); return; }
    const det = getDetail(p.name);
    if (!det) return;
    await updateDoc(doc(db,'project_details',det.id),{status:'Revision Required',rejectedAt:Date.now(),rejectedBy:currentUser?.email||'',rejectReason:rejectReason.trim(),adminRemark:adminRemark.trim()});
    await logActivity(p.name,'Reject',{rejectedAt:Date.now(),reason:rejectReason.trim(),remark:adminRemark.trim()});
    await notifyRecipients(emailsForProject(p.name), {
      type: 'project_update',
      summary: 'sent your project back for revision',
      actorName: 'Admin',
      projectName: p.name,
      createdAt: Date.now(),
    }, currentUser?.email);
    setReviewModal(null); setRejectReason(''); setAdminRemark('');
    showSnack('Project sent for revision','success');
  }

  async function handleAddProject(e) {
    e.preventDefault();
    if (!form.name.trim()) { showSnack('Project name required','error'); return; }
    await addDoc(collection(db,'project_details'),{name:form.name.trim(),description:form.description.trim(),startDate:fromInputDate(form.startDate),deadline:fromInputDate(form.deadline),assignedEmails:form.assignedEmails,status:'Assigned',createdAt:Date.now(),createdBy:currentUser?.email||''});
    await addDoc(collection(db,'projects'),{name:form.name.trim(),createdAt:Date.now(),createdBy:currentUser?.email||''});
    // Fan-out project request notifications
    const requesterEmail = String(currentUser?.email||'').toLowerCase();
    const requesterName = getSenderName();
    const now = Date.now();
    const empSnap = await getDocs(collection(db,'employees'));
    const directoryEmails = empSnap.docs.map(d => d.data()['Email ID']);
    await notifyRecipients(
      [ADMIN_EMAIL, ...directoryEmails, ...(form.assignedEmails || [])],
      { type:'project_request', requesterName, requesterEmail, projectName:form.name.trim(), createdAt:now },
      requesterEmail
    );
    setAddModal(false); setForm({name:'',description:'',startDate:todayInput(),deadline:'',assignedEmails:[]});
    showSnack('Project created','success');
  }

  async function handleDeleteProject(p) {
    // Admin: delete only the project_details doc. Never delete from the master projects list.
    const det = getDetail(p.name);
    if (det) await deleteDoc(doc(db, 'project_details', det.id));
    setDeleteConfirm(null);
    showSnack('Project details deleted', 'success');
  }

  async function handleDeleteMyProjectDetails(p) {
    // User: delete only their own project_details doc scoped to their email.
    const myEmail = String(currentUser?.email || '').toLowerCase();
    const userDoc = projectDetails.find(d =>
      String(d.name || '').trim().toLowerCase() === String(p.name || '').trim().toLowerCase() &&
      String(d.userEmail || '').toLowerCase() === myEmail
    );
    if (userDoc) await deleteDoc(doc(db, 'project_details', userDoc.id));
    setDeleteMyDetailsConfirm(null);
    showSnack('Your project details removed. You can re-add them anytime.', 'success');
  }

  async function handleEditProject(e) {
    e.preventDefault();
    const updates = { description:form.description.trim(), startDate:fromInputDate(form.startDate), deadline:fromInputDate(form.deadline) };
    if (editModal?.id) { await updateDoc(doc(db,'project_details',editModal.id), updates); }
    else { await addDoc(collection(db,'project_details'),{name:editModal.name,status:'Assigned',createdAt:Date.now(),...updates}); }
    setEditModal(null);
    showSnack('Project updated','success');
  }

  async function fanOutProjectMsgNotif(projectName, messagePreview) {
    const senderEmail = String(currentUser?.email||'').toLowerCase();
    const senderName = getSenderName();
    await notifyRecipients(
      emailsForProject(projectName),
      { type:'project_message', senderName, senderEmail, projectName, messagePreview: messagePreview.slice(0,80), createdAt: Date.now() },
      senderEmail
    );
  }

  async function handleSendMessage() {
    if (!msgText.trim()||!msgModal) return;
    const isAssigned = myProjectNames.has(msgModal.name);
    await addDoc(collection(db,'project_messages'),{projectId:msgModal.id,projectName:msgModal.name,senderEmail:currentUser?.email||'',senderName:getSenderName(),message:msgText.trim(),replyTo:null,createdAt:Date.now(),isSupport:!isAssigned&&!isAdmin});
    await fanOutProjectMsgNotif(msgModal.name, msgText.trim());
    setMsgText('');
  }

  async function handleSendReply(parentId) {
    if (!replyText.trim()||!msgModal) return;
    const isAssigned = myProjectNames.has(msgModal.name);
    await addDoc(collection(db,'project_messages'),{projectId:msgModal.id,projectName:msgModal.name,senderEmail:currentUser?.email||'',senderName:getSenderName(),message:replyText.trim(),replyTo:parentId,createdAt:Date.now(),isSupport:!isAssigned&&!isAdmin});
    await fanOutProjectMsgNotif(msgModal.name, replyText.trim());
    setReplyTo(null); setReplyText('');
  }

  function openEdit(p) {
    setForm({name:p.name,description:p.det?.description||'',startDate:toInputDate(p.det?.startDate)||todayInput(),deadline:toInputDate(p.det?.deadline)||'',assignedEmails:p.det?.assignedEmails||[]});
    setEditModal(p.det||{id:null,name:p.name});
  }
  function openMsg(p) {
    setMsgModal({id:p.det?.id||p.name,name:p.name});
    setMsgText(''); setReplyTo(null); setReplyText('');
  }

  const allNames = Array.from(new Set([
    ...projects.map(p=>String(p?.name||p).trim()).filter(Boolean),
    ...projectDetails.map(d=>String(d.name||'').trim()).filter(Boolean),
  ]));
  const myEmail = String(currentUser?.email||'').toLowerCase();
  const enriched = allNames.map(name => {
    const det = getDetail(name);
    const status = det?.status || getStatus(name);
    const projectStatus = getProjectStatus(name);
    const progress = getProgress(name);
    const assigned = getAssigned(name);
    const pendingReqs = deadlineRequests.filter(r=>r.projectName===name&&r.status==='Pending');
    return { name, det, status, projectStatus, progress, assigned, pendingReqs };
  });
  const myProjectNames = new Set(
    tasks.filter(t=>String(t.userEmail||'').toLowerCase()===myEmail).map(t=>String(t.Project||'').trim()).filter(Boolean)
  );
  const myEnriched = allNames.filter(name=>myProjectNames.has(name)).map(name => {
    const det = getUserDetail(name, myEmail);
    const status = det?.status || getStatus(name, myEmail);
    const projectStatus = getProjectStatus(name);
    const progress = getMyProgress(name);
    const assigned = getAssigned(name);
    const pendingReqs = deadlineRequests.filter(r=>r.projectName===name&&r.status==='Pending');
    return { name, det, status, projectStatus, progress, assigned, pendingReqs };
  });
  const source = isAdmin ? enriched : myEnriched;
  const allEmpOptions = Array.from(new Set(enriched.flatMap(p=>p.assigned.map(e=>e.name)).filter(Boolean))).sort();
  const filtered = source.filter(p => {
    const ms = !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()) || p.assigned.some(e=>e.name.toLowerCase().includes(search.trim().toLowerCase()));
    const mf = statusFilter==='all' || p.status===statusFilter;
    const me = !empFilter || p.assigned.some(e=>e.name===empFilter);
    return ms && mf && me;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
  const safePage = Math.min(Math.max(1,page), totalPages);
  const pageItems = filtered.slice((safePage-1)*PAGE_SIZE, safePage*PAGE_SIZE);
  const counts = { all:source.length, Assigned:0, 'In Progress':0, 'On Hold':0, 'Pending Approval':0, 'Revision Required':0, Completed:0 };
  source.forEach(p=>{ if(counts[p.status]!==undefined) counts[p.status]++; });
  const topMessages = messages.filter(m=>!m.replyTo);
  function getReplies(pid) { return messages.filter(m=>m.replyTo===pid); }
  const statTabs = [
    {
      key:'all', label:'All', color:'#2563eb',
      iconBg:'#dbeafe',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="#2563eb"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
    },
    {
      key:'Assigned', label:'Assigned', color:'#16a34a',
      iconBg:'#dcfce7',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="#16a34a"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
    },
    {
      key:'In Progress', label:'In Progress', color:'#0284c7',
      iconBg:'#e0f2fe',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#0284c7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><polyline points="18 10 14 6 10 10 6 14"/></svg>
    },
    {
      key:'On Hold', label:'On Hold', color:'#d97706',
      iconBg:'#fef3c7',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    },
    {
      key:'Pending Approval', label:'Pending', color:'#7c3aed',
      iconBg:'#ede9fe',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="#7c3aed"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
    },
    {
      key:'Revision Required', label:'Revision', color:'#db2777',
      iconBg:'#fce7f3',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#db2777" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
    },
    {
      key:'Completed', label:'Completed', color:'#16a34a',
      iconBg:'#dcfce7',
      icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="#16a34a"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
    },
  ];
  function canHold(status) { return ['Assigned','In Progress','Revision Required'].includes(status); }
  function canResume(status) { return status === 'On Hold'; }
  function canSubmit(status) { return !['Pending Approval','Completed'].includes(status); }
  function canReview(status) { return status === 'Pending Approval'; }

  return (
    <div className="pp-wrapper">
      <div className="pp-header">
        <div>
          <h2 className="pp-title">{isAdmin ? 'All Projects' : 'My Projects'}</h2>
          <p className="pp-subtitle">{isAdmin ? 'Manage all team projects, deadlines and discussions' : 'Your assigned projects, progress and discussions'}</p>
        </div>
        {isAdmin && (
          <button className="pp-btn-primary" onClick={()=>{setForm({name:'',description:'',startDate:todayInput(),deadline:'',assignedEmails:[]});setAddModal(true);}}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Project
          </button>
        )}
      </div>

      <div className="pp-stats-row">
        {statTabs.map(({key,label,color,iconBg,icon})=>(
          <button key={key} className={'pp-stat-card'+(statusFilter===key?' active':'')} onClick={()=>{setStatusFilter(key);setPage(1);}} style={statusFilter===key?{borderColor:'#3b82f6'}:{}}>
            <div className="pp-stat-icon-wrap" style={{background:iconBg}}>{icon}</div>
            <span className="pp-stat-num" style={{color}}>{counts[key]??0}</span>
            <span className="pp-stat-label">{label}</span>
          </button>
        ))}
      </div>

      <div className="pp-toolbar">
        <div className="pp-search-wrap">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input className="pp-search" placeholder={isAdmin?'Search by project or employee name...':'Search your projects...'} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} />
          {search && <button className="pp-search-clear" onClick={()=>{setSearch('');setPage(1);}}>&#x2715;</button>}
        </div>
        <select className="pp-filter-select" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}>
          <option value="all">All Statuses</option>
          <option value="Assigned">Assigned</option>
          <option value="In Progress">In Progress</option>
          <option value="On Hold">On Hold</option>
          <option value="Pending Approval">Pending Approval</option>
          <option value="Revision Required">Revision Required</option>
          <option value="Completed">Completed</option>
        </select>
        {isAdmin && (
          <select className="pp-filter-select" value={empFilter} onChange={e=>{setEmpFilter(e.target.value);setPage(1);}}>
            <option value="">All Employees</option>
            {allEmpOptions.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        )}
      </div>

      <div className="pp-table-card">
        {filtered.length === 0 ? (
          <div className="pp-empty">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <p>No projects found</p>
          </div>
        ) : isAdmin ? (
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead><tr>
                <th className="pp-th-sno">S.No</th>
                <th>Project Name</th>
                <th>Assigned Team</th>
                <th>Start Date</th>
                <th>Deadline</th>
                <th>Hold Date</th>
                <th>Task Status</th>
                <th>Project Status</th>
                <th>Progress</th>
                <th>Hold Reason</th>
                <th className="pp-th-actions">Actions</th>
              </tr></thead>
              <tbody>
                {pageItems.map((p,i)=>{
                  const sc = STATUS_COLORS[p.status]||STATUS_COLORS.Assigned;
                  const sno = (safePage-1)*PAGE_SIZE+i+1;
                  return (
                    <tr key={p.name} className="pp-tr">
                      <td className="pp-td-sno">{sno}</td>
                      <td className="pp-td-name">
                        <span className="pp-proj-name">{p.name}</span>
                        {p.det?.description && <span className="pp-proj-desc">{p.det.description}</span>}
                      </td>
                      <td className="pp-td-team">
                        {p.assigned.length===0 ? <span className="pp-no-emp">—</span> :
                          <div className="pp-contrib-list">
                            {getEmpContributions(p.name).map((e,idx)=>(
                              <div key={idx} className="pp-contrib-row">
                                <span className="pp-avatar pp-avatar-sm" style={{background:avColor(e.name),flexShrink:0}}>{initials(e.name)}</span>
                                <div className="pp-contrib-info">
                                  <div className="pp-contrib-header">
                                    <span className="pp-contrib-name">{e.name}</span>
                                    <span className="pp-contrib-pct">{e.pct}% share · {e.compPct}% done</span>
                                  </div>
                                  <div className="pp-contrib-track">
                                    <div className="pp-contrib-fill" style={{width:`${e.compPct}%`,background:e.compPct===100?'#16a34a':e.compPct>=60?'#2563eb':'#38bdf8'}}/>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        }
                      </td>
                      <td className="pp-td-date">{p.det?.startDate||'—'}</td>
                      <td className="pp-td-date">{p.det?.deadline||'—'}</td>
                      <td className="pp-td-date">{p.det?.holdDate?formatDate(p.det.holdDate):'—'}</td>
                      <td className="pp-td-status"><span className="pp-status-badge" style={{background:sc.bg,color:sc.color}}>{p.status}</span></td>
                      <td className="pp-td-status">
                        {projStatusSaving===p.name
                          ? <span className="pp-status-badge" style={{background:'#f1f5f9',color:'#64748b'}}>Saving…</span>
                          : <select className="pp-proj-status-select" value={p.projectStatus} onChange={e=>handleProjectStatusChange(p.name,e.target.value)} style={{background:PROJECT_STATUS_COLORS[p.projectStatus]?.bg,color:PROJECT_STATUS_COLORS[p.projectStatus]?.color}}>
                              {PROJECT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                            </select>
                        }
                      </td>
                      <td className="pp-td-progress"><CircularProgress pct={p.progress}/></td>
                      <td className="pp-td-reason">
                        {p.det?.holdReason ? <span className="pp-reason-text" title={p.det.holdReason}>{p.det.holdReason.slice(0,40)}{p.det.holdReason.length>40?'…':''}</span> : <span className="pp-no-emp">—</span>}
                        {p.pendingReqs.length>0 && (
                          <div className="pp-dreq-inline">
                            {p.pendingReqs.map(r=>(
                              <div key={r.id} className="pp-dreq-row-inline">
                                <span className="pp-dreq-label">Ext: {r.revisedDeadline} by {r.requestedBy}</span>
                                <div className="pp-dreq-btns">
                                  <button className="pp-btn-approve" onClick={()=>handleDeadlineAction(r.id,'Approved')}>✓</button>
                                  <button className="pp-btn-reject" onClick={()=>handleDeadlineAction(r.id,'Rejected')}>✕</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="pp-td-actions">
                        <div style={{display:'flex',alignItems:'center',gap:'6px',justifyContent:'center'}}>
                          <button className="pp-delete-btn" title="Delete project" onClick={()=>setDeleteConfirm(p)}>
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                          </button>
                          <div className="pp-menu-wrap" ref={openMenu===p.name?menuRef:null}>
                          <button className="pp-menu-trigger" onClick={()=>setOpenMenu(openMenu===p.name?null:p.name)}>⋮</button>
                          {openMenu===p.name && (
                            <div className="pp-menu-dropdown">
                              <button className="pp-menu-item pp-btn-view" onClick={()=>{setDetailModal(p);setOpenMenu(null);}}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View
                              </button>
                              {canReview(p.status) && (
                                <button className="pp-menu-item pp-btn-approve-action" onClick={()=>{setReviewModal(p);setRejectReason('');setAdminRemark('');setOpenMenu(null);}}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Review
                                </button>
                              )}
                              {p.projectStatus==='Pre-Closed' && (
                                <button className="pp-menu-item pp-btn-finalize" onClick={()=>{setPreCloseModal(p);setOpenMenu(null);}}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Finalize Closure
                                </button>
                              )}
                              <button className="pp-menu-item pp-btn-edit" onClick={()=>{openEdit(p);setOpenMenu(null);}}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>Edit
                              </button>
                            </div>
                          )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead><tr>
                <th className="pp-th-sno">S.No</th>
                <th>Project Name</th>
                <th>Description</th>
                <th>Assigned Date</th>
                <th>Deadline</th>
                <th>Task Status</th>
                <th>Project Status</th>
                <th>My Progress</th>
                <th className="pp-th-actions">Actions</th>
              </tr></thead>
              <tbody>
                {pageItems.map((p,i)=>{
                  const sc = STATUS_COLORS[p.status]||STATUS_COLORS.Assigned;
                  const sno = (safePage-1)*PAGE_SIZE+i+1;
                  const myProg = getMyProgress(p.name);
                  const assignedDate = getMyAssignedDate(p.name);
                  return (
                    <tr key={p.name} className="pp-tr">
                      <td className="pp-td-sno">{sno}</td>
                      <td className="pp-td-name">
                        <span className="pp-proj-name">{p.name}</span>
                      </td>
                      <td className="pp-td-name">
                        <span className="pp-proj-desc" style={{maxWidth:'180px',display:'block'}}>{p.det?.description||'—'}</span>
                      </td>
                      <td className="pp-td-date">{assignedDate}</td>
                      <td className="pp-td-date">{p.det?.deadline||'—'}</td>
                      <td className="pp-td-status"><span className="pp-status-badge" style={{background:sc.bg,color:sc.color}}>{p.status}</span></td>
                      <td className="pp-td-status">{(()=>{const psc=PROJECT_STATUS_COLORS[p.projectStatus]||PROJECT_STATUS_COLORS['Open'];return <span className="pp-status-badge" style={{background:psc.bg,color:psc.color}}>{p.projectStatus}</span>;})()}</td>
                      <td className="pp-td-progress"><CircularProgress pct={myProg}/></td>
                      <td className="pp-td-actions">
                        <div className="pp-menu-wrap" ref={openMenu===p.name?menuRef:null}>
                          <button className="pp-menu-trigger" onClick={()=>setOpenMenu(openMenu===p.name?null:p.name)}>⋮</button>
                          {openMenu===p.name && (
                            <div className="pp-menu-dropdown">
                              {canHold(p.status) && p.projectStatus==='Open' && (
                                <button className="pp-menu-item pp-btn-hold" onClick={()=>{setHoldModal(p);setHoldReason('');setHoldReasonError(false);setOpenMenu(null);}}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Hold Deadline
                                </button>
                              )}
                              {canResume(p.status) && p.projectStatus==='Open' && (
                                <button className="pp-menu-item pp-btn-resume" onClick={()=>{handleResume(p);setOpenMenu(null);}}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Resume Project
                                </button>
                              )}
                              {canSubmit(p.status) && (
                                <button className="pp-menu-item pp-btn-submit" onClick={()=>{setSubmitModal(p);setSubmitNote('');setOpenMenu(null);}}>
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Submit Project
                                </button>
                              )}
                              <button className="pp-menu-item pp-btn-view" onClick={()=>{setDetailModal(p);setOpenMenu(null);}}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View Details
                              </button>
                              <button className="pp-menu-item pp-btn-delete" onClick={()=>{setDeleteMyDetailsConfirm(p);setOpenMenu(null);}}>
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Delete My Details
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="pp-pagination">
            <span className="pp-page-info">Showing {Math.min((safePage-1)*PAGE_SIZE+1,filtered.length)}–{Math.min(safePage*PAGE_SIZE,filtered.length)} of {filtered.length}</span>
            <div className="pp-page-btns">
              <button className="pp-page-btn" disabled={safePage<=1} onClick={()=>setPage(p=>p-1)}>Previous</button>
              {Array.from({length:totalPages},(_,i)=>i+1).map(n=>(
                <button key={n} className={'pp-page-btn pp-page-num'+(safePage===n?' active':'')} onClick={()=>setPage(n)}>{n}</button>
              ))}
              <button className="pp-page-btn" disabled={safePage>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {holdModal && (
        <div className="pp-overlay" onClick={()=>setHoldModal(null)}>
          <div className="pp-modal" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon hold-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg></div>
              <div><h3>Hold Project Deadline</h3><span className="pp-modal-sub">{holdModal.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setHoldModal(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <div className="pp-modal-info-row"><span className="pp-modal-info-label">Current Deadline</span><span className="pp-modal-info-val">{holdModal.det?.deadline||'—'}</span></div>
              <div className="pp-modal-field">
                <label className="pp-modal-label">Hold Reason <span className="pp-required-star">*</span></label>
                <textarea className={'pp-modal-textarea'+(holdReasonError?' pp-input-error':'')} rows={3} placeholder="Mandatory: Describe why this project is being put on hold..." value={holdReason} onChange={e=>{setHoldReason(e.target.value);if(e.target.value.trim())setHoldReasonError(false);}}/>
                {holdReasonError && <span className="pp-error-msg">Hold reason is required before submitting.</span>}
              </div>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setHoldModal(null)}>Cancel</button>
              <button className="pp-btn-hold-confirm" onClick={handleHoldConfirm}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>Hold Deadline
              </button>
            </div>
          </div>
        </div>
      )}

      {submitModal && (
        <div className="pp-overlay" onClick={()=>setSubmitModal(null)}>
          <div className="pp-modal" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon submit-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></div>
              <div><h3>Submit Project</h3><span className="pp-modal-sub">{submitModal.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setSubmitModal(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <div className="pp-modal-info-row"><span className="pp-modal-info-label">Deadline</span><span className="pp-modal-info-val">{submitModal.det?.deadline||'—'}</span></div>
              <div className="pp-modal-field">
                <label className="pp-modal-label">Submission Note (Optional)</label>
                <textarea className="pp-modal-textarea" rows={3} placeholder="Describe what was completed..." value={submitNote} onChange={e=>setSubmitNote(e.target.value)}/>
              </div>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setSubmitModal(null)}>Cancel</button>
              <button className="pp-btn-submit-confirm" onClick={handleSubmitProject}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Submit for Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewModal && (
        <div className="pp-overlay" onClick={()=>setReviewModal(null)}>
          <div className="pp-modal pp-modal-lg" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon approval-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <div><h3>Review Submission</h3><span className="pp-modal-sub">{reviewModal.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setReviewModal(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <div className="pp-modal-info-row"><span className="pp-modal-info-label">Submitted By</span><span className="pp-modal-info-val">{reviewModal.det?.submittedBy||'—'} ({reviewModal.det?.submittedByEmpId||'—'})</span></div>
              <div className="pp-modal-info-row"><span className="pp-modal-info-label">Submitted At</span><span className="pp-modal-info-val">{formatDateTime(reviewModal.det?.submittedAt)||'—'}</span></div>
              {reviewModal.det?.submissionNote && <div className="pp-modal-info-row"><span className="pp-modal-info-label">Note</span><span className="pp-modal-info-val">{reviewModal.det.submissionNote}</span></div>}
              <div className="pp-modal-field">
                <label className="pp-modal-label">Admin Remarks</label>
                <textarea className="pp-modal-textarea" rows={2} placeholder="Optional remarks..." value={adminRemark} onChange={e=>setAdminRemark(e.target.value)}/>
              </div>
              <div className="pp-modal-field">
                <label className="pp-modal-label">Rejection Reason (required to reject)</label>
                <textarea className="pp-modal-textarea" rows={2} placeholder="Reason for rejection..." value={rejectReason} onChange={e=>setRejectReason(e.target.value)}/>
              </div>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setReviewModal(null)}>Cancel</button>
              <button className="pp-btn-reject-action" onClick={()=>handleRejectProject(reviewModal)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Reject
              </button>
              <button className="pp-btn-approve-confirm" onClick={()=>handleApproveProject(reviewModal)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {detailModal && (
        <div className="pp-overlay" onClick={()=>setDetailModal(null)}>
          <div className="pp-modal pp-modal-lg" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon detail-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></div>
              <div><h3>{detailModal.name}</h3><span className="pp-modal-sub">Project Details</span></div>
              <button className="pp-modal-close" onClick={()=>setDetailModal(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <div className="pp-detail-grid">
                <div className="pp-detail-field"><span className="pp-detail-label">Task Status</span><span className="pp-status-badge" style={{background:STATUS_COLORS[detailModal.status]?.bg,color:STATUS_COLORS[detailModal.status]?.color}}>{detailModal.status}</span></div>
                <div className="pp-detail-field"><span className="pp-detail-label">Project Status</span>{(()=>{const psc=PROJECT_STATUS_COLORS[detailModal.projectStatus||'Open']||PROJECT_STATUS_COLORS['Open'];return <span className="pp-status-badge" style={{background:psc.bg,color:psc.color}}>{detailModal.projectStatus||'Open'}</span>;})()}</div>
                <div className="pp-detail-field"><span className="pp-detail-label">Progress</span><span className="pp-detail-val">{detailModal.progress}%</span></div>
                <div className="pp-detail-field"><span className="pp-detail-label">Start Date</span><span className="pp-detail-val">{detailModal.det?.startDate||'—'}</span></div>
                <div className="pp-detail-field"><span className="pp-detail-label">Original Deadline</span><span className="pp-detail-val">{detailModal.det?.deadline||'—'}</span></div>
                {detailModal.det?.description&&<div className="pp-detail-field pp-detail-full"><span className="pp-detail-label">Description</span><span className="pp-detail-val">{detailModal.det.description}</span></div>}
                {detailModal.det?.submittedAt&&<div className="pp-detail-field"><span className="pp-detail-label">Submitted At</span><span className="pp-detail-val">{formatDateTime(detailModal.det.submittedAt)}</span></div>}
                {detailModal.det?.approvedAt&&<div className="pp-detail-field"><span className="pp-detail-label">Approved At</span><span className="pp-detail-val">{formatDateTime(detailModal.det.approvedAt)}</span></div>}
                {detailModal.det?.rejectedAt&&<div className="pp-detail-field"><span className="pp-detail-label">Rejected At</span><span className="pp-detail-val">{formatDateTime(detailModal.det.rejectedAt)}</span></div>}
                {detailModal.det?.adminRemark&&<div className="pp-detail-field pp-detail-full"><span className="pp-detail-label">Admin Remarks</span><span className="pp-detail-val">{detailModal.det.adminRemark}</span></div>}
                {detailModal.det?.rejectReason&&<div className="pp-detail-field pp-detail-full"><span className="pp-detail-label">Rejection Reason</span><span className="pp-detail-val pp-revision-note">{detailModal.det.rejectReason}</span></div>}
              </div>
              {isAdmin && detailModal.det?.holdDate && (
                <div className="pp-hold-info-box" style={{marginTop:'12px'}}>
                  <div className="pp-hold-info-title">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    Current Hold Details (Admin Only)
                  </div>
                  <div className="pp-detail-grid" style={{marginTop:'6px'}}>
                    <div className="pp-detail-field"><span className="pp-detail-label">Hold Date</span><span className="pp-detail-val">{formatDateTime(detailModal.det.holdDate)}</span></div>
                    <div className="pp-detail-field"><span className="pp-detail-label">Held By</span><span className="pp-detail-val">{detailModal.det.heldBy||'—'} ({detailModal.det.heldByEmpId||'—'})</span></div>
                    <div className="pp-detail-field pp-detail-full"><span className="pp-detail-label">Hold Reason</span><span className="pp-detail-val">{detailModal.det.holdReason||'—'}</span></div>
                  </div>
                </div>
              )}
              <div className="pp-detail-section" style={{marginTop:'12px'}}>
                <span className="pp-detail-section-title">Team Members ({detailModal.assigned.length})</span>
                <div className="pp-detail-team">
                  {detailModal.assigned.length===0 ? <span className="pp-no-emp">No members assigned yet</span> :
                    detailModal.assigned.map((e,i)=>(
                      <div key={i} className="pp-detail-emp-row">
                        <span className="pp-avatar" style={{background:avColor(e.name)}}>{initials(e.name)}</span>
                        <div><div className="pp-detail-emp-name">{e.name}</div><div className="pp-detail-emp-id">{e.email||e.id}</div></div>
                      </div>
                    ))}
                </div>
              </div>
              {isAdmin && getProjectActivity(detailModal.name).length>0 && (
                <div className="pp-detail-section" style={{marginTop:'12px'}}>
                  <span className="pp-detail-section-title">Activity History (Admin Only)</span>
                  <div className="pp-activity-timeline">
                    {getProjectActivity(detailModal.name).map(a=>{
                      const dotColor = a.type==='Hold'?'#b45309':a.type==='Resume'?'#15803d':a.type==='Submit'?'#0369a1':a.type==='Approve'?'#16a34a':'#be185d';
                      return (
                        <div key={a.id} className="pp-activity-entry">
                          <div className="pp-activity-dot" style={{background:dotColor}}/>
                          <div className="pp-activity-body">
                            <div className="pp-activity-top">
                              <span className="pp-activity-type" style={{color:dotColor}}>{a.type}</span>
                              <span className="pp-activity-by">by {a.byName} ({a.byEmpId||a.byEmail})</span>
                            </div>
                            {a.reason && <span className="pp-activity-reason">{a.reason}</span>}
                            {a.note && <span className="pp-activity-reason">{a.note}</span>}
                            <span className="pp-activity-time">{formatDateTime(a.timestamp)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {isAdmin && deadlineRequests.filter(r=>r.projectName===detailModal.name).length>0 && (
                <div className="pp-detail-section" style={{marginTop:'12px'}}>
                  <span className="pp-detail-section-title">Deadline Extension History</span>
                  {deadlineRequests.filter(r=>r.projectName===detailModal.name).map(r=>(
                    <div key={r.id} className="pp-dreq-history-row">
                      <span>{r.requestedBy} requested {r.revisedDeadline}</span>
                      <span className={'pp-dreq-status pp-dreq-'+r.status.toLowerCase()}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setDetailModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {(addModal||editModal) && (
        <div className="pp-overlay" onClick={()=>{setAddModal(false);setEditModal(null);}}>
          <div className="pp-modal pp-modal-lg" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon detail-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>
              <div><h3>{editModal?'Edit Project':'New Project'}</h3><span className="pp-modal-sub">Fill in the project details</span></div>
              <button className="pp-modal-close" onClick={()=>{setAddModal(false);setEditModal(null);}}>&#x2715;</button>
            </div>
            <form onSubmit={editModal?handleEditProject:handleAddProject}>
              <div className="pp-modal-body">
                <div className="pp-form-grid">
                  {!editModal&&(
                    <div className="pp-form-field pp-form-full">
                      <label className="pp-modal-label">Project Name <span className="pp-required-star">*</span></label>
                      <input className="pp-modal-input" placeholder="Enter project name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/>
                    </div>
                  )}
                  <div className="pp-form-field pp-form-full">
                    <label className="pp-modal-label">Description</label>
                    <textarea className="pp-modal-textarea" rows={2} placeholder="Project description..." value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/>
                  </div>
                  <div className="pp-form-field">
                    <label className="pp-modal-label">Start Date</label>
                    <input type="date" className="pp-modal-input" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}/>
                  </div>
                  <div className="pp-form-field">
                    <label className="pp-modal-label">Deadline <span className="pp-required-star">*</span></label>
                    <input type="date" className="pp-modal-input" value={form.deadline} onChange={e=>setForm(f=>({...f,deadline:e.target.value}))} required/>
                  </div>
                </div>
              </div>
              <div className="pp-modal-footer">
                <button type="button" className="pp-btn-cancel" onClick={()=>{setAddModal(false);setEditModal(null);}}>Cancel</button>
                <button type="submit" className="pp-btn-primary">{editModal?'Save Changes':'Create Project'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {preCloseModal && (
        <div className="pp-overlay" onClick={()=>setPreCloseModal(null)}>
          <div className="pp-modal" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon" style={{background:'#f3e8ff',color:'#7c3aed'}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>
              <div><h3>Finalize Project Closure</h3><span className="pp-modal-sub">{preCloseModal.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setPreCloseModal(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <div className="pp-modal-info-row"><span className="pp-modal-info-label">Current Status</span><span className="pp-modal-info-val" style={{color:'#7c3aed',fontWeight:700}}>Pre-Closed</span></div>
              <div className="pp-modal-info-row"><span className="pp-modal-info-label">Progress</span><span className="pp-modal-info-val">{preCloseModal.progress}%</span></div>
              <p style={{fontSize:'0.84rem',color:'#475569',margin:'4px 0 0'}}>All tasks have been completed and approved. Confirm final closure to mark this project as <strong>Closed</strong> and notify all team members.</p>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setPreCloseModal(null)}>Cancel</button>
              <button className="pp-btn-approve-confirm" onClick={()=>handleFinalClose(preCloseModal)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Confirm Closure
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="pp-overlay" onClick={()=>setDeleteConfirm(null)}>
          <div className="pp-modal" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon" style={{background:'#fee2e2',color:'#b91c1c'}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
              <div><h3>Delete Project</h3><span className="pp-modal-sub">{deleteConfirm.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setDeleteConfirm(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <p style={{margin:0,fontSize:'0.88rem',color:'#475569'}}>Are you sure you want to delete the project details for <strong>{deleteConfirm?.name}</strong>? The project will remain in the master list. This action cannot be undone.</p>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setDeleteConfirm(null)}>Cancel</button>
              <button className="pp-btn-delete-confirm" onClick={()=>handleDeleteProject(deleteConfirm)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteMyDetailsConfirm && (
        <div className="pp-overlay" onClick={()=>setDeleteMyDetailsConfirm(null)}>
          <div className="pp-modal" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon" style={{background:'#fee2e2',color:'#b91c1c'}}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></div>
              <div><h3>Delete My Project Details</h3><span className="pp-modal-sub">{deleteMyDetailsConfirm.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setDeleteMyDetailsConfirm(null)}>&#x2715;</button>
            </div>
            <div className="pp-modal-body">
              <p style={{margin:0,fontSize:'0.88rem',color:'#475569'}}>This will remove only <strong>your</strong> project details for <strong>{deleteMyDetailsConfirm.name}</strong>. The project will remain available in the dropdown — you can re-add your details anytime. Other employees' records are not affected.</p>
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn-cancel" onClick={()=>setDeleteMyDetailsConfirm(null)}>Cancel</button>
              <button className="pp-btn-delete-confirm" onClick={()=>handleDeleteMyProjectDetails(deleteMyDetailsConfirm)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Delete My Details
              </button>
            </div>
          </div>
        </div>
      )}

      {msgModal && (
        <div className="pp-overlay" onClick={()=>setMsgModal(null)}>
          <div className="pp-modal pp-modal-lg pp-modal-msg" onClick={e=>e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon msg-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
              <div><h3>Team Discussion</h3><span className="pp-modal-sub">{msgModal.name}</span></div>
              <button className="pp-modal-close" onClick={()=>setMsgModal(null)}>&#x2715;</button>
            </div>
            <div className="pp-msg-body">
              {topMessages.length===0&&<div className="pp-msg-empty">No messages yet. Start the conversation!</div>}
              {topMessages.map(msg=>(
                <div key={msg.id} className="pp-msg-thread">
                  <div className="pp-msg-row">
                    <span className="pp-avatar pp-avatar-sm" style={{background:avColor(msg.senderName)}}>{initials(msg.senderName)}</span>
                    <div className="pp-msg-bubble">
                      <div className="pp-msg-meta"><span className="pp-msg-sender">{msg.senderName}</span>{msg.isSupport&&<span className="pp-msg-support-badge">Support</span>}<span className="pp-msg-time">{new Date(msg.createdAt).toLocaleString()}</span></div>
                      <p className="pp-msg-text">{msg.message}</p>
                      <button className="pp-reply-btn" onClick={()=>{setReplyTo(replyTo===msg.id?null:msg.id);setReplyText('');}}>Reply</button>
                    </div>
                  </div>
                  {getReplies(msg.id).map(reply=>(
                    <div key={reply.id} className="pp-msg-row pp-msg-reply">
                      <span className="pp-avatar pp-avatar-sm" style={{background:avColor(reply.senderName)}}>{initials(reply.senderName)}</span>
                      <div className="pp-msg-bubble pp-reply-bubble">
                        <div className="pp-msg-meta"><span className="pp-msg-sender">{reply.senderName}</span><span className="pp-msg-time">{new Date(reply.createdAt).toLocaleString()}</span></div>
                        <p className="pp-msg-text">{reply.message}</p>
                      </div>
                    </div>
                  ))}
                  {replyTo===msg.id&&(
                    <div className="pp-reply-input-row">
                      <input className="pp-msg-input" placeholder="Write a reply..." value={replyText} onChange={e=>setReplyText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSendReply(msg.id);}}}/>
                      <button className="pp-send-btn" onClick={()=>handleSendReply(msg.id)}>Send</button>
                    </div>
                  )}
                </div>
              ))}
              <div ref={msgEndRef}/>
            </div>
            <div className="pp-msg-footer">
              <input className="pp-msg-input" placeholder="Write a message..." value={msgText} onChange={e=>setMsgText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSendMessage();}}}/>
              <button className="pp-send-btn" onClick={handleSendMessage}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
