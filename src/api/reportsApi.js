const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim() !== '' && envUrl !== '/api') {
    return envUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  }
  return 'https://smart-city-citizen-app-git-main-lousieboyys-projects.vercel.app';
};
const API_URL = getApiUrl();

// Helper to get authorization headers
function getAuthHeaders() {
  const token = localStorage.getItem('smart_city_jwt_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// The backend caps each page at 200 rows (main.py: `.limit(max(1, min(limit, 200)))`)
// and defaults to 50 when no limit is sent. Fetching without a limit therefore
// silently truncates every analytic to the newest 50 reports.
export const REPORTS_PAGE_SIZE = 200;
export const MAX_REPORTS = 5000;

// `role` is vestigial — the backend scopes off the JWT — but it is kept so the
// existing call sites and Cypress intercepts (`**/reports*`) keep working.
export const fetchReports = async (role = 'admin', { limit, offset } = {}) => {
  const qs = new URLSearchParams({ role });
  if (limit != null) qs.set('limit', String(limit));
  if (offset != null) qs.set('offset', String(offset));
  const response = await fetch(`${API_URL}/reports?${qs}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch reports');
  return response.json();
};

// Walks every page so callers get the whole dataset rather than the newest 50.
// Stops on the first short page, or at MAX_REPORTS as a runaway guard.
export const fetchAllReports = async (role = 'admin') => {
  const all = [];
  for (let offset = 0; offset < MAX_REPORTS; offset += REPORTS_PAGE_SIZE) {
    const page = await fetchReports(role, { limit: REPORTS_PAGE_SIZE, offset });
    if (!Array.isArray(page)) break;
    all.push(...page);
    if (page.length < REPORTS_PAGE_SIZE) break;
  }
  return all;
};

export const fetchStats = async () => {
  const response = await fetch(`${API_URL}/reports/stats`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
};

export const fetchTimeline = async () => {
  const response = await fetch(`${API_URL}/reports/timeline`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch timeline');
  return response.json();
};

export const updateReportStatus = async (reportId, status) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/status`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('Failed to update status');
  return response.json();
};

// STEP 1 — Admin approves → In Review
export const adminReview = async (reportId, department, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/review`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ department, note }),
  });
  if (!response.ok) throw new Error('Failed to approve report');
  return response.json();
};

// Admin rejects report → Rejected
export const adminReject = async (reportId, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/reject`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ note }),
  });
  if (!response.ok) throw new Error('Failed to reject report');
  return response.json();
};

// STEP 2 — Authority assigns worker → In Process
export const assignWorker = async (reportId, worker_name, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/assign`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ worker_name, note }),
  });
  if (!response.ok) throw new Error('Failed to assign worker');
  return response.json();
};

// ── TEAM DISPATCH ───────────────────────────────────────────
// Read the server's error detail so the UI can show why an action was refused
// (wrong team, already claimed, ...) instead of a generic failure message.
async function parseError(response, fallback) {
  let detail = fallback;
  try {
    const body = await response.json();
    if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : fallback;
  } catch {
    /* non-JSON error body — keep the fallback */
  }
  const err = new Error(detail);
  err.status = response.status;
  return err;
}

export const fetchTeams = async () => {
  const response = await fetch(`${API_URL}/teams`, { headers: getAuthHeaders() });
  if (!response.ok) throw await parseError(response, 'Failed to load teams');
  return response.json();
};

export const fetchTeamWorkers = async (teamId) => {
  const response = await fetch(`${API_URL}/teams/${teamId}/workers`, { headers: getAuthHeaders() });
  if (!response.ok) throw await parseError(response, 'Failed to load team roster');
  return response.json();
};

export const fetchTeamWorkload = async () => {
  const response = await fetch(`${API_URL}/teams/workload`, { headers: getAuthHeaders() });
  if (!response.ok) throw await parseError(response, 'Failed to load team workload');
  return response.json();
};

// STEP 2 — Authority dispatches to a team pool (crew_id/worker_id optional)
export const dispatchToTeam = async (reportId, agency_id, worker_id = null, note = '', crew_id = null) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/dispatch`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ agency_id, crew_id, worker_id, note }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to dispatch report');
  return response.json();
};

// Move a report between crews (or back to the general pool) within the same
// agency. No approval needed — unlike a cross-team transfer, work never
// leaves the agency.
export const reassignCrew = async (reportId, crew_id, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/reassign-crew`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ crew_id, note }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to reassign crew');
  return response.json();
};

// ── CREWS — sub-teams within one agency ─────────────────────
export const fetchCrews = async (agencyId) => {
  const response = await fetch(`${API_URL}/agencies/${agencyId}/crews`, { headers: getAuthHeaders() });
  if (!response.ok) throw await parseError(response, 'Failed to load crews');
  return response.json();
};

export const fetchCrewWorkload = async (agencyId) => {
  const response = await fetch(`${API_URL}/agencies/${agencyId}/crews/workload`, { headers: getAuthHeaders() });
  if (!response.ok) throw await parseError(response, 'Failed to load crew workload');
  return response.json();
};

export const createCrew = async (agencyId, name) => {
  const response = await fetch(`${API_URL}/agencies/${agencyId}/crews`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to create crew');
  return response.json();
};

export const updateCrew = async (crewId, { name, status } = {}) => {
  const response = await fetch(`${API_URL}/crews/${crewId}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ name, status }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to update crew');
  return response.json();
};

export const deleteCrew = async (crewId) => {
  const response = await fetch(`${API_URL}/crews/${crewId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw await parseError(response, 'Failed to delete crew');
  return response.json();
};

export const addCrewMember = async (crewId, staffId) => {
  const response = await fetch(`${API_URL}/crews/${crewId}/members`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ staff_id: staffId }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to add crew member');
  return response.json();
};

export const removeCrewMember = async (crewId, staffId) => {
  const response = await fetch(`${API_URL}/crews/${crewId}/members/${staffId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw await parseError(response, 'Failed to remove crew member');
  return response.json();
};

export const setStaffLeave = async (staffId, onLeave) => {
  const response = await fetch(`${API_URL}/staff/${staffId}/leave`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ on_leave: onLeave }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to update leave status');
  return response.json();
};

export const transferReport = async (reportId, to_agency_id, reason = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/transfer`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ to_agency_id, reason }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to transfer report');
  return response.json();
};

// Worker claims an unclaimed job from their team pool. A 409 means another
// worker got there first — callers should surface that, not retry.
export const claimReport = async (reportId) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/claim`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw await parseError(response, 'Failed to claim task');
  return response.json();
};

export const releaseReport = async (reportId, reason = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/release`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to release report');
  return response.json();
};

export const fetchTransfers = async (status = 'pending') => {
  const response = await fetch(`${API_URL}/transfers?status=${status}`, { headers: getAuthHeaders() });
  if (!response.ok) throw await parseError(response, 'Failed to load transfer requests');
  return response.json();
};

/**
 * Workflow audit trail, if this backend serves it.
 *
 * Returns `null` when the endpoint is absent or the caller may not read it, and
 * `[]` when it exists but has no rows. The distinction matters: the page must be
 * able to tell "no data" from "no endpoint", because they warrant different
 * captions. Every audit-derived figure has a scalar-timestamp equivalent, so a
 * missing endpoint degrades the detail rather than blanking the panel.
 */
export const fetchAuthorityActions = async ({ reportId, since, limit = 5000 } = {}) => {
  const qs = new URLSearchParams();
  if (reportId != null) qs.set('report_id', String(reportId));
  if (since) qs.set('since', since);
  qs.set('limit', String(limit));

  const response = await fetch(`${API_URL}/reports/actions?${qs}`, {
    headers: getAuthHeaders(),
  });

  // 404/405 → backend predates the endpoint. 403 → present but not for this role.
  if ([403, 404, 405, 501].includes(response.status)) return null;
  if (!response.ok) throw await parseError(response, 'Failed to load audit trail');
  return response.json();
};

export const approveTransfer = async (transferId, to_agency_id = null, note = '') => {
  const response = await fetch(`${API_URL}/transfers/${transferId}/approve`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ to_agency_id, note }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to approve transfer');
  return response.json();
};

export const denyTransfer = async (transferId, note = '') => {
  const response = await fetch(`${API_URL}/transfers/${transferId}/deny`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ to_agency_id: null, note }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to deny transfer');
  return response.json();
};

// STEP 3 — Worker accepts task → In Maintenance
export const startMaintenance = async (reportId) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/start-maintenance`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to start maintenance');
  return response.json();
};

// STEP 4 — Worker submits proof
export const completeTask = async (reportId, notes, file) => {
  const formData = new FormData();
  formData.append('notes', notes);
  if (file) formData.append('file', file);

  const token = localStorage.getItem('smart_city_jwt_token');
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}/reports/${reportId}/complete-task`, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to complete task');
  return response.json();
};

// STEP 5 — Authority confirms resolved → Resolved
export const authorityResolve = async (reportId, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/resolve`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ note }),
  });
  if (!response.ok) throw new Error('Failed to resolve report');
  return response.json();
};

export const rejectProof = async (reportId, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/reject-proof`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ note }),
  });
  if (!response.ok) throw new Error('Failed to reject completion proof');
  return response.json();
};

// Legacy kept for compat
export const forwardReport = async (reportId, department, note = '') => {
  return adminReview(reportId, department, note);
};

// Trigger AI analysis on a report's image (original OR completion photo)
// Backend endpoint: POST /reports/{id}/analyze
// Returns updated report object with ai_prediction, confidence (and optionally
// completion_ai_prediction, completion_confidence if backend supports it)
export const analyzeReportImage = async (reportId) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/analyze`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('AI analysis failed or endpoint not available');
  return response.json();
};

// Returns null when there is no image, rather than a stock photo. A report with
// no photo used to render a stranger's street scene from Unsplash, which reads
// as the citizen's evidence and is not.
export const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  if (imagePath.startsWith('data:image')) return imagePath;
  const path = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  return `${API_URL}${path}`;
};
