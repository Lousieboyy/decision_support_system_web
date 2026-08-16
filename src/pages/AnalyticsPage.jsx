import { useEffect, useState, useMemo, useRef } from 'react';
import { fetchAllReports } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine, PieChart, Pie, ErrorBar,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { MapContainer, TileLayer, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import {
  AlertTriangle, AlertCircle, Download, Info, MapPin, RefreshCw,
  CheckCircle2, ChevronRight, ChevronLeft, Eye, Lightbulb, Heart, Activity
} from 'lucide-react';
import { format, parseISO, subDays, startOfWeek } from 'date-fns';
import {
  SLA_END_TO_END_DAYS, CLUSTER, REINCIDENCE, INSIGHT, MIN_N_FOR_SCORE, gradeFor,
} from '../utils/analyticsConstants';
import {
  calculateDistance, canonicalizeCategory, deriveZone, deriveDepartmentOptions,
} from '../utils/analyticsMetrics';
import { AnalyticsFilterBar } from '../components/AnalyticsFilterBar';
import { StageFunnel } from '../components/StageFunnel';

const HOTSPOT_OVERRIDES_KEY = 'analytics_hotspot_overrides_v1';

// Helper to compute priority on the fly matching the mobile app logic
const getPriority = (status, categories) => {
  if (status === 'Resolved') return 'Resolved';
  const cat = categories || '';
  if (cat.includes('Damage') || cat.includes('Drainage') || cat.includes('Tree')) {
    return 'High';
  }
  return 'Medium';
};

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

export function AnalyticsPage() {
  const { role, user } = useAuth();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const reportRef = useRef(null);

  // Scoping and Filter State
  const [dateFilter, setDateFilter] = useState('all');
  
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
  const [mapFocus, setMapFocus] = useState(null);
  const [activeTab, setActiveTab] = useState('single');
  const [activeViewTab, setActiveViewTab] = useState('overview'); // 'overview' | 'hotspots' | 'dispatch'
  const [upvoteWeight, setUpvoteWeight] = useState(1.0);
  const [priorityWeight, setPriorityWeight] = useState(1.0);
  const [agingWeight, setAgingWeight] = useState(1.0);
  const [trustWeight, setTrustWeight] = useState(1.0);

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
  }, [reports, selectedDept, dateFilter]);

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

        // Generate recommendations
        let recommendation = override.customRecommendation;
        if (!recommendation) {
          if (c.category === 'Road Damage') {
            recommendation = `Concentration of ${totalItems} road surface defects detected. Repetitive patching is inefficient; we suggest scheduling a full road repaving plan for this section to optimize JKR/MBMB capital resources.`;
          } else if (c.category === 'Street Lighting') {
            recommendation = `Grid cluster of ${totalItems} street lighting reports. This suggests a circuit breaker or grid cabinet malfunction rather than separate bulb failures. Suggest electrical crew checks cabinet circuit.`;
          } else if (c.category === 'Waste Management') {
            recommendation = `High incident zone for waste. Recommend adding a permanent waste bin cabinet and scheduling a higher frequency SWCorp collection route for this neighborhood.`;
          } else if (c.category === 'Drainage System') {
            recommendation = `Drainage blockages clustered here (${totalItems} active). Indicates structural siltation or pipe collapse. Suggest JKR utilizes pipe inspection cameras.`;
          } else {
            recommendation = `Multiple related issues in close proximity (${totalItems} active). Suggest local authority schedules a collaborative site inspection.`;
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

      if (hasRoad && hasDrain) {
        advisoryType = 'Drainage & Road Decay';
        advisoryRec = `Structural Drainage & Road Decay: Correlated defects detected (${groupItems.length} reports). Water logging from drainage issues is eroding the road foundation. Suggest cross-department project between JKR (road resurfacing) and SWCorp (drainage desilting).`;
      } else if (hasLight && (hasVandalism || uniqueCategories.has('Vandalism'))) {
        advisoryType = 'Darkness & Vandalism Zone';
        advisoryRec = `Darkness & Vandalism Risk Zone: Broken street lights and vandalism/graffiti reports (${groupItems.length} reports) overlap here. Suggest MBMB installs CCTV cameras and schedules immediate electrical repairs to deter crime.`;
      } else if (hasWaste && hasDrain) {
        advisoryType = 'Waste-Induced Drainage Blockages';
        advisoryRec = `Waste-Induced Drainage Blockages: Accumulation of garbage and drainage blockages (${groupItems.length} reports) suggest trash washing into public drainage grids. Suggest SWCorp installs trash traps and local enforcement audits illegal dumping activities.`;
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

  // 1c. Contractor SLA Performance Audit
  const contractorAudit = useMemo(() => {
    const resolvedReports = filteredReports.filter(r => r.status === 'Resolved');
    const unresolvedReports = filteredReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected');
    
    const reIncidenceCount = { JKR: 0, MBMB: 0, SWCorp: 0 };
    const totalResolved = { JKR: 0, MBMB: 0, SWCorp: 0 };

    filteredReports.forEach(r => {
      if (r.status === 'Resolved') {
        const dept = r.assigned_department || '';
        if (dept.toLowerCase().includes('jkr')) totalResolved.JKR++;
        else if (dept.toLowerCase().includes('mbmb')) totalResolved.MBMB++;
        else if (dept.toLowerCase().includes('swcorp')) totalResolved.SWCorp++;
      }
    });

    // Run distance check to find repeat complaints in proximity of resolved ones (within 50m and 60 days)
    unresolvedReports.forEach(unres => {
      // Submission time is `timestamp`; there is no `created_at` on the API payload.
      // Undated records are skipped rather than defaulted to now(), which would
      // force daysDiff to ~0 and make every undated pair look co-incident.
      const unresTime = unres.timestamp ? new Date(unres.timestamp).getTime() : null;
      if (!unresTime) return;
      resolvedReports.forEach(res => {
        const resTime = res.timestamp ? new Date(res.timestamp).getTime() : null;
        if (!resTime) return;
        const daysDiff = Math.abs(unresTime - resTime) / (1000 * 60 * 60 * 24);

        if (daysDiff <= REINCIDENCE.windowDays && canonicalizeCategory(unres.categories || unres.ai_prediction) === canonicalizeCategory(res.categories || res.ai_prediction)) {
          const dist = calculateDistance(unres.latitude, unres.longitude, res.latitude, res.longitude);
          if (dist <= REINCIDENCE.radiusM) { // Same spot repeat complaint
            const dept = res.assigned_department || '';
            if (dept.toLowerCase().includes('jkr')) reIncidenceCount.JKR++;
            else if (dept.toLowerCase().includes('mbmb')) reIncidenceCount.MBMB++;
            else if (dept.toLowerCase().includes('swcorp')) reIncidenceCount.SWCorp++;
          }
        }
      });
    });

    // Actual SLA resolution rates (resolved within the target), measured from
    // `timestamp` -> `resolved_at`. Reports missing either date are excluded from
    // BOTH numerator and denominator — counting them as on-time (the previous
    // behaviour) made this rate incapable of returning anything but 100 or 92.
    const onTimeResolved = { JKR: 0, MBMB: 0, SWCorp: 0 };
    const datedResolved = { JKR: 0, MBMB: 0, SWCorp: 0 };
    const deptKeyOf = (r) => {
      const dept = (r.assigned_department || '').toLowerCase();
      if (dept.includes('jkr')) return 'JKR';
      if (dept.includes('mbmb')) return 'MBMB';
      if (dept.includes('swcorp')) return 'SWCorp';
      return null;
    };

    resolvedReports.forEach(r => {
      const key = deptKeyOf(r);
      if (!key) return;
      const start = r.timestamp ? new Date(r.timestamp).getTime() : null;
      const end = r.resolved_at ? new Date(r.resolved_at).getTime() : null;
      if (!start || !end || isNaN(start) || isNaN(end)) return;
      datedResolved[key]++;
      if ((end - start) / (1000 * 60 * 60 * 24) <= SLA_END_TO_END_DAYS) onTimeResolved[key]++;
    });

    // null (not a number) when there is nothing to measure — the render layer
    // shows "Insufficient data" rather than a plausible-looking invented rate.
    const calculateSLARate = (onTime, total) => (
      total ? Math.round((onTime / total) * 100) : null
    );

    const rates = {
      JKR: calculateSLARate(onTimeResolved.JKR, datedResolved.JKR),
      MBMB: calculateSLARate(onTimeResolved.MBMB, datedResolved.MBMB),
      SWCorp: calculateSLARate(onTimeResolved.SWCorp, datedResolved.SWCorp),
    };

    // A null rate means "not measured", which is not the same as failing —
    // grading an unmeasured department F would be as misleading as the old
    // 92% default. Phase 1 replaces this with the shared GRADE_SCALE.
    const getGrade = (rate) => {
      if (rate == null) return null;
      if (rate >= 90) return 'A (Optimal)';
      if (rate >= 80) return 'B (Good)';
      if (rate >= 70) return 'C (Satisfactory)';
      return 'F (Audit Warning)';
    };

    return [
      { name: 'JKR (Road Works)', rate: rates.JKR, grade: getGrade(rates.JKR), color: '#3b82f6' },
      { name: 'MBMB (Municipal Lighting)', rate: rates.MBMB, grade: getGrade(rates.MBMB), color: '#10b981' },
      { name: 'SWCorp (Sewerage & Waste)', rate: rates.SWCorp, grade: getGrade(rates.SWCorp), color: '#ef4444' },
    ];
  }, [filteredReports]);

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

      // Criticality Score Equation
      let rawScore = (item.size * 8) + 
                      (item.upvotes * upvoteWeight * 1.5) + 
                      (highPriorityCount * 15 * priorityWeight) + 
                      (avgElapsed * 4 * agingWeight);

      if (item.isSystemic) {
        rawScore += 15;
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
      const trustTerm = 1.0 - (1.0 - avgTrustFraction) * (trustWeight / 3.0);
      const priorityScore = Math.min(100, Math.max(0, Math.round(score * trustTerm * confidenceFraction)));

      // Determine the primary driving risk factor
      let primaryRisk = 'Density Threshold';
      const upvoteVal = item.upvotes * upvoteWeight * 1.5;
      const priorityVal = highPriorityCount * 15 * priorityWeight;
      const agingVal = avgElapsed * 4 * agingWeight;

      if (upvoteVal > priorityVal && upvoteVal > agingVal) {
        primaryRisk = 'Citizen Urgency';
      } else if (priorityVal > upvoteVal && priorityVal > agingVal) {
        primaryRisk = 'High-Safety Hazards';
      } else if (agingVal > upvoteVal && agingVal > priorityVal) {
        primaryRisk = 'Aging Backlog Delay';
      } else if (item.isSystemic) {
        primaryRisk = 'Spatio-Temporal Decay';
      }

      // Generate precise dispatch advice
      let dispatchAdvice = '';
      if (item.isSystemic) {
        dispatchAdvice = `Requires Joint Dispatch: 3 crew members from matching departments to inspect underlying structural issue at ${item.address}.`;
      } else {
        dispatchAdvice = `Requires Single-Dept Dispatch: Deploy a standard crew to resolve ${item.size} active ${item.category} complaints.`;
      }

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
  }, [hotspots, rootCauseAdvisories, upvoteWeight, priorityWeight, agingWeight, reporterTrustMap, trustWeight, proximityRadius]);

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

    // Resource allocation health analysis
    let worstBacklogDept = 'None';
    let maxBacklog = 0;
    
    if (selectedDept !== 'all') {
      const currentDeptData = deptSLAMetrics.find(d => d.name === selectedDept);
      const backlog = currentDeptData ? currentDeptData.backlog : 0;
      let healthStatus = 'Optimal';
      let recommendation = `Resources are currently balanced for ${selectedDept}.`;
      
      if (backlog > INSIGHT.backlogAlertTickets) {
        healthStatus = 'Backlog Warning';
        recommendation = `High backlog detected in ${selectedDept} (${backlog} active tickets). We recommend prioritizing outstanding tasks and allocating emergency budget to accelerate crew operations.`;
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
    let recommendation = 'Resources are currently balanced across departments.';
    
    if (maxBacklog > INSIGHT.backlogAlertTickets) {
      healthStatus = 'Resource Overload';
      const helperDept = deptSLAMetrics.find((d) => d.name !== worstBacklogDept && d.backlog <= 2);
      recommendation = `Backlog detected in ${worstBacklogDept} (${maxBacklog} tickets). Suggest reallocating 15% labor capacity from ${
        helperDept ? helperDept.name : 'other departments'
      } to clear pending road repair backlogs.`;
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

  // 4. Monthly Trend Data (Last 30 Days)
  const trendChartData = useMemo(() => {
    const daysMap = {};
    for (let i = 29; i >= 0; i--) {
      const dStr = format(subDays(new Date(), i), 'yyyy-MM-dd');
      daysMap[dStr] = 0;
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
      Complaints: count,
    }));
  }, [filteredReports]);

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

  // ==================== CITY HEALTH & WELLNESS COMPUTATIONS ====================

  // 5.5. City Wellness Index — Composite Score (0–100)
  const cityWellnessData = useMemo(() => {
    const total = filteredReports.length;
    // No data means no score. The previous early-return invented a healthy
    // grade-B city, so an empty dataset — or a failed fetch — rendered as good news.
    if (total === 0) return { cwi: null, domains: {
      infrastructure: { name: 'Infrastructure', score: null, activeIssues: 0, totalReports: 0 },
      environment: { name: 'Environment', score: null, activeIssues: 0, totalReports: 0 },
      publicSafety: { name: 'Public Safety', score: null, activeIssues: 0, totalReports: 0 },
      efficiency: { name: 'Service Efficiency', score: null, activeIssues: 0, totalReports: 0 },
      satisfaction: { name: 'Citizen Satisfaction', score: null, activeIssues: 0, totalReports: 0 },
      responsiveness: { name: 'Responsiveness', score: null, activeIssues: 0, totalReports: 0 },
    }, grade: null };

    const resolved = filteredReports.filter(r => r.status === 'Resolved').length;
    const rejected = filteredReports.filter(r => r.status === 'Rejected').length;

    // Helper: match report category against keywords
    const getCatReports = (keywords) => filteredReports.filter(r => {
      const cat = (r.categories || r.ai_prediction || '').toLowerCase();
      return keywords.some(kw => cat.includes(kw));
    });

    // INFRASTRUCTURE — roads, sidewalks, streetlights, signs
    const infraReports = getCatReports(['road', 'pothole', 'sidewalk', 'pavement', 'light', 'lamp', 'lighting', 'sign', 'bridge']);
    const infraResolved = infraReports.filter(r => r.status === 'Resolved').length;
    const infraActive = infraReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    // null when the domain has no reports. The old defaults (80/82/85/75) meant
    // a domain with ZERO data outscored most domains with real data.
    const infraScore = infraReports.length > 0
      ? Math.round(Math.max(15, Math.min(100, (infraResolved / infraReports.length) * 100 - (infraActive * 3))))
      : null;

    // ENVIRONMENT — waste, dumping, pollution, vegetation
    const envReports = getCatReports(['waste', 'garbage', 'dumping', 'trash', 'burning', 'vegetation', 'overgrown', 'pollution', 'smoke']);
    const envResolved = envReports.filter(r => r.status === 'Resolved').length;
    const envActive = envReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    const envScore = envReports.length > 0
      ? Math.round(Math.max(15, Math.min(100, (envResolved / envReports.length) * 100 - (envActive * 4))))
      : null;

    // PUBLIC SAFETY — vandalism, fallen trees, fire hazards
    const safetyReports = getCatReports(['vandal', 'graffiti', 'tree', 'fallen', 'fire', 'hazard', 'manhole', 'stray', 'electrical']);
    const safetyResolved = safetyReports.filter(r => r.status === 'Resolved').length;
    const safetyActive = safetyReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    // Derived directly rather than via the `priority` field loadData attaches,
    // so this score does not silently break if that mapping changes.
    const safetyHighPriority = safetyReports.filter(r =>
      getPriority(r.status, r.categories || r.ai_prediction) === 'High' &&
      r.status !== 'Resolved' && r.status !== 'Rejected'
    ).length;
    const safetyScore = safetyReports.length > 0
      ? Math.round(Math.max(10, Math.min(100, (safetyResolved / safetyReports.length) * 100 - (safetyHighPriority * 10) - (safetyActive * 3))))
      : null;

    // SERVICE EFFICIENCY — % resolved within 3-day SLA
    const resolvedWithDates = filteredReports.filter(r => r.status === 'Resolved' && r.timestamp && r.resolved_at);
    let onTimeCount = 0;
    resolvedWithDates.forEach(r => {
      const start = new Date(r.timestamp).getTime();
      const end = new Date(r.resolved_at).getTime();
      if (!isNaN(start) && !isNaN(end) && (end - start) / (1000 * 60 * 60 * 24) <= SLA_END_TO_END_DAYS) onTimeCount++;
    });
    const efficiencyScore = resolvedWithDates.length > 0
      ? Math.round((onTimeCount / resolvedWithDates.length) * 100)
      : null;

    // CITIZEN SATISFACTION — upvote engagement + resolution rate
    const totalUpvotes = filteredReports.reduce((sum, r) => sum + (r.upvotes || 0), 0);
    const avgUpvotes = total > 0 ? totalUpvotes / total : 0;
    const resolutionRate = total > 0 ? (resolved / (total - rejected || 1)) : 0.5;
    const satisfactionScore = Math.round(Math.max(20, Math.min(100, resolutionRate * 70 + Math.min(avgUpvotes * 5, 30))));

    // RESPONSIVENESS — avg days to first response (lower is better)
    const withResponse = filteredReports.filter(r => r.timestamp && (r.reviewed_at || r.forwarded_at || r.in_process_at));
    let totalResponseDays = 0;
    withResponse.forEach(r => {
      const start = new Date(r.timestamp).getTime();
      const response = new Date(r.reviewed_at || r.forwarded_at || r.in_process_at).getTime();
      if (!isNaN(start) && !isNaN(response)) totalResponseDays += (response - start) / (1000 * 60 * 60 * 24);
    });
    // The old fallback of 2 days silently produced a score of 70 for a council
    // that had never responded to anything.
    const avgResponseDays = withResponse.length > 0 ? totalResponseDays / withResponse.length : null;
    const responsivenessScore = avgResponseDays == null
      ? null
      : Math.round(Math.max(10, Math.min(100, 100 - (avgResponseDays * 15))));

    // COMPOSITE CITY WELLNESS INDEX
    // Domains without data score null and are excluded, with the remaining
    // weights renormalised to 1 — otherwise a single null would poison the
    // whole sum to NaN. `excludedDomains` is surfaced so the UI can say which
    // domains the score actually covers. Phase 4 replaces this with SPI/UCI.
    const CWI_WEIGHTS = {
      infrastructure: 0.25, environment: 0.20, publicSafety: 0.20,
      efficiency: 0.15, satisfaction: 0.10, responsiveness: 0.10,
    };
    const scoreByDomain = {
      infrastructure: infraScore, environment: envScore, publicSafety: safetyScore,
      efficiency: efficiencyScore, satisfaction: satisfactionScore,
      responsiveness: responsivenessScore,
    };
    const included = Object.keys(CWI_WEIGHTS).filter(k => scoreByDomain[k] != null);
    const excludedDomains = Object.keys(CWI_WEIGHTS).filter(k => scoreByDomain[k] == null);
    const weightSum = included.reduce((s, k) => s + CWI_WEIGHTS[k], 0);
    const cwi = weightSum > 0
      ? Math.round(included.reduce((s, k) => s + scoreByDomain[k] * CWI_WEIGHTS[k], 0) / weightSum)
      : null;

    // Shared rubric — see GRADE_SCALE. Previously this file carried three
    // different scales that looked identical to anyone comparing their outputs.
    const getGrade = (s) => gradeFor(s)?.grade ?? null;

    const domains = {
      infrastructure: { name: 'Infrastructure', score: infraScore, activeIssues: infraActive, totalReports: infraReports.length },
      environment: { name: 'Environment', score: envScore, activeIssues: envActive, totalReports: envReports.length },
      publicSafety: { name: 'Public Safety', score: safetyScore, activeIssues: safetyActive, totalReports: safetyReports.length },
      efficiency: { name: 'Service Efficiency', score: efficiencyScore, activeIssues: total - resolved - rejected, totalReports: resolvedWithDates.length },
      satisfaction: { name: 'Citizen Satisfaction', score: satisfactionScore, activeIssues: 0, totalReports: total },
      responsiveness: { name: 'Responsiveness', score: responsivenessScore, activeIssues: 0, totalReports: withResponse.length },
    };

    return { cwi, domains, grade: getGrade(cwi), excludedDomains };
  }, [filteredReports]);

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

  // 5.7. Wellness Trend Data (12 weeks — deterministic from report data)
  const wellnessTrendData = useMemo(() => {
    const weeks = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const weekStart = startOfWeek(subDays(now, i * 7), { weekStartsOn: 1 });
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

      // Cumulative reports up to this week
      const cumReports = reports.filter(r => { if (!r.timestamp) return false; return new Date(r.timestamp) < weekEnd; });
      const total = cumReports.length || 1;
      const resolved = cumReports.filter(r => r.status === 'Resolved').length;
      const rejected = cumReports.filter(r => r.status === 'Rejected').length;
      const validTotal = total - rejected || 1;

      // Domain sub-scores
      // null, not 75 — a week with no reports in a domain is unmeasured, and the
      // old default drew a flat "healthy" line out of an empty dataset. Recharts
      // renders nulls as gaps. Phase 4 replaces this memo with a real
      // point-in-time cumulative-flow reconstruction.
      const scoreDomain = (keywords) => {
        const dr = cumReports.filter(r => { const c = (r.categories || '').toLowerCase(); return keywords.some(k => c.includes(k)); });
        if (dr.length === 0) return null;
        const dres = dr.filter(r => r.status === 'Resolved').length;
        return Math.round(Math.max(20, Math.min(100, (dres / dr.length) * 100)));
      };

      const infra = scoreDomain(['road', 'sidewalk', 'light', 'sign', 'pothole']);
      const env = scoreDomain(['waste', 'dumping', 'burning', 'vegetation', 'garbage']);
      const safety = scoreDomain(['vandal', 'tree', 'fallen', 'fire']);
      // Renormalise over whichever domains are measurable this week.
      const parts = [[infra, 0.35], [env, 0.35], [safety, 0.30]].filter(([v]) => v != null);
      const wSum = parts.reduce((s, [, w]) => s + w, 0);
      const cwi = wSum > 0 ? Math.round(parts.reduce((s, [v, w]) => s + v * w, 0) / wSum) : null;

      const cap = (v) => (v == null ? null : Math.min(100, v));
      weeks.push({ week: format(weekStart, 'MMM dd'), CWI: cap(cwi), Infrastructure: cap(infra), Environment: cap(env), Safety: cap(safety) });
    }
    return weeks;
  }, [reports]);

  // 5.8. Actionable Insights Generation (rule-based)
  const actionableInsights = useMemo(() => {
    const insights = [];
    const now = new Date();

    // 1. Worsening domain detection
    Object.entries(cityWellnessData.domains).forEach(([key, domain]) => {
      // Same coercion trap as above — an unmeasured domain must not read as 0.
      if (domain.score != null && domain.score < 60) {
        insights.push({ id: `domain-${key}`, type: 'warning', title: `${domain.name} Needs Attention`,
          description: `${domain.name} health score is ${domain.score}/100 with ${domain.activeIssues} active issues. This domain is below the acceptable threshold and requires immediate intervention.`,
          zone: 'City-wide', action: `Prioritize ${domain.name.toLowerCase()} reports and allocate additional resources to this domain.` });
      }
    });

    // 2. Top performing zone — only among zones with enough reports to grade.
    const topZone = zoneScorecard.find(z => z.sufficient && z.resolutionRate >= 80);
    if (topZone) {
      insights.push({ id: 'top-zone', type: 'success', title: `${topZone.name} — Top Performing Zone`,
        description: `${topZone.resolutionRate}% resolution rate across ${topZone.total} reports. Average resolution time: ${topZone.avgDays} days.`,
        zone: topZone.name, action: `Recognize this zone's performance and adopt its practices as a model for underperforming areas.` });
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
          description: `${worstZone[1]} reports older than 14 days remain unresolved in ${worstZone[0]}. This indicates a systemic response gap that needs urgent attention.`,
          zone: worstZone[0], action: `Schedule a priority inspection team for ${worstZone[0]} and review department assignment bottlenecks.` });
      }
    }

    // 4. Overloaded department
    deptSLAMetrics.forEach(dept => {
      if (dept.backlog > INSIGHT.backlogAlertTickets) {
        insights.push({ id: `dept-overload-${dept.name}`, type: 'warning', title: `${dept.name} Department Overloaded`,
          description: `${dept.name} has ${dept.backlog} active backlog tickets with an average resolution time of ${dept.avgResolveDays} days. This exceeds the 3-day SLA target.`,
          zone: 'Department-wide', action: `Reallocate 15–20% crew capacity from lower-backlog departments to ${dept.name} for the next sprint cycle.` });
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
      insights.push({ id: 'volume-spike', type: 'warning', title: `${pctIncrease}% Report Volume Spike Detected`,
        description: `${last7} reports this week vs ${prev7} last week. ${topCat ? `Most common: ${topCat[0]} (${topCat[1]} reports).` : ''} This may indicate a seasonal or event-driven pattern.`,
        zone: 'City-wide', action: `Investigate the root cause and prepare additional response capacity if the trend continues.` });
    }

    // 6. Cross-category correlation
    if (rootCauseAdvisories.length > 0) {
      const topAdvisory = rootCauseAdvisories[0];
      insights.push({ id: 'cross-correlation', type: 'info', title: `Cross-Issue Pattern: ${topAdvisory.category}`,
        description: `${topAdvisory.size} reports of different categories clustered near ${topAdvisory.address}. This suggests a shared root cause requiring coordinated response.`,
        zone: topAdvisory.address, action: topAdvisory.recommendation });
    }

    // 7. SLA achievement
    const bestDept = deptSLAMetrics.filter(d => d.assigned > 0).sort((a, b) => a.avgResolveDays - b.avgResolveDays)[0];
    if (bestDept && bestDept.avgResolveDays <= 3 && bestDept.resolved > 0) {
      insights.push({ id: 'sla-achievement', type: 'success', title: `${bestDept.name} Exceeding SLA Targets`,
        description: `${bestDept.name} maintained an average resolution time of ${bestDept.avgResolveDays} days, within the 3-day SLA target. ${bestDept.resolved} tickets resolved.`,
        zone: 'Department-wide', action: `Acknowledge ${bestDept.name}'s performance and share their workflow practices across departments.` });
    }

    // 8. High citizen engagement
    const highUpvoteReports = filteredReports.filter(r => (r.upvotes || 0) >= INSIGHT.highEngagementUpvotes && r.status !== 'Resolved' && r.status !== 'Rejected');
    if (highUpvoteReports.length > 0) {
      const totalHighUpvotes = highUpvoteReports.reduce((sum, r) => sum + (r.upvotes || 0), 0);
      insights.push({ id: 'citizen-engagement', type: 'info', title: `High Citizen Engagement Detected`,
        description: `${highUpvoteReports.length} active reports have 5+ citizen upvotes (${totalHighUpvotes} total). These represent strong public concern that should be prioritized.`,
        zone: 'City-wide', action: `Prioritize high-engagement reports to demonstrate government responsiveness to citizen concerns.` });
    }

    // 9. Overall city health status. The null guard matters: `null < 60` coerces
    // to `0 < 60`, so without it an unmeasurable city reported itself critical.
    if (cityWellnessData.cwi == null) {
      // No index, no verdict.
    } else if (cityWellnessData.cwi >= 80) {
      insights.push({ id: 'city-health-good', type: 'success', title: 'City Health Status: Excellent',
        description: `The overall City Wellness Index is ${cityWellnessData.cwi}/100 (Grade ${cityWellnessData.grade}). All major domains are performing within acceptable thresholds.`,
        zone: 'City-wide', action: 'Maintain current operations and focus on continuous improvement in weaker domains.' });
    } else if (cityWellnessData.cwi < 60) {
      insights.push({ id: 'city-health-poor', type: 'critical', title: 'City Health Status: Needs Improvement',
        description: `The overall City Wellness Index is ${cityWellnessData.cwi}/100 (Grade ${cityWellnessData.grade}). Multiple domains are below acceptable thresholds.`,
        zone: 'City-wide', action: 'Convene an emergency planning session to address critical infrastructure and service gaps.' });
    }

    const priority = { critical: 0, warning: 1, info: 2, success: 3 };
    return insights.sort((a, b) => (priority[a.type] ?? 4) - (priority[b.type] ?? 4));
  }, [filteredReports, cityWellnessData, zoneScorecard, deptSLAMetrics, rootCauseAdvisories]);

  // 5.9. Radar Chart Data
  const radarChartData = useMemo(() => {
    return Object.values(cityWellnessData.domains).map(d => ({ domain: d.name, score: d.score, fullMark: 100 }));
  }, [cityWellnessData]);

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
  const exportToPDF = async () => {
    if (pdfGenerating) return;
    setPdfGenerating(true);

    let restoreStyles = null;
    try {
      const deletedRules = [];
      
      const cleanRules = (container) => {
        if (!container || !container.cssRules) return;
        for (let i = container.cssRules.length - 1; i >= 0; i--) {
          try {
            const rule = container.cssRules[i];
            if (rule.cssRules) {
              cleanRules(rule);
            } else if (rule.cssText && (rule.cssText.includes('oklab') || rule.cssText.includes('oklch'))) {
              deletedRules.push({ container, index: i, cssText: rule.cssText });
              container.deleteRule(i);
            }
          } catch (err) {
            // ignore rule-level access errors
          }
        }
      };

      for (let i = 0; i < document.styleSheets.length; i++) {
        const sheet = document.styleSheets[i];
        try {
          if (sheet.cssRules) {
            cleanRules(sheet);
          }
        } catch (err) {
          // ignore CORS errors for external fonts/styles
        }
      }

      restoreStyles = () => {
        // Sort deleted rules by index ascending to restore in original positions
        deletedRules.sort((a, b) => a.index - b.index);
        for (const item of deletedRules) {
          try {
            item.container.insertRule(item.cssText, item.index);
          } catch (err) {
            console.warn("Failed to restore rule:", err);
          }
        }
      };
    } catch (err) {
      console.warn("Style preprocessing failed:", err);
    }

    try {
      const element = reportRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#faf8f2', // match Grove light background
      });
      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210; // A4 width
      const pageHeight = 297; // A4 height
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const tabNames = {
        overview: "Overview_and_Trends",
        hotspots: "Predictive_Hotspots",
        dispatch: "Risk_and_Crew_Dispatch",
        cityhealth: "City_Health_Wellness"
      };
      const tabLabel = tabNames[activeViewTab] || "Report";
      pdf.save(`Melaka_Infrastructure_${tabLabel}_${format(new Date(), 'yyyyMMdd')}.pdf`);
    } catch (e) {
      console.error('PDF generation failed:', e);
    } finally {
      if (restoreStyles) {
        try {
          restoreStyles();
        } catch (err) {
          console.warn("Error restoring styles:", err);
        }
      }
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
          Operational wellness scores, predictive hotspots, and response efficiency metrics.
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
    ? (hotspots.find(h => h.id === activeClusterId) || rootCauseAdvisories.find(a => a.id === activeClusterId))
    : null;

  // The date filter cohorts by SUBMISSION date (matchesDateFilter keys off
  // r.timestamp). Saying so matters: cohorting by resolution date instead would
  // censor slow reports out of short windows and make the service look faster
  // than it is — the standard survivorship trap in SLA reporting.
  const dateFilterLabel = dateFilter === 'all'
    ? 'All reports, cohorted by submission date'
    : `Reports submitted in the last ${dateFilter === '7d' ? '7' : '30'} days`;

  // One instance rendered on every tab. City Health previously had no filter UI
  // at all despite being filter-sensitive, so it silently reflected whatever had
  // been selected on another tab.
  const filterBar = (
    <AnalyticsFilterBar
      dateFilter={dateFilter}
      onDateFilterChange={setDateFilter}
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
            Operational wellness scores, predictive hotspots, and response efficiency metrics.
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
          onClick={() => setActiveViewTab('hotspots')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'hotspots'
              ? 'bg-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20 border border-[#4a5d3f]'
              : 'text-[#8a8477] hover:text-[#201f1b] hover:bg-[#4a5d3f]/8 border border-transparent'
          }`}
        >
          Predictive Hotspots ({hotspots.length + rootCauseAdvisories.length})
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
      </div>

      {/* Main page content wrapper for PDF capture */}
      <div ref={reportRef} className="space-y-6 p-1 rounded-2xl">

        {/* ==================== OVERVIEW & TRENDS TAB ==================== */}
        {activeViewTab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            {filterBar}

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Active Complaints</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-1">{kpiStats.active}</div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">Out of {kpiStats.total} total reports</div>
                </div>
              </div>

              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Avg Resolution SLA</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-1">
                    {kpiStats.avgDays == null
                      ? <span className="text-base text-[#8a8477]">Insufficient data</span>
                      : `${kpiStats.avgDays} Days`}
                  </div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">Calculated from historical tickets</div>
                </div>
              </div>

              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Active Hotspots</div>
                  <div className="text-2xl font-black text-[#201f1b] mt-1">{kpiStats.hotspotsCount} Zones</div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">Clusters with radius &le; {proximityRadius}m</div>
                </div>
              </div>

              <div className="bg-white border border-[#1f1e1a]/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-[#8a8477] uppercase tracking-wider">Allocation Status</div>
                  <div className="text-lg font-black text-[#201f1b] mt-1 truncate max-w-[170px]" title={kpiStats.healthStatus}>
                    {kpiStats.healthStatus}
                  </div>
                  <div className="text-[10px] text-[#8a8477] font-medium mt-0.5">
                    {kpiStats.healthStatus === 'Optimal' ? 'All crew rates balanced' : `${kpiStats.worstBacklogDept} backlog warning`}
                  </div>
                </div>
              </div>
            </div>

            {/* Stage-duration funnel — the headline operational analytic:
                which stage of the pipeline actually consumes the days. */}
            <StageFunnel reports={filteredReports} dateFilterLabel={dateFilterLabel} />

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Historical Trend Line */}
              <div className="content-card lg:col-span-2 min-w-0">
                <div className="content-card-header">
                  <div className="content-card-title">
                    Ticket Volume Trends (Last 30 Days)
                  </div>
                </div>
                <div className="p-5">
                  <div style={{ height: '260px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                        <Area type="monotone" dataKey="Complaints" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTrend)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
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
                  <div className="relative flex items-center justify-center" style={{ height: '260px', width: '100%' }}>
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
                        >
                          {categoryChartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    
                    {/* Legends Custom */}
                    <div className="absolute bottom-2 left-0 right-0 flex flex-wrap justify-center gap-x-3 gap-y-1 px-4 text-[10px] text-[#201f1b] font-semibold">
                      {categoryChartData.map((entry, index) => (
                        <div key={entry.name} className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />
                          <span className="truncate max-w-[80px]">{entry.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SLA Department Performance Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* SLA Performance Bar Chart / Scoped Status Chart */}
              <div className="content-card lg:col-span-2 min-w-0">
                <div className="content-card-header">
                  <div className="content-card-title">
                    {selectedDept === 'all' 
                      ? 'Average Days to Resolve Complaints vs SLA Target (3 Days)' 
                      : `${selectedDept} Ticket Status Breakdown`}
                  </div>
                </div>
                <div className="p-5">
                  <div style={{ height: '260px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      {selectedDept === 'all' ? (
                        <BarChart data={measurableSLAMetrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                          <XAxis dataKey="name" stroke="#8a8477" fontSize={11} tickLine={false} />
                          <YAxis stroke="#8a8477" fontSize={11} tickLine={false} label={{ value: 'Days', angle: -90, position: 'insideLeft', stroke: '#8a8477', fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                          <ReferenceLine y={SLA_END_TO_END_DAYS} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Target SLA', fill: '#ef4444', fontSize: 9, position: 'top' }} />
                          <Bar dataKey="avgResolveDays" radius={[6, 6, 0, 0]} maxBarSize={45}>
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
                          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={30}>
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
                </div>
              </div>

              {/* Smart Decision Warning Board */}
              <div className="content-card flex flex-col justify-between">
                <div className="content-card-header">
                  <div className="content-card-title">
                    Resource Reallocation Advisory
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <p className="text-xs leading-relaxed text-[#4b473d]">
                      City assets and labor tracking alerts. These alerts are automatically triggered when any department backlogs exceed targets:
                    </p>
                    
                    <div className="mt-4 space-y-3">
                      <div className="p-4 rounded-xl border flex items-start gap-3 bg-[#4a5d3f]/10 border-[#4a5d3f]/20 text-[#4a5d3f]">
                        <div className="text-left">
                          <div className="text-xs font-bold uppercase tracking-wide">
                            {kpiStats.healthStatus === 'Optimal' ? 'System Healthy' : 'Resource Reallocation Alert'}
                          </div>
                          <div className="text-[11px] leading-relaxed mt-1 text-[#8a8477]">
                            {kpiStats.recommendation}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[#1f1e1a]/8 pt-4">
                    <div className="flex items-center justify-between text-xs text-[#8a8477] font-bold">
                      <span>Fastest SLA</span>
                      <span className="text-[#201f1b]">
                        {kpiStats.fastestSLA
                          ? `${kpiStats.fastestSLA.name} (${kpiStats.fastestSLA.avgResolveDays} days)`
                          : 'Insufficient data'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#8a8477] font-bold mt-2">
                      <span>Slowest SLA</span>
                      <span className="text-[#201f1b]">
                        {kpiStats.slowestSLA
                          ? `${kpiStats.slowestSLA.name} (${kpiStats.slowestSLA.avgResolveDays} days)`
                          : 'Insufficient data'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-[#8a8477] font-bold mt-2">
                      <span>Largest Backlog</span>
                      <span className="text-[#8a8477]">{kpiStats.worstBacklogDept}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ==================== PREDICTIVE HOTSPOTS TAB ==================== */}
        {activeViewTab === 'hotspots' && (
          <div className="space-y-6 animate-fade-in">
            {filterBar}

            {/* Focused Map & List Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Map & List (lg:col-span-2) */}
              <div className="lg:col-span-2 space-y-6">
                {/* Heatmap Card */}
                <div className="content-card">
                  <div className="content-card-header">
                    <div className="content-card-title">
                      <MapPin size={16} className="text-[#4a5d3f] mr-2" />
                      Melaka Complaint Density Heatmap
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
                        {activeCluster && (
                          <Circle
                            center={[activeCluster.latitude, activeCluster.longitude]}
                            radius={proximityRadius}
                            pathOptions={{
                              color: activeCluster.id.startsWith('advisory-') ? '#a1a1aa' : '#ffffff',
                              fillColor: activeCluster.id.startsWith('advisory-') ? '#a1a1aa' : '#ffffff',
                              fillOpacity: 0.15,
                              weight: 2,
                              dashArray: activeCluster.id.startsWith('advisory-') ? '6, 6' : undefined
                            }}
                          />
                        )}
                        <MapResizer />
                        <MapController focus={mapFocus} />
                      </MapContainer>
                    </div>
                  </div>
                </div>

                {/* Hotspots & Systemic tab list */}
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
                      Hotspots ({hotspots.length})
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
                  <div className="p-5 flex-1 flex flex-col space-y-4">
                    <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 space-y-3 scrollbar-thin">
                      {activeTab === 'single' ? (
                        hotspots.length === 0 ? (
                          <div className="h-48 flex flex-col items-center justify-center text-[#8a8477] text-xs text-center">
                            <CheckCircle2 className="text-[#8a8477] mb-2 animate-pulse mx-auto" size={24} />
                            No high-density active hotspots detected.
                          </div>
                        ) : (
                          hotspots.map((h) => (
                            <div
                              key={h.id}
                              onClick={() => {
                                setActiveClusterId(h.id);
                                setMapFocus({ center: [h.latitude, h.longitude], zoom: 15.5, trigger: Date.now() });
                              }}
                              className={`p-4 border rounded-xl space-y-2 hover:border-[#4a5d3f]/40 transition-all cursor-pointer group text-left ${
                                activeClusterId === h.id ? 'bg-[#4a5d3f]/10 border-[#4a5d3f]/50 shadow-md' : 'bg-[#f7f4ec] border-[#1f1e1a]/8'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-[#4a5d3f]/10 border border-[#4a5d3f]/20 text-[#4a5d3f]">
                                    {h.category}
                                  </span>
                                  <span className="text-[10px] font-bold text-[#8a8477] flex items-center gap-1">
                                    {h.size} active defects
                                  </span>
                                </div>
                                <span className="text-[9px] font-bold text-[#8a8477] group-hover:text-[#201f1b] flex items-center gap-0.5 transition-colors">
                                  Modify Settings
                                  <ChevronRight size={10} />
                                </span>
                              </div>
                              <div className="text-xs text-[#4b473d] font-bold">{h.address}</div>
                              <div className="text-[11px] leading-relaxed text-[#8a8477] italic line-clamp-2">
                                <strong>Recommendation:</strong> {h.recommendation}
                              </div>
                            </div>
                          ))
                        )
                      ) : (
                        rootCauseAdvisories.length === 0 ? (
                          <div className="h-48 flex flex-col items-center justify-center text-[#8a8477] text-xs text-center">
                            <CheckCircle2 className="text-[#8a8477] mb-2 animate-pulse mx-auto" size={24} />
                            No systemic cross-department issues detected.
                          </div>
                        ) : (
                          rootCauseAdvisories.map((a) => (
                            <div
                              key={a.id}
                              onClick={() => {
                                setActiveClusterId(a.id);
                                setMapFocus({ center: [a.latitude, a.longitude], zoom: 15.5, trigger: Date.now() });
                              }}
                              className={`p-4 border rounded-xl space-y-2 hover:border-[#4a5d3f]/40 transition-all cursor-pointer group text-left ${
                                activeClusterId === a.id ? 'bg-[#4a5d3f]/10 border-[#4a5d3f]/50 shadow-md' : 'bg-[#f7f4ec] border-[#1f1e1a]/8'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-[#4a5d3f]/10 border border-[#4a5d3f]/20 text-[#4a5d3f]">
                                    {a.category}
                                  </span>
                                  <span className="text-[10px] font-bold text-[#8a8477] flex items-center gap-1">
                                    {a.size} reports grouped
                                  </span>
                                </div>
                                <span className="text-[9px] font-bold text-[#8a8477] group-hover:text-[#201f1b] flex items-center gap-0.5 transition-colors">
                                  Modify Settings
                                  <ChevronRight size={10} />
                                </span>
                              </div>
                              <div className="text-xs text-[#4b473d] font-bold">{a.address}</div>
                              <div className="text-[11px] leading-relaxed text-[#8a8477] italic line-clamp-2">
                                <strong>Recommendation:</strong> {a.recommendation}
                              </div>
                            </div>
                          ))
                        )
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Hotspot Controls & Detail Editor (lg:col-span-1) */}
              <div className="lg:col-span-1 space-y-6">
                {activeCluster ? (
                  // Detail & Edit View
                  <div className="content-card flex flex-col h-full justify-between">
                    <div>
                      <div className="content-card-header flex items-center justify-between border-b border-[#1f1e1a]/8 pb-4">
                        <button
                          onClick={() => setActiveClusterId(null)}
                          className="flex items-center gap-1 text-[#8a8477] hover:text-[#201f1b] text-xs font-bold transition-colors cursor-pointer"
                        >
                          <ChevronLeft size={16} />
                          Back
                        </button>
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-[#4a5d3f]/10 border border-[#4a5d3f]/20 text-[#4a5d3f]">
                          {activeCluster.category}
                        </span>
                      </div>
                      <div className="p-5 space-y-5 text-left">
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

                        {/* Map Focus Button */}
                        <button
                          onClick={() => {
                            setMapFocus({
                              center: [activeCluster.latitude, activeCluster.longitude],
                              zoom: 15.5,
                              trigger: Date.now()
                            });
                          }}
                          className="flex items-center justify-center gap-1.5 bg-[#f5f1e6] border border-[#1f1e1a]/12 hover:border-[#4a5d3f]/30 hover:bg-[#4a5d3f]/8 text-[#4b473d] hover:text-[#201f1b] py-2.5 rounded-xl text-xs font-bold transition-all w-full cursor-pointer"
                        >
                          <Eye size={14} />
                          Locate on Heatmap
                        </button>

                        {/* Exclude / Include Tickets List */}
                        <div className="flex flex-col min-h-0 pt-2 border-t border-[#1f1e1a]/8">
                          <label className="text-[10px] font-bold text-[#8a8477] uppercase tracking-wider mb-2 flex items-center justify-between">
                            <span>Constituent Issues</span>
                            <span className="px-1.5 py-0.5 rounded bg-[#f5f1e6] text-[#4b473d] text-[9px] font-black">{activeCluster.items.length} Tickets</span>
                          </label>
                          <div className="overflow-y-auto max-h-[180px] pr-1 space-y-2 scrollbar-thin">
                            {activeCluster.items.map((item) => (
                              <div key={item.id} className="flex items-start gap-2.5 p-2.5 bg-[#f7f4ec] border border-[#1f1e1a]/8 rounded-lg text-left">
                                <input
                                  type="checkbox"
                                  checked={!(customOverrides[activeCluster.seedId]?.excludedReportIds?.includes(item.id))}
                                  onChange={() => handleToggleExcludeTicket(activeCluster.seedId, item.id)}
                                  className="mt-0.5 cursor-pointer accent-[#4a5d3f] rounded border-[#1f1e1a]/15"
                                  title="Exclude this ticket from cluster"
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
                ) : (
                  // Hotspot Parameter Controls (shown by default in right panel)
                  <div className="bg-white border border-[#1f1e1a]/10 rounded-2xl p-6 space-y-6 text-left animate-fade-in">
                    <div>
                      <h3 className="text-sm font-extrabold text-[#201f1b]">
                        Clustering Controls
                      </h3>
                      <p className="text-xs text-[#8a8477] mt-1">Adjust spatial criteria to modify hotspot grouping boundaries in real time.</p>
                    </div>

                    <div className="space-y-5 pt-2">
                      {/* Proximity Slider */}
                      <div className="space-y-2 text-left">
                        <div className="flex items-center justify-between text-xs font-bold text-[#4b473d]">
                          <span>Cluster Proximity Radius</span>
                          <span className="text-[#4a5d3f] font-bold">{proximityRadius} meters</span>
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

                      {/* Min Density Selector */}
                      <div className="space-y-2 text-left">
                        <div className="flex items-center justify-between text-xs font-bold text-[#4b473d]">
                          <span>Minimum Complaint Density</span>
                          <span className="text-[#4a5d3f] font-bold">{minClusterSize} tickets</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[2, 3, 4, 5, 6, 8, 10, 15].map((val) => (
                            <button
                              key={val}
                              onClick={() => setMinClusterSize(val)}
                              className={`py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                minClusterSize === val
                                  ? 'bg-[#4a5d3f] border-[#4a5d3f] text-white shadow-lg shadow-[#4a5d3f]/20'
                                  : 'bg-[#f5f1e6] border-[#1f1e1a]/12 hover:border-[#4a5d3f]/30 text-[#8a8477] hover:text-[#201f1b]'
                              }`}
                            >
                              {val}+
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-[#8a8477] leading-relaxed mt-2">
                          Hotspots require at least this number of active complaints of the same category clustered within the radius.
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[#4a5d3f]/10 border border-[#4a5d3f]/20 text-[11px] text-[#4b473d] leading-relaxed">
                      Select a hotspot card on the list to rename its address, edit the recommended action plans, or exclude individual report tickets.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}



        {/* ==================== CITY HEALTH & WELLNESS TAB ==================== */}
        {activeViewTab === 'cityhealth' && (
          <div className="space-y-6 animate-fade-in">

            {filterBar}

            {/* Row 1: CWI Gauge Hero + 6 Domain Health Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* CWI Radial Gauge */}
              <div className="content-card flex flex-col items-center justify-center py-8 px-6">
                <div
                  className="cwi-gauge"
                  style={{
                    '--gauge-pct': cityWellnessData.cwi ?? 0,
                    '--gauge-color': cityWellnessData.cwi == null ? '#8a8477'
                      : cityWellnessData.cwi >= 80 ? '#15803d'
                      : cityWellnessData.cwi >= 60 ? '#b45309' : '#b91c1c'
                  }}
                >
                  <div className="cwi-gauge-glow" />
                  <div className="cwi-gauge-ring" />
                  <div className="cwi-gauge-value">{cityWellnessData.cwi ?? '—'}</div>
                  <div className="cwi-gauge-label">City Wellness</div>
                </div>
                {cityWellnessData.grade ? (
                  <div className={`mt-5 text-2xl font-black cwi-grade-${cityWellnessData.grade}`}>
                    Grade {cityWellnessData.grade}
                  </div>
                ) : (
                  <div className="mt-5 text-base font-bold text-[#8a8477]">Insufficient data</div>
                )}
                <div className="text-[10px] text-[#8a8477] font-semibold mt-1 uppercase tracking-wider">
                  Composite Health Index
                </div>
                <div className="mt-4 flex flex-col items-center gap-1 text-[10px] text-[#8a8477]">
                  <span className="flex items-center gap-2">
                    <Heart size={12} className="text-[#8a8477]" />
                    <span className="font-semibold">Based on {filteredReports.length} reports</span>
                  </span>
                  {cityWellnessData.excludedDomains?.length > 0 && (
                    <span className="font-semibold">
                      {cityWellnessData.excludedDomains.length} of 6 domains omitted — insufficient data
                    </span>
                  )}
                </div>
              </div>

              {/* 6 Domain Health Cards */}
              <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(cityWellnessData.domains).map(([key, domain]) => {
                  // Unmeasured domains keep the identical box model — only the
                  // score, bar fill and caption change — so the grid never shifts.
                  const measured = domain.score != null;
                  return (
                    <div key={key} className="domain-card">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-extrabold text-[#8a8477] uppercase tracking-wider">{domain.name}</span>
                        <span className={`text-lg font-black ${
                          !measured ? 'text-[#8a8477]'
                            : domain.score >= 80 ? 'text-emerald-700'
                            : domain.score >= 60 ? 'text-amber-700' : 'text-red-700'
                        }`}>
                          {measured ? domain.score : '—'}
                        </span>
                      </div>
                      <div className="domain-score-bar">
                        {measured ? (
                          <div
                            className="domain-score-fill"
                            style={{
                              width: `${domain.score}%`,
                              backgroundColor: domain.score >= 80 ? '#15803d' : domain.score >= 60 ? '#b45309' : '#b91c1c'
                            }}
                          />
                        ) : (
                          <div
                            className="domain-score-fill"
                            style={{
                              width: '100%',
                              background: 'repeating-linear-gradient(135deg, rgba(31,30,26,.06) 0 6px, transparent 6px 12px)'
                            }}
                          />
                        )}
                      </div>
                      <div className="text-[10px] text-[#8a8477] font-medium mt-2">
                        {measured
                          ? `${domain.activeIssues > 0 ? `${domain.activeIssues} active issues` : 'No active issues'} · ${domain.totalReports} total`
                          : 'Insufficient data — no reports in this domain'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Row 2: Radar Chart + Wellness Trend Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Radar Chart */}
              <div className="content-card">
                <div className="content-card-header">
                  <div className="content-card-title">City Health Balance</div>
                </div>
                <div className="p-5">
                  <div style={{ height: '280px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarChartData} cx="50%" cy="50%" outerRadius="65%">
                        <PolarGrid stroke="rgba(31,30,26,0.08)" />
                        <PolarAngleAxis dataKey="domain" tick={{ fill: '#8a8477', fontSize: 9, fontWeight: 700 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
                        <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center text-[10px] text-[#8a8477] font-medium mt-2">
                    Balanced scores indicate healthy city operations across all domains
                  </div>
                </div>
              </div>

              {/* Wellness Trend Chart (12 Weeks) */}
              <div className="content-card lg:col-span-2">
                <div className="content-card-header">
                  <div className="content-card-title">City Wellness Trend (12 Weeks)</div>
                </div>
                <div className="p-5">
                  <div style={{ height: '280px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={wellnessTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorCWI" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(31,30,26,0.08)" />
                        <XAxis dataKey="week" stroke="#8a8477" fontSize={10} tickLine={false} />
                        <YAxis stroke="#8a8477" fontSize={10} tickLine={false} domain={[0, 100]} />
                        <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid rgba(31,30,26,0.10)', borderRadius: 8, color: '#201f1b', fontSize: 12 }} itemStyle={{ color: '#201f1b' }} labelStyle={{ color: '#8a8477' }} />
                        <Area type="monotone" dataKey="CWI" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCWI)" name="City Wellness Index" />
                        <Area type="monotone" dataKey="Infrastructure" stroke="#34d399" strokeWidth={1.5} fillOpacity={0} dot={false} />
                        <Area type="monotone" dataKey="Environment" stroke="#fbbf24" strokeWidth={1.5} fillOpacity={0} dot={false} />
                        <Area type="monotone" dataKey="Safety" stroke="#f87171" strokeWidth={1.5} fillOpacity={0} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Chart Legend */}
                  <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-3 text-[10px] font-bold text-[#8a8477]">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#6366f1' }} />CWI</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#34d399' }} />Infrastructure</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#fbbf24' }} />Environment</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: '#f87171' }} />Safety</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 3: Actionable Insights Panel */}
            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title flex items-center gap-2">
                  <Lightbulb size={16} className="text-amber-600" />
                  Actionable Urban Insights
                </div>
                <div className="text-[10px] font-semibold text-[#8a8477]">
                  {actionableInsights.length} insights generated
                </div>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[440px] overflow-y-auto pr-1 scrollbar-thin">
                  {actionableInsights.length === 0 ? (
                    <div className="col-span-2 h-32 flex flex-col items-center justify-center text-[#8a8477] text-xs">
                      <CheckCircle2 className="text-[#8a8477] mb-2" size={20} />
                      No actionable insights generated from current data.
                    </div>
                  ) : (
                    actionableInsights.map(insight => (
                      <div key={insight.id} className={`insight-card ${insight.type}`}>
                        <div className="flex items-start gap-3">
                          <div className={`insight-icon mt-0.5 flex-shrink-0 ${
                            insight.type === 'critical' ? 'text-red-700' :
                            insight.type === 'warning' ? 'text-amber-700' :
                            insight.type === 'success' ? 'text-emerald-700' : 'text-[#4a5d3f]'
                          }`}>
                            {insight.type === 'critical' ? <AlertCircle size={16} /> :
                             insight.type === 'warning' ? <AlertTriangle size={16} /> :
                             insight.type === 'success' ? <CheckCircle2 size={16} /> :
                             <Info size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-extrabold text-[#201f1b]">{insight.title}</div>
                            <div className="text-[11px] leading-relaxed text-[#8a8477] mt-1">{insight.description}</div>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-[#1f1e1a]/6 border border-[#1f1e1a]/8 text-[#8a8477]">
                                {insight.zone}
                              </span>
                            </div>
                            <div className="text-[10px] leading-relaxed text-[#4b473d] mt-2 italic">
                              <strong>Recommended Action:</strong> {insight.action}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Row 4: Zone Wellness Scorecard */}
            <div className="content-card">
              <div className="content-card-header">
                <div className="content-card-title flex items-center gap-2">
                  <MapPin size={16} className="text-[#4a5d3f]" />
                  Zone / Area Wellness Scorecard
                </div>
                <div className="text-[10px] font-semibold text-[#8a8477]">
                  {zoneScorecard.length} zones tracked
                </div>
              </div>
              <div className="p-5">
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto scrollbar-thin rounded-lg">
                  <table className="scorecard-table">
                    <thead>
                      <tr>
                        <th>Zone / Area</th>
                        <th>Total</th>
                        <th>Active</th>
                        <th>Resolved</th>
                        <th>Resolution Rate</th>
                        <th>Avg Days</th>
                        <th>Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zoneScorecard.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center text-[#8a8477] py-8">No zone data available</td>
                        </tr>
                      ) : (
                        zoneScorecard.map(zone => (
                          <tr key={zone.name}>
                            <td className="font-bold text-[#201f1b]">{zone.name}</td>
                            <td>{zone.total}</td>
                            <td>
                              <span className={zone.active > 3 ? 'text-amber-700 font-bold' : ''}>
                                {zone.active}
                              </span>
                            </td>
                            <td className="text-[#3d4d34]">{zone.resolved}</td>
                            <td>
                              {zone.resolutionRate == null ? (
                                <span className="text-[10px] text-[#8a8477]">—</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-[#1f1e1a]/8 rounded-full overflow-hidden max-w-[60px]">
                                    <div
                                      className="h-full rounded-full"
                                      style={{
                                        width: `${zone.resolutionRate}%`,
                                        backgroundColor: zone.resolutionRate >= 80 ? '#15803d' : zone.resolutionRate >= 60 ? '#b45309' : '#b91c1c'
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-bold">{zone.resolutionRate}%</span>
                                </div>
                              )}
                            </td>
                            <td className={zone.avgDays != null && zone.avgDays > SLA_END_TO_END_DAYS ? 'text-red-700 font-bold' : 'text-[#4b473d]'}>
                              {zone.avgDays ?? '—'}
                            </td>
                            <td>
                              {zone.grade ? (
                                <span className={`wellness-grade grade-${zone.grade}`}>{zone.grade}</span>
                              ) : (
                                <span
                                  className="wellness-grade grade-NA"
                                  title={`Needs at least ${MIN_N_FOR_SCORE} non-rejected reports to grade`}
                                >—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
