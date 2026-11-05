import { useState, useEffect, useRef } from 'react';
import {
  collection, addDoc, onSnapshot, query, orderBy,
  doc, updateDoc, deleteDoc, runTransaction, getDocs
} from 'firebase/firestore';
import { db } from '../firebase';
import { notifyRecipients, ADMIN_EMAIL } from '../services/notifyService';
import '../style/SupportPage.css';

const TECH_OPTIONS = ['React','JavaScript','TypeScript','Java','Python','Node.js','CSS','SQL','Firebase','Other'];
const STATUS_COLORS = {
  Open:          { bg:'#dcfce7', color:'#15803d', dot:'#16a34a' },
  Claimed:       { bg:'#ede9fe', color:'#6d28d9', dot:'#7c3aed' },
  'In Progress': { bg:'#dbeafe', color:'#1d4ed8', dot:'#2563eb' },
  Completed:     { bg:'#f1f5f9', color:'#475569', dot:'#64748b' },
};

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - (typeof ts === 'object' && ts.seconds ? ts.seconds * 1000 : ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name) {
  return (name || '?').split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
}

const AV_COLORS = ['#6d28d9','#2563eb','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#0284c7'];
function avColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h + name.charCodeAt(i)) % AV_COLORS.length;
  return AV_COLORS[h];
}

export default function SupportPage({ currentUser, employees, showSnack }) {
  const [activeTab, setActiveTab] = useState('browse');
  const [requests, setRequests] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', tech: '', projectName: '' });
  const [formError, setFormError] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [claimingId, setClaimingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [progressModal, setProgressModal] = useState(null);
  const [progressNote, setProgressNote] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTech, setFilterTech] = useState('all');
  const [search, setSearch] = useState('');
  // Edit / Revert / Delete state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', description: '', tech: '', projectName: '' });
  const [editError, setEditError] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [revertingId, setRevertingId] = useState(null);
  const formRef = useRef(null);

  const myEmail = String(currentUser?.email || '').toLowerCase();

  function getEmpRecord() {
    return employees.find(e => String(e['Email ID'] || '').toLowerCase() === myEmail) || null;
  }
  function getMyName() {
    const emp = getEmpRecord();
    return emp?.['Employee Name'] || currentUser?.email || 'Unknown';
  }

  useEffect(() => {
    const q = query(collection(db, 'support_requests'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    if (showForm && formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [showForm]);

  async function handleSubmit(e) {
    e.preventDefault();
    const errors = {};
    if (!form.title.trim()) errors.title = 'Title is required';
    if (!form.description.trim()) errors.description = 'Description is required';
    if (!form.tech) errors.tech = 'Select a technology';
    if (Object.keys(errors).length) { setFormError(errors); return; }
    setSubmitting(true);
    try {
      const now = Date.now();
      const reqRef = await addDoc(collection(db, 'support_requests'), {
        title: form.title.trim(),
        description: form.description.trim(),
        tech: form.tech,
        projectName: form.projectName.trim(),
        requesterEmail: myEmail,
        requesterName: getMyName(),
        status: 'Open',
        claimedBy: null,
        claimedByEmail: null,
        claimedAt: null,
        completedAt: null,
        progressNote: '',
        createdAt: now,
      });

      try {
        const emails = [ADMIN_EMAIL, ...(employees || []).map((item) => item['Email ID'])];
        const [empSnap, taskSnap] = await Promise.all([
          getDocs(collection(db, 'employees')).catch(() => null),
          getDocs(collection(db, 'tasks')).catch(() => null),
        ]);
        empSnap?.forEach((item) => emails.push(item.data()['Email ID']));
        taskSnap?.forEach((item) => emails.push(item.data().userEmail));
        await notifyRecipients(emails, {
          type: 'support_request',
          requestId: reqRef.id,
          requestTitle: form.title.trim(),
          projectName: form.projectName.trim(),
          requesterName: getMyName(),
          requesterEmail: myEmail,
          createdAt: now,
        }, myEmail);
      } catch (err) {
        console.error('Support notification fan-out failed', err);
      }

      setForm({ title: '', description: '', tech: '', projectName: '' });
      setFormError({});
      setShowForm(false);
      showSnack('Support request posted!', 'success');
      setActiveTab('browse');
    } catch {
      showSnack('Failed to post request', 'error');
    }
    setSubmitting(false);
  }

  async function handleClaim(req) {
    if (claimingId) return;
    setClaimingId(req.id);
    try {
      const ref = doc(db, 'support_requests', req.id);
      await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Not found');
        if (snap.data().status !== 'Open') throw new Error('Already claimed');
        tx.update(ref, {
          status: 'Claimed',
          claimedBy: getMyName(),
          claimedByEmail: myEmail,
          claimedAt: Date.now(),
        });
      });
      showSnack('Request claimed successfully!', 'success');
    } catch (err) {
      showSnack(err.message === 'Already claimed' ? 'This request was already claimed' : 'Failed to claim', 'error');
    }
    setClaimingId(null);
  }

  async function handleMarkInProgress(req) {
    await updateDoc(doc(db, 'support_requests', req.id), { status: 'In Progress' });
    showSnack('Marked as In Progress', 'success');
  }

  async function handleComplete(req) {
    await updateDoc(doc(db, 'support_requests', req.id), {
      status: 'Completed',
      completedAt: Date.now(),
      progressNote: progressNote.trim(),
    });
    setProgressModal(null);
    setProgressNote('');
    showSnack('Request marked as completed!', 'success');
  }

  // ── Revert: reset Completed request back to Open (owner only, no active claimer)
  async function handleRevert(req) {
    if (req.requesterEmail !== myEmail) { showSnack('Permission denied', 'error'); return; }
    if (req.status !== 'Completed') { showSnack('Only completed requests can be reverted', 'error'); return; }
    setRevertingId(req.id);
    try {
      await updateDoc(doc(db, 'support_requests', req.id), {
        status: 'Open',
        claimedBy: null,
        claimedByEmail: null,
        claimedAt: null,
        completedAt: null,
        progressNote: '',
        revertedAt: Date.now(),
      });
      showSnack('Request reverted to Open', 'success');
    } catch {
      showSnack('Failed to revert request', 'error');
    }
    setRevertingId(null);
  }

  // ── Open edit form pre-filled with existing data
  function handleStartEdit(req) {
    if (req.requesterEmail !== myEmail) { showSnack('Permission denied', 'error'); return; }
    if (req.status !== 'Open') { showSnack('Only Open requests can be edited', 'error'); return; }
    setEditForm({
      title: req.title || '',
      description: req.description || '',
      tech: req.tech || '',
      projectName: req.projectName || '',
    });
    setEditError({});
    setEditingId(req.id);
  }

  function handleCancelEdit() {
    setEditingId(null);
    setEditForm({ title: '', description: '', tech: '', projectName: '' });
    setEditError({});
  }

  // ── Update & Resubmit: update existing doc, no new doc created
  async function handleUpdate(req) {
    if (req.requesterEmail !== myEmail) { showSnack('Permission denied', 'error'); return; }
    if (req.status !== 'Open') { showSnack('Only Open requests can be edited', 'error'); return; }
    const errors = {};
    if (!editForm.title.trim()) errors.title = 'Title is required';
    if (!editForm.description.trim()) errors.description = 'Description is required';
    if (!editForm.tech) errors.tech = 'Select a technology';
    if (Object.keys(errors).length) { setEditError(errors); return; }
    setEditSaving(true);
    try {
      await updateDoc(doc(db, 'support_requests', req.id), {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        tech: editForm.tech,
        projectName: editForm.projectName.trim(),
        updatedAt: Date.now(),
      });
      setEditingId(null);
      showSnack('Request updated successfully!', 'success');
    } catch {
      showSnack('Failed to update request', 'error');
    }
    setEditSaving(false);
  }

  // ── Delete: owner only, only Open requests
  async function handleDelete(req) {
    if (req.requesterEmail !== myEmail) { showSnack('Permission denied', 'error'); return; }
    if (req.status !== 'Open') { showSnack('Only Open requests can be deleted', 'error'); return; }
    setDeletingId(req.id);
    try {
      await deleteDoc(doc(db, 'support_requests', req.id));
      setDeleteConfirmId(null);
      showSnack('Request deleted', 'success');
    } catch {
      showSnack('Failed to delete request', 'error');
    }
    setDeletingId(null);
  }

  const myRequests = requests.filter(r => r.requesterEmail === myEmail);
  const myClaimed = requests.filter(r => r.claimedByEmail === myEmail);

  const filtered = requests.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterTech !== 'all' && r.tech !== filterTech) return false;
    if (search.trim() && !r.title.toLowerCase().includes(search.toLowerCase()) &&
        !r.requesterName.toLowerCase().includes(search.toLowerCase()) &&
        !r.tech.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const openCount = requests.filter(r => r.status === 'Open').length;
  const claimedCount = requests.filter(r => r.status === 'Claimed' || r.status === 'In Progress').length;
  const completedCount = requests.filter(r => r.status === 'Completed').length;

  return (
    <div className="sp-wrapper">
      <div className="sp-header">
        <div className="sp-header-left">
          <div className="sp-header-icon">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <h2 className="sp-title">Support Hub</h2>
            <p className="sp-subtitle">Request help or support your teammates</p>
          </div>
        </div>
        <button className="sp-btn-post" onClick={() => { setShowForm(s => !s); setActiveTab('browse'); }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {showForm ? 'Cancel' : 'Post Request'}
        </button>
      </div>

      <div className="sp-stats-row">
        <div className="sp-stat-card sp-stat-open"><span className="sp-stat-num">{openCount}</span><span className="sp-stat-label">Open</span></div>
        <div className="sp-stat-card sp-stat-claimed"><span className="sp-stat-num">{claimedCount}</span><span className="sp-stat-label">Active</span></div>
        <div className="sp-stat-card sp-stat-done"><span className="sp-stat-num">{completedCount}</span><span className="sp-stat-label">Completed</span></div>
        <div className="sp-stat-card sp-stat-mine"><span className="sp-stat-num">{myRequests.length}</span><span className="sp-stat-label">My Requests</span></div>
        <div className="sp-stat-card sp-stat-claimed2"><span className="sp-stat-num">{myClaimed.length}</span><span className="sp-stat-label">I'm Helping</span></div>
      </div>

      {showForm && (
        <div className="sp-form-card" ref={formRef}>
          <div className="sp-form-header">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>New Support Request</span>
          </div>
          <form onSubmit={handleSubmit} className="sp-form">
            <div className="sp-form-row">
              <div className="sp-form-field sp-form-full">
                <label className="sp-label">Request Title <span className="sp-required">*</span></label>
                <input className={`sp-input${formError.title ? ' sp-input-err' : ''}`} placeholder="e.g. Need help with React state management" value={form.title} onChange={e => { setForm(f => ({ ...f, title: e.target.value })); setFormError(f => ({ ...f, title: '' })); }} />
                {formError.title && <span className="sp-err-msg">{formError.title}</span>}
              </div>
            </div>
            <div className="sp-form-row sp-form-2col">
              <div className="sp-form-field">
                <label className="sp-label">Technology / Area <span className="sp-required">*</span></label>
                <select className={`sp-input${formError.tech ? ' sp-input-err' : ''}`} value={form.tech} onChange={e => { setForm(f => ({ ...f, tech: e.target.value })); setFormError(f => ({ ...f, tech: '' })); }}>
                  <option value="">Select technology...</option>
                  {TECH_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {formError.tech && <span className="sp-err-msg">{formError.tech}</span>}
              </div>
              <div className="sp-form-field">
                <label className="sp-label">Project Name (optional)</label>
                <input className="sp-input" placeholder="e.g. Task Management App" value={form.projectName} onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))} />
              </div>
            </div>
            <div className="sp-form-row">
              <div className="sp-form-field sp-form-full">
                <label className="sp-label">Description <span className="sp-required">*</span></label>
                <textarea className={`sp-textarea${formError.description ? ' sp-input-err' : ''}`} rows={4} placeholder="Describe your issue in detail..." value={form.description} onChange={e => { setForm(f => ({ ...f, description: e.target.value })); setFormError(f => ({ ...f, description: '' })); }} />
                {formError.description && <span className="sp-err-msg">{formError.description}</span>}
              </div>
            </div>
            <div className="sp-form-actions">
              <button type="button" className="sp-btn-cancel" onClick={() => { setShowForm(false); setFormError({}); }}>Cancel</button>
              <button type="submit" className="sp-btn-submit" disabled={submitting}>{submitting ? 'Posting...' : 'Post Request'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="sp-tabs">
        {[
          { key: 'browse', label: 'Browse Requests', count: filtered.length },
          { key: 'mine', label: 'My Requests', count: myRequests.length },
          { key: 'claimed', label: "I'm Helping", count: myClaimed.length },
        ].map(tab => (
          <button key={tab.key} className={`sp-tab${activeTab === tab.key ? ' active' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
            <span className="sp-tab-count">{tab.count}</span>
          </button>
        ))}
      </div>

      {activeTab === 'browse' && (
        <div className="sp-filters">
          <div className="sp-search-wrap">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className="sp-search" placeholder="Search requests..." value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="sp-search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
          <select className="sp-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="Open">Open</option>
            <option value="Claimed">Claimed</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
          </select>
          <select className="sp-filter-select" value={filterTech} onChange={e => setFilterTech(e.target.value)}>
            <option value="all">All Technologies</option>
            {TECH_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      )}

      <RequestList
        requests={activeTab === 'browse' ? filtered : activeTab === 'mine' ? myRequests : myClaimed}
        myEmail={myEmail}
        myName={getMyName()}
        claimingId={claimingId}
        expandedId={expandedId}
        setExpandedId={setExpandedId}
        onClaim={handleClaim}
        onMarkInProgress={handleMarkInProgress}
        onComplete={req => { setProgressModal(req); setProgressNote(req.progressNote || ''); }}
        isMineTab={activeTab === 'mine'}
        editingId={editingId}
        editForm={editForm}
        setEditForm={setEditForm}
        editError={editError}
        editSaving={editSaving}
        onStartEdit={handleStartEdit}
        onCancelEdit={handleCancelEdit}
        onUpdate={handleUpdate}
        deleteConfirmId={deleteConfirmId}
        setDeleteConfirmId={setDeleteConfirmId}
        deletingId={deletingId}
        onDelete={handleDelete}
        revertingId={revertingId}
        onRevert={handleRevert}
        emptyLabel={activeTab === 'browse' ? 'No support requests found' : activeTab === 'mine' ? "You haven't posted any requests yet" : "You haven't claimed any requests yet"}
      />

      {progressModal && (
        <div className="sp-overlay" onClick={() => setProgressModal(null)}>
          <div className="sp-modal" onClick={e => e.stopPropagation()}>
            <div className="sp-modal-header">
              <div className="sp-modal-icon">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <h3>Mark as Completed</h3>
                <span className="sp-modal-sub">{progressModal.title}</span>
              </div>
              <button className="sp-modal-close" onClick={() => setProgressModal(null)}>✕</button>
            </div>
            <div className="sp-modal-body">
              <label className="sp-label">Resolution Note (optional)</label>
              <textarea className="sp-textarea" rows={3} placeholder="Describe how you resolved the issue..." value={progressNote} onChange={e => setProgressNote(e.target.value)} />
            </div>
            <div className="sp-modal-footer">
              <button className="sp-btn-cancel" onClick={() => setProgressModal(null)}>Cancel</button>
              <button className="sp-btn-complete" onClick={() => handleComplete(progressModal)}>Mark Completed</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestList({
  requests, myEmail, myName, claimingId, expandedId, setExpandedId,
  onClaim, onMarkInProgress, onComplete,
  isMineTab, editingId, editForm, setEditForm, editError, editSaving,
  onStartEdit, onCancelEdit, onUpdate,
  deleteConfirmId, setDeleteConfirmId, deletingId, onDelete,
  revertingId, onRevert, emptyLabel,
}) {
  if (requests.length === 0) {
    return (
      <div className="sp-empty">
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#4c1d95" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <p>{emptyLabel}</p>
      </div>
    );
  }
  return (
    <div className="sp-cards-grid">
      {requests.map(req => (
        <RequestCard
          key={req.id}
          req={req}
          myEmail={myEmail}
          myName={myName}
          claimingId={claimingId}
          expanded={expandedId === req.id}
          onToggle={() => setExpandedId(expandedId === req.id ? null : req.id)}
          onClaim={onClaim}
          onMarkInProgress={onMarkInProgress}
          onComplete={onComplete}
          isMineTab={isMineTab}
          isEditing={editingId === req.id}
          editForm={editForm}
          setEditForm={setEditForm}
          editError={editError}
          editSaving={editSaving}
          onStartEdit={onStartEdit}
          onCancelEdit={onCancelEdit}
          onUpdate={onUpdate}
          isDeleteConfirm={deleteConfirmId === req.id}
          setDeleteConfirmId={setDeleteConfirmId}
          isDeleting={deletingId === req.id}
          onDelete={onDelete}
          isReverting={revertingId === req.id}
          onRevert={onRevert}
        />
      ))}
    </div>
  );
}

function RequestCard({
  req, myEmail, myName, claimingId, expanded, onToggle,
  onClaim, onMarkInProgress, onComplete,
  isMineTab, isEditing, editForm, setEditForm, editError, editSaving,
  onStartEdit, onCancelEdit, onUpdate,
  isDeleteConfirm, setDeleteConfirmId, isDeleting, onDelete,
  isReverting, onRevert,
}) {
  const sc = STATUS_COLORS[req.status] || STATUS_COLORS.Open;
  const isOwn = req.requesterEmail === myEmail;
  const isClaimer = req.claimedByEmail === myEmail;
  const canClaim = req.status === 'Open' && !isOwn;
  const isClaiming = claimingId === req.id;

  // Ownership-based action rules
  const canEdit   = isMineTab && isOwn && req.status === 'Open';
  const canDelete = isMineTab && isOwn && req.status === 'Open';
  const canRevert = isMineTab && isOwn && req.status === 'Completed';

  return (
    <div className={`sp-card${expanded ? ' sp-card-expanded' : ''}${isEditing ? ' sp-card-editing' : ''}`}>
      <div className="sp-card-top">
        <div className="sp-card-avatar" style={{ background: avColor(req.requesterName) }}>
          {initials(req.requesterName)}
        </div>
        <div className="sp-card-meta">
          <span className="sp-card-requester">{req.requesterName}</span>
          <span className="sp-card-time">{timeAgo(req.createdAt)}{req.updatedAt ? ' · edited' : ''}</span>
        </div>
        <span className="sp-status-badge" style={{ background: sc.bg, color: sc.color }}>
          <span className="sp-status-dot" style={{ background: sc.dot }} />
          {req.status}
        </span>
      </div>

      {/* ── Inline Edit Form ── */}
      {isEditing ? (
        <div className="sp-edit-form">
          <div className="sp-edit-form-header">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
            <span>Edit Request</span>
          </div>
          <div className="sp-edit-field">
            <label className="sp-label">Title <span className="sp-required">*</span></label>
            <input
              className={`sp-input${editError.title ? ' sp-input-err' : ''}`}
              value={editForm.title}
              onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Request title"
            />
            {editError.title && <span className="sp-err-msg">{editError.title}</span>}
          </div>
          <div className="sp-edit-row-2col">
            <div className="sp-edit-field">
              <label className="sp-label">Technology <span className="sp-required">*</span></label>
              <select
                className={`sp-input${editError.tech ? ' sp-input-err' : ''}`}
                value={editForm.tech}
                onChange={e => setEditForm(f => ({ ...f, tech: e.target.value }))}
              >
                <option value="">Select...</option>
                {TECH_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {editError.tech && <span className="sp-err-msg">{editError.tech}</span>}
            </div>
            <div className="sp-edit-field">
              <label className="sp-label">Project (optional)</label>
              <input
                className="sp-input"
                value={editForm.projectName}
                onChange={e => setEditForm(f => ({ ...f, projectName: e.target.value }))}
                placeholder="Project name"
              />
            </div>
          </div>
          <div className="sp-edit-field">
            <label className="sp-label">Description <span className="sp-required">*</span></label>
            <textarea
              className={`sp-textarea${editError.description ? ' sp-input-err' : ''}`}
              rows={3}
              value={editForm.description}
              onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe your issue..."
            />
            {editError.description && <span className="sp-err-msg">{editError.description}</span>}
          </div>
          <div className="sp-edit-actions">
            <button className="sp-btn-cancel" onClick={onCancelEdit} disabled={editSaving}>Cancel</button>
            <button className="sp-btn-resubmit" onClick={() => onUpdate(req)} disabled={editSaving}>
              {editSaving ? (
                <><span className="sp-spinner" /> Saving...</>
              ) : (
                <><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Update &amp; Resubmit</>
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="sp-card-body">
            <h3 className="sp-card-title">{req.title}</h3>
            <div className="sp-card-tags">
              <span className="sp-tech-tag">{req.tech}</span>
              {req.projectName && <span className="sp-proj-tag">{req.projectName}</span>}
              {isOwn && <span className="sp-own-tag">Your Request</span>}
            </div>
            <p className={`sp-card-desc${expanded ? ' expanded' : ''}`}>{req.description}</p>
            {req.description.length > 120 && (
              <button className="sp-read-more" onClick={onToggle}>{expanded ? 'Show less' : 'Read more'}</button>
            )}
          </div>

          {req.claimedBy && (
            <div className="sp-claimed-info">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>{req.status === 'Completed' ? 'Resolved by' : 'Being helped by'} <strong>{req.claimedBy}</strong></span>
              {req.claimedAt && <span className="sp-claimed-time">· {timeAgo(req.claimedAt)}</span>}
            </div>
          )}

          {req.progressNote && req.status === 'Completed' && (
            <div className="sp-resolution-note">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#15803d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              <span>{req.progressNote}</span>
            </div>
          )}

          {/* ── Delete Confirmation inline ── */}
          {isDeleteConfirm && (
            <div className="sp-delete-confirm">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              <span>Delete this request?</span>
              <div className="sp-delete-confirm-btns">
                <button className="sp-btn-delete-cancel" onClick={() => setDeleteConfirmId(null)} disabled={isDeleting}>No</button>
                <button className="sp-btn-delete-confirm" onClick={() => onDelete(req)} disabled={isDeleting}>
                  {isDeleting ? <span className="sp-spinner" /> : 'Yes, Delete'}
                </button>
              </div>
            </div>
          )}

          <div className="sp-card-actions">
            {/* Claim (browse tab, not own) */}
            {canClaim && (
              <button className="sp-btn-claim" onClick={() => onClaim(req)} disabled={isClaiming}>
                {isClaiming ? <span className="sp-spinner" /> : (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                )}
                {isClaiming ? 'Claiming...' : 'Claim This Request'}
              </button>
            )}

            {/* Claimer actions */}
            {req.status === 'Claimed' && isClaimer && (
              <button className="sp-btn-progress" onClick={() => onMarkInProgress(req)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Mark In Progress
              </button>
            )}
            {(req.status === 'Claimed' || req.status === 'In Progress') && isClaimer && (
              <button className="sp-btn-complete-action" onClick={() => onComplete(req)}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Mark Completed
              </button>
            )}

            {/* Claimed badge (not claimer, not completed) */}
            {req.status !== 'Open' && !isClaimer && req.claimedByEmail !== myEmail && req.status !== 'Completed' && (
              <span className="sp-claimed-badge">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Claimed
              </span>
            )}
            {req.status === 'Completed' && !canRevert && (
              <span className="sp-done-badge">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Completed
              </span>
            )}

            {/* Owner actions in My Requests tab */}
            {canEdit && (
              <button className="sp-btn-edit-action" onClick={() => onStartEdit(req)}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                Edit
              </button>
            )}
            {canRevert && (
              <button className="sp-btn-revert-action" onClick={() => onRevert(req)} disabled={isReverting}>
                {isReverting ? <span className="sp-spinner" /> : (
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                )}
                {isReverting ? 'Reverting...' : 'Revert to Open'}
              </button>
            )}
            {canDelete && !isDeleteConfirm && (
              <button className="sp-btn-delete-action" onClick={() => setDeleteConfirmId(req.id)}>
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
