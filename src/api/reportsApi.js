const API_URL = "http://127.0.0.1:8000";

export const fetchReports = async (role = 'admin') => {
  const response = await fetch(`${API_URL}/reports/?role=${role}`);
  if (!response.ok) throw new Error('Failed to fetch reports');
  return response.json();
};

export const fetchStats = async () => {
  const response = await fetch(`${API_URL}/reports/stats`);
  if (!response.ok) throw new Error('Failed to fetch stats');
  return response.json();
};

export const fetchTimeline = async () => {
  const response = await fetch(`${API_URL}/reports/timeline`);
  if (!response.ok) throw new Error('Failed to fetch timeline');
  return response.json();
};

export const updateReportStatus = async (reportId, status) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw new Error('Failed to update status');
  return response.json();
};

// STEP 1 — Admin approves → In Review
export const adminReview = async (reportId, department, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ department, note }),
  });
  if (!response.ok) throw new Error('Failed to approve report');
  return response.json();
};

// STEP 2 — Authority assigns worker → In Process
export const assignWorker = async (reportId, worker_name, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ worker_name, note }),
  });
  if (!response.ok) throw new Error('Failed to assign worker');
  return response.json();
};

// STEP 3 — Worker accepts task → In Maintenance
export const startMaintenance = async (reportId) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/start-maintenance`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to start maintenance');
  return response.json();
};

// STEP 4 — Worker submits proof
export const completeTask = async (reportId, notes, file) => {
  const formData = new FormData();
  formData.append('notes', notes);
  if (file) formData.append('file', file);

  const response = await fetch(`${API_URL}/reports/${reportId}/complete-task`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('Failed to complete task');
  return response.json();
};

// STEP 5 — Authority confirms resolved → Resolved
export const authorityResolve = async (reportId, note = '') => {
  const response = await fetch(`${API_URL}/reports/${reportId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  if (!response.ok) throw new Error('Failed to resolve report');
  return response.json();
};

// Legacy kept for compat
export const forwardReport = async (reportId, department, note = '') => {
  return adminReview(reportId, department, note);
};

export const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  return `${API_URL}${imagePath}`;
};
