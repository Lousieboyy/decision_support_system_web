import { useEffect, useState, useMemo, Fragment } from 'react';
import { fetchAllReports, fetchAuthorityActions } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine, PieChart, Pie, ErrorBar, LabelList,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { MapContainer, TileLayer, useMap, Circle, CircleMarker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle, Download, Info, MapPin, RefreshCw,
  CheckCircle2, ChevronRight, Heart, Activity, Truck,
  Search, X,
} from 'lucide-react';
import { format, parseISO, subDays, endOfDay } from 'date-fns';
import {
  SLA_END_TO_END_DAYS, SLA_TARGET_DAYS, CLUSTER, REINCIDENCE, INSIGHT,
  MIN_N_FOR_SCORE, MIN_N_FOR_STAGE, CRITICALITY, gradeFor, RISK_TONE, DEFAULT_RISK_TONE,
} from '../utils/analyticsConstants';
import {
  calculateDistance, canonicalizeCategory, deriveZone, deriveDepartmentOptions,
  buildServicePerformance, buildUrbanCondition, buildBacklogFlow, buildFunnel,
  buildReliabilityAudit, buildInfrastructureFragility, fmtDuration,
} from '../utils/analyticsMetrics';
import { AnalyticsFilterBar } from '../components/AnalyticsFilterBar';
import { CityHealthBands } from '../components/CityHealthBands';
import { DispatchAudit } from '../components/DispatchAudit';
import { RepairReliabilityModal } from '../components/RepairReliabilityModal';
import { ReportExplorerModal } from '../components/ReportExplorerModal';
import { ClusterDispatchAction } from '../components/ClusterDispatchAction';
import { getReportPriority as getPriority } from '../utils/reportPriority';

const HOTSPOT_OVERRIDES_KEY = 'analytics_hotspot_overrides_v1';

// Heatmap Layer for Leaflet Map
function HeatmapLayer({ points, ready }) {
  const map = useMap();
  useEffect(() => {
    if (!ready || !points || points.length === 0) return;
    
    // Safety check for map dimension initialization
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) {
      map.invalidateSize();
      return;
    }

    let heat;
    try {
      const heatPoints = points.map(p => [p.latitude, p.longitude, 1.5]); // Lat, Lng, Intensity
      heat = L.heatLayer(heatPoints, {
        radius: 28,
        blur: 18,
        maxZoom: 15,
        gradient: { 0.4: 'blue', 0.6: 'cyan', 0.8: 'lime', 1.0: 'red' }
      }).addTo(map);
    } catch (err) {
      console.warn("Leaflet heatmap draw deferred:", err);
    }

    return () => {
      if (map && heat) {
        try {
          map.removeLayer(heat);
        } catch (e) {
          // ignore position/unmount glitches
        }
      }
    };
  }, [map, points, ready]);
  return null;
}

const fmtRecurDate = (v) => {
  if (!v) return 'unknown date';
  const d = new Date(v);
  return isNaN(d.getTime()) ? 'unknown date' : format(d, 'd MMM yyyy');
};

// Forces Leaflet to recalculate container size on render
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      if (map) {
        try {
          map.invalidateSize();
        } catch (e) {
          // ignore
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [map]);
  return null;
}

// Controls map center and zoom dynamically
function MapController({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus && focus.center) {
      try {
        map.setView(focus.center, focus.zoom || 15.5, { animate: true });
      } catch (e) {
        // ignore
      }
    }
  }, [map, focus]);
  return null;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9'];

// Individual-ticket marker color for a selected hotspot's constituent
// reports — status, not category, since category is already the cluster's
// own badge. Only Pending/In Review/In Process/In Maintenance ever reach
// here (hotspots only cluster active reports).
const clusterMarkerColor = (status) =>
  status === 'In Process' || status === 'In Maintenance' ? '#3b82f6' : '#b45309';

// Plain-language reason for whichever factor primaryRisk names as the
// biggest driver of a cluster's priority score — the score itself is a
// blend of several inputs, but this says which one actually pushed it up.
const PRIORITY_RISK_EXPLANATION = {
  'High Public Concern': 'Mainly upvotes — a lot of people flagged this.',
  'Safety Risk': 'Mainly category — several reports here are Road Damage, Drainage, or Fallen Tree, which the system treats as safety hazards regardless of upvotes or age.',
  'Long Overdue': "Mainly age — these reports have sat open a long time.",
  'Recurring Problem': "Systemic — it spans more than one department's category, not just report count.",
  'Many Reports': 'Mainly how many reports are clustered here.',
};

export function AnalyticsPage() {
  const { role, user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);

  // Scoping and Filter State
  const [dateFilter, setDateFilter] = useState('custom');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  
  // Initialize department filter based on user role and username
  const initialDept = useMemo(() => {
    if (!role || role === 'admin') return 'all';
    const lowerRole = role.toLowerCase();
    const lowerUsername = (user?.username || '').toLowerCase();
    
    if (lowerRole.includes('jkr') || lowerUsername.includes('jkr')) return 'JKR';
    if (lowerRole.includes('mbmb') || lowerUsername.includes('mbmb')) return 'MBMB';
    if (lowerRole.includes('swcorp') || lowerUsername.includes('swcorp')) return 'SWCorp';
    
    return 'all';
  }, [role, user]);
  
  const [selectedDept, setSelectedDept] = useState(initialDept);

  useEffect(() => {
    if (initialDept !== 'all') {
      setSelectedDept(initialDept);
    }
  }, [initialDept]);

  // Hotspot Parameters
  const [proximityRadius, setProximityRadius] = useState(CLUSTER.radiusM);
  const [minClusterSize, setMinClusterSize] = useState(CLUSTER.minSize);

  // Hotspot overrides and exclusions. Persisted, because renaming a hotspot and
  // rewriting its recommendation is real analyst work that used to be discarded
  // on the next refresh.
  const [customOverrides, setCustomOverrides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(HOTSPOT_OVERRIDES_KEY) || '{}');
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HOTSPOT_OVERRIDES_KEY, JSON.stringify(customOverrides));
    } catch {
      // A full or unavailable localStorage must not break the page.
    }
  }, [customOverrides]);
  const [activeClusterId, setActiveClusterId] = useState(null);
  const [activeRecurringId, setActiveRecurringId] = useState(null);
  const [mapFocus, setMapFocus] = useState(null);
  // The Overview charts used to each pop their own single-dimension "reports
  // matching this one click" panel — date OR category OR department, never
  // combinable, which made four separate entry points into what was really
  // the same underlying question. One explorer instead: any chart click
  // pre-fills one filter here, and every filter stays live and adjustable
  // in the same modal so they can be combined (e.g. MBMB + Road Damage +
  // a specific week) rather than re-clicking through charts one at a time.
  const EMPTY_EXPLORE_FILTERS = { dateFrom: '', dateTo: '', category: 'all', department: 'all', status: 'all', zone: 'all' };
  const [exploreFilters, setExploreFilters] = useState(null); // null = modal closed
  const openExplore = (partial) => setExploreFilters({ ...EMPTY_EXPLORE_FILTERS, ...partial });
  // null = endpoint absent or forbidden; [] = present but empty. The two mean
  // different things to the UI, so they must stay distinguishable.
  const [auditActions, setAuditActions] = useState(null);
  const [activeTab, setActiveTab] = useState('single');
  const [hotspotSearch, setHotspotSearch] = useState('');
  const [activeViewTab, setActiveViewTab] = useState('overview'); // 'overview' | 'hotspots' | 'dispatch'
  const [showReliabilityModal, setShowReliabilityModal] = useState(false);
  // Lifted out of CityHealthBands so the Zone chart below it can show the
  // dimension that matches whichever score band is currently selected,
  // instead of the same resolution-rate chart under every tab.
  const [cityHealthBand, setCityHealthBand] = useState('spi');

  useEffect(() => {
    const timer = setTimeout(() => {
      setMapReady(true);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      // Pass the user role to fetchAllReports to ensure secure data fetching.
      // Paginated so analytics cover the whole dataset, not just the newest page.
      const data = await fetchAllReports(role || 'admin');

      // Optional enrichment. Held as null-when-absent so the UI can distinguish
      // "no audit rows" from "no audit endpoint", and never allowed to block the
      // page — every panel works from the scalar timestamps without it.
      fetchAuthorityActions({ since: subDays(new Date(), 90).toISOString() })
        .then(setAuditActions)
        .catch(() => setAuditActions(null));

      const reportsWithPriority = data.map(r => ({
        ...r,
        priority: getPriority(r.status, r.categories)
      }));
      setReports(reportsWithPriority);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load report data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [role]);

  // Helper to check if report date falls inside preset range
  const matchesDateFilter = (reportTimestamp) => {
    if (dateFilter === 'all') return true;
    if (!reportTimestamp) return false;
    const date = new Date(reportTimestamp);
    if (isNaN(date.getTime())) return false;

    if (dateFilter === 'custom') {
      if (customStart && date < new Date(customStart)) return false;
      if (customEnd && date > endOfDay(new Date(customEnd))) return false;
      return true;
    }

    const daysAgo = dateFilter === '7d' ? 7 : 30;
    const cutOff = subDays(new Date(), daysAgo);
    return date >= cutOff;
  };

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      // 1. Date filter
      if (!matchesDateFilter(r.timestamp)) return false;
      
      // 2. Department filter
      if (selectedDept !== 'all') {
        const deptName = r.assigned_department || '';
        const matches = deptName.toLowerCase().includes(selectedDept.toLowerCase());
        if (!matches) return false;
      }
      
      return true;
    });
  }, [reports, selectedDept, dateFilter, customStart, customEnd]);

  // 1. Proximity Clustering for Hotspot Detection
  const hotspots = useMemo(() => {
    const active = filteredReports.filter(
      (r) =>
        r.status !== 'Resolved' &&
        r.status !== 'Rejected' &&
        r.latitude != null &&
        r.longitude != null
    );

    const clusters = [];

    active.forEach((report) => {
      const canonical = canonicalizeCategory(report.categories || report.ai_prediction);
      
      // Look for an existing cluster within proximityRadius meters of the same canonical type
      let foundCluster = false;
      for (const cluster of clusters) {
        if (cluster.category === canonical) {
          // Check if this report is excluded from this cluster
          const isExcluded = customOverrides[cluster.seedId]?.excludedReportIds?.includes(report.id);
          if (isExcluded) continue;

          const match = cluster.items.some(
            (item) => calculateDistance(item.latitude, item.longitude, report.latitude, report.longitude) <= proximityRadius
          );
          if (match) {
            cluster.items.push(report);
            foundCluster = true;
            break;
          }
        }
      }

      if (!foundCluster) {
        clusters.push({
          id: `cluster-${clusters.length + 1}`,
          seedId: report.id,
          category: canonical,
          items: [report],
        });
      }
    });

    // Filter clusters with minClusterSize or more reports to represent a real hotspot
    return clusters
      .filter((c) => c.items.length >= minClusterSize)
      .map((c) => {
        const totalItems = c.items.length;
        const avgLat = c.items.reduce((sum, item) => sum + item.latitude, 0) / totalItems;
        const avgLng = c.items.reduce((sum, item) => sum + item.longitude, 0) / totalItems;
        
        // Find representative address from the most upvoted or first report
        const sortedItems = [...c.items].sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
        const defaultAddress = sortedItems[0].address || sortedItems[0].location || 'Melaka District';
        const totalUpvotes = c.items.reduce((sum, item) => sum + (item.upvotes || 0), 0);

        // Check if there are overrides for this seedId
        const override = customOverrides[c.seedId] || {};
        const address = override.customAddress || defaultAddress;

        // The recommendation is the action only — one short sentence. Count,
        // address, and upvotes are real evidence but are already shown as
        // their own stats everywhere this renders, so repeating them in the
        // sentence just made it longer without saying anything new.
        let recommendation = override.customRecommendation;
        if (!recommendation) {
          if (c.category === 'Road Damage') {
            recommendation = 'Repave the stretch — patching each pothole separately costs more.';
          } else if (c.category === 'Street Lighting') {
            recommendation = totalItems >= 4
              ? 'Check the main circuit — likely one fault, not several bulbs.'
              : 'Check for a shared electrical fault before replacing bulbs.';
          } else if (c.category === 'Waste Management') {
            recommendation = 'Add a permanent bin and more frequent SWCorp pickups.';
          } else if (c.category === 'Drainage System') {
            recommendation = 'Camera-inspect the pipe before the next rainy season.';
          } else {
            recommendation = 'One combined site visit instead of separate crews.';
          }
        }

        return {
          id: c.id,
          seedId: c.seedId,
          category: c.category,
          size: totalItems,
          latitude: avgLat,
          longitude: avgLng,
          address,
          defaultAddress,
          upvotes: totalUpvotes,
          recommendation,
          items: c.items,
        };
      })
      .sort((a, b) => b.size - a.size);
  }, [filteredReports, proximityRadius, minClusterSize, customOverrides]);

  // 1b. Cross-Department Systemic Root-Cause advisories
  const rootCauseAdvisories = useMemo(() => {
    const active = filteredReports.filter(
      (r) =>
        r.status !== 'Resolved' &&
        r.status !== 'Rejected' &&
        r.latitude != null &&
        r.longitude != null
    );

    const advisories = [];
    const visitedReportIds = new Set();

    // Sort reports by upvotes/priority so the most critical issues act as seeds
    const sortedActive = [...active].sort(
      (a, b) => (b.upvotes || 0) - (a.upvotes || 0)
    );

    sortedActive.forEach((seedReport) => {
      // If this report is already clustered into an advisory, skip it as a seed
      if (visitedReportIds.has(seedReport.id)) return;

      // Find all complaints in proximity (regardless of category)
      const groupItems = active.filter((r) => {
        // Check if report itself is excluded from this advisory seed
        const isExcluded = customOverrides[seedReport.id]?.excludedReportIds?.includes(r.id);
        if (isExcluded) return false;

        const dist = calculateDistance(
          seedReport.latitude,
          seedReport.longitude,
          r.latitude,
          r.longitude
        );
        return dist <= proximityRadius;
      });

      if (groupItems.length < minClusterSize) return;

      // Classify which canonical categories are present
      const categoriesInGroup = groupItems.map((r) =>
        canonicalizeCategory(r.categories || r.ai_prediction)
      );
      const uniqueCategories = new Set(categoriesInGroup);

      // Check rules
      const hasRoad = uniqueCategories.has('Road Damage');
      const hasDrain = uniqueCategories.has('Drainage System');
      const hasLight = uniqueCategories.has('Street Lighting');
      const hasVandalism = uniqueCategories.has('Vandalism') || uniqueCategories.has('Other Infrastructure');
      const hasWaste = uniqueCategories.has('Waste Management');

      let advisoryType = null;
      let advisoryRec = null;

      // Action only, one sentence — count, address, and upvotes are already
      // shown as their own stats wherever this renders.
      if (hasRoad && hasDrain) {
        advisoryType = 'Drainage & Road Decay';
        advisoryRec = 'Water is likely damaging the road from underneath — clear the drain before resurfacing.';
      } else if (hasLight && (hasVandalism || uniqueCategories.has('Vandalism'))) {
        advisoryType = 'Darkness & Vandalism Zone';
        advisoryRec = 'Fix the lights first — add cameras only if it keeps happening.';
      } else if (hasWaste && hasDrain) {
        advisoryType = 'Waste-Induced Drainage Blockages';
        advisoryRec = 'Clear the drain and add a trash trap at the same time.';
      }

      if (advisoryType) {
        // Mark all items in this group as visited so they don't form other advisories
        groupItems.forEach((r) => visitedReportIds.add(r.id));

        const avgLat = groupItems.reduce((sum, item) => sum + item.latitude, 0) / groupItems.length;
        const avgLng = groupItems.reduce((sum, item) => sum + item.longitude, 0) / groupItems.length;
        const totalUpvotes = groupItems.reduce((sum, item) => sum + (item.upvotes || 0), 0);
        
        const defaultAddress = seedReport.address || seedReport.location || 'Melaka District';

        // Check if there are overrides for this seedId
        const override = customOverrides[seedReport.id] || {};
        const address = override.customAddress || `Systemic Zone: ${defaultAddress}`;
        const recommendation = override.customRecommendation || advisoryRec;

        advisories.push({
          id: `advisory-${seedReport.id}`,
          seedId: seedReport.id,
          category: advisoryType,
          size: groupItems.length,
          latitude: avgLat,
          longitude: avgLng,
          address,
          defaultAddress: `Systemic Zone: ${defaultAddress}`,
          upvotes: totalUpvotes,
          recommendation,
          items: groupItems,
        });
      }
    });

    return advisories.sort((a, b) => b.size - a.size);
  }, [filteredReports, proximityRadius, minClusterSize, customOverrides]);

  // 1c. Repair reliability audit — every authority with a resolved ticket,
  // not a fixed shortlist. See buildReliabilityAudit for the methodology.
  const reliabilityAudit = useMemo(() => buildReliabilityAudit(filteredReports), [filteredReports]);
  const contractorAudit = reliabilityAudit.rows;

  // 1c.1. Predictive Hotspots (reworked) — recurring-failure locations, not
  // currently-open backlog. A resolved report that reappeared nearby within
  // REINCIDENCE.radiusM/windowDays means the earlier fix didn't hold; this
  // proximity-clusters those flagged reports using the same evidence
  // buildReliabilityAudit already computed, instead of re-deriving it.
  // Deliberately has no dispatch action: every report in a cluster here is
  // already Resolved, so there is no unclaimed work to send a crew to — this
  // is a "watch this area, the real cause likely wasn't fixed" signal, not
  // an action queue. hotspots/rootCauseAdvisories (above) are untouched and
  // still drive Dispatch & Audit, the Overview KPI cards, and Systemic.
  const recurringHotspots = useMemo(() => {
    const flagged = reliabilityAudit.rows
      .flatMap((row) => row.tickets)
      .filter((t) => t.reappearances.length > 0 && t.latitude != null && t.longitude != null);

    const clusters = [];
    flagged.forEach((ticket) => {
      let foundCluster = false;
      for (const cluster of clusters) {
        if (cluster.category === ticket.category) {
          const match = cluster.items.some(
            (item) => calculateDistance(item.latitude, item.longitude, ticket.latitude, ticket.longitude) <= proximityRadius
          );
          if (match) {
            cluster.items.push(ticket);
            foundCluster = true;
            break;
          }
        }
      }
      if (!foundCluster) {
        clusters.push({ id: `recur-${clusters.length + 1}`, category: ticket.category, items: [ticket] });
      }
    });

    return clusters
      .filter((c) => c.items.length >= minClusterSize)
      .map((c) => {
        const totalReappearances = c.items.reduce((sum, t) => sum + t.reappearances.length, 0);
        const avgLat = c.items.reduce((sum, t) => sum + t.latitude, 0) / c.items.length;
        const avgLng = c.items.reduce((sum, t) => sum + t.longitude, 0) / c.items.length;
        const representative = [...c.items].sort((a, b) => b.reappearances.length - a.reappearances.length)[0];
        return {
          id: c.id,
          category: c.category,
          size: c.items.length,
          totalReappearances,
          latitude: avgLat,
          longitude: avgLng,
          address: representative.address,
          items: c.items,
        };
      })
      .sort((a, b) => b.totalReappearances - a.totalReappearances);
  }, [reliabilityAudit, proximityRadius, minClusterSize]);

  // 1c.5. Reporter Trust Map calculation based on reports
  const reporterTrustMap = useMemo(() => {
    const userStats = {};
    reports.forEach(r => {
      const uId = r.user_id;
      if (uId === undefined || uId === null) return;
      if (!userStats[uId]) {
        userStats[uId] = { total: 0, nonRejected: 0 };
      }
      userStats[uId].total++;
      if (r.status !== 'Rejected') {
        userStats[uId].nonRejected++;
      }
    });

    const trustMap = {};
    Object.keys(userStats).forEach(uId => {
      const stats = userStats[uId];
      trustMap[uId] = stats.total > 0 ? (stats.nonRejected / stats.total) : 1.0;
    });
    return trustMap;
  }, [reports]);

  // 1d. Dynamic Criticality Score & Priority Dispatch Queue calculation
  const prioritizedDispatchQueue = useMemo(() => {
    // Combine both regular hotspots and root-cause systemic advisories
    const combined = [
      ...hotspots.map(h => ({ ...h, isSystemic: false })),
      ...rootCauseAdvisories.map(a => ({ ...a, isSystemic: true }))
    ];

    const computed = combined.map(item => {
      // Calculate Average Elapsed Days of reports inside the cluster
      // Age is measured from `timestamp`. Reading the nonexistent `created_at`
      // and defaulting to now() made every elapsed value ~0, so the aging term
      // contributed nothing to the criticality score.
      const dated = item.items.filter(r => r.timestamp && !isNaN(new Date(r.timestamp).getTime()));
      const totalDays = dated.reduce((sum, r) => (
        sum + (Date.now() - new Date(r.timestamp).getTime()) / (1000 * 60 * 60 * 24)
      ), 0);
      const avgElapsed = dated.length ? (totalDays / dated.length) : 0;

      // Count High Priority reports in the cluster. The API never serializes
      // `priority`; loadData derives it locally. Calling getPriority directly
      // removes the dependency on that mapping having run.
      const highPriorityCount = item.items.filter(
        r => getPriority(r.status, r.categories || r.ai_prediction) === 'High'
      ).length;

      // Criticality score. The tunable terms live in CRITICALITY so each one can
      // be explained; they were previously multiplied by four state values that
      // had no UI and were permanently 1.0.
      let rawScore = (item.size * CRITICALITY.size) +
                      (item.upvotes * CRITICALITY.upvote) +
                      (highPriorityCount * CRITICALITY.highPriority) +
                      (avgElapsed * CRITICALITY.agingPerDay);

      if (item.isSystemic) {
        rawScore += CRITICALITY.systemicBonus;
      }

      // Normalize score between 0 and 100
      const score = Math.min(Math.round(rawScore), 100);

      // Spatial compactness confidence score (10% - 100%)
      const totalDistance = item.items.reduce((sum, r) => {
        return sum + calculateDistance(r.latitude, r.longitude, item.latitude, item.longitude);
      }, 0);
      const avgDistance = item.items.length ? (totalDistance / item.items.length) : 0;
      const confidenceFraction = Math.max(0.1, Math.min(1.0, 1.0 - (avgDistance / proximityRadius)));
      const confidence = Math.round(confidenceFraction * 100);

      // Average citizen reporter trust score (0% - 100%)
      const totalTrust = item.items.reduce((sum, r) => {
        const t = reporterTrustMap[r.user_id] !== undefined ? reporterTrustMap[r.user_id] : 1.0;
        return sum + t;
      }, 0);
      const avgTrustFraction = item.items.length ? (totalTrust / item.items.length) : 1.0;
      const avgTrust = Math.round(avgTrustFraction * 100);

      // Unified Priority Score combining criticality, trust weight, and compactness confidence
      const trustTerm = 1.0 - (1.0 - avgTrustFraction) / CRITICALITY.trustDamping;
      const priorityScore = Math.min(100, Math.max(0, Math.round(score * trustTerm * confidenceFraction)));

      // Determine the primary driving risk factor. Labels are plain words
      // (not the dashboard-analytics phrasing this used to carry, e.g.
      // "Spatio-Temporal Decay") because the people reading this queue are
      // city officials, not data analysts.
      let primaryRisk = 'Many Reports';
      const upvoteVal = item.upvotes * CRITICALITY.upvote;
      const priorityVal = highPriorityCount * CRITICALITY.highPriority;
      const agingVal = avgElapsed * CRITICALITY.agingPerDay;

      if (upvoteVal > priorityVal && upvoteVal > agingVal) {
        primaryRisk = 'High Public Concern';
      } else if (priorityVal > upvoteVal && priorityVal > agingVal) {
        primaryRisk = 'Safety Risk';
      } else if (agingVal > upvoteVal && agingVal > priorityVal) {
        primaryRisk = 'Long Overdue';
      } else if (item.isSystemic) {
        primaryRisk = 'Recurring Problem';
      }

      // Plain-language dispatch instructions — address, size, and upvotes
      // are already shown right above this wherever it renders.
      const dispatchAdvice = item.isSystemic
        ? 'Send a joint crew from both departments to check what\'s really going on.'
        : `Send a crew to fix the ${item.category.toLowerCase()} reports here.`;

      return {
        ...item,
        score,
        confidence,
        avgTrust,
        priorityScore,
        primaryRisk,
        dispatchAdvice
      };
    });

    // Sort by priority score descending
    return computed.sort((a, b) => b.priorityScore - a.priorityScore);
  }, [hotspots, rootCauseAdvisories, reporterTrustMap, proximityRadius]);

  // Lookup so the Predictive Hotspots list can show the same priority score
  // and risk badge as the Dispatch & Audit queue, instead of a second,
  // inconsistent ranking (currently raw cluster size) for the same clusters.
  const priorityById = useMemo(() => {
    const map = {};
    prioritizedDispatchQueue.forEach((item) => { map[item.id] = item; });
    return map;
  }, [prioritizedDispatchQueue]);

  // Department scopes offered by the filter, derived from the data rather than a
  // hardcoded list of three. Declared before deptSLAMetrics, which consumes it.
  const departmentOptions = useMemo(() => deriveDepartmentOptions(reports), [reports]);

  // 2. Department SLA Performance calculation
  const deptSLAMetrics = useMemo(() => {
    const metrics = {};
    // Every authority that actually appears in the data, not a hardcoded three.
    // Reports belonging to the other ten were previously dropped from all SLA
    // and backlog arithmetic without any indication on screen.
    const presentAbbrs = new Set(departmentOptions.map((d) => d.key));
    const filteredAuthorities = AUTHORITIES.filter((a) => presentAbbrs.has(a.abbr));
    filteredAuthorities.forEach((a) => {
      metrics[a.abbr] = {
        name: a.abbr,
        fullName: a.name,
        assigned: 0,
        resolved: 0,
        totalResponseHours: 0,
        totalResolutionHours: 0,
        backlog: 0,
      };
    });

    filteredReports.forEach((r) => {
      const deptName = r.assigned_department || '';
      const auth = filteredAuthorities.find(
        (a) =>
          deptName.toLowerCase().includes(a.abbr.toLowerCase()) ||
          deptName.toLowerCase().includes(a.id.toLowerCase())
      );
      if (!auth) return;

      const metric = metrics[auth.abbr];
      metric.assigned++;

      if (r.status === 'Resolved') {
        metric.resolved++;
        if (r.timestamp && r.resolved_at) {
          const start = new Date(r.timestamp);
          const end = new Date(r.resolved_at);
          if (!isNaN(start) && !isNaN(end)) {
            metric.totalResolutionHours += (end - start) / (1000 * 60 * 60);
          }
        }
      } else if (r.status !== 'Rejected') {
        metric.backlog++;
      }

      if (r.timestamp && r.in_process_at) {
        const start = new Date(r.timestamp);
        const assign = new Date(r.in_process_at);
        if (!isNaN(start) && !isNaN(assign)) {
          metric.totalResponseHours += (assign - start) / (1000 * 60 * 60);
        }
      }
    });

    return Object.values(metrics).map((m) => {
      // null, not 0 and not a fabricated 4.5 — a department with nothing resolved
      // has no measurable resolve time. The old fallback rendered an invented
      // over-SLA red bar for departments that had simply never closed a ticket.
      const avgResponseDays = m.assigned
        ? parseFloat((m.totalResponseHours / m.assigned / 24).toFixed(1))
        : null;
      const avgResolveDays = m.resolved
        ? parseFloat((m.totalResolutionHours / m.resolved / 24).toFixed(1))
        : null;

      return { ...m, avgResponseDays, avgResolveDays };
    });
  }, [filteredReports, departmentOptions]);

  // Only departments with a measurable resolve time reach the SLA chart, so a
  // department that has never closed a ticket contributes no bar at all rather
  // than an invented one. Filtering here also keeps <Cell> aligned with the bars.
  const measurableSLAMetrics = useMemo(
    () => deptSLAMetrics.filter((d) => d.avgResolveDays != null),
    [deptSLAMetrics]
  );

  // 2.4 Every department against three separate requirements, regardless of
  // the page's Department Scope filter — Allocation Status is specifically a
  // cross-department comparison, so it deliberately ignores that filter (it
  // still respects the date filter) rather than zeroing out every department
  // but the one currently selected. Backlog alone only ever answered "is
  // work piling up" — resolve time and on-time rate answer "is it moving
  // fast enough" and "is it hitting the target once it moves."
  const allDeptStatus = useMemo(() => {
    const dateOnly = reports.filter((r) => matchesDateFilter(r.timestamp));
    const presentAbbrs = new Set(departmentOptions.map((d) => d.key));
    const filteredAuthorities = AUTHORITIES.filter((a) => presentAbbrs.has(a.abbr));
    const stats = {};
    filteredAuthorities.forEach((a) => {
      stats[a.abbr] = { name: a.abbr, fullName: a.name, backlog: 0, resolvedCount: 0, totalResolveDays: 0, onTimeCount: 0 };
    });
    dateOnly.forEach((r) => {
      const deptName = r.assigned_department || '';
      const auth = filteredAuthorities.find(
        (a) => deptName.toLowerCase().includes(a.abbr.toLowerCase()) || deptName.toLowerCase().includes(a.id.toLowerCase())
      );
      if (!auth) return;
      const s = stats[auth.abbr];
      if (r.status !== 'Resolved' && r.status !== 'Rejected') {
        s.backlog++;
      } else if (r.status === 'Resolved' && r.timestamp && r.resolved_at) {
        const days = (new Date(r.resolved_at) - new Date(r.timestamp)) / (1000 * 60 * 60 * 24);
        if (!isNaN(days) && days >= 0) {
          s.resolvedCount++;
          s.totalResolveDays += days;
          if (days <= SLA_END_TO_END_DAYS) s.onTimeCount++;
        }
      }
    });
    return Object.values(stats)
      .map((s) => ({
        ...s,
        avgResolveDays: s.resolvedCount ? parseFloat((s.totalResolveDays / s.resolvedCount).toFixed(1)) : null,
        onTimeRate: s.resolvedCount ? Math.round((s.onTimeCount / s.resolvedCount) * 100) : null,
      }))
      .sort((a, b) => b.backlog - a.backlog);
  }, [reports, dateFilter, customStart, customEnd, departmentOptions]);

  // 2.5 Scoped department status data for breakdown chart
  const deptStatusData = useMemo(() => {
    if (selectedDept === 'all') return [];
    const counts = { Pending: 0, 'In Progress': 0, Resolved: 0, Rejected: 0 };
    filteredReports.forEach(r => {
      if (r.status === 'Resolved') counts.Resolved++;
      else if (r.status === 'Rejected') counts.Rejected++;
      else if (r.status === 'Pending') counts.Pending++;
      else counts['In Progress']++;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredReports, selectedDept]);

  // 3. Overall KPI Stats
  const kpiStats = useMemo(() => {
    const total = filteredReports.length;
    const active = filteredReports.filter((r) => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    
    // Average resolution time
    const resolved = filteredReports.filter((r) => r.status === 'Resolved' && r.resolved_at && r.timestamp);
    let totalResolutionHours = 0;
    resolved.forEach((r) => {
      const start = new Date(r.timestamp);
      const end = new Date(r.resolved_at);
      if (!isNaN(start) && !isNaN(end)) {
        totalResolutionHours += (end - start) / (1000 * 60 * 60);
      }
    });
    // null when nothing has been resolved — the KPI card renders "Insufficient
    // data" rather than the invented 2.4-day figure it used to show.
    const avgDays = resolved.length ? (totalResolutionHours / resolved.length / 24).toFixed(1) : null;

    // Resource allocation health analysis. Names the category actually
    // driving a backlog instead of guessing — a fixed "road repair backlogs"
    // phrase used to appear even when the backlog was entirely waste or
    // drainage tickets.
    const dominantOpenCategory = (deptName) => {
      const open = filteredReports.filter(
        (r) => r.status !== 'Resolved' && r.status !== 'Rejected' &&
          (r.assigned_department || '').toLowerCase().includes(deptName.toLowerCase())
      );
      const counts = {};
      open.forEach((r) => {
        const cat = canonicalizeCategory(r.categories || r.ai_prediction);
        counts[cat] = (counts[cat] || 0) + 1;
      });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return top ? { category: top[0], count: top[1], total: open.length } : null;
    };

    let worstBacklogDept = 'None';
    let maxBacklog = 0;

    if (selectedDept !== 'all') {
      const currentDeptData = deptSLAMetrics.find(d => d.name === selectedDept);
      const backlog = currentDeptData ? currentDeptData.backlog : 0;
      let healthStatus = 'Optimal';
      let recommendation = `${selectedDept} isn't backed up right now — no action needed.`;

      if (backlog > INSIGHT.backlogAlertTickets) {
        healthStatus = 'Backlog Warning';
        const top = dominantOpenCategory(selectedDept);
        const catNote = top ? ` (mostly ${top.category.toLowerCase()})` : '';
        recommendation = `${backlog} open reports${catNote} — bring in extra crew.`;
      }

      return {
        total,
        active,
        avgDays,
        hotspotsCount: hotspots.length,
        healthStatus,
        recommendation,
        worstBacklogDept: selectedDept,
        // Ranking departments against each other is meaningless when the view
        // is scoped to a single one.
        fastestSLA: null,
        slowestSLA: null,
      };
    }

    deptSLAMetrics.forEach((d) => {
      if (d.backlog > maxBacklog) {
        maxBacklog = d.backlog;
        worstBacklogDept = d.name;
      }
    });

    let healthStatus = 'Optimal';
    let recommendation = 'No department has an unusual backlog right now.';

    if (maxBacklog > INSIGHT.backlogAlertTickets) {
      healthStatus = 'Resource Overload';
      const helperDept = deptSLAMetrics.find((d) => d.name !== worstBacklogDept && d.backlog <= 2);
      const top = dominantOpenCategory(worstBacklogDept);
      const catNote = top ? ` (mostly ${top.category.toLowerCase()})` : '';
      recommendation = `${worstBacklogDept}: ${maxBacklog} open reports${catNote}. ${
        helperDept ? `${helperDept.name} could help.` : 'No department has room to help.'
      }`;
    }

    // Real fastest/slowest resolution times, over departments that actually have
    // a measurable one. These replace a hardcoded "SWCorp (<1.0 Day)" string and
    // a "Slowest SLA" label that was really showing the largest backlog.
    const measurable = deptSLAMetrics.filter((d) => d.avgResolveDays != null);
    const bySpeed = [...measurable].sort((a, b) => a.avgResolveDays - b.avgResolveDays);
    const fastestSLA = bySpeed[0] || null;
    const slowestSLA = bySpeed.length > 1 ? bySpeed[bySpeed.length - 1] : null;

    return {
      total,
      active,
      avgDays,
      hotspotsCount: hotspots.length,
      healthStatus,
      recommendation,
      worstBacklogDept,
      fastestSLA,
      slowestSLA,
    };
  }, [filteredReports, hotspots, deptSLAMetrics, selectedDept]);

  // 3a. What kind of "active" — a bare count doesn't say whether it's a pile
  // of untouched Pending reports or work already In Process.
  const activeStatusBreakdown = useMemo(() => {
    const counts = {};
    filteredReports.forEach((r) => {
      if (r.status === 'Resolved' || r.status === 'Rejected' || !r.status) return;
      counts[r.status] = (counts[r.status] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filteredReports]);

  // 3b. Which categories the active hotspots are actually in — the zone
  // count alone doesn't say what kind of problem is clustering.
  const hotspotCategoryBreakdown = useMemo(() => {
    const counts = {};
    hotspots.forEach((h) => { counts[h.category] = (counts[h.category] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [hotspots]);

  // 4. Ticket Volume Trend — the window it plots now follows whichever date
  // filter is active instead of being hardcoded to the last 30 days, so
  // picking "Last 7 Days" or a custom range actually changes this chart
  // instead of silently ignoring the filter.
  const TREND_MAX_DAYS = 180;
  const trendRange = useMemo(() => {
    const today = endOfDay(new Date());
    if (dateFilter === '7d') return { start: subDays(today, 6), end: today, truncated: false };
    if (dateFilter === '30d') return { start: subDays(today, 29), end: today, truncated: false };

    // 'all', or 'custom' with one or both bounds unset — fall back to the
    // actual span of the filtered reports rather than an arbitrary window.
    const reportDates = filteredReports
      .map((r) => r.timestamp)
      .filter(Boolean)
      .map((t) => parseISO(t.split('T')[0]));

    let start = dateFilter === 'custom' && customStart ? new Date(customStart) : null;
    let end = dateFilter === 'custom' && customEnd ? endOfDay(new Date(customEnd)) : null;

    if (!start) start = reportDates.length ? new Date(Math.min(...reportDates)) : subDays(today, 29);
    if (!end) end = reportDates.length && dateFilter !== 'custom' ? new Date(Math.max(...reportDates)) : today;

    const spanDays = Math.round((end - start) / 86400000) + 1;
    if (spanDays > TREND_MAX_DAYS) {
      return { start: subDays(end, TREND_MAX_DAYS - 1), end, truncated: true };
    }
    return { start, end, truncated: false };
  }, [dateFilter, customStart, customEnd, filteredReports]);

  const trendChartData = useMemo(() => {
    const daysMap = {};
    let cursor = new Date(trendRange.start);
    while (cursor <= trendRange.end) {
      daysMap[format(cursor, 'yyyy-MM-dd')] = 0;
      cursor = subDays(cursor, -1); // +1 day, without a separate addDays import
    }

    filteredReports.forEach((r) => {
      if (!r.timestamp) return;
      const dateStr = r.timestamp.split('T')[0];
      if (daysMap[dateStr] !== undefined) {
        daysMap[dateStr]++;
      }
    });

    return Object.entries(daysMap).map(([date, count]) => ({
      date: format(parseISO(date), 'MMM dd'),
      rawDate: date,
      Reports: count,
    }));
  }, [trendRange, filteredReports]);

  // Week-over-week change and the single busiest day — the two facts that
  // turn "here's a line" into "here's what changed and when it spiked."
  const trendInsight = useMemo(() => {
    if (trendChartData.length < 14) return null;
    const last7 = trendChartData.slice(-7);
    const prior7 = trendChartData.slice(-14, -7);
    const last7Sum = last7.reduce((s, d) => s + d.Reports, 0);
    const prior7Sum = prior7.reduce((s, d) => s + d.Reports, 0);
    const pctChange = prior7Sum > 0 ? Math.round(((last7Sum - prior7Sum) / prior7Sum) * 100) : null;
    const peak = [...trendChartData].sort((a, b) => b.Reports - a.Reports)[0];
    return { last7Sum, prior7Sum, pctChange, peak: peak.Reports > 0 ? peak : null };
  }, [trendChartData]);

  // 5. Category distribution chart data
  const categoryChartData = useMemo(() => {
    const counts = {};
    filteredReports.forEach((r) => {
      const category = r.categories || 'Other';
      counts[category] = (counts[category] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [filteredReports]);

  // Option lists for the explorer's selects, derived from every report ever
  // loaded (not just the current top-level filter scope) — the explorer is
  // a standalone "find anything" tool, so its own dropdowns shouldn't be
  // limited to whatever the page-level Time Interval/Department happens to
  // be set to right now.
  const exploreCategories = useMemo(
    () => [...new Set(reports.map((r) => r.categories || 'Other'))].sort(),
    [reports]
  );
  const exploreStatuses = useMemo(
    () => [...new Set(reports.map((r) => r.status).filter(Boolean))].sort(),
    [reports]
  );
  const exploreZones = useMemo(
    () => [...new Set(reports.map((r) => deriveZone(r)))].sort(),
    [reports]
  );

  // Every filter in exploreFilters applies together (AND), over the full
  // report set — searching "MBMB AND Road Damage AND this week" instead of
  // one dimension at a time is the entire point of combining the four
  // separate chart-click panels into one modal.
  const exploreResults = useMemo(() => {
    if (!exploreFilters) return [];
    return reports
      .filter((r) => {
        if (exploreFilters.department !== 'all') {
          const needle = exploreFilters.department.toLowerCase();
          if (!(r.assigned_department || '').toLowerCase().includes(needle)) return false;
        }
        if (exploreFilters.category !== 'all' && (r.categories || 'Other') !== exploreFilters.category) return false;
        if (exploreFilters.status !== 'all' && r.status !== exploreFilters.status) return false;
        if (exploreFilters.zone !== 'all' && deriveZone(r) !== exploreFilters.zone) return false;
        if (exploreFilters.dateFrom || exploreFilters.dateTo) {
          if (!r.timestamp) return false;
          // Compared as UTC calendar-date strings, not Date-instant math.
          // Report timestamps carry a real UTC offset (e.g. "...+00:00"),
          // but datetime-local inputs parse as local time — in Malaysia
          // (UTC+8) that mismatch could put a report the trend chart
          // buckets into "Jul 26" (UTC) outside a "Jul 26" local-time
          // window entirely, so a bar showing 4 reports opened to 0.
          const reportDate = r.timestamp.split('T')[0];
          if (exploreFilters.dateFrom && reportDate < exploreFilters.dateFrom.split('T')[0]) return false;
          if (exploreFilters.dateTo && reportDate > exploreFilters.dateTo.split('T')[0]) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  }, [exploreFilters, reports]);

  // ==================== CITY HEALTH & WELLNESS COMPUTATIONS ====================

  // Service Performance — how well the council responds. Derives from the same
  // buildFunnel output the funnel chart renders, so the two panels cannot
  // disagree about how long a stage takes.
  const servicePerformance = useMemo(
    () => buildServicePerformance(filteredReports),
    [filteredReports]
  );

  // Urban Condition — the state of the city, scored from the open defect burden
  // rather than resolution rate. Using resolution rate here would measure the
  // council again, which is the conflation this split removes.
  const urbanCondition = useMemo(
    () => buildUrbanCondition(filteredReports),
    [filteredReports]
  );

  // Infrastructure Fragility — where the city is breaking by design, not by
  // bad luck. The one index here scored over full history (including
  // resolved reports) rather than the current open backlog.
  const infrastructureFragility = useMemo(
    () => buildInfrastructureFragility(filteredReports),
    [filteredReports]
  );

  // 5.6. Zone Wellness Scorecard
  const zoneScorecard = useMemo(() => {
    const zones = {};
    filteredReports.forEach(r => {
      // Reports have no zone field; deriveZone assigns a real Melaka locality by
      // proximity. The old chain fell through to `location` (a postcode string)
      // or the last part of the address (usually "Malaysia"), so the whole
      // scorecard collapsed into one row.
      const zone = deriveZone(r);
      if (!zones[zone]) zones[zone] = { name: zone, total: 0, active: 0, resolved: 0, rejected: 0, totalResDays: 0, resWithDates: 0 };
      zones[zone].total++;
      if (r.status === 'Resolved') {
        zones[zone].resolved++;
        if (r.timestamp && r.resolved_at) {
          const days = (new Date(r.resolved_at) - new Date(r.timestamp)) / (1000 * 60 * 60 * 24);
          if (!isNaN(days) && days >= 0) { zones[zone].totalResDays += days; zones[zone].resWithDates++; }
        }
      } else if (r.status === 'Rejected') { zones[zone].rejected++; }
      else { zones[zone].active++; }
    });

    return Object.values(zones).map(z => {
      const validTotal = z.total - z.rejected;
      const resolutionRate = validTotal > 0 ? Math.round((z.resolved / validTotal) * 100) : null;
      const avgDays = z.resWithDates > 0 ? parseFloat((z.totalResDays / z.resWithDates).toFixed(1)) : null;
      // Counts are facts and are always shown, but a zone with only a couple of
      // reports gets no grade rather than a grade built on almost nothing.
      // Graded on the shared rubric, which the zone table used to disagree with.
      const sufficient = validTotal >= MIN_N_FOR_SCORE;
      return {
        ...z,
        resolutionRate,
        avgDays,
        sufficient,
        grade: sufficient ? (gradeFor(resolutionRate)?.grade ?? null) : null,
      };
    }).sort((a, b) => b.total - a.total);
  }, [filteredReports]);

  // Real point-in-time backlog reconstruction. The previous memo recomputed each
  // past week from present-day statuses, so a ticket resolved this morning
  // counted as resolved in all twelve historical weeks.
  const backlogFlow = useMemo(() => buildBacklogFlow(filteredReports), [filteredReports]);

  // 5.8. Actionable Insights Generation (rule-based)
  const actionableInsights = useMemo(() => {
    const insights = [];
    const now = new Date();

    // 1a. Service stages missing their target. Actionable by the council.
    Object.entries(servicePerformance.domains).forEach(([key, domain]) => {
      // Null guard matters: `null < 60` coerces to `0 < 60`.
      if (domain.score != null && domain.score < 60) {
        const detail = domain.medianDays != null
          ? `Typical (median) time is ${fmtDuration(domain.medianDays)}, against a target of ${fmtDuration(domain.targetDays)} (based on ${domain.n} reports).`
          : `${domain.score}% of dispatched reports were handled successfully on the first try, out of ${domain.n} reports.`;
        insights.push({
          id: `spi-${key}`, type: 'warning', title: `${domain.name} is missing its target`,
          description: `${detail} This step is directly within the council's control.`,
          zone: 'City-wide',
          action: `Review the ${domain.name.toLowerCase()} step — it is taking longer than its SLA target allows.`,
        });
      }
    });

    // 1b. Categories where the city itself is deteriorating.
    Object.entries(urbanCondition.domains).forEach(([key, domain]) => {
      if (domain.score != null && domain.score < 60) {
        insights.push({
          id: `uci-${key}`, type: 'warning', title: `${domain.name} defects are accumulating`,
          description: `${domain.openCount} open, with a current load of ${domain.burden} against an allowed limit of ${domain.target} (issues open longer count for more)` +
            (domain.medianAgeDays != null ? `, typical age ${Math.round(domain.medianAgeDays)} days.` : '.'),
          zone: 'City-wide',
          action: `Clear the oldest ${domain.name.toLowerCase()} defects first — their age is what's driving this number up.`,
        });
      }
    });

    // 1c. Fragile zones — not a speed or backlog problem, a "this keeps
    // breaking" problem, so it needs a different fix and belongs in the same
    // feed as the SPI/UCI warnings above rather than only inside its own band.
    Object.entries(infrastructureFragility.domains).forEach(([zone, d]) => {
      if (d.score != null && d.score < 60) {
        insights.push({
          id: `ifi-${zone}`, type: 'critical', title: `${zone} — fragile infrastructure`,
          description: `Fragility score: ${d.score} of 100, mainly because of ${d.driverLabel}.`,
          zone,
          action: d.driver === 'failureRate'
            ? `Check the quality of repairs in ${zone} — they aren't holding, so responding faster won't fix it.`
            : d.driver === 'mtbf'
            ? `Set up regular inspections in ${zone} instead of waiting for the next resident report.`
            : `Check whether ${zone} has enough resources for how often problems actually happen there.`,
        });
      }
    });

    // 2. Top performing zone — only among zones with enough reports to grade.
    const topZone = zoneScorecard.find(z => z.sufficient && z.resolutionRate >= 80);
    if (topZone) {
      insights.push({ id: 'top-zone', type: 'success', title: `${topZone.name} — Top Performing Zone`,
        description: `${topZone.resolutionRate}% resolution rate across ${topZone.total} reports. Average resolution time: ${topZone.avgDays} days.`,
        zone: topZone.name, action: `Recognize this zone's performance and use its approach as an example for zones that are behind.` });
    }

    // 3. Neglected zones (aged unresolved reports)
    const agedReports = filteredReports.filter(r => {
      if (r.status === 'Resolved' || r.status === 'Rejected' || !r.timestamp) return false;
      return (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24) > INSIGHT.agedReportDays;
    });
    if (agedReports.length > 0) {
      const zoneAged = {};
      agedReports.forEach(r => { const z = deriveZone(r); zoneAged[z] = (zoneAged[z] || 0) + 1; });
      const worstZone = Object.entries(zoneAged).sort((a, b) => b[1] - a[1])[0];
      if (worstZone) {
        insights.push({ id: 'neglected-zone', type: 'critical', title: `Neglected Zone: ${worstZone[0]}`,
          description: `${worstZone[1]} reports older than 14 days are still unresolved in ${worstZone[0]}. This shows an ongoing gap in response that needs urgent attention.`,
          zone: worstZone[0], action: `Send a priority inspection team to ${worstZone[0]} and review why department assignment is slow there.` });
      }
    }

    // 4. Overloaded department
    deptSLAMetrics.forEach(dept => {
      if (dept.backlog > INSIGHT.backlogAlertTickets) {
        insights.push({ id: `dept-overload-${dept.name}`, type: 'warning', title: `${dept.name} Department Overloaded`,
          description: `${dept.name} has ${dept.backlog} active backlog reports with an average resolution time of ${dept.avgResolveDays} days. This exceeds the 3-day SLA target.`,
          zone: 'Department-wide', action: `Move 15–20% of crew capacity from less-busy departments to ${dept.name} for the next work cycle.` });
      }
    });

    // 5. Report volume spike detection (week-over-week)
    const last7 = filteredReports.filter(r => r.timestamp && (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24) <= 7).length;
    const prev7 = filteredReports.filter(r => { if (!r.timestamp) return false; const d = (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24); return d > 7 && d <= 14; }).length;
    if (prev7 > 0 && last7 > prev7 * INSIGHT.volumeSpikeRatio) {
      const pctIncrease = Math.round(((last7 - prev7) / prev7) * 100);
      const catCounts = {};
      filteredReports.filter(r => r.timestamp && (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24) <= 7).forEach(r => {
        const cat = r.categories || r.ai_prediction || 'Other'; catCounts[cat] = (catCounts[cat] || 0) + 1;
      });
      const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
      insights.push({ id: 'volume-spike', type: 'warning', title: `${pctIncrease}% Increase in Reports This Week`,
        description: `${last7} reports this week, compared with ${prev7} last week. ${topCat ? `Most common type: ${topCat[0]} (${topCat[1]} reports).` : ''} This could be due to the season or a specific event.`,
        zone: 'City-wide', action: `Look into what's causing this, and prepare extra response capacity if it continues.` });
    }

    // 6. Cross-category correlation
    if (rootCauseAdvisories.length > 0) {
      const topAdvisory = rootCauseAdvisories[0];
      insights.push({ id: 'cross-correlation', type: 'info', title: `Cross-Issue Pattern: ${topAdvisory.category}`,
        description: `${topAdvisory.size} reports of different types are clustered near ${topAdvisory.address}. This suggests one shared cause that needs a joint response.`,
        zone: topAdvisory.address, action: topAdvisory.recommendation });
    }

    // 7. SLA achievement
    const bestDept = deptSLAMetrics.filter(d => d.assigned > 0).sort((a, b) => a.avgResolveDays - b.avgResolveDays)[0];
    if (bestDept && bestDept.avgResolveDays <= 3 && bestDept.resolved > 0) {
      insights.push({ id: 'sla-achievement', type: 'success', title: `${bestDept.name} Exceeding SLA Targets`,
        description: `${bestDept.name} maintained an average resolution time of ${bestDept.avgResolveDays} days, within the 3-day SLA target. ${bestDept.resolved} reports resolved.`,
        zone: 'Department-wide', action: `Recognize ${bestDept.name}'s performance and share how they work with other departments.` });
    }

    // 8. High citizen engagement
    const highUpvoteReports = filteredReports.filter(r => (r.upvotes || 0) >= INSIGHT.highEngagementUpvotes && r.status !== 'Resolved' && r.status !== 'Rejected');
    if (highUpvoteReports.length > 0) {
      const totalHighUpvotes = highUpvoteReports.reduce((sum, r) => sum + (r.upvotes || 0), 0);
      insights.push({ id: 'citizen-engagement', type: 'info', title: `High Citizen Engagement Detected`,
        description: `${highUpvoteReports.length} active reports have 5+ citizen upvotes (${totalHighUpvotes} total). These show strong public concern and should be prioritized.`,
        zone: 'City-wide', action: `Prioritize these reports to show residents the government is listening.` });
    }

    // 9. Overall standing. Reported as two separate verdicts, because a council
    // can be responding well to a city that is still deteriorating — the case
    // the old single composite could not express.
    const spi = servicePerformance.index;
    const uci = urbanCondition.index;
    if (spi != null && spi < 60) {
      insights.push({ id: 'spi-poor', type: 'critical', title: 'Service performance below target',
        description: `Service Performance score is ${spi} of 100. The council is missing its own targets across multiple steps.`,
        zone: 'City-wide', action: 'Check the SLA chart below for the department furthest over target and start there.' });
    }
    if (uci != null && uci < 60) {
      insights.push({ id: 'uci-poor', type: 'critical', title: 'Urban condition is getting worse',
        description: `Urban Condition score is ${uci} of 100. Open issues are piling up faster than the agreed limit, no matter how fast the council responds.`,
        zone: 'City-wide', action: 'This is a capacity or budget problem, not a process problem — resolving reports faster alone will not fix it.' });
    }
    if (spi != null && uci != null && spi >= 80 && uci < 60) {
      insights.push({ id: 'spi-uci-divergence', type: 'info', title: 'Responding well, but falling behind',
        description: `Service Performance is ${spi} of 100 while Urban Condition is ${uci} of 100. The council is keeping up with what comes in, but issues are piling up faster than they're being cleared.`,
        zone: 'City-wide', action: 'Adding more crew capacity is more likely to help here than adjusting the process further.' });
    }

    const priority = { critical: 0, warning: 1, info: 2, success: 3 };
    return insights.sort((a, b) => (priority[a.type] ?? 4) - (priority[b.type] ?? 4));
  }, [filteredReports, servicePerformance, urbanCondition, infrastructureFragility, zoneScorecard, deptSLAMetrics, rootCauseAdvisories]);

  // 6. Coordinates list for density Heatmap
  const heatmapPoints = useMemo(() => {
    return filteredReports
      .filter((r) => r.status !== 'Resolved' && r.status !== 'Rejected' && r.latitude && r.longitude)
      .map((r) => ({
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
      }));
  }, [filteredReports]);

  // 7. PDF Exporter
  /**
   * Text-based executive brief.
   *
   * Replaces an html2canvas screenshot of whichever tab happened to be open,
   * which produced no selectable text, no data tables, no statement of what was
   * filtered, and rasterised map tiles unreliably. It also mutated live CSSOM to
   * strip oklab/oklch rules that html2canvas could not parse.
   *
   * The filter context is printed first: a brief that does not say what it
   * covers cannot be checked by whoever receives it.
   */
  const exportToPDF = async () => {
    setPdfGenerating(true);
    try {
      const doc = new jsPDF();
      const M = 14;
      const BOTTOM = 275;
      let y = 20;

      const nextPage = () => { doc.addPage(); y = 20; };
      const room = (needed = 8) => { if (y + needed > BOTTOM) nextPage(); };
      const heading = (text) => {
        room(14);
        y += 4;
        doc.setFontSize(12); doc.setFont(undefined, 'bold');
        doc.text(text, M, y); y += 7;
        doc.setFontSize(9); doc.setFont(undefined, 'normal');
      };
      const line = (text, indent = 0) => {
        room();
        doc.text(String(text), M + indent, y); y += 5;
      };
      const row = (cols, widths, bold = false) => {
        room();
        doc.setFont(undefined, bold ? 'bold' : 'normal');
        let x = M;
        cols.forEach((c, i) => { doc.text(String(c), x, y); x += widths[i]; });
        doc.setFont(undefined, 'normal');
        y += 5;
      };
      const days = (v) => (v == null ? 'n/a' : v.toFixed(1) + 'd');
      const pct = (v) => (v == null ? 'n/a' : v + '%');

      // Header and filter context.
      doc.setFontSize(16); doc.setFont(undefined, 'bold');
      doc.text('Infrastructure Analytics - Executive Brief', M, y); y += 8;
      doc.setFontSize(9); doc.setFont(undefined, 'normal');
      doc.text('Generated ' + format(new Date(), 'd MMM yyyy HH:mm'), M, y); y += 5;
      doc.text(dateFilterLabel, M, y); y += 5;
      doc.text(
        'Department scope: ' + (selectedDept === 'all' ? 'All departments' : selectedDept) +
        '  |  ' + filteredReports.length + ' of ' + reports.length + ' reports',
        M, y
      );
      y += 6;
      doc.setDrawColor(180); doc.line(M, y, 196, y); y += 2;

      // Headline figures.
      heading('Headline');
      line('Active reports: ' + kpiStats.active + ' of ' + kpiStats.total);
      line('Average resolution: ' + (kpiStats.avgDays == null ? 'insufficient data' : kpiStats.avgDays + ' days'));
      line('Service Performance Index: ' + (servicePerformance.index ?? 'insufficient data') +
        (servicePerformance.excluded.length ? '  (' + servicePerformance.excluded.length + ' domains omitted)' : ''));
      line('Urban Condition Index: ' + (urbanCondition.index ?? 'insufficient data') +
        (urbanCondition.excluded.length ? '  (' + urbanCondition.excluded.length + ' categories omitted)' : ''));
      line('Active hotspots: ' + kpiStats.hotspotsCount + ' (radius <= ' + proximityRadius + 'm, min ' + minClusterSize + ' reports)');

      // Stage durations.
      const funnel = buildFunnel(filteredReports, { cohort: 'all', minN: MIN_N_FOR_STAGE });
      heading('Where the time goes (median days per stage)');
      row(['Stage', 'Median', 'p90', 'Target', 'n'], [70, 25, 25, 25, 20], true);
      funnel.stages.forEach((st) => {
        row([
          st.label,
          st.sufficient ? days(st.median) : 'insufficient',
          st.sufficient ? days(st.p90) : '-',
          SLA_TARGET_DAYS[st.key] != null ? SLA_TARGET_DAYS[st.key] + 'd' : '-',
          st.n,
        ], [70, 25, 25, 25, 20]);
      });
      y += 2;
      line('Medians shown; they do not sum to the total. Mean end-to-end: ' + days(funnel.endToEnd.mean) + ' (n=' + funnel.endToEnd.n + ').');
      if (funnel.firstPassYield != null) {
        line('First-pass yield ' + funnel.firstPassYield + '% - ' + funnel.bouncedCount + ' of ' + funnel.dispatchedCount + ' dispatched reports were re-pooled.');
      }
      if (funnel.nonMonotonic > 0) {
        line(funnel.nonMonotonic + ' out-of-order timestamps were clamped to zero.');
      }

      // Department SLA.
      heading('Department performance');
      row(['Department', 'Assigned', 'Resolved', 'Backlog', 'Avg resolve'], [60, 25, 25, 25, 30], true);
      deptSLAMetrics.forEach((d) => {
        row([d.name, d.assigned, d.resolved, d.backlog, days(d.avgResolveDays)], [60, 25, 25, 25, 30]);
      });

      // Repeat-failure audit.
      heading('Repeat-failure audit');
      line('A new report of the same category within ' + REINCIDENCE.radiusM + 'm and ' + REINCIDENCE.windowDays + ' days of a resolved one.');
      y += 1;
      row(['Department', 'Repeats', 'Resolved', 'On-time', 'Grade'], [70, 25, 25, 25, 20], true);
      contractorAudit.forEach((d) => {
        row([
          d.name.length > 34 ? d.name.slice(0, 33) + '.' : d.name,
          d.reIncidence ?? 0,
          d.resolvedCount ?? 0,
          pct(d.rate),
          gradeFor(d.rate)?.grade ?? '-',
        ], [70, 25, 25, 25, 20]);
      });

      // Dispatch queue.
      if (prioritizedDispatchQueue.length) {
        heading('Dispatch priority queue');
        row(['#', 'Location', 'Reports', 'Risk', 'Score'], [10, 85, 22, 40, 20], true);
        prioritizedDispatchQueue.slice(0, 10).forEach((item, i) => {
          const label = item.address || item.category || 'Cluster';
          row([
            i + 1,
            label.length > 42 ? label.slice(0, 41) + '.' : label,
            item.size,
            item.primaryRisk || '-',
            item.priorityScore,
          ], [10, 85, 22, 40, 20]);
        });
      }

      // Zones.
      if (zoneScorecard.length) {
        heading('Zone scorecard');
        row(['Zone', 'Total', 'Active', 'Resolved', 'Rate', 'Grade'], [60, 22, 22, 25, 22, 20], true);
        zoneScorecard.forEach((z) => {
          row([
            z.name.length > 30 ? z.name.slice(0, 29) + '.' : z.name,
            z.total, z.active, z.resolved,
            pct(z.resolutionRate),
            z.grade ?? '-',
          ], [60, 22, 22, 25, 22, 20]);
        });
      }

      // Insights.
      if (actionableInsights.length) {
        heading('Actionable insights');
        actionableInsights.forEach((ins) => {
          room(16);
          doc.setFont(undefined, 'bold');
          doc.text('[' + ins.type.toUpperCase() + '] ' + ins.title, M, y); y += 5;
          doc.setFont(undefined, 'normal');
          doc.splitTextToSize(ins.description, 178).forEach((l) => { room(); doc.text(l, M, y); y += 4.5; });
          doc.splitTextToSize('Action: ' + ins.action, 178).forEach((l) => { room(); doc.text(l, M + 3, y); y += 4.5; });
          y += 2;
        });
      }

      // Methodology footer.
      heading('Methodology');
      [
        'End-to-end SLA target ' + SLA_END_TO_END_DAYS + ' days. Stage targets sum to that total.',
        'Medians and p90 use linear interpolation (R-7). Medians are not additive.',
        'Figures marked "insufficient data" had too few records to report; nothing is substituted.',
        'Service Performance scores council actions. Urban Condition scores open defect burden',
        'weighted by age, and excludes resolution rate by design.',
      ].forEach((t) => line(t));

      // Page numbers, added last so the total is known.
      const pages = doc.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text('Page ' + i + ' of ' + pages, 196, 288, { align: 'right' });
      }

      doc.save('Melaka_Infrastructure_Brief_' + format(new Date(), 'yyyyMMdd') + '.pdf');
    } catch (err) {
      console.error('Failed to build the executive brief', err);
      setError('Could not generate the PDF brief. Please try again.');
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleToggleExcludeTicket = (seedId, reportId) => {
    setCustomOverrides(prev => {
      const current = prev[seedId] || {};
      const excluded = current.excludedReportIds || [];
      const newExcluded = excluded.includes(reportId)
        ? excluded.filter(id => id !== reportId)
        : [...excluded, reportId];
      return {
        ...prev,
        [seedId]: {
          ...current,
          excludedReportIds: newExcluded
        }
      };
    });
  };

  useEffect(() => {
    if (activeClusterId) {
      const exists = hotspots.some(h => h.id === activeClusterId) || rootCauseAdvisories.some(a => a.id === activeClusterId);
      if (!exists) {
        setActiveClusterId(null);
      }
    }
  }, [hotspots, rootCauseAdvisories, activeClusterId]);

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin text-[#4a5d3f]" size={32} />
          <div className="text-[#8a8477] font-medium">Computing City Infrastructure Insights...</div>
        </div>
      </div>
    );
  }

  // A failed load must not fall through to the dashboard. Previously `error` was
  // set and never read, so a network failure rendered a full page of zeroes and
  // fallbacks that looked like real, healthy data.
  if (error) {
    return (
      <div className="p-6 md:p-8">
        <div className="page-header-title mb-1">Infrastructure Analytics</div>
        <p className="page-header-sub mb-6">
          How fast the city responds, where problems are clustering, and whether repairs are actually holding.
        </p>
        <div
          className="p-5 rounded-xl flex items-start gap-3 border"
          style={{ background: '#ffffff', borderColor: 'rgba(31,30,26,0.08)', color: '#201f1b' }}
        >
          <AlertTriangle size={22} className="text-[#c1613f] shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-bold">Failed to load analytics</h3>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(75,71,61,0.75)' }}>{error}</p>
            <p className="text-xs mt-2" style={{ color: '#8a8477' }}>
              No figures are shown because none could be computed. Retry once the
              reports service is reachable.
            </p>
            <button onClick={loadData} className="export-btn mt-4">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeCluster = activeClusterId
    ? rootCauseAdvisories.find(a => a.id === activeClusterId)
    : null;
  const activeRecurring = activeRecurringId
    ? recurringHotspots.find(c => c.id === activeRecurringId)
    : null;

  // Predictive Hotspots list: searchable by address/category once there are
  // more than a handful of clusters to scan. Systemic stays ranked by the
  // same priority score as the Dispatch & Audit queue; the recurring-failure
  // Hotspots list is ranked by total reappearances instead (already sorted
  // that way by the recurringHotspots memo).
  const hotspotSearchLower = hotspotSearch.trim().toLowerCase();
  const matchesHotspotSearch = (item) =>
    !hotspotSearchLower ||
    item.address.toLowerCase().includes(hotspotSearchLower) ||
    item.category.toLowerCase().includes(hotspotSearchLower);
  const displayRecurringHotspots = recurringHotspots.filter(matchesHotspotSearch);
  const displayAdvisories = [...rootCauseAdvisories]
    .filter(matchesHotspotSearch)
    .sort((a, b) => (priorityById[b.id]?.priorityScore ?? 0) - (priorityById[a.id]?.priorityScore ?? 0));

  const renderHotspotCard = (item, isSystemic) => {
    const priority = priorityById[item.id];
    const tone = priority ? (RISK_TONE[priority.primaryRisk] || DEFAULT_RISK_TONE) : DEFAULT_RISK_TONE;
    const badge = isSystemic
      ? { bg: 'rgba(99,102,241,0.10)', border: 'rgba(99,102,241,0.25)', text: '#4338ca' }
      : { bg: 'rgba(74,93,63,0.10)', border: 'rgba(74,93,63,0.20)', text: '#4a5d3f' };
    return (
      <div
        key={item.id}
        onClick={() => {
          setActiveClusterId(item.id);
          setMapFocus({ center: [item.latitude, item.longitude], zoom: 15.5, trigger: Date.now() });
        }}
        style={{ borderLeftColor: tone.color, borderLeftWidth: 4 }}
        className={`p-4 border rounded-xl space-y-2 hover:border-[#4a5d3f]/40 transition-all cursor-pointer group text-left ${
          activeClusterId === item.id ? 'bg-[#4a5d3f]/10 border-[#4a5d3f]/50 shadow-md' : 'bg-[#f7f4ec] border-[#1f1e1a]/8'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span
              className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border shrink-0"
              style={{ background: badge.bg, borderColor: badge.border, color: badge.text }}
            >
              {item.category}
            </span>
            <span className="text-[10px] font-bold text-[#8a8477] flex items-center gap-1">
              {item.size} active report{item.size === 1 ? '' : 's'}{item.upvotes > 0 && ` · ${item.upvotes} upvotes`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {priority && (
              <span
                className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide"
                style={{ color: tone.color, background: tone.bg }}
                title={`Priority ${priority.priorityScore} of 100 — ${priority.primaryRisk}`}
              >
                {priority.priorityScore}
              </span>
            )}
            <ChevronRight size={12} className="text-[#8a8477] group-hover:text-[#201f1b] transition-colors" />
          </div>
        </div>
        <div className="text-xs text-[#4b473d] font-bold">{item.address}</div>
        <div className="text-[11px] leading-relaxed text-[#8a8477] italic">
          {item.recommendation}
        </div>
        <div onClick={(e) => e.stopPropagation()} className="flex">
          <ClusterDispatchAction item={item} onDispatched={loadData} />
        </div>
      </div>
    );
  };

  // No dispatch action here — every item is a resolved report that came
  // back, not unclaimed work, so there's nothing to send a crew to.
  const renderRecurringHotspotCard = (item) => (
    <div
      key={item.id}
      onClick={() => {
        setActiveRecurringId(item.id);
        setMapFocus({ center: [item.latitude, item.longitude], zoom: 15.5, trigger: Date.now() });
      }}
      style={{ borderLeftColor: '#b91c1c', borderLeftWidth: 4 }}
      className={`p-4 border rounded-xl space-y-2 hover:border-[#4a5d3f]/40 transition-all cursor-pointer group text-left ${
        activeRecurringId === item.id ? 'bg-[#4a5d3f]/10 border-[#4a5d3f]/50 shadow-md' : 'bg-[#f7f4ec] border-[#1f1e1a]/8'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span
            className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border shrink-0"
            style={{ background: 'rgba(185,28,28,0.08)', borderColor: 'rgba(185,28,28,0.20)', color: '#b91c1c' }}
          >
            {item.category}
          </span>
          <span className="text-[10px] font-bold text-[#8a8477]">
            {item.size} repair{item.size === 1 ? '' : 's'} reappeared
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide"
            style={{ color: '#b91c1c', background: 'rgba(185,28,28,0.08)' }}
            title={`${item.totalReappearances} repeat failure${item.totalReappearances === 1 ? '' : 's'} recorded nearby`}
          >
            {item.totalReappearances}×
          </span>
          <ChevronRight size={12} className="text-[#8a8477] group-hover:text-[#201f1b] transition-colors" />
        </div>
      </div>
      <div className="text-xs text-[#4b473d] font-bold">{item.address}</div>
      <div className="text-[11px] leading-relaxed text-[#8a8477] italic">
        A resolved {item.category.toLowerCase()} repair near here reappeared {item.totalReappearances} time{item.totalReappearances === 1 ? '' : 's'} —
        worth checking whether the original fix actually addressed the cause.
      </div>
    </div>
  );

  // The date filter cohorts by SUBMISSION date (matchesDateFilter keys off
  // r.timestamp). Saying so matters: cohorting by resolution date instead would
  // censor slow reports out of short windows and make the service look faster
  // than it is — the standard survivorship trap in SLA reporting.
  const dateFilterLabel = dateFilter === 'all'
    ? 'All reports, cohorted by submission date'
    : dateFilter === 'custom'
    ? customStart && customEnd
      ? `Reports submitted ${format(new Date(customStart), 'd MMM yyyy')} – ${format(new Date(customEnd), 'd MMM yyyy')}`
      : customStart
      ? `Reports submitted from ${format(new Date(customStart), 'd MMM yyyy')} onward`
      : customEnd
      ? `Reports submitted through ${format(new Date(customEnd), 'd MMM yyyy')}`
      : 'All reports, cohorted by submission date (no custom range set)'
    : `Reports submitted in the last ${dateFilter === '7d' ? '7' : '30'} days`;

  // One instance rendered on every tab. City Health previously had no filter UI
  // at all despite being filter-sensitive, so it silently reflected whatever had
  // been selected on another tab.
  const filterBar = (
    <AnalyticsFilterBar
      dateFilter={dateFilter}
      onDateFilterChange={setDateFilter}
      customStart={customStart}
      customEnd={customEnd}
      onCustomStartChange={setCustomStart}
      onCustomEndChange={setCustomEnd}
      selectedDept={selectedDept}
      onDeptChange={setSelectedDept}
      departments={departmentOptions}
      canChooseDept={role === 'admin'}
    />
  );

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Top action header bar */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
        <div>
          <h1 className="page-header-title">
            Infrastructure Analytics
          </h1>
          <p className="page-header-sub">
            How fast the city responds, where problems are clustering, and whether repairs are actually holding.
          </p>
        </div>
        <button
          onClick={exportToPDF}
          disabled={pdfGenerating}
          className="export-btn disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pdfGenerating ? (
            <>
              <RefreshCw className="animate-spin" size={16} />
              Generating PDF...
            </>
          ) : (
            <>
              <Download size={16} />
              Export Executive Brief
            </>
          )}
        </button>
      </div>

        {/* Sub-navigation Tabs */}
        <div className="flex bg-[#f5f1e6] p-1.5 rounded-2xl border border-[#1f1e1a]/8 self-start overflow-x-auto scrollbar-none max-w-full gap-2">
        <button
          onClick={() => setActiveViewTab('overview')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'overview'
              ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
              : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
          }`}
        >
          Overview & Trends
        </button>
        <button
          onClick={() => setActiveViewTab('cityhealth')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'cityhealth'
              ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
              : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
          }`}
        >
          <Activity size={15} />
          City Health
        </button>
        <button
          onClick={() => setActiveViewTab('hotspots')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'hotspots'
              ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
              : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
          }`}
        >
          Predictive Hotspots ({recurringHotspots.length + rootCauseAdvisories.length})
        </button>
        <button
          onClick={() => setActiveViewTab('dispatch')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'dispatch'
              ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
              : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
          }`}
        >
          <Truck size={15} />
          Dispatch &amp; Audit
        </button>
      </div>

      {/* Main page content wrapper for PDF capture */}
      <div className="space-y-6 p-1 rounded-2xl">

        {/* ==================== OVERVIEW & TRENDS TAB ==================== */}
        {activeViewTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            {filterBar}

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Active Reports</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-1">{kpiStats.active}</div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">Out of {kpiStats.total} total reports</div>
                  {/* What kind of active — untouched vs already being worked
                      call for different responses. */}
                  {activeStatusBreakdown.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-[#1f1e1a]/6">
                      {activeStatusBreakdown.map(([status, count]) => (
                        <button
                          key={status}
                          onClick={() => openExplore({ status })}
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer"
                          style={{ background: 'rgba(74,93,63,0.08)', color: '#4a5d3f' }}
                          title={`${count} ${status} — click to see them`}
                        >
                          {status} {count}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Average Time to Fix</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-1">
                    {kpiStats.avgDays == null
                      ? <span className="text-base text-[#8a8477]">Insufficient data</span>
                      : `${kpiStats.avgDays} Days`}
                  </div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">From report submitted to problem resolved</div>
                  {kpiStats.avgDays != null && (
                    <div className="mt-3 pt-3 border-t border-[#1f1e1a]/6 space-y-1.5">
                      <div
                        className="text-[9px] font-bold"
                        style={{ color: kpiStats.avgDays > SLA_END_TO_END_DAYS ? '#b91c1c' : '#15803d' }}
                      >
                        {kpiStats.avgDays > SLA_END_TO_END_DAYS
                          ? `${fmtDuration(kpiStats.avgDays - SLA_END_TO_END_DAYS)} over the ${SLA_END_TO_END_DAYS}-day target`
                          : `${fmtDuration(SLA_END_TO_END_DAYS - kpiStats.avgDays)} under the ${SLA_END_TO_END_DAYS}-day target`}
                      </div>
                      {kpiStats.fastestSLA && (
                        <button
                          onClick={() => openExplore({ department: kpiStats.fastestSLA.name })}
                          className="flex items-center justify-between w-full text-[9px] font-semibold cursor-pointer"
                        >
                          <span className="text-[#8a8477]">Fastest</span>
                          <span style={{ color: '#15803d' }}>{kpiStats.fastestSLA.name} — {fmtDuration(kpiStats.fastestSLA.avgResolveDays)}</span>
                        </button>
                      )}
                      {kpiStats.slowestSLA && (
                        <button
                          onClick={() => openExplore({ department: kpiStats.slowestSLA.name })}
                          className="flex items-center justify-between w-full text-[9px] font-semibold cursor-pointer"
                        >
                          <span className="text-[#8a8477]">Slowest</span>
                          <span style={{ color: '#b91c1c' }}>{kpiStats.slowestSLA.name} — {fmtDuration(kpiStats.slowestSLA.avgResolveDays)}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Active Hotspots</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-1">{kpiStats.hotspotsCount} Zones</div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">Areas with several reports close together</div>
                  {/* The zone count alone doesn't say what's clustering —
                      the category breakdown does. */}
                  {hotspotCategoryBreakdown.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-[#1f1e1a]/6">
                      {hotspotCategoryBreakdown.map(([category, count]) => (
                        <button
                          key={category}
                          onClick={() => openExplore({ category })}
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold cursor-pointer"
                          style={{ background: 'rgba(193,97,63,0.08)', color: '#c1613f' }}
                          title={`${count} hotspot zone${count === 1 ? '' : 's'} in ${category} — click to see those reports`}
                        >
                          {category} {count}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setActiveViewTab('hotspots')}
                    className="mt-2 text-[9px] font-bold underline decoration-dotted underline-offset-2 cursor-pointer"
                    style={{ color: '#4a5d3f' }}
                  >
                    Full breakdown →
                  </button>
                </div>
              </div>

              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Allocation Status</div>
                  <div
                    className="text-lg font-black mt-1 truncate max-w-[220px]"
                    style={{ color: kpiStats.healthStatus === 'Optimal' ? '#15803d' : '#b91c1c' }}
                    title={kpiStats.healthStatus}
                  >
                    {kpiStats.healthStatus}
                  </div>
                  <div className="text-[10px] text-[#4b473d] font-semibold mt-1 leading-relaxed">
                    {kpiStats.recommendation}
                  </div>
                  <div className="text-[9px] text-[#8a8477] mt-1.5 pt-1.5 border-t border-[#1f1e1a]/6 leading-relaxed">
                    {selectedDept === 'all'
                      ? (kpiStats.healthStatus === 'Optimal'
                          ? `Optimal means every department has ${INSIGHT.backlogAlertTickets} or fewer open reports waiting.`
                          : `Triggers when any department has more than ${INSIGHT.backlogAlertTickets} open reports waiting.`)
                      : `Scoped to ${kpiStats.worstBacklogDept} — triggers once it has more than ${INSIGHT.backlogAlertTickets} open reports waiting.`}
                  </div>
                  {/* Backlog alone only says "is work piling up" — resolve
                      time and on-time rate say "is it moving fast enough"
                      and "does it hit the target once it moves." Every
                      department, not just whichever one is flagged, so
                      "Normal" has a visible baseline. Deliberately ignores
                      the page's Department Scope filter (see the memo above)
                      since this is specifically a cross-department comparison. */}
                  <div className="flex flex-col gap-1 mt-2">
                    {allDeptStatus.map((d) => {
                      const failBacklog = d.backlog > INSIGHT.backlogAlertTickets;
                      const failResolve = d.avgResolveDays != null && d.avgResolveDays > SLA_END_TO_END_DAYS;
                      const failOnTime = d.onTimeRate != null && d.onTimeRate < 60;
                      const failing = failBacklog || failResolve || failOnTime;
                      return (
                        <button
                          key={d.name}
                          onClick={() => openExplore({ department: d.name })}
                          className="flex items-center justify-between gap-2 px-2 py-1 rounded text-left cursor-pointer"
                          style={{ background: failing ? 'rgba(185,28,28,0.06)' : 'rgba(21,128,61,0.06)' }}
                          title={`${d.fullName} — click to see its reports`}
                        >
                          <span className="text-[9px] font-black shrink-0" style={{ color: failing ? '#b91c1c' : '#15803d' }}>
                            {d.name}
                          </span>
                          <span className="text-[8px] font-bold text-right">
                            <span style={{ color: failBacklog ? '#b91c1c' : '#8a8477' }}>{d.backlog} backlog</span>
                            {' · '}
                            <span style={{ color: failResolve ? '#b91c1c' : '#8a8477' }}>
                              {d.avgResolveDays != null ? `${fmtDuration(d.avgResolveDays)} avg` : 'no data'}
                            </span>
                            {' · '}
                            <span style={{ color: failOnTime ? '#b91c1c' : '#8a8477' }}>
                              {d.onTimeRate != null ? `${d.onTimeRate}% on time` : '—'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 pt-1.5 border-t border-[#1f1e1a]/6">
                    <div className="text-[8px] font-bold text-[#8a8477] uppercase tracking-wider mb-1">Requirements checked</div>
                    <ul className="space-y-0.5 text-[8px] text-[#8a8477] leading-relaxed">
                      <li>• Backlog — {INSIGHT.backlogAlertTickets} or fewer reports waiting</li>
                      <li>• Resolve time — {fmtDuration(SLA_END_TO_END_DAYS)} or under, on average</li>
                      <li>• On-time rate — 60%+ of resolved reports within {fmtDuration(SLA_END_TO_END_DAYS)}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Repair reliability — the one figure built from every resolved
                report, not just whatever is still open. Answers "does the
                city actually get better" rather than "how fast do we close
                tickets", and is why a report keeps mattering after it's fixed. */}
            <div
              className="rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between"
              style={{ background: 'linear-gradient(135deg, rgba(74,93,63,0.09), rgba(74,93,63,0.02))', border: '1px solid rgba(74,93,63,0.20)' }}
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(74,93,63,0.15)', color: '#3d4d34' }}>
                  <Activity size={22} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Repair Reliability</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-0.5">
                    {reliabilityAudit.overallHoldRate == null
                      ? <span className="text-base text-[#8a8477]">Insufficient data</span>
                      : `${reliabilityAudit.overallHoldRate}% of past repairs have held`}
                  </div>
                  <div className="text-[11px] text-[#8a8477] font-medium mt-0.5">
                    Across {reliabilityAudit.totalResolved} resolved reports, {reliabilityAudit.totalReIncidence} reappeared nearby within {REINCIDENCE.windowDays} days —
                    the only figure on this tab built from every closed report, not just what's still open.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0 self-stretch sm:self-auto">
                {/* Only meaningful as a cross-department comparison. A
                    department-scoped authority's view has exactly one
                    department in it, so "needs attention: [their own name]"
                    is trivially true and confusing rather than informative. */}
                {reliabilityAudit.worst && reliabilityAudit.rows.length > 1 && (
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#8a8477]">Needs attention</div>
                    <div className="text-sm font-bold" style={{ color: '#c1613f' }}>{reliabilityAudit.worst.name}</div>
                  </div>
                )}
                <button
                  onClick={() => setShowReliabilityModal(true)}
                  className="px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap"
                  style={{ background: '#3d4d34', color: '#fff' }}
                >
                  Full breakdown →
                </button>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Historical Trend Line */}
              <div className="content-card lg:col-span-2 min-w-0">
                <div className="content-card-header">
                  <div className="content-card-title">
                    Report Volume Trends
                  </div>
                  <span className="text-[11px] text-[#8a8477]">
                    {format(trendRange.start, 'd MMM yyyy')} – {format(trendRange.end, 'd MMM yyyy')}
                    {trendRange.truncated && ` (capped at ${TREND_MAX_DAYS} days)`}
                  </span>
                </div>
                <div className="p-5">
                  {trendInsight && (
                    <p className="text-xs font-semibold leading-relaxed mb-3" style={{ color: trendInsight.pctChange > 0 ? '#8a4b0a' : '#3d4d34' }}>
                      {trendInsight.pctChange != null && (
                        <>This week: {trendInsight.pctChange >= 0 ? 'up' : 'down'} {Math.abs(trendInsight.pctChange)}% vs last week
                        ({trendInsight.last7Sum} vs {trendInsight.prior7Sum} reports).{' '}</>
                      )}
                      {trendInsight.peak && (
                        <>Busiest day: <button onClick={() => openExplore({ dateFrom: `${trendInsight.peak.rawDate}T00:00`, dateTo: `${trendInsight.peak.rawDate}T23:59` })} className="underline decoration-dotted underline-offset-2 hover:opacity-70">{trendInsight.peak.date} ({trendInsight.peak.Reports})</button>.</>
                      )}
                    </p>
                  )}
                  <div style={{ height: '260px', width: '100%', cursor: 'pointer' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={trendChartData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        onClick={(e) => {
                          const point = e?.activePayload?.[0]?.payload;
                          if (point && point.Reports > 0) {
                            openExplore({ dateFrom: `${point.rawDate}T00:00`, dateTo: `${point.rawDate}T23:59` });
                          }
                        }}
                      >
                        <defs>
                          <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                        <XAxis dataKey="date" stroke="#8a8477" fontSize={10} tickLine={false} />
                        <YAxis stroke="#8a8477" fontSize={10} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                        <Area type="monotone" dataKey="Reports" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTrend)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[10px] text-[#8a8477] mt-1.5">Click a point on the line to see that day's reports.</p>
                </div>
              </div>

              {/* Category Distribution Pie Chart */}
              <div className="content-card min-w-0">
                <div className="content-card-header">
                  <div className="content-card-title">
                    Incidents by Category
                  </div>
                </div>
                <div className="p-5">
                  {categoryChartData.length > 0 && filteredReports.length > 0 && (
                    <p className="text-xs font-semibold leading-relaxed mb-2" style={{ color: '#8a4b0a' }}>
                      {categoryChartData[0].name} is the most reported —{' '}
                      {Math.round((categoryChartData[0].value / filteredReports.length) * 100)}% of all reports in this window.
                    </p>
                  )}
                  <div className="relative flex items-center justify-center" style={{ height: '230px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={3}
                          dataKey="value"
                          cursor="pointer"
                          onClick={(d) => {
                            const name = d?.name ?? d?.payload?.name;
                            if (name) openExplore({ category: name });
                          }}
                        >
                          {categoryChartData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={COLORS[index % COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Legend — real counts, and each entry opens the explorer
                      pre-filtered to it, so the chart isn't the only
                      clickable surface. */}
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 px-2 mt-2">
                    {categoryChartData.map((entry, index) => (
                      <button
                        key={entry.name}
                        onClick={() => openExplore({ category: entry.name })}
                        className="flex items-center gap-1.5 text-[10px] font-semibold hover:opacity-70"
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[index % COLORS.length] }} />
                        <span className="truncate max-w-[100px]">{entry.name}</span>
                        <span className="text-[#8a8477]">{entry.value}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* SLA Performance Bar Chart / Scoped Status Chart */}
            <div className="content-card min-w-0">
                <div className="content-card-header">
                  <div className="content-card-title">
                    {selectedDept === 'all'
                      ? 'Average Days to Resolve Reports vs SLA Target (3 Days)'
                      : `${selectedDept} Report Status Breakdown`}
                  </div>
                </div>
                <div className="p-5">
                  {selectedDept === 'all' && (() => {
                    const worst = [...measurableSLAMetrics]
                      .filter((d) => d.avgResolveDays > SLA_END_TO_END_DAYS)
                      .sort((a, b) => b.avgResolveDays - a.avgResolveDays)[0];
                    return worst ? (
                      <p className="text-xs font-semibold leading-relaxed mb-3" style={{ color: '#b91c1c' }}>
                        {worst.fullName} is {fmtDuration(worst.avgResolveDays - SLA_END_TO_END_DAYS)} over target —
                        click its bar to see the resolved reports that average is built from.
                      </p>
                    ) : (
                      <p className="text-xs font-semibold leading-relaxed mb-3" style={{ color: '#15803d' }}>
                        Every department with a measurable resolve time is inside the {SLA_END_TO_END_DAYS}-day target.
                      </p>
                    );
                  })()}
                  <div style={{ height: '260px', width: '100%', cursor: 'pointer' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      {selectedDept === 'all' ? (
                        <BarChart data={measurableSLAMetrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                          <XAxis dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} />
                          <YAxis stroke="#8a8477" fontSize={11} tickLine={false} label={{ value: 'Days', angle: -90, position: 'insideLeft', stroke: '#8a8477', fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                          <ReferenceLine y={SLA_END_TO_END_DAYS} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Target SLA', fill: '#ef4444', fontSize: 9, position: 'top' }} />
                          <Bar
                            dataKey="avgResolveDays"
                            radius={[6, 6, 0, 0]}
                            maxBarSize={45}
                            onClick={(d) => {
                              const entry = d?.payload ?? d;
                              // Resolved only — the average this bar shows is
                              // itself only ever computed from resolved
                              // tickets, so an open ticket with no resolve
                              // time yet has nothing to do with this number.
                              if (entry?.name) openExplore({ department: entry.name, status: 'Resolved' });
                            }}
                          >
                            {measurableSLAMetrics.map((entry, index) => {
                              const exceedsSLA = entry.avgResolveDays > SLA_END_TO_END_DAYS;
                              return <Cell key={`cell-${index}`} fill={exceedsSLA ? '#ef4444' : '#10b981'} />;
                            })}
                          </Bar>
                        </BarChart>
                      ) : (
                        <BarChart data={deptStatusData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                          <XAxis type="number" stroke="#8a8477" fontSize={10} tickLine={false} />
                          <YAxis dataKey="name" type="category" stroke="#8a8477" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                          <Bar
                            dataKey="value"
                            radius={[0, 6, 6, 0]}
                            maxBarSize={30}
                            onClick={(d) => {
                              const entry = d?.payload ?? d;
                              if (!entry?.name) return;
                              // "In Progress" is a catch-all bucket (In Review/In
                              // Process/In Maintenance lumped together), not one
                              // real status value, so leave status unfiltered for it.
                              const status = ['Pending', 'Resolved', 'Rejected'].includes(entry.name) ? entry.name : 'all';
                              openExplore({ department: selectedDept, status });
                            }}
                          >
                            {deptStatusData.map((entry, index) => {
                              let color = '#3b82f6';
                              if (entry.name === 'Pending') color = '#f59e0b';
                              else if (entry.name === 'In Progress') color = '#3b82f6';
                              else if (entry.name === 'Resolved') color = '#10b981';
                              else if (entry.name === 'Rejected') color = '#3f3f46';
                              return <Cell key={`cell-${index}`} fill={color} />;
                            })}
                          </Bar>
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                  <p className="text-[10px] text-[#8a8477] mt-1.5">Click a bar to see the reports behind it.</p>
                </div>
              </div>

          </div>
        )}

        {/* ==================== PREDICTIVE HOTSPOTS TAB ==================== */}
        {activeViewTab === 'hotspots' && (
          <div className="space-y-6 animate-fade-in">
            {filterBar}

            {/* Heatmap Card */}
            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title">
                  <MapPin size={16} className="text-[#4a5d3f] mr-2" />
                  Melaka Report Density Heatmap
                </div>
              </div>
              <div className="p-5">
                <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8 relative z-10" style={{ height: '380px', width: '100%' }}>
                  <MapContainer
                    center={[2.1896, 102.2501]}
                    zoom={12.5}
                    style={{ height: '100%', width: '100%' }}
                    zoomControl={false}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <HeatmapLayer points={heatmapPoints} ready={mapReady} />
                    <MapResizer />
                    <MapController focus={mapFocus} />
                  </MapContainer>
                </div>
                <p className="text-[10px] text-[#8a8477] mt-2.5">Click a hotspot below to open its full detail with the individual reports on a map.</p>
              </div>
            </div>

            {/* Hotspots & Systemic list, with the clustering controls that
                shape it right above — dragging the radius/density here
                re-sorts and re-filters the exact list underneath it,
                instead of a separate panel elsewhere on the page. */}
            <div className="content-card flex flex-col">
            <div className="content-card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#1f1e1a]/8 pb-4">
              <div className="content-card-title">
                Infrastructure Decision Support
              </div>

              {/* Tab Selector */}
              <div className="flex bg-[#f5f1e6] p-1 rounded-xl border border-[#1f1e1a]/8 self-start sm:self-auto">
                <button
                  onClick={() => setActiveTab('single')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'single'
                      ? 'bg-[#4a5d3f] text-white border border-[#4a5d3f] shadow-lg'
                      : 'text-[#8a8477] hover:text-[#201f1b] border border-transparent'
                  }`}
                >
                  Hotspots ({recurringHotspots.length})
                </button>
                <button
                  onClick={() => setActiveTab('systemic')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'systemic'
                      ? 'bg-[#4a5d3f] text-white border border-[#4a5d3f] shadow-lg'
                      : 'text-[#8a8477] hover:text-[#201f1b] border border-transparent'
                  }`}
                >
                  Systemic ({rootCauseAdvisories.length})
                </button>
              </div>
            </div>

              {/* Clustering Controls */}
              <div className="px-5 py-4 border-b border-[#1f1e1a]/8" style={{ background: 'rgba(74,93,63,0.04)' }}>
                <div className="flex flex-col sm:flex-row sm:items-start gap-5">
                  <div className="flex-1 min-w-[200px] space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-[#4b473d]">
                      <span>Cluster Proximity Radius</span>
                      <span className="text-[#4a5d3f] font-bold">{proximityRadius}m</span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="1000"
                      step="50"
                      value={proximityRadius}
                      onChange={(e) => setProximityRadius(Number(e.target.value))}
                      className="w-full h-1.5 bg-[#e7ede1] rounded-lg appearance-none cursor-pointer accent-[#4a5d3f]"
                    />
                    <div className="flex justify-between text-[9px] text-[#8a8477] font-medium">
                      <span>50m (Precise)</span>
                      <span>1000m (Broad)</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-[240px] space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold text-[#4b473d]">
                      <span>Minimum Report Density</span>
                      <span className="text-[#4a5d3f] font-bold">{minClusterSize}+ reports</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[2, 3, 4, 5, 6, 8, 10, 15].map((val) => (
                        <button
                          key={val}
                          onClick={() => setMinClusterSize(val)}
                          className={`py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            minClusterSize === val
                              ? 'bg-[#4a5d3f] border-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20'
                              : 'bg-[#f5f1e6] border-[#1f1e1a]/12 hover:border-[#4a5d3f]/30 text-[#8a8477] hover:text-[#201f1b]'
                          }`}
                        >
                          {val}+
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 flex-1 flex flex-col space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="relative flex-1 min-w-[200px]">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a8477] pointer-events-none" />
                        <input
                          type="text"
                          value={hotspotSearch}
                          onChange={(e) => setHotspotSearch(e.target.value)}
                          placeholder="Search by address or category…"
                          className="w-full bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-xl pl-8 pr-8 py-2 text-xs font-semibold text-[#201f1b] outline-none focus:border-[#4a5d3f]/50 transition-colors"
                        />
                        {hotspotSearch && (
                          <button
                            onClick={() => setHotspotSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8477] hover:text-[#201f1b]"
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                      <span className="text-[10px] font-semibold text-[#8a8477] shrink-0">
                        {activeTab === 'single' ? 'Sorted by how often it has recurred, most first' : 'Sorted by priority, highest first'}
                      </span>
                    </div>
                    {activeTab === 'systemic' && (
                      <p className="text-[10px] text-[#8a8477] leading-relaxed -mt-2">
                        <Info size={10} className="inline mr-1 -mt-0.5" />
                        A Hotspot is many reports about the <strong>same</strong> problem. This is different —
                        each row mixes two or more <strong>different</strong> problem types (e.g. drainage +
                        road damage) that showed up in the same spot, which usually means one is causing the
                        other. Fixing the visible symptom without the cause tends to bring it back.
                      </p>
                    )}
                    {activeTab === 'single' ? (
                      <p className="text-[10px] text-[#8a8477] leading-relaxed -mt-2">
                        <Info size={10} className="inline mr-1 -mt-0.5" />
                        This shows resolved repairs that came back — a new report of the same category within{' '}
                        {REINCIDENCE.radiusM}m and {REINCIDENCE.windowDays} days of the fix, evidence the original
                        repair didn't hold. Not currently-open work — there's nothing to dispatch here, it's a
                        signal for wherever repairs get planned.
                      </p>
                    ) : (
                      <p className="text-[10px] text-[#8a8477] leading-relaxed -mt-2">
                        <Info size={10} className="inline mr-1 -mt-0.5" />
                        Priority score combines report count, upvotes, how urgent the category is, and how long it's
                        been open — reports tightly clustered together and from reporters with an accurate track
                        record count for more. Same score the Dispatch & Audit queue uses.
                      </p>
                    )}
                    <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 space-y-3 scrollbar-thin">
                      {activeTab === 'single' ? (
                        displayRecurringHotspots.length === 0 ? (
                          <div className="h-48 flex flex-col items-center justify-center text-[#8a8477] text-xs text-center">
                            <CheckCircle2 className="text-[#8a8477] mb-2 animate-pulse mx-auto" size={24} />
                            {recurringHotspots.length === 0 ? 'No recurring-failure locations detected.' : `No hotspots match "${hotspotSearch}".`}
                          </div>
                        ) : (
                          displayRecurringHotspots.map((h) => renderRecurringHotspotCard(h))
                        )
                      ) : (
                        displayAdvisories.length === 0 ? (
                          <div className="h-48 flex flex-col items-center justify-center text-[#8a8477] text-xs text-center">
                            <CheckCircle2 className="text-[#8a8477] mb-2 animate-pulse mx-auto" size={24} />
                            {rootCauseAdvisories.length === 0 ? 'No systemic cross-department issues detected.' : `No systemic issues match "${hotspotSearch}".`}
                          </div>
                        ) : (
                          displayAdvisories.map((a) => renderHotspotCard(a, true))
                        )
                      )}
                    </div>
                  </div>
                </div>

            {/* Detail & Edit popup — used to swap in for the Clustering
                Controls panel above, which hid the panel and forced a "Back"
                click just to change the radius/density mid-edit. */}
            {activeCluster && (
              <>
                <div className="fixed inset-0 z-40 overlay-fade-in" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setActiveClusterId(null)} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div
                    className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden modal-pop-in"
                    style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
                  >
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {priorityById[activeCluster.id] && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide"
                            style={{
                              color: (RISK_TONE[priorityById[activeCluster.id].primaryRisk] || DEFAULT_RISK_TONE).color,
                              background: (RISK_TONE[priorityById[activeCluster.id].primaryRisk] || DEFAULT_RISK_TONE).bg,
                            }}
                            title={PRIORITY_RISK_EXPLANATION[priorityById[activeCluster.id].primaryRisk] || ''}
                          >
                            Priority {priorityById[activeCluster.id].priorityScore} · {priorityById[activeCluster.id].primaryRisk}
                          </span>
                        )}
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-[#4a5d3f]/10 border border-[#4a5d3f]/20 text-[#4a5d3f]">
                          {activeCluster.category}
                        </span>
                      </div>
                      <button onClick={() => setActiveClusterId(null)} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
                        <X size={18} />
                      </button>
                    </div>
                    <div className="p-5 space-y-5 text-left overflow-y-auto">
                      {/* Evidence map — every constituent report as its own
                          marker, not just the fuzzy density heatmap behind
                          this popup (which the overlay blur hides anyway). */}
                      <div>
                        <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8" style={{ height: 260 }}>
                          <MapContainer
                            key={activeCluster.id}
                            center={[activeCluster.latitude, activeCluster.longitude]}
                            zoom={15.5}
                            style={{ height: '100%', width: '100%' }}
                          >
                            <TileLayer
                              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <Circle
                              center={[activeCluster.latitude, activeCluster.longitude]}
                              radius={proximityRadius}
                              pathOptions={{
                                color: activeCluster.id.startsWith('advisory-') ? '#6366f1' : '#4a5d3f',
                                fillColor: activeCluster.id.startsWith('advisory-') ? '#6366f1' : '#4a5d3f',
                                fillOpacity: 0.06,
                                weight: 1.5,
                                dashArray: activeCluster.id.startsWith('advisory-') ? '6, 6' : undefined
                              }}
                            />
                            {activeCluster.items
                              .filter((it) => it.latitude != null && it.longitude != null)
                              .map((it) => (
                                <CircleMarker
                                  key={it.id}
                                  center={[it.latitude, it.longitude]}
                                  radius={7}
                                  pathOptions={{
                                    color: clusterMarkerColor(it.status),
                                    fillColor: clusterMarkerColor(it.status),
                                    fillOpacity: 0.9,
                                    weight: 2,
                                  }}
                                >
                                  <Popup>
                                    <div style={{ fontSize: 12, minWidth: 180 }}>
                                      <div style={{ fontWeight: 700 }}>{it.address || it.location || 'Unknown location'}</div>
                                      <div style={{ color: '#8a8477', marginTop: 2 }}>Category: {it.categories || activeCluster.category}</div>
                                      <div style={{ color: '#8a8477' }}>Status: {it.status}</div>
                                      {it.upvotes > 0 && <div style={{ color: '#8a8477' }}>{it.upvotes} upvotes</div>}
                                    </div>
                                  </Popup>
                                </CircleMarker>
                              ))}
                            <MapResizer />
                          </MapContainer>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap mt-2 text-[10px] text-[#8a8477]">
                          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#b45309' }} /> Waiting to be actioned</span>
                          <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#3b82f6' }} /> Already being worked</span>
                          <span>Click a marker for that report's detail.</span>
                        </div>
                        {priorityById[activeCluster.id] && (
                          <p className="text-[10px] text-[#8a8477] leading-relaxed mt-2">
                            <Info size={10} className="inline mr-1 -mt-0.5" />
                            Priority {priorityById[activeCluster.id].priorityScore} of 100.{' '}
                            {PRIORITY_RISK_EXPLANATION[priorityById[activeCluster.id].primaryRisk] || ''}
                          </p>
                        )}
                      </div>

                      {/* Edit Name */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">Hotspot Location Name</label>
                        <input
                          type="text"
                          value={activeCluster.address}
                          onChange={(e) => {
                            setCustomOverrides(prev => ({
                              ...prev,
                              [activeCluster.seedId]: {
                                ...prev[activeCluster.seedId],
                                customAddress: e.target.value
                              }
                            }));
                          }}
                          placeholder={activeCluster.defaultAddress}
                          className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-xl px-4 py-2 text-xs font-semibold text-[#201f1b] outline-none focus:border-[#4a5d3f]/50 transition-colors w-full"
                        />
                      </div>

                      {/* Edit Recommendation */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider">Actionable Recommendation</label>
                          <button
                            onClick={() => {
                              setCustomOverrides(prev => {
                                const copy = { ...prev };
                                if (copy[activeCluster.seedId]) {
                                  const next = { ...copy[activeCluster.seedId] };
                                  delete next.customRecommendation;
                                  copy[activeCluster.seedId] = next;
                                }
                                return copy;
                              });
                            }}
                            className="text-[9px] font-bold text-[#8a8477] hover:text-[#4b473d] transition-colors cursor-pointer"
                          >
                            Reset to Default
                          </button>
                        </div>
                        <textarea
                          value={activeCluster.recommendation}
                          onChange={(e) => {
                            setCustomOverrides(prev => ({
                              ...prev,
                              [activeCluster.seedId]: {
                                ...prev[activeCluster.seedId],
                                customRecommendation: e.target.value
                              }
                            }));
                          }}
                          rows={4}
                          className="bg-[#f5f1e6] border border-[#1f1e1a]/12 rounded-xl px-4 py-2 text-xs font-semibold text-[#201f1b] outline-none focus:border-[#4a5d3f]/50 transition-colors w-full resize-none leading-relaxed"
                        />
                      </div>

                      {/* Exclude / Include Reports List */}
                      <div className="flex flex-col min-h-0 pt-2 border-t border-[#1f1e1a]/8">
                        <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2 flex items-center justify-between">
                          <span>Constituent Reports</span>
                          <span className="px-1.5 py-0.5 rounded bg-[#f5f1e6] text-[#4b473d] text-[9px] font-black">{activeCluster.items.length} Reports</span>
                        </label>
                        <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2 scrollbar-thin">
                          {activeCluster.items.map((item) => (
                            <div key={item.id} className="flex items-start gap-2.5 p-2.5 bg-[#f7f4ec] border border-[#1f1e1a]/8 rounded-lg text-left">
                              <input
                                type="checkbox"
                                checked={!(customOverrides[activeCluster.seedId]?.excludedReportIds?.includes(item.id))}
                                onChange={() => handleToggleExcludeTicket(activeCluster.seedId, item.id)}
                                className="mt-0.5 cursor-pointer accent-[#4a5d3f] rounded border-[#1f1e1a]/15"
                                title="Exclude this report from cluster"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] leading-relaxed text-[#4b473d] truncate font-semibold">
                                  {item.description || 'No description'}
                                </p>
                                <p className="text-[9px] text-[#8a8477] font-medium mt-0.5">
                                  Report #{item.id} | {item.status} | {item.upvotes || 0} Upvotes
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Recurring-hotspot detail popup — read-only by design. Everything
                in here is already Resolved, so there's no assignment to edit
                and no crew to dispatch; the map's job is just to show why this
                spot was flagged, matching the same original-to-reappearance
                visual language as the Repair Reliability modal. */}
            {activeRecurring && (
              <>
                <div className="fixed inset-0 z-40 overlay-fade-in" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={() => setActiveRecurringId(null)} />
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                  <div
                    className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden modal-pop-in"
                    style={{ background: '#fff', boxShadow: '0 32px 80px rgba(31,30,26,0.25)' }}
                  >
                    <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1e1a]/8 shrink-0">
                      <div>
                        <div className="text-sm font-black text-[#201f1b]">{activeRecurring.category} — recurring failure</div>
                        <div className="text-[11px] text-[#8a8477]">
                          {activeRecurring.size} resolved repair{activeRecurring.size === 1 ? '' : 's'} · {activeRecurring.totalReappearances} reappearance{activeRecurring.totalReappearances === 1 ? '' : 's'} nearby
                        </div>
                      </div>
                      <button onClick={() => setActiveRecurringId(null)} className="p-2 rounded-full transition-colors" style={{ color: '#8a8477' }}>
                        <X size={18} />
                      </button>
                    </div>
                    <div className="p-5 overflow-y-auto space-y-4">
                      <p className="text-xs text-[#8a8477] leading-relaxed">
                        Each green marker is a repair the council marked Resolved. Each red marker is a later report of
                        the same category within {REINCIDENCE.radiusM}m and {REINCIDENCE.windowDays} days — evidence the
                        original fix didn't hold. This is historical only: nothing here is unclaimed work, so there's
                        nothing to dispatch — worth a look from whoever plans repairs for this area.
                      </p>
                      <div className="rounded-xl overflow-hidden border border-[#1f1e1a]/8" style={{ height: 340 }}>
                        <MapContainer key={activeRecurring.id} center={[activeRecurring.latitude, activeRecurring.longitude]} zoom={15} style={{ height: '100%', width: '100%' }}>
                          <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                          />
                          {activeRecurring.items.map((ticket) => (
                            <Fragment key={ticket.id}>
                              <CircleMarker center={[ticket.latitude, ticket.longitude]} radius={7} pathOptions={{ color: '#15803d', fillColor: '#15803d', fillOpacity: 0.85, weight: 2 }}>
                                <Popup>
                                  <div style={{ fontSize: 12, minWidth: 180 }}>
                                    <div style={{ fontWeight: 700 }}>{ticket.address}</div>
                                    <div style={{ color: '#8a8477' }}>Resolved {fmtRecurDate(ticket.resolvedAt)}</div>
                                  </div>
                                </Popup>
                              </CircleMarker>
                              {ticket.reappearances.filter((rep) => rep.latitude != null && rep.longitude != null).map((rep) => (
                                <Fragment key={rep.id}>
                                  <Polyline positions={[[ticket.latitude, ticket.longitude], [rep.latitude, rep.longitude]]} pathOptions={{ color: '#b91c1c', weight: 2, dashArray: '4 4' }} />
                                  <CircleMarker center={[rep.latitude, rep.longitude]} radius={5} pathOptions={{ color: '#b91c1c', fillColor: '#fff', fillOpacity: 1, weight: 2 }}>
                                    <Popup>
                                      <div style={{ fontSize: 12, minWidth: 160 }}>
                                        <div style={{ fontWeight: 700 }}>{rep.address}</div>
                                        <div style={{ color: '#8a8477' }}>Reappeared {fmtRecurDate(rep.at)}, {rep.distanceM}m from the original repair</div>
                                      </div>
                                    </Popup>
                                  </CircleMarker>
                                </Fragment>
                              ))}
                            </Fragment>
                          ))}
                          <MapResizer />
                        </MapContainer>
                      </div>
                      <div className="space-y-2">
                        {activeRecurring.items.map((ticket) => (
                          <div key={ticket.id} className="rounded-xl p-3 border border-[#1f1e1a]/8" style={{ background: 'var(--cream-100)' }}>
                            <div className="text-xs font-bold text-[#201f1b]">{ticket.address}</div>
                            <div className="text-[10px] text-[#8a8477] mt-0.5">
                              Resolved {fmtRecurDate(ticket.resolvedAt)} — reappeared {ticket.reappearances.length} time{ticket.reappearances.length === 1 ? '' : 's'},
                              most recently {fmtRecurDate(ticket.reappearances[ticket.reappearances.length - 1]?.at)} ({ticket.reappearances[ticket.reappearances.length - 1]?.distanceM}m away)
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}



        {/* ==================== CITY HEALTH & WELLNESS TAB ==================== */}
        {activeViewTab === 'cityhealth' && (
          <div className="space-y-6 animate-fade-in">

            {filterBar}

            {/* Two bands: what the council does, and what the city is like.
                The previous single composite scored throughput and labelled it
                city condition. */}
            <CityHealthBands
              servicePerformance={servicePerformance}
              urbanCondition={urbanCondition}
              infrastructureFragility={infrastructureFragility}
              backlogFlow={backlogFlow}
              reportCount={filteredReports.length}
              activeBand={cityHealthBand}
              onBandChange={setCityHealthBand}
              onZoneClick={(zone) => openExplore({ zone })}
            />

            {/* Row 4: a zone breakdown that matches whichever score band is
                active — Service Performance and Urban Condition had no
                zone-level view anywhere else on this tab, and Infrastructure
                Fragility already has its own zone chart, so nothing repeats
                here. */}
            {cityHealthBand === 'spi' && (() => {
              const graded = zoneScorecard.filter(z => z.resolutionRate != null);
              const ungraded = zoneScorecard.length - graded.length;
              const chartData = [...graded].sort((a, b) => a.resolutionRate - b.resolutionRate);
              const gradeColor = (rate) => (rate >= 80 ? '#15803d' : rate >= 60 ? '#b45309' : '#b91c1c');

              const ZoneTooltip = ({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const z = payload[0].payload;
                return (
                  <div className="bg-white border border-[#1f1e1a]/10 rounded-lg p-3 text-xs shadow-lg">
                    <div className="font-bold text-[#201f1b] mb-1">{z.name}</div>
                    <div className="text-[#4b473d] space-y-0.5">
                      <div>{z.total} total · {z.active} active · {z.resolved} resolved</div>
                      <div>
                        Average {z.avgDays ?? '—'} days
                        {z.avgDays != null && z.avgDays > SLA_END_TO_END_DAYS && (
                          <span className="text-red-700 font-bold"> (over target)</span>
                        )}
                      </div>
                      {z.grade && <div>Grade <strong style={{ color: gradeColor(z.resolutionRate) }}>{z.grade}</strong></div>}
                    </div>
                  </div>
                );
              };

              // Percentage alone hides the actual counts behind it — "10%"
              // reads very differently as 1 of 10 vs 5 of 50. Put the counts
              // right on the label instead of leaving them only in the hover
              // tooltip.
              const ZoneRateLabel = (props) => {
                const { x, y, width, height, index } = props;
                const z = chartData[index];
                if (!z) return null;
                return (
                  <text x={x + width + 6} y={y + height / 2} dy={3.5} fontSize={10} fontWeight={700} fill="#4b473d">
                    {z.resolutionRate}% ({z.resolved}/{z.total - z.rejected})
                  </text>
                );
              };

              return (
                <div className="content-card">
                  <div className="content-card-header">
                    <div className="content-card-title flex items-center gap-2">
                      <MapPin size={16} className="text-[#4a5d3f]" />
                      Zone Response Rate
                    </div>
                    <div className="text-[10px] font-semibold text-[#8a8477]">
                      {zoneScorecard.length} zones tracked — worst shown first
                    </div>
                  </div>
                  <div className="p-5">
                    {chartData.length === 0 ? (
                      <div className="text-center text-[#8a8477] py-8 text-sm">No zone data available</div>
                    ) : (
                      <>
                        <div style={{ height: Math.max(220, chartData.length * 34) }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 75, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                              <XAxis type="number" domain={[0, 100]} stroke="#8a8477" fontSize={10} tickLine={false} unit="%" />
                              <YAxis type="category" dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} width={140} />
                              <Tooltip content={<ZoneTooltip />} cursor={{ fill: 'rgba(74,93,63,0.05)' }} />
                              <ReferenceLine x={80} stroke="#15803d" strokeDasharray="4 4" />
                              <Bar
                                dataKey="resolutionRate"
                                isAnimationActive={false}
                                radius={[0, 4, 4, 0]}
                                maxBarSize={18}
                                cursor="pointer"
                                onClick={(d) => {
                                  const name = d?.payload?.name ?? d?.name;
                                  if (name) openExplore({ zone: name });
                                }}
                              >
                                {chartData.map((z) => (
                                  <Cell key={z.name} fill={gradeColor(z.resolutionRate)} />
                                ))}
                                <LabelList dataKey="resolutionRate" content={ZoneRateLabel} />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="text-[10px] text-[#8a8477] mt-2">
                          Resolution rate is the number resolved, divided by the total minus rejected reports. The dashed line at 80% marks where a passing grade starts.
                          {ungraded > 0 && ` ${ungraded} zone${ungraded === 1 ? '' : 's'} left out — fewer than ${MIN_N_FOR_SCORE} reports, so they can't be graded yet.`}
                          {' '}Click a bar to see the reports behind it.
                        </p>
                        {/* The ranking alone doesn't say what to do about it —
                            name the worst zone and why it's worth a look. */}
                        {chartData[0].resolutionRate < 60 ? (
                          <div className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(185,28,28,0.06)', color: '#b91c1c' }}>
                            {chartData[0].name} is furthest behind at {chartData[0].resolutionRate}%. It may be worth checking whether
                            something specific to this zone — like routing, staffing, or access — is slowing it down, rather than a city-wide capacity problem.
                          </div>
                        ) : (
                          <div className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(21,128,61,0.06)', color: '#15803d' }}>
                            No zone is seriously behind — even the lowest, {chartData[0].name}, is still at {chartData[0].resolutionRate}%.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

            {cityHealthBand === 'uci' && (() => {
              const totalOpenCityWide = zoneScorecard.reduce((sum, z) => sum + z.active, 0);
              const chartData = [...zoneScorecard]
                .filter((z) => z.active > 0)
                .sort((a, b) => b.active - a.active);
              const shareOf = (n) => (totalOpenCityWide > 0 ? Math.round((n / totalOpenCityWide) * 100) : 0);

              const OpenZoneTooltip = ({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const z = payload[0].payload;
                return (
                  <div className="bg-white border border-[#1f1e1a]/10 rounded-lg p-3 text-xs shadow-lg">
                    <div className="font-bold text-[#201f1b] mb-1">{z.name}</div>
                    <div className="text-[#4b473d] space-y-0.5">
                      <div>{z.active} open of {z.total} total reports</div>
                      <div>{shareOf(z.active)}% of all open issues city-wide</div>
                      {z.avgDays != null && <div>Average {z.avgDays} days to resolve, when resolved</div>}
                    </div>
                  </div>
                );
              };

              // A raw count means little on its own — put its share of the
              // city-wide total right on the label instead of only on hover.
              const OpenZoneLabel = (props) => {
                const { x, y, width, height, index } = props;
                const z = chartData[index];
                if (!z) return null;
                return (
                  <text x={x + width + 6} y={y + height / 2} dy={3.5} fontSize={10} fontWeight={700} fill="#4b473d">
                    {z.active} ({shareOf(z.active)}%)
                  </text>
                );
              };

              return (
                <div className="content-card">
                  <div className="content-card-header">
                    <div className="content-card-title flex items-center gap-2">
                      <MapPin size={16} className="text-[#4a5d3f]" />
                      Open Issues by Zone
                    </div>
                    <div className="text-[10px] font-semibold text-[#8a8477]">
                      {totalOpenCityWide} open city-wide — most burdened shown first
                    </div>
                  </div>
                  <div className="p-5">
                    {chartData.length === 0 ? (
                      <div className="text-center text-[#8a8477] py-8 text-sm">No open issues right now.</div>
                    ) : (
                      <>
                        <div style={{ height: Math.max(220, chartData.length * 34) }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 70, left: 10, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(31,30,26,0.08)" />
                              <XAxis type="number" stroke="#8a8477" fontSize={10} tickLine={false} allowDecimals={false} />
                              <YAxis type="category" dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} width={140} />
                              <Tooltip content={<OpenZoneTooltip />} cursor={{ fill: 'rgba(74,93,63,0.05)' }} />
                              <Bar
                                dataKey="active"
                                isAnimationActive={false}
                                fill="#c1613f"
                                radius={[0, 4, 4, 0]}
                                maxBarSize={18}
                                cursor="pointer"
                                onClick={(d) => {
                                  const name = d?.payload?.name ?? d?.name;
                                  if (name) openExplore({ zone: name, status: 'all' });
                                }}
                              >
                                <LabelList dataKey="active" content={OpenZoneLabel} />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="text-[10px] text-[#8a8477] mt-2">
                          Open issues currently unresolved (not rejected) in each zone, right now — not weighted by
                          population or age (see Infrastructure Fragility for that). Bars aren't a pass/fail grade,
                          since there's no per-zone target to compare against, only a city-wide one. Click a bar
                          to see those reports.
                        </p>
                        <div className="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(193,97,63,0.06)', color: '#c1613f' }}>
                          {chartData[0].name} carries {chartData[0].active} open issue{chartData[0].active === 1 ? '' : 's'} —
                          {' '}{shareOf(chartData[0].active)}% of everything open city-wide. Worth checking whether that's
                          a real backlog or just a recent spike still working through the queue.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}

          </div>
        )}

        {/* ==================== DISPATCH & AUDIT TAB ==================== */}
        {activeViewTab === 'dispatch' && (
          <div className="space-y-6 animate-fade-in">
            {filterBar}
            <DispatchAudit
              dispatchQueue={prioritizedDispatchQueue}
              onDispatched={loadData}
            />
          </div>
        )}

      </div>

      {showReliabilityModal && (
        <RepairReliabilityModal
          contractorAudit={contractorAudit}
          auditActions={auditActions}
          onClose={() => setShowReliabilityModal(false)}
        />
      )}

      {/* Page-level (not tab-scoped) so a click from any tab — Overview
          charts, or the City Health zone charts — can open it. Any click
          pre-fills a single filter, but date/category/department/status/zone
          all stay live and combinable in the same modal afterward. */}
      {exploreFilters && (
        <ReportExplorerModal
          filters={exploreFilters}
          onFiltersChange={setExploreFilters}
          categories={exploreCategories}
          departments={departmentOptions}
          statuses={exploreStatuses}
          zones={exploreZones}
          results={exploreResults}
          onClose={() => setExploreFilters(null)}
        />
      )}
    </div>
  );
}
