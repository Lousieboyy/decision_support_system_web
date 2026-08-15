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

export const fetchReports = async (role = 'admin') => {
  const response = await fetch(`${API_URL}/reports?role=${role}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch reports');
  return response.json();
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

// STEP 2 — Authority dispatches to a team pool (worker_id optional pin)
export const dispatchToTeam = async (reportId, agency_id, worker_id = null, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/dispatch`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ agency_id, worker_id, note }),
  });
  if (!response.ok) throw await parseError(response, 'Failed to dispatch report');
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

export const getImageUrl = (imagePath) => {
  if (!imagePath) return 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=800&q=80';
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  if (imagePath.startsWith('data:image')) return imagePath;
  const path = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  return `${API_URL}${path}`;
};
