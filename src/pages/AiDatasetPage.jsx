import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, CheckCircle2, ShieldAlert, Camera, ImageOff, CloudUpload,
  Database, AlertTriangle, Bot, Pencil,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import {
  fetchDatasetStats, fetchDatasetSamples, approveSample, rejectSample,
  syncDataset, describeVerdict, TRAINABLE_CLASSES, getImageUrl,
} from '../api/datasetApi';

const PANEL = {
  background: 'rgba(255,255,255,0.055)',
  backdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,0.09)',
};

const TONE_STYLES = {
  danger:  { background: 'rgba(239,68,68,0.12)',  color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)' },
  warn:    { background: 'rgba(234,179,8,0.12)',  color: '#fde047', border: '1px solid rgba(234,179,8,0.3)' },
  ok:      { background: 'rgba(34,197,94,0.12)',  color: '#86efac', border: '1px solid rgba(34,197,94,0.3)' },
  neutral: { background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)' },
};

function VerdictBadge({ verdict }) {
  const { label, tone, hint } = describeVerdict(verdict);
  const Icon = tone === 'danger' ? Bot : tone === 'ok' ? Camera : tone === 'warn' ? Pencil : ImageOff;
  return (
    <span
      title={hint}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap"
      style={TONE_STYLES[tone]}
    >
      <Icon size={12} /> {label}
    </span>
  );
}

function StatTile({ icon, label, value, sub }) {
  return (
    <div className="rounded-2xl p-5" style={PANEL}>
      <div className="flex items-center gap-2 mb-2" style={{ color: 'rgba(148,163,184,0.65)' }}>
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-3xl font-bold" style={{ color: '#f1f5f9' }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>{sub}</p>}
    </div>
  );
}

export function AiDatasetPage() {
  const [tab, setTab] = useState('pending');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [relabel, setRelabel] = useState({});

  // One state object tagged with the tab it belongs to. Loading is then derived
  // rather than stored, which keeps the fetch effect free of synchronous
  // setState calls and avoids a cascading render on every tab switch.
  const [view, setView] = useState(null);

  const loading = !view || view.tab !== tab;
  const stats = view?.stats ?? null;
  const samples = view?.samples ?? [];
  const total = view?.total ?? 0;

  const refresh = useCallback(async () => {
    try {
      // "health" is a stats-only view; there is no sample list behind it.
      const isQueue = tab !== 'health';
      const [statsData, sampleData] = await Promise.all([
        fetchDatasetStats(),
        isQueue ? fetchDatasetSamples(tab) : Promise.resolve({ samples: [], total: 0 }),
      ]);
      setView({
        tab,
        stats: statsData,
        samples: Array.isArray(sampleData.samples) ? sampleData.samples : [],
        total: sampleData.total || 0,
      });
      setError('');
    } catch (e) {
      // Keep the last good stats on screen so the tiles don't blank out.
      setView(prev => ({ tab, stats: prev?.stats ?? null, samples: [], total: 0 }));
      setError(e.message || 'Could not load the dataset. Is the backend running?');
    }
  }, [tab]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleApprove = async (sample) => {
    setBusyId(sample.id);
    try {
      const chosen = relabel[sample.id] || null;
      await approveSample(sample.id, chosen);
      setNotice(`Sample #${sample.id} approved${chosen ? ` as ${chosen}` : ''}.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (sample) => {
    setBusyId(sample.id);
    try {
      await rejectSample(sample.id);
      setNotice(`Sample #${sample.id} rejected and removed from the training pool.`);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleSync = async () => {
    setNotice('');
    setError('');
    try {
      const result = await syncDataset();
      if (result.status === 'success') {
        setNotice(`Committed ${result.committed} samples to the dataset repo.`);
      } else {
        setNotice(result.message);
      }
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const byStatus = stats?.by_status || {};
  const pendingCount = byStatus.pending || 0;

  // Merge the base training set with collected samples so the balance chart
  // shows what the model would actually train on, not just the new arrivals.
  const chartData = (() => {
    if (!stats) return [];
    const base = stats.base_dataset || {};
    const collected = stats.by_class || {};
    const classes = new Set([...Object.keys(base), ...Object.keys(collected)]);
    return [...classes].sort().map(name => ({
      name: name.replace(/_/g, ' '),
      base: base[name] || 0,
      collected: collected[name] || 0,
      total: (base[name] || 0) + (collected[name] || 0),
    }));
  })();

  const counts = chartData.map(d => d.total).filter(Boolean);
  const imbalance = counts.length ? Math.max(...counts) / Math.min(...counts) : 0;

  return (
    <div className="p-8 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="page-header-title">AI Dataset</h1>
          <p className="page-header-sub">
            Review images the AI collected from reports, and control what it learns from.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(203,213,225,0.85)' }}
          >
            <CloudUpload size={15} /> Sync to GitHub
          </button>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-semibold transition-colors"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(203,213,225,0.85)' }}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-3 p-4 rounded-2xl" style={TONE_STYLES.danger}>
          <AlertTriangle size={18} />
          <p className="text-sm font-semibold">{error}</p>
        </div>
      )}
      {notice && (
        <div className="mb-6 flex items-center gap-3 p-4 rounded-2xl" style={PANEL}>
          <CheckCircle2 size={18} style={{ color: '#86efac' }} />
          <p className="text-sm" style={{ color: '#e2e8f0' }}>{notice}</p>
          <button onClick={() => setNotice('')} className="ml-auto text-xs" style={{ color: 'rgba(148,163,184,0.7)' }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Storage warning — without this, nothing the AI learns survives a redeploy */}
      {stats && !stats.storage_configured && (
        <div className="mb-6 flex items-start gap-3 p-4 rounded-2xl" style={TONE_STYLES.warn}>
          <ShieldAlert size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-bold text-sm">Dataset storage is not configured</p>
            <p className="text-xs mt-1 opacity-90">
              Collected images are being kept on the server's local disk, which is wiped on every
              redeploy and cold start. Set <code>GITHUB_TOKEN</code> and <code>DATASET_REPO</code> in
              the backend environment so samples are committed to a private repo and actually persist.
            </p>
          </div>
        </div>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile icon={<Database size={14} />} label="Collected" value={stats?.total ?? '—'}
                  sub="images harvested from reports" />
        <StatTile icon={<CheckCircle2 size={14} />} label="Approved" value={byStatus.approved ?? 0}
                  sub="in the training pool" />
        <StatTile icon={<AlertTriangle size={14} />} label="Awaiting review" value={pendingCount}
                  sub="need a human decision" />
        <StatTile icon={<Bot size={14} />} label="Rejected" value={byStatus.rejected ?? 0}
                  sub="excluded from training" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6 border-b border-white/5 pb-3">
        {[
          { id: 'pending', label: `Pending Review (${pendingCount})` },
          { id: 'approved', label: `Approved (${byStatus.approved ?? 0})` },
          { id: 'rejected', label: `Rejected (${byStatus.rejected ?? 0})` },
          { id: 'health', label: 'Model Health' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.id ? 'text-white shadow-sm' : 'hover:text-slate-300'
            }`}
            style={tab === t.id
              ? { background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.18)' }
              : { color: 'rgba(148,163,184,0.7)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* MODEL HEALTH */}
      {tab === 'health' && (
        <div className="space-y-6">
          <div className="rounded-2xl p-6" style={PANEL}>
            <h2 className="font-bold mb-1" style={{ color: '#f1f5f9' }}>Class balance</h2>
            <p className="text-xs mb-5" style={{ color: 'rgba(148,163,184,0.65)' }}>
              Images per class across the base dataset and newly collected samples.
            </p>

            {imbalance >= 3 && (
              <div className="mb-5 flex items-start gap-3 p-3 rounded-xl" style={TONE_STYLES.warn}>
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <p className="text-xs">
                  Classes are imbalanced by <strong>{imbalance.toFixed(1)}×</strong>. The model will
                  lean toward over-represented classes; collect more examples of the smaller ones
                  before retraining.
                </p>
              </div>
            )}

            <div style={{ width: '100%', height: 340, overflowX: 'auto' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 60, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" />
                  <XAxis dataKey="name" angle={-40} textAnchor="end" interval={0}
                         tick={{ fill: 'rgba(148,163,184,0.75)', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'rgba(148,163,184,0.75)', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, color: '#e2e8f0' }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Bar dataKey="base" stackId="a" name="Base dataset" fill="rgba(148,163,184,0.55)" />
                  <Bar dataKey="collected" stackId="a" name="Collected" fill="#86efac">
                    {chartData.map((entry, i) => <Cell key={i} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl p-6" style={PANEL}>
            <h2 className="font-bold mb-3" style={{ color: '#f1f5f9' }}>Retraining</h2>
            <p className="text-sm mb-3" style={{ color: 'rgba(203,213,225,0.85)' }}>
              Training runs offline, on a machine with TensorFlow — the deployed backend
              serves a TFLite model and cannot train.
            </p>
            <pre className="text-xs p-4 rounded-xl overflow-x-auto"
                 style={{ background: 'rgba(0,0,0,0.35)', color: '#86efac', border: '1px solid rgba(255,255,255,0.08)' }}>
python retrain_model.py --pull
            </pre>
            <p className="text-xs mt-3" style={{ color: 'rgba(148,163,184,0.65)' }}>
              Merges the approved samples with the base dataset, trains, and only replaces the
              served model if it scores better on a held-out set.
            </p>
          </div>
        </div>
      )}

      {/* SAMPLE QUEUES */}
      {tab !== 'health' && (
        <div className="rounded-2xl overflow-hidden" style={PANEL}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: 'rgba(148,163,184,0.7)' }}>
              <RefreshCw size={28} className="mb-3 animate-spin opacity-50" />
              <p className="text-sm">Loading samples…</p>
            </div>
          ) : samples.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16" style={{ color: 'rgba(148,163,184,0.7)' }}>
              <CheckCircle2 size={40} className="mb-3 opacity-40" />
              <p className="font-medium">
                {tab === 'pending' ? 'Nothing awaiting review' : `No ${tab} samples`}
              </p>
              <p className="text-sm">
                {tab === 'pending'
                  ? 'High-confidence photos from verified cameras are accepted automatically.'
                  : 'Samples will appear here as citizens submit reports.'}
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="w-full text-left text-sm">
                <thead className="text-xs font-bold tracking-wider uppercase"
                       style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.07)', color: 'rgba(148,163,184,0.65)' }}>
                  <tr>
                    <th className="px-6 py-4">Image</th>
                    <th className="px-6 py-4">Proposed label</th>
                    <th className="px-6 py-4">Authenticity</th>
                    <th className="px-6 py-4">Why</th>
                    {tab === 'pending' && <th className="px-6 py-4">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                  {samples.map(sample => {
                    const preview = getImageUrl(sample.preview_url);
                    return (
                      <tr key={sample.id} className="transition-colors hover:bg-white/5 align-top">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {preview ? (
                              <img
                                src={preview}
                                alt=""
                                className="rounded-lg object-cover"
                                style={{ width: 72, height: 72, border: '1px solid rgba(255,255,255,0.1)' }}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : (
                              <div className="rounded-lg flex items-center justify-center"
                                   style={{ width: 72, height: 72, background: 'rgba(255,255,255,0.05)', color: 'rgba(148,163,184,0.5)' }}>
                                <ImageOff size={20} />
                              </div>
                            )}
                            <div className="text-xs" style={{ color: 'rgba(148,163,184,0.7)' }}>
                              <div>#{sample.id}</div>
                              {sample.report_id && <div>report {sample.report_id}</div>}
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4">
                          <p className="font-semibold mb-1" style={{ color: '#e2e8f0' }}>
                            {(sample.class_label || '—').replace(/_/g, ' ')}
                          </p>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ width: 70, background: 'rgba(255,255,255,0.08)' }}>
                              <div className="h-full rounded-full"
                                   style={{ width: `${Math.round((sample.confidence || 0) * 100)}%`, background: 'rgba(255,255,255,0.45)' }} />
                            </div>
                            <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.75)' }}>
                              {Math.round((sample.confidence || 0) * 100)}%
                            </span>
                          </div>
                          {sample.source === 'user_correction' && (
                            <span className="inline-block mt-2 text-[10px] font-bold px-2 py-0.5 rounded"
                                  style={TONE_STYLES.ok}>
                              CITIZEN CORRECTED
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-4">
                          <VerdictBadge verdict={sample.authenticity_verdict} />
                          {sample.authenticity_score != null && (
                            <p className="text-[11px] mt-1.5" style={{ color: 'rgba(148,163,184,0.6)' }}>
                              score {sample.authenticity_score}/100
                            </p>
                          )}
                        </td>

                        <td className="px-6 py-4 max-w-xs">
                          <p className="text-xs leading-relaxed" style={{ color: 'rgba(203,213,225,0.75)' }}>
                            {sample.reason}
                          </p>
                        </td>

                        {tab === 'pending' && (
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-2" style={{ minWidth: 190 }}>
                              <select
                                value={relabel[sample.id] || ''}
                                onChange={(e) => setRelabel(r => ({ ...r, [sample.id]: e.target.value }))}
                                className="px-2 py-1.5 rounded-lg text-xs"
                                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0' }}
                              >
                                <option value="">Keep proposed label</option>
                                {TRAINABLE_CLASSES.map(c => (
                                  <option key={c} value={c} style={{ background: '#0f172a' }}>{c}</option>
                                ))}
                              </select>
                              <div className="flex items-center gap-2">
                                <button
                                  disabled={busyId === sample.id}
                                  onClick={() => handleApprove(sample)}
                                  className="flex-1 px-3 py-2 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition-colors border border-white disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  disabled={busyId === sample.id}
                                  onClick={() => handleReject(sample)}
                                  className="flex-1 px-3 py-2 bg-zinc-800 text-zinc-300 text-xs font-bold rounded-xl hover:bg-zinc-700 transition-colors border border-zinc-700 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {samples.length > 0 && (
            <div className="px-6 py-3 text-xs" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color: 'rgba(148,163,184,0.6)' }}>
              Showing {samples.length} of {total}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
