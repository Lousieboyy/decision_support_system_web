import { useState, useEffect } from 'react';
import {
  X, MapPin, Brain, CheckCircle2, ChevronRight, Image as ImageIcon,
  Send, Building2, Clock, AlertTriangle, MessageSquare, ShieldCheck,
  RotateCcw, ChevronDown, Mail, Phone, Wrench, HardHat, Camera
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { 
  getImageUrl, updateReportStatus, adminReview, 
  assignWorker, startMaintenance, completeTask, authorityResolve 
} from '../api/reportsApi';
import { AUTHORITIES } from '../utils/authorities';



function suggestDepartment(report) {
  const text = `${report.categories || ''} ${report.ai_prediction || ''} ${report.address || ''}`.toLowerCase();
  for (const a of AUTHORITIES) {
    if (a.keywords.some(kw => text.includes(kw))) return a.id;
  }
  return 'mbmb';
}

function buildNotificationText(report, authorityName, note) {
  const lines = [
    `[SMART CITY REPORT #${report.id}]`,
    `Category   : ${report.categories || 'N/A'}`,
    `Location   : ${report.address || report.location || 'Unknown'}`,
    `Description: ${report.description || 'No description.'}`,
    `Authority  : ${authorityName}`,
    note ? `Admin Note : ${note}` : null,
    ``,
    `Please review this issue and assign a worker.`,
  ].filter(l => l !== null);
  return lines.join('\n');
}

// --- Status helpers ---
function getStatusStyle(status) {
  switch (status) {
    case 'Pending':        return { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500' };
    case 'In Review':      return { bg: 'bg-amber-100',  text: 'text-amber-800',  border: 'border-amber-200',  dot: 'bg-amber-500'  };
    case 'In Process':     return { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-200',   dot: 'bg-blue-500'   };
    case 'In Maintenance': return { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200', dot: 'bg-purple-500' };
    case 'Resolved':       return { bg: 'bg-green-100',  text: 'text-green-800',  border: 'border-green-200',  dot: 'bg-green-500'  };
    default:               return { bg: 'bg-slate-100',  text: 'text-slate-800',  border: 'border-slate-200',  dot: 'bg-slate-500'  };
  }
}

function fmtDate(iso) {
  if (!iso) return null;
  try { return format(parseISO(iso), 'MMM d, yyyy · HH:mm'); } catch { return iso; }
}

// --- Timeline step ---
function TimelineStep({ icon, label, time, active, last }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${active ? 'bg-primary-500 text-white shadow-md shadow-primary-500/30' : 'bg-slate-100 text-slate-400'}`}>
          {icon}
        </div>
        {!last && <div className={`w-0.5 flex-1 mt-1 ${active ? 'bg-primary-200' : 'bg-slate-100'}`} style={{ minHeight: 20 }} />}
      </div>
      <div className="pb-4">
        <p className={`text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-400'}`}>{label}</p>
        {time && <p className="text-xs text-slate-400 mt-0.5">{time}</p>}
      </div>
    </div>
  );
}

export function ReportDetailModal({ report, onClose, onUpdate, currentRole = 'admin' }) {
  const [manualStatus, setManualStatus] = useState(report?.status || 'Pending');
  const [updating, setUpdating] = useState(false);

  // Admin -> Authority
  const [selectedDept, setSelectedDept] = useState('mbmb');
  const [dispatchNote, setDispatchNote] = useState('');
  
  // Authority -> Worker
  const [workerName, setWorkerName] = useState('');
  const [assignNote, setAssignNote] = useState('');
  
  // Worker -> Proof
  const [workerProofNote, setWorkerProofNote] = useState('');
  const [workerFile, setWorkerFile] = useState(null);

  // Authority -> Resolve
  const [authorityNote, setAuthorityNote] = useState('');

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  // Fullscreen image state
  const [fullScreenImage, setFullScreenImage] = useState(null);

  useEffect(() => {
    if (report) {
      setManualStatus(report.status || 'Pending');
      setSelectedDept(suggestDepartment(report));
      setDispatchNote('');
      setWorkerName('');
      setAssignNote('');
      setWorkerProofNote('');
      setWorkerFile(null);
      setAuthorityNote('');
      setActionError(null);
      setActionSuccess(null);
    }
  }, [report?.id]);

  if (!report) return null;

  const style = getStatusStyle(report.status);

  // 5-Step Timeline
  const steps = [
    { label: 'Report Submitted', icon: <AlertTriangle size={14} />, time: fmtDate(report.timestamp), done: true },
    { label: report.reviewed_at ? `Approved & Forwarded to ${report.assigned_department || 'Authority'}` : 'Awaiting Review', icon: <Send size={14} />, time: fmtDate(report.reviewed_at || report.forwarded_at), done: !!report.reviewed_at },
    { label: report.in_process_at ? `Assigned to Worker: ${report.assigned_worker || 'Unknown'}` : 'Awaiting Worker Assignment', icon: <HardHat size={14} />, time: fmtDate(report.in_process_at), done: !!report.in_process_at },
    { label: report.completion_submitted_at ? 'Maintenance Completed' : (report.in_maintenance_at ? 'Maintenance In Progress' : 'Awaiting Maintenance'), icon: <Wrench size={14} />, time: fmtDate(report.completion_submitted_at || report.in_maintenance_at), done: !!report.in_maintenance_at },
    { label: report.resolved_at ? 'Resolved & Verified' : 'Awaiting Verification', icon: <ShieldCheck size={14} />, time: fmtDate(report.resolved_at), done: !!report.resolved_at },
  ];

  const execAction = async (actionFn, successMsg) => {
    try {
      setActionLoading(true); setActionError(null);
      const res = await actionFn();
      onUpdate(report.id, res); // res is the updated report from backend
      setActionSuccess(successMsg);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleManualUpdate = () => execAction(
    () => updateReportStatus(report.id, manualStatus), 
    'Status manually overridden.'
  );

  const handleAdminApprove = () => execAction(
    () => {
      const deptName = AUTHORITIES.find(a => a.id === selectedDept)?.name || selectedDept;
      return adminReview(report.id, deptName, dispatchNote);
    },
    'Report approved and sent to Local Authority.'
  );

  const handleAuthorityAssign = () => {
    if (!workerName.trim()) return setActionError('Worker name is required.');
    return execAction(
      () => assignWorker(report.id, workerName, assignNote),
      'Worker assigned. Task is now In Process.'
    );
  };

  const handleWorkerStart = () => execAction(
    () => startMaintenance(report.id),
    'Maintenance started.'
  );

  const handleWorkerComplete = () => {
    if (!workerProofNote.trim()) return setActionError('Please provide completion notes.');
    return execAction(
      () => completeTask(report.id, workerProofNote, workerFile),
      'Proof submitted successfully. Awaiting Authority confirmation.'
    );
  };

  const handleAuthorityResolve = () => {
    if (!authorityNote.trim()) return setActionError('Please provide resolution verification notes.');
    return execAction(
      () => authorityResolve(report.id, authorityNote),
      'Report fully resolved.'
    );
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Report #{report.id}</h2>
              <p className="text-xs text-slate-400">{fmtDate(report.timestamp) || 'Unknown Date'}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-bold border ${style.bg} ${style.text} ${style.border}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot} mr-1.5`} />
              {report.status || 'Pending'}
            </span>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Main Image */}
          <div className="w-full h-52 bg-slate-100 relative shrink-0">
            {report.image_path ? (
              <img 
                src={getImageUrl(report.image_path)} 
                alt="Issue" 
                className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity" 
                onClick={() => setFullScreenImage(getImageUrl(report.image_path))}
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} 
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400" style={{ display: report.image_path ? 'none' : 'flex' }}>
              <ImageIcon size={40} className="opacity-40 mb-2" />
              <p className="text-sm font-medium">No Image Provided</p>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Category + Description + AI */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Category</p>
              <p className="text-xl font-bold text-slate-900">{report.categories || 'Uncategorized'}</p>
            </div>

            {report.ai_prediction && (
              <div className="bg-primary-50 rounded-xl p-4 border border-primary-100 flex items-start gap-3">
                <div className="bg-white p-2 rounded-lg text-primary-600 shadow-sm shrink-0">
                  <Brain size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-primary-700 uppercase tracking-wider mb-1">AI Analysis</p>
                  <p className="text-sm font-semibold text-slate-900 mb-2">{report.ai_prediction}</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-primary-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full" style={{ width: report.confidence || '0%' }} />
                    </div>
                    <span className="text-xs font-bold text-primary-700 shrink-0">{report.confidence}</span>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Description</p>
              <p className="text-slate-700 text-sm leading-relaxed bg-slate-50 p-4 rounded-xl border border-slate-100">
                {report.description || 'No description provided.'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Location</p>
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-3 flex items-start gap-3 border-b border-slate-100">
                  <MapPin className="text-slate-400 shrink-0 mt-0.5" size={16} />
                  <p className="text-sm text-slate-700">{report.address || report.location || 'Not available'}</p>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Lifecycle Timeline</p>
              <div className="pl-1">
                {steps.map((s, i) => (
                  <TimelineStep key={i} icon={s.icon} label={s.label} time={s.time} active={s.done} last={i === steps.length - 1} />
                ))}
              </div>
            </div>

            {/* Notes Thread */}
            {report.authority_notes && (
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-100">
                  <MessageSquare size={14} className="text-slate-500" />
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wider">Communication Thread</p>
                </div>
                <div className="p-4 space-y-2">
                  {report.authority_notes.split('\n').map((line, i) => {
                    const isAuth = line.startsWith('[Authority]');
                    const isAdmin = line.startsWith('[Admin]');
                    const isRes = line.startsWith('[Resolved]');
                    return (
                      <div key={i} className={`flex items-start gap-2 p-3 rounded-lg text-sm bg-white border border-slate-100`}>
                        <span className="text-xs font-bold shrink-0 mt-0.5 text-slate-500">📝</span>
                        <p className="text-sm text-slate-700">{line}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Worker Proof Display (Visible to all if it exists) */}
            {report.worker_completed && (
              <div className="bg-purple-50 rounded-xl border border-purple-200 overflow-hidden">
                <div className="px-4 py-3 bg-purple-100 flex items-center gap-2 border-b border-purple-200">
                  <Camera size={14} className="text-purple-700" />
                  <p className="text-xs font-bold text-purple-800 uppercase tracking-wider">Worker Completion Proof</p>
                </div>
                <div className="p-4">
                  {report.completion_image_path && (
                    <img 
                      src={getImageUrl(report.completion_image_path)} 
                      alt="Proof" 
                      className="w-full h-40 object-cover rounded-lg mb-3 border border-purple-200 cursor-pointer hover:opacity-90 transition-opacity" 
                      onClick={() => setFullScreenImage(getImageUrl(report.completion_image_path))}
                    />
                  )}
                  <p className="text-sm text-purple-900 bg-white p-3 rounded-lg border border-purple-100">{report.completion_notes}</p>
                  <p className="text-xs text-purple-600 mt-2 text-right">Submitted: {fmtDate(report.completion_submitted_at)}</p>
                </div>
              </div>
            )}

            {/* =========================================
                ROLE-BASED ACTION PANELS 
                ========================================= */}

            {/* 1. ADMIN PANEL (Pending) */}
            {currentRole === 'admin' && report.status === 'Pending' && (
              <div className="bg-orange-50 border border-orange-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 bg-orange-500">
                  <Send size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Approve & Forward to Authority</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-orange-800 mb-2">Select Authority</label>
                    <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-300">
                      {AUTHORITIES.map(a => <option key={a.id} value={a.id}>[{a.abbr}] {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-orange-800 mb-2">Admin Note</label>
                    <textarea value={dispatchNote} onChange={e => setDispatchNote(e.target.value)} rows={2} className="w-full px-3 py-2 bg-white border border-orange-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-300" />
                  </div>
                  <button onClick={handleAdminApprove} disabled={actionLoading} className="w-full py-3 bg-orange-600 text-white font-bold text-sm rounded-xl hover:bg-orange-700 disabled:opacity-50">
                    {actionLoading ? 'Approving...' : 'Approve & Send'}
                  </button>
                </div>
              </div>
            )}

            {/* 2. AUTHORITY PANEL (In Review) - Assign Worker */}
            {currentRole?.startsWith('authority') && report.status === 'In Review' && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 bg-amber-500">
                  <HardHat size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Assign Task to Worker</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-amber-800 mb-2">Worker / Contractor Name</label>
                    <input type="text" value={workerName} onChange={e => setWorkerName(e.target.value)} placeholder="e.g. Ali (Team Alpha)" className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-300" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-amber-800 mb-2">Assignment Notes</label>
                    <textarea value={assignNote} onChange={e => setAssignNote(e.target.value)} rows={2} className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-300" />
                  </div>
                  <button onClick={handleAuthorityAssign} disabled={actionLoading || !workerName} className="w-full py-3 bg-amber-600 text-white font-bold text-sm rounded-xl hover:bg-amber-700 disabled:opacity-50">
                    {actionLoading ? 'Assigning...' : 'Assign Task'}
                  </button>
                </div>
              </div>
            )}

            {/* 3. WORKER PANEL (In Process) - Start Work */}
            {currentRole?.startsWith('worker') && report.status === 'In Process' && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center">
                <Wrench size={32} className="text-blue-500 mx-auto mb-3" />
                <h3 className="font-bold text-blue-900 mb-2">You've been assigned this task</h3>
                <p className="text-sm text-blue-700 mb-4">Click below when you have arrived at the location and are starting the maintenance work.</p>
                <button onClick={handleWorkerStart} disabled={actionLoading} className="w-full py-3 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50">
                  {actionLoading ? 'Updating...' : 'Accept & Start Work'}
                </button>
              </div>
            )}

            {/* 4. WORKER PANEL (In Maintenance) - Submit Proof */}
            {currentRole?.startsWith('worker') && report.status === 'In Maintenance' && !report.worker_completed && (
              <div className="bg-purple-50 border border-purple-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 bg-purple-500">
                  <Camera size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Submit Completion Proof</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-purple-800 mb-2">Upload Photo Proof</label>
                    <input type="file" accept="image/*" onChange={e => setWorkerFile(e.target.files[0])} className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-purple-800 mb-2">Completion Notes</label>
                    <textarea value={workerProofNote} onChange={e => setWorkerProofNote(e.target.value)} placeholder="Describe what was fixed..." rows={3} className="w-full px-3 py-2 bg-white border border-purple-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-300" />
                  </div>
                  <button onClick={handleWorkerComplete} disabled={actionLoading || !workerProofNote} className="w-full py-3 bg-purple-600 text-white font-bold text-sm rounded-xl hover:bg-purple-700 disabled:opacity-50">
                    {actionLoading ? 'Submitting...' : 'Submit Proof'}
                  </button>
                </div>
              </div>
            )}

            {/* 5. AUTHORITY PANEL (In Maintenance + worker completed) - Confirm Resolve */}
            {currentRole?.startsWith('authority') && report.status === 'In Maintenance' && report.worker_completed && (
              <div className="bg-green-50 border border-green-200 rounded-2xl overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-4 bg-green-500">
                  <ShieldCheck size={18} className="text-white" />
                  <p className="text-sm font-bold text-white">Verify & Resolve</p>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-sm text-green-800">The worker has submitted proof of completion. Please review the notes and photo above to verify the fix.</p>
                  <div>
                    <label className="block text-xs font-semibold text-green-800 mb-2">Verification Notes (Optional)</label>
                    <textarea value={authorityNote} onChange={e => setAuthorityNote(e.target.value)} placeholder="Looks good..." rows={2} className="w-full px-3 py-2 bg-white border border-green-200 rounded-xl text-sm focus:ring-2 focus:ring-green-300" />
                  </div>
                  <button onClick={handleAuthorityResolve} disabled={actionLoading} className="w-full py-3 bg-green-600 text-white font-bold text-sm rounded-xl hover:bg-green-700 disabled:opacity-50">
                    {actionLoading ? 'Verifying...' : 'Confirm Resolved'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer — Manual Override */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
          {actionError && (
            <div className="mb-3 p-3 bg-red-50 text-red-600 text-xs rounded-lg border border-red-100 flex items-center gap-2">
              <AlertTriangle size={14} /> {actionError}
            </div>
          )}
          {actionSuccess && (
            <div className="mb-3 p-3 bg-green-50 text-green-700 text-xs rounded-lg border border-green-100 flex items-center gap-2">
              <CheckCircle2 size={14} /> {actionSuccess}
            </div>
          )}
          <div className="flex items-center gap-2">
            <RotateCcw size={13} className="text-slate-400 shrink-0" />
            <p className="text-xs text-slate-400 font-medium mr-auto">Manual override</p>
            <div className="relative">
              <select value={manualStatus} onChange={e => setManualStatus(e.target.value)} className="appearance-none bg-white border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-2 pr-7 focus:ring-2 focus:ring-primary-500 font-medium">
                <option value="Pending">Pending</option>
                <option value="In Review">In Review</option>
                <option value="In Process">In Process</option>
                <option value="In Maintenance">In Maintenance</option>
                <option value="Resolved">Resolved</option>
              </select>
              <ChevronDown size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <button onClick={handleManualUpdate} disabled={actionLoading || manualStatus === report.status} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white text-xs font-bold rounded-lg hover:bg-primary-600 disabled:opacity-40 shadow-sm">
              <CheckCircle2 size={13} /> Save
            </button>
          </div>
        </div>
      </div>

      {/* Full Screen Image Viewer */}
      {fullScreenImage && (
        <div 
          className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setFullScreenImage(null)}
        >
          <button 
            className="absolute top-6 right-6 text-white/70 hover:text-white bg-black/50 p-2 rounded-full backdrop-blur-sm transition-colors"
            onClick={(e) => { e.stopPropagation(); setFullScreenImage(null); }}
          >
            <X size={24} />
          </button>
          <img 
            src={fullScreenImage} 
            alt="Full Screen" 
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default"
            onClick={(e) => e.stopPropagation()} 
          />
        </div>
      )}
    </>
  );
}
