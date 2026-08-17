// AI dataset review API.
//
// Mirrors the conventions in reportsApi.js: same base-URL resolution, same
// bearer-token header, same "throw on non-ok" contract.

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  // '/api' routes through the Vite dev proxy (vite.config.js) — see the
  // matching comment in reportsApi.js for why it must not be stripped here.
  if (envUrl === '/api') return envUrl;
  if (envUrl && envUrl.trim() !== '') {
    return envUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  }
  return 'https://smart-city-citizen-app-git-main-lousieboyys-projects.vercel.app';
};
const API_URL = getApiUrl();

function getAuthHeaders() {
  const token = localStorage.getItem('smart_city_jwt_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Counts by status and class, plus storage configuration state. */
export const fetchDatasetStats = async () => {
  const response = await fetch(`${API_URL}/dataset/stats`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch dataset stats');
  return response.json();
};

/** List collected samples. status: pending | approved | rejected | skipped | all */
export const fetchDatasetSamples = async (status = 'pending', limit = 100, offset = 0) => {
  const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  const response = await fetch(`${API_URL}/dataset/samples?${params}`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch dataset samples');
  return response.json();
};

/** Accept a sample into the training pool, optionally correcting its label. */
export const approveSample = async (sampleId, classLabel = null, note = '') => {
  const response = await fetch(`${API_URL}/dataset/${sampleId}/approve`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ class_label: classLabel, note }),
  });
  if (!response.ok) throw new Error('Failed to approve sample');
  return response.json();
};

/** Exclude a sample from training. The row is kept so its hash still blocks duplicates. */
export const rejectSample = async (sampleId, note = '') => {
  const response = await fetch(`${API_URL}/dataset/${sampleId}/reject`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ class_label: null, note }),
  });
  if (!response.ok) throw new Error('Failed to reject sample');
  return response.json();
};

/** Push buffered samples to the dataset repo in a single commit. */
export const syncDataset = async () => {
  const response = await fetch(`${API_URL}/dataset/sync`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to sync dataset');
  return response.json();
};

/** Full forensic signal breakdown for one report's image. */
export const fetchReportAuthenticity = async (reportId) => {
  const response = await fetch(`${API_URL}/reports/${reportId}/authenticity`, {
    headers: getAuthHeaders(),
  });
  if (!response.ok) throw new Error('Failed to fetch authenticity');
  return response.json();
};

// ── Presentation helpers ───────────────────────────────────────────────────

/**
 * How each verdict should read to a human.
 *
 * "metadata_stripped" deliberately reads as neutral, not as an accusation:
 * screenshots, WhatsApp forwards and social downloads all lose their metadata,
 * so it means "cannot tell", not "fake".
 */
export const VERDICT_LABELS = {
  ai_confirmed:        { label: 'AI generated',    tone: 'danger',  hint: 'Provenance metadata declares this image was synthesised' },
  likely_ai_generated: { label: 'Likely AI',       tone: 'danger',  hint: 'Strong synthetic indicators, no camera evidence' },
  likely_edited:       { label: 'Edited',          tone: 'warn',    hint: 'Processed in photo-editing software' },
  metadata_stripped:   { label: 'No metadata',     tone: 'neutral', hint: 'Cannot determine origin — typical of screenshots and re-shared images' },
  likely_camera:       { label: 'Likely camera',   tone: 'ok',      hint: 'Some camera metadata present' },
  camera_verified:     { label: 'Camera verified', tone: 'ok',      hint: 'Full camera metadata cluster present' },
};

export const describeVerdict = (verdict) =>
  VERDICT_LABELS[verdict] || { label: verdict || 'Unknown', tone: 'neutral', hint: '' };

/** Class names the model can be trained on, for the relabel dropdown. */
export const TRAINABLE_CLASSES = [
  'Broken Sidewalk', 'Drainage', 'Fallen Tree', 'Illegal Dumping', 'Normal',
  'Open Burning', 'Overgrown Vegetation', 'Pothole', 'Road Sign',
  'Street Light', 'Vandalism',
];

export const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return imagePath;
  if (imagePath.startsWith('data:image')) return imagePath;
  const path = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
  return `${API_URL}${path}`;
};
