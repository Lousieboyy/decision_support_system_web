const API_URL = import.meta.env.VITE_API_URL || "/api";

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
  const response = await fetch(`${API_URL}/reports/?role=${role}`, {
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
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  const path = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  return `${API_URL}${path}`;
};
