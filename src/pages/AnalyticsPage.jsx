import { useEffect, useState, useMemo, useRef } from 'react';
import { fetchReports } from '../api/reportsApi';
import { useAuth } from '../context/AuthContext';
import { AUTHORITIES } from '../utils/authorities';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine, PieChart, Pie, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { MapContainer, TileLayer, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import {
  TrendingUp, Clock, AlertTriangle, AlertCircle, Sparkles, Download, Info,
  MapPin, RefreshCw, BarChart2, ShieldAlert, CheckCircle2, ChevronRight,
  SlidersHorizontal, ChevronLeft, Eye, Trash2, Workflow, Award, Truck, Sliders,
  Lightbulb, Heart, Activity
} from 'lucide-react';
import { format, parseISO, subDays, startOfWeek } from 'date-fns';

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

// Distance helper for geographic clustering (Haversine formula in meters)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000; // meters
}

// Maps category names to canonical groups for better clustering
function canonicalizeCategory(catName) {
  const name = (catName || '').toLowerCase();
  if (name.includes('road') || name.includes('pothole') || name.includes('sidewalk') || name.includes('pavement')) {
    return 'Road Damage';
  }
  if (name.includes('light') || name.includes('lamp') || name.includes('lighting')) {
    return 'Street Lighting';
  }
  if (name.includes('waste') || name.includes('garbage') || name.includes('dumping') || name.includes('trash') || name.includes('burning')) {
    return 'Waste Management';
  }
  if (name.includes('drain') || name.includes('water') || name.includes('drainage') || name.includes('flood')) {
    return 'Drainage System';
  }
  if (name.includes('vandal') || name.includes('graffiti') || name.includes('damage') || name.includes('property')) {
    return 'Vandalism';
  }
  return 'Other Infrastructure';
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
  const [proximityRadius, setProximityRadius] = useState(250);
  const [minClusterSize, setMinClusterSize] = useState(2);
  const [showParams, setShowParams] = useState(false);

  // Hotspot overrides and exclusions state
  const [customOverrides, setCustomOverrides] = useState({});
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
      // Pass the user role to fetchReports to ensure secure data fetching
      const data = await fetchReports(role || 'admin');
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
      const canonical = canonicalizeCategory(report.categories || report.predictedCategory);
      
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
        canonicalizeCategory(r.categories || r.predictedCategory)
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
      const unresTime = unres.created_at ? new Date(unres.created_at).getTime() : Date.now();
      resolvedReports.forEach(res => {
        const resTime = res.created_at ? new Date(res.created_at).getTime() : Date.now();
        const daysDiff = Math.abs(unresTime - resTime) / (1000 * 60 * 60 * 24);

        if (daysDiff <= 60 && canonicalizeCategory(unres.categories || unres.predictedCategory) === canonicalizeCategory(res.categories || res.predictedCategory)) {
          const dist = calculateDistance(unres.latitude, unres.longitude, res.latitude, res.longitude);
          if (dist <= 50) { // Same spot repeat complaint
            const dept = res.assigned_department || '';
            if (dept.toLowerCase().includes('jkr')) reIncidenceCount.JKR++;
            else if (dept.toLowerCase().includes('mbmb')) reIncidenceCount.MBMB++;
            else if (dept.toLowerCase().includes('swcorp')) reIncidenceCount.SWCorp++;
          }
        }
      });
    });

    // We also calculate actual SLA resolution rates (resolved within 3 days)
    const onTimeResolved = { JKR: 0, MBMB: 0, SWCorp: 0 };
    resolvedReports.forEach(r => {
      const created = r.created_at ? new Date(r.created_at).getTime() : null;
      const updated = r.updated_at ? new Date(r.updated_at).getTime() : null;
      const dept = r.assigned_department || '';
      
      if (created && updated) {
        const diffDays = (updated - created) / (1000 * 60 * 60 * 24);
        if (diffDays <= 3) {
          if (dept.toLowerCase().includes('jkr')) onTimeResolved.JKR++;
          else if (dept.toLowerCase().includes('mbmb')) onTimeResolved.MBMB++;
          else if (dept.toLowerCase().includes('swcorp')) onTimeResolved.SWCorp++;
        }
      } else {
        // Fallback: treat as on-time if no dates
        if (dept.toLowerCase().includes('jkr')) onTimeResolved.JKR++;
        else if (dept.toLowerCase().includes('mbmb')) onTimeResolved.MBMB++;
        else if (dept.toLowerCase().includes('swcorp')) onTimeResolved.SWCorp++;
      }
    });

    const calculateSLARate = (onTime, total) => {
      if (!total) return 92; // default high baseline if no resolved tickets
      return Math.round((onTime / total) * 100);
    };

    const rates = {
      JKR: calculateSLARate(onTimeResolved.JKR, totalResolved.JKR),
      MBMB: calculateSLARate(onTimeResolved.MBMB, totalResolved.MBMB),
      SWCorp: calculateSLARate(onTimeResolved.SWCorp, totalResolved.SWCorp),
    };

    const getGrade = (rate) => {
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
      const totalDays = item.items.reduce((sum, r) => {
        const created = r.created_at ? new Date(r.created_at).getTime() : Date.now();
        const elapsed = (Date.now() - created) / (1000 * 60 * 60 * 24);
        return sum + elapsed;
      }, 0);
      const avgElapsed = item.items.length ? (totalDays / item.items.length) : 0;

      // Count High Priority reports in the cluster
      const highPriorityCount = item.items.filter(r => (r.priority || '').toLowerCase() === 'high').length;

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

  // 2. Department SLA Performance calculation
  const deptSLAMetrics = useMemo(() => {
    const metrics = {};
    const filteredAuthorities = AUTHORITIES.filter(a => ['mbmb', 'jkr', 'swcorp'].includes(a.id));
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
      const avgResponseDays = m.assigned
        ? parseFloat((m.totalResponseHours / m.assigned / 24).toFixed(1))
        : 0;
      const avgResolveDays = m.resolved
        ? parseFloat((m.totalResolutionHours / m.resolved / 24).toFixed(1))
        : 0;

      return {
        ...m,
        avgResponseDays,
        avgResolveDays: avgResolveDays || (m.backlog > 0 ? 4.5 : 0), // fallback average if resolved empty
      };
    });
  }, [filteredReports]);

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
    const avgDays = resolved.length ? (totalResolutionHours / resolved.length / 24).toFixed(1) : '2.4';

    // Resource allocation health analysis
    let worstBacklogDept = 'None';
    let maxBacklog = 0;
    
    if (selectedDept !== 'all') {
      const currentDeptData = deptSLAMetrics.find(d => d.name === selectedDept);
      const backlog = currentDeptData ? currentDeptData.backlog : 0;
      let healthStatus = 'Optimal';
      let recommendation = `Resources are currently balanced for ${selectedDept}.`;
      
      if (backlog > 5) {
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
    
    if (maxBacklog > 5) {
      healthStatus = 'Resource Overload';
      const helperDept = deptSLAMetrics.find((d) => d.name !== worstBacklogDept && d.backlog <= 2);
      recommendation = `Backlog detected in ${worstBacklogDept} (${maxBacklog} tickets). Suggest reallocating 15% labor capacity from ${
        helperDept ? helperDept.name : 'other departments'
      } to clear pending road repair backlogs.`;
    }

    return {
      total,
      active,
      avgDays,
      hotspotsCount: hotspots.length,
      healthStatus,
      recommendation,
      worstBacklogDept,
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
    if (total === 0) return { cwi: 75, domains: {
      infrastructure: { name: 'Infrastructure', score: 75, activeIssues: 0, totalReports: 0 },
      environment: { name: 'Environment', score: 78, activeIssues: 0, totalReports: 0 },
      publicSafety: { name: 'Public Safety', score: 82, activeIssues: 0, totalReports: 0 },
      efficiency: { name: 'Service Efficiency', score: 70, activeIssues: 0, totalReports: 0 },
      satisfaction: { name: 'Citizen Satisfaction', score: 65, activeIssues: 0, totalReports: 0 },
      responsiveness: { name: 'Responsiveness', score: 72, activeIssues: 0, totalReports: 0 },
    }, grade: 'B' };

    const resolved = filteredReports.filter(r => r.status === 'Resolved').length;
    const rejected = filteredReports.filter(r => r.status === 'Rejected').length;

    // Helper: match report category against keywords
    const getCatReports = (keywords) => filteredReports.filter(r => {
      const cat = (r.categories || r.predictedCategory || '').toLowerCase();
      return keywords.some(kw => cat.includes(kw));
    });

    // INFRASTRUCTURE — roads, sidewalks, streetlights, signs
    const infraReports = getCatReports(['road', 'pothole', 'sidewalk', 'pavement', 'light', 'lamp', 'lighting', 'sign', 'bridge']);
    const infraResolved = infraReports.filter(r => r.status === 'Resolved').length;
    const infraActive = infraReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    const infraScore = infraReports.length > 0
      ? Math.round(Math.max(15, Math.min(100, (infraResolved / infraReports.length) * 100 - (infraActive * 3))))
      : 80;

    // ENVIRONMENT — waste, dumping, pollution, vegetation
    const envReports = getCatReports(['waste', 'garbage', 'dumping', 'trash', 'burning', 'vegetation', 'overgrown', 'pollution', 'smoke']);
    const envResolved = envReports.filter(r => r.status === 'Resolved').length;
    const envActive = envReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    const envScore = envReports.length > 0
      ? Math.round(Math.max(15, Math.min(100, (envResolved / envReports.length) * 100 - (envActive * 4))))
      : 82;

    // PUBLIC SAFETY — vandalism, fallen trees, fire hazards
    const safetyReports = getCatReports(['vandal', 'graffiti', 'tree', 'fallen', 'fire', 'hazard', 'manhole', 'stray', 'electrical']);
    const safetyResolved = safetyReports.filter(r => r.status === 'Resolved').length;
    const safetyActive = safetyReports.filter(r => r.status !== 'Resolved' && r.status !== 'Rejected').length;
    const safetyHighPriority = safetyReports.filter(r =>
      (r.priority || '').toLowerCase() === 'high' && r.status !== 'Resolved' && r.status !== 'Rejected'
    ).length;
    const safetyScore = safetyReports.length > 0
      ? Math.round(Math.max(10, Math.min(100, (safetyResolved / safetyReports.length) * 100 - (safetyHighPriority * 10) - (safetyActive * 3))))
      : 85;

    // SERVICE EFFICIENCY — % resolved within 3-day SLA
    const resolvedWithDates = filteredReports.filter(r => r.status === 'Resolved' && r.timestamp && r.resolved_at);
    let onTimeCount = 0;
    resolvedWithDates.forEach(r => {
      const start = new Date(r.timestamp).getTime();
      const end = new Date(r.resolved_at).getTime();
      if (!isNaN(start) && !isNaN(end) && (end - start) / (1000 * 60 * 60 * 24) <= 3) onTimeCount++;
    });
    const efficiencyScore = resolvedWithDates.length > 0
      ? Math.round((onTimeCount / resolvedWithDates.length) * 100)
      : 75;

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
    const avgResponseDays = withResponse.length > 0 ? totalResponseDays / withResponse.length : 2;
    const responsivenessScore = Math.round(Math.max(10, Math.min(100, 100 - (avgResponseDays * 15))));

    // COMPOSITE CITY WELLNESS INDEX
    const cwi = Math.round(
      infraScore * 0.25 + envScore * 0.20 + safetyScore * 0.20 +
      efficiencyScore * 0.15 + satisfactionScore * 0.10 + responsivenessScore * 0.10
    );

    const getGrade = (s) => { if (s >= 90) return 'A'; if (s >= 80) return 'B'; if (s >= 70) return 'C'; if (s >= 60) return 'D'; return 'F'; };

    const domains = {
      infrastructure: { name: 'Infrastructure', score: infraScore, activeIssues: infraActive, totalReports: infraReports.length },
      environment: { name: 'Environment', score: envScore, activeIssues: envActive, totalReports: envReports.length },
      publicSafety: { name: 'Public Safety', score: safetyScore, activeIssues: safetyActive, totalReports: safetyReports.length },
      efficiency: { name: 'Service Efficiency', score: efficiencyScore, activeIssues: total - resolved - rejected, totalReports: resolvedWithDates.length },
      satisfaction: { name: 'Citizen Satisfaction', score: satisfactionScore, activeIssues: 0, totalReports: total },
      responsiveness: { name: 'Responsiveness', score: responsivenessScore, activeIssues: 0, totalReports: withResponse.length },
    };

    return { cwi, domains, grade: getGrade(cwi) };
  }, [filteredReports]);

  // 5.6. Zone Wellness Scorecard
  const zoneScorecard = useMemo(() => {
    const zones = {};
    filteredReports.forEach(r => {
      const zone = r.zone || r.location || (r.address ? r.address.split(',').pop()?.trim() : null) || 'Unknown';
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

    const getGrade = (rate) => { if (rate >= 90) return 'A'; if (rate >= 75) return 'B'; if (rate >= 60) return 'C'; if (rate >= 45) return 'D'; return 'F'; };

    return Object.values(zones).filter(z => z.total >= 1).map(z => {
      const validTotal = z.total - z.rejected || 1;
      const resolutionRate = Math.round((z.resolved / validTotal) * 100);
      const avgDays = z.resWithDates > 0 ? parseFloat((z.totalResDays / z.resWithDates).toFixed(1)) : 0;
      return { ...z, resolutionRate, avgDays, grade: getGrade(resolutionRate) };
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
      const scoreDomain = (keywords) => {
        const dr = cumReports.filter(r => { const c = (r.categories || '').toLowerCase(); return keywords.some(k => c.includes(k)); });
        if (dr.length === 0) return 75;
        const dres = dr.filter(r => r.status === 'Resolved').length;
        return Math.round(Math.max(20, Math.min(100, (dres / dr.length) * 100)));
      };

      const infra = scoreDomain(['road', 'sidewalk', 'light', 'sign', 'pothole']);
      const env = scoreDomain(['waste', 'dumping', 'burning', 'vegetation', 'garbage']);
      const safety = scoreDomain(['vandal', 'tree', 'fallen', 'fire']);
      const cwi = Math.round(infra * 0.35 + env * 0.35 + safety * 0.30);

      weeks.push({ week: format(weekStart, 'MMM dd'), CWI: Math.min(100, cwi), Infrastructure: Math.min(100, infra), Environment: Math.min(100, env), Safety: Math.min(100, safety) });
    }
    return weeks;
  }, [reports]);

  // 5.8. Actionable Insights Generation (rule-based)
  const actionableInsights = useMemo(() => {
    const insights = [];
    const now = new Date();

    // 1. Worsening domain detection
    Object.entries(cityWellnessData.domains).forEach(([key, domain]) => {
      if (domain.score < 60) {
        insights.push({ id: `domain-${key}`, type: 'warning', title: `${domain.name} Needs Attention`,
          description: `${domain.name} health score is ${domain.score}/100 with ${domain.activeIssues} active issues. This domain is below the acceptable threshold and requires immediate intervention.`,
          zone: 'City-wide', action: `Prioritize ${domain.name.toLowerCase()} reports and allocate additional resources to this domain.` });
      }
    });

    // 2. Top performing zone
    const topZone = zoneScorecard.find(z => z.resolutionRate >= 80 && z.total >= 3);
    if (topZone) {
      insights.push({ id: 'top-zone', type: 'success', title: `${topZone.name} — Top Performing Zone`,
        description: `${topZone.resolutionRate}% resolution rate across ${topZone.total} reports. Average resolution time: ${topZone.avgDays} days.`,
        zone: topZone.name, action: `Recognize this zone's performance and adopt its practices as a model for underperforming areas.` });
    }

    // 3. Neglected zones (aged unresolved reports > 14 days)
    const agedReports = filteredReports.filter(r => {
      if (r.status === 'Resolved' || r.status === 'Rejected' || !r.timestamp) return false;
      return (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24) > 14;
    });
    if (agedReports.length > 0) {
      const zoneAged = {};
      agedReports.forEach(r => { const z = r.zone || r.location || 'Unknown'; zoneAged[z] = (zoneAged[z] || 0) + 1; });
      const worstZone = Object.entries(zoneAged).sort((a, b) => b[1] - a[1])[0];
      if (worstZone) {
        insights.push({ id: 'neglected-zone', type: 'critical', title: `Neglected Zone: ${worstZone[0]}`,
          description: `${worstZone[1]} reports older than 14 days remain unresolved in ${worstZone[0]}. This indicates a systemic response gap that needs urgent attention.`,
          zone: worstZone[0], action: `Schedule a priority inspection team for ${worstZone[0]} and review department assignment bottlenecks.` });
      }
    }

    // 4. Overloaded department
    deptSLAMetrics.forEach(dept => {
      if (dept.backlog > 5) {
        insights.push({ id: `dept-overload-${dept.name}`, type: 'warning', title: `${dept.name} Department Overloaded`,
          description: `${dept.name} has ${dept.backlog} active backlog tickets with an average resolution time of ${dept.avgResolveDays} days. This exceeds the 3-day SLA target.`,
          zone: 'Department-wide', action: `Reallocate 15–20% crew capacity from lower-backlog departments to ${dept.name} for the next sprint cycle.` });
      }
    });

    // 5. Report volume spike detection (week-over-week)
    const last7 = filteredReports.filter(r => r.timestamp && (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24) <= 7).length;
    const prev7 = filteredReports.filter(r => { if (!r.timestamp) return false; const d = (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24); return d > 7 && d <= 14; }).length;
    if (prev7 > 0 && last7 > prev7 * 1.25) {
      const pctIncrease = Math.round(((last7 - prev7) / prev7) * 100);
      const catCounts = {};
      filteredReports.filter(r => r.timestamp && (now - new Date(r.timestamp)) / (1000 * 60 * 60 * 24) <= 7).forEach(r => {
        const cat = r.categories || r.predictedCategory || 'Other'; catCounts[cat] = (catCounts[cat] || 0) + 1;
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
    const highUpvoteReports = filteredReports.filter(r => (r.upvotes || 0) >= 5 && r.status !== 'Resolved' && r.status !== 'Rejected');
    if (highUpvoteReports.length > 0) {
      const totalHighUpvotes = highUpvoteReports.reduce((sum, r) => sum + (r.upvotes || 0), 0);
      insights.push({ id: 'citizen-engagement', type: 'info', title: `High Citizen Engagement Detected`,
        description: `${highUpvoteReports.length} active reports have 5+ citizen upvotes (${totalHighUpvotes} total). These represent strong public concern that should be prioritized.`,
        zone: 'City-wide', action: `Prioritize high-engagement reports to demonstrate government responsiveness to citizen concerns.` });
    }

    // 9. Overall city health status
    if (cityWellnessData.cwi >= 80) {
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
        backgroundColor: '#030712', // match dashboard dark background
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
          <RefreshCw className="animate-spin text-indigo-400" size={32} />
          <div className="text-slate-400 font-medium">Computing City Infrastructure Insights...</div>
        </div>
      </div>
    );
  }

  const activeCluster = activeClusterId
    ? (hotspots.find(h => h.id === activeClusterId) || rootCauseAdvisories.find(a => a.id === activeClusterId))
    : null;

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
          className="flex items-center justify-center gap-2 bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 px-5 py-2.5 rounded-xl font-bold transition-all shadow-lg hover:shadow-white/5 shadow-black/25 text-sm cursor-pointer border border-white"
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
        <div className="flex bg-white/3 p-1.5 rounded-2xl border border-white/5 self-start overflow-x-auto scrollbar-none max-w-full gap-2">
        <button
          onClick={() => setActiveViewTab('overview')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'overview'
              ? 'bg-white text-black shadow-lg shadow-white/10 border border-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          Overview & Trends
        </button>
        <button
          onClick={() => setActiveViewTab('hotspots')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'hotspots'
              ? 'bg-white text-black shadow-lg shadow-white/10 border border-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
          }`}
        >
          Predictive Hotspots ({hotspots.length + rootCauseAdvisories.length})
        </button>
        <button
          onClick={() => setActiveViewTab('cityhealth')}
          className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
            activeViewTab === 'cityhealth'
              ? 'bg-white text-black shadow-lg shadow-white/10 border border-white'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
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
            {/* Control Panel / Filter Bar */}
            <div className="bg-white/3 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
              <div className="flex flex-wrap items-center gap-6 text-left">
                {/* Date Filter */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Time Interval</label>
                  <select
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-zinc-500 transition-colors custom-select min-w-[150px]"
                  >
                    <option value="all">All Time</option>
                    <option value="7d">Last 7 Days</option>
                    <option value="30d">Last 30 Days</option>
                  </select>
                </div>

                {/* Department Filter */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Department Scope</label>
                  {role === 'admin' ? (
                    <select
                      value={selectedDept}
                      onChange={(e) => setSelectedDept(e.target.value)}
                      className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-zinc-500 transition-colors custom-select min-w-[180px]"
                    >
                      <option value="all">All Departments</option>
                      <option value="JKR">JKR (Public Works)</option>
                      <option value="MBMB">MBMB (City Council)</option>
                      <option value="SWCorp">SWCorp (Waste Management)</option>
                    </select>
                  ) : (
                    <div className="bg-zinc-950/50 border border-white/5 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold min-w-[180px] flex items-center gap-1.5 h-[34px]">
                      <span className="w-2 h-2 rounded-full bg-zinc-400" />
                      {selectedDept === 'all' ? 'All Departments' : `${selectedDept}`}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 text-left">
              <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Complaints</div>
                  <div className="text-2xl font-black text-slate-100 mt-1">{kpiStats.active}</div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">Out of {kpiStats.total} total reports</div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Avg Resolution SLA</div>
                  <div className="text-2xl font-black text-slate-100 mt-1">{kpiStats.avgDays} Days</div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">Calculated from historical tickets</div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Hotspots</div>
                  <div className="text-2xl font-black text-slate-100 mt-1">{kpiStats.hotspotsCount} Zones</div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">Clusters with radius &le; {proximityRadius}m</div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-xl border border-white/8 rounded-2xl p-6">
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Allocation Status</div>
                  <div className="text-lg font-black text-slate-100 mt-1 truncate max-w-[170px]" title={kpiStats.healthStatus}>
                    {kpiStats.healthStatus}
                  </div>
                  <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                    {kpiStats.healthStatus === 'Optimal' ? 'All crew rates balanced' : `${kpiStats.worstBacklogDept} backlog warning`}
                  </div>
                </div>
              </div>
            </div>

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
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="date" stroke="#cbd5e1" fontSize={10} tickLine={false} />
                        <YAxis stroke="#cbd5e1" fontSize={10} tickLine={false} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#cbd5e1' }} />
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
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#cbd5e1' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    
                    {/* Legends Custom */}
                    <div className="absolute bottom-2 left-0 right-0 flex flex-wrap justify-center gap-x-3 gap-y-1 px-4 text-[10px] text-slate-100 font-semibold">
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
                        <BarChart data={deptSLAMetrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" stroke="#cbd5e1" fontSize={11} tickLine={false} />
                          <YAxis stroke="#cbd5e1" fontSize={11} tickLine={false} label={{ value: 'Days', angle: -90, position: 'insideLeft', stroke: '#cbd5e1', fontSize: 10 }} />
                          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#cbd5e1' }} />
                          <ReferenceLine y={3} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Target SLA', fill: '#ef4444', fontSize: 9, position: 'top' }} />
                          <Bar dataKey="avgResolveDays" radius={[6, 6, 0, 0]} maxBarSize={45}>
                            {deptSLAMetrics.map((entry, index) => {
                              const exceedsSLA = entry.avgResolveDays > 3;
                              return <Cell key={`cell-${index}`} fill={exceedsSLA ? '#ef4444' : '#10b981'} />;
                            })}
                          </Bar>
                        </BarChart>
                      ) : (
                        <BarChart data={deptStatusData} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis type="number" stroke="#cbd5e1" fontSize={10} tickLine={false} />
                          <YAxis dataKey="name" type="category" stroke="#cbd5e1" fontSize={11} tickLine={false} />
                          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#cbd5e1' }} />
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
                    <p className="text-xs leading-relaxed text-slate-300">
                      City assets and labor tracking alerts. These alerts are automatically triggered when any department backlogs exceed targets:
                    </p>
                    
                    <div className="mt-4 space-y-3">
                      <div className="p-4 rounded-xl border flex items-start gap-3 bg-zinc-800/10 border-zinc-700/20 text-zinc-300">
                        <div className="text-left">
                          <div className="text-xs font-bold uppercase tracking-wide">
                            {kpiStats.healthStatus === 'Optimal' ? 'System Healthy' : 'Resource Reallocation Alert'}
                          </div>
                          <div className="text-[11px] leading-relaxed mt-1 text-slate-350">
                            {kpiStats.recommendation}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/5 pt-4">
                    <div className="flex items-center justify-between text-xs text-slate-400 font-bold">
                      <span>Fastest SLA</span>
                      <span className="text-white">SWCorp (&lt;1.0 Day)</span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400 font-bold mt-2">
                      <span>Slowest SLA</span>
                      <span className="text-zinc-400">{kpiStats.worstBacklogDept}</span>
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
            {/* Control Panel / Filter Bar */}
            <div className="bg-white/3 backdrop-blur-xl border border-white/5 rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 text-left">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Date Filter */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Time Interval</label>
                    <select
                      value={dateFilter}
                      onChange={(e) => setDateFilter(e.target.value)}
                      className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-zinc-500 transition-colors custom-select min-w-[130px]"
                    >
                      <option value="all">All Time</option>
                      <option value="7d">Last 7 Days</option>
                      <option value="30d">Last 30 Days</option>
                    </select>
                  </div>

                  {/* Department Filter */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Department Scope</label>
                    {role === 'admin' ? (
                      <select
                        value={selectedDept}
                        onChange={(e) => setSelectedDept(e.target.value)}
                        className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-zinc-500 transition-colors custom-select min-w-[150px]"
                      >
                        <option value="all">All Departments</option>
                        <option value="JKR">JKR (Public Works)</option>
                        <option value="MBMB">MBMB (City Council)</option>
                        <option value="SWCorp">SWCorp (Waste Management)</option>
                      </select>
                    ) : (
                      <div className="bg-zinc-950/50 border border-white/5 text-slate-300 px-4 py-2 rounded-xl text-xs font-bold min-w-[150px] flex items-center gap-1.5 h-[34px]">
                        <span className="w-2 h-2 rounded-full bg-zinc-400" />
                        {selectedDept === 'all' ? 'All Departments' : `${selectedDept}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Focused Map & List Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Map & List (lg:col-span-2) */}
              <div className="lg:col-span-2 space-y-6">
                {/* Heatmap Card */}
                <div className="content-card">
                  <div className="content-card-header">
                    <div className="content-card-title">
                      <MapPin size={16} className="text-indigo-400 mr-2" />
                      Melaka Complaint Density Heatmap
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="rounded-xl overflow-hidden border border-white/5 relative z-10" style={{ height: '380px', width: '100%' }}>
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
                <div className="content-card-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-white/5 pb-4">
                  <div className="content-card-title">
                    Infrastructure Decision Support
                  </div>
                  
                  {/* Tab Selector */}
                  <div className="flex bg-zinc-950 p-1 rounded-xl border border-white/5 self-start sm:self-auto">
                    <button
                      onClick={() => setActiveTab('single')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeTab === 'single'
                          ? 'bg-white text-black border border-white shadow-lg'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      Hotspots ({hotspots.length})
                    </button>
                    <button
                      onClick={() => setActiveTab('systemic')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeTab === 'systemic'
                          ? 'bg-white text-black border border-white shadow-lg'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent'
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
                          <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs text-center">
                            <CheckCircle2 className="text-slate-500 mb-2 animate-pulse mx-auto" size={24} />
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
                              className={`p-4 border rounded-xl space-y-2 hover:border-white/40 transition-all cursor-pointer group text-left ${
                                activeClusterId === h.id ? 'bg-white/10 border-white/60 shadow-md' : 'bg-zinc-800/30 border-white/5'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                                    {h.category}
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                    {h.size} active defects
                                  </span>
                                </div>
                                <span className="text-[9px] font-bold text-slate-500 group-hover:text-white flex items-center gap-0.5 transition-colors">
                                  Modify Settings
                                  <ChevronRight size={10} />
                                </span>
                              </div>
                              <div className="text-xs text-slate-300 font-bold">{h.address}</div>
                              <div className="text-[11px] leading-relaxed text-slate-400 italic line-clamp-2">
                                <strong>Recommendation:</strong> {h.recommendation}
                              </div>
                            </div>
                          ))
                        )
                      ) : (
                        rootCauseAdvisories.length === 0 ? (
                          <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs text-center">
                            <CheckCircle2 className="text-slate-500 mb-2 animate-pulse mx-auto" size={24} />
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
                              className={`p-4 border rounded-xl space-y-2 hover:border-white/40 transition-all cursor-pointer group text-left ${
                                activeClusterId === a.id ? 'bg-white/10 border-white/60 shadow-md' : 'bg-zinc-800/30 border-white/5'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                                    {a.category}
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                    {a.size} reports grouped
                                  </span>
                                </div>
                                <span className="text-[9px] font-bold text-slate-500 group-hover:text-white flex items-center gap-0.5 transition-colors">
                                  Modify Settings
                                  <ChevronRight size={10} />
                                </span>
                              </div>
                              <div className="text-xs text-slate-300 font-bold">{a.address}</div>
                              <div className="text-[11px] leading-relaxed text-slate-400 italic line-clamp-2">
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
                      <div className="content-card-header flex items-center justify-between border-b border-white/5 pb-4">
                        <button
                          onClick={() => setActiveClusterId(null)}
                          className="flex items-center gap-1 text-slate-400 hover:text-white text-xs font-bold transition-colors cursor-pointer"
                        >
                          <ChevronLeft size={16} />
                          Back
                        </button>
                        <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                          {activeCluster.category}
                        </span>
                      </div>
                      <div className="p-5 space-y-5 text-left">
                        {/* Edit Name */}
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hotspot Location Name</label>
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
                            className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-zinc-500 transition-colors w-full"
                          />
                        </div>

                        {/* Edit Recommendation */}
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actionable Recommendation</label>
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
                              className="text-[9px] font-bold text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
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
                            className="bg-zinc-950 border border-white/10 rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 outline-none focus:border-zinc-500 transition-colors w-full resize-none leading-relaxed"
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
                          className="flex items-center justify-center gap-1.5 bg-zinc-950 border border-white/10 hover:border-white/20 hover:bg-zinc-950/40 text-slate-300 hover:text-white py-2.5 rounded-xl text-xs font-bold transition-all w-full cursor-pointer"
                        >
                          <Eye size={14} />
                          Locate on Heatmap
                        </button>

                        {/* Exclude / Include Tickets List */}
                        <div className="flex flex-col min-h-0 pt-2 border-t border-white/5">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
                            <span>Constituent Issues</span>
                            <span className="px-1.5 py-0.5 rounded bg-zinc-950 text-slate-300 text-[9px] font-black">{activeCluster.items.length} Tickets</span>
                          </label>
                          <div className="overflow-y-auto max-h-[180px] pr-1 space-y-2 scrollbar-thin">
                            {activeCluster.items.map((item) => (
                              <div key={item.id} className="flex items-start gap-2.5 p-2.5 bg-zinc-950/30 border border-white/5 rounded-lg text-left">
                                <input
                                  type="checkbox"
                                  checked={!(customOverrides[activeCluster.seedId]?.excludedReportIds?.includes(item.id))}
                                  onChange={() => handleToggleExcludeTicket(activeCluster.seedId, item.id)}
                                  className="mt-0.5 cursor-pointer accent-zinc-500 rounded border-white/10"
                                  title="Exclude this ticket from cluster"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] leading-relaxed text-slate-300 truncate font-semibold">
                                    {item.description || 'No description'}
                                  </p>
                                  <p className="text-[9px] text-slate-500 font-medium mt-0.5">
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
                  <div className="bg-white/3 backdrop-blur-xl border border-white/10 rounded-2xl p-6 space-y-6 text-left animate-fade-in">
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-100">
                        Clustering Controls
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">Adjust spatial criteria to modify hotspot grouping boundaries in real time.</p>
                    </div>

                    <div className="space-y-5 pt-2">
                      {/* Proximity Slider */}
                      <div className="space-y-2 text-left">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                          <span>Cluster Proximity Radius</span>
                          <span className="text-indigo-400 font-bold">{proximityRadius} meters</span>
                        </div>
                        <input
                          type="range"
                          min="50"
                          max="1000"
                          step="50"
                          value={proximityRadius}
                          onChange={(e) => setProximityRadius(Number(e.target.value))}
                          className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-100"
                        />
                        <div className="flex justify-between text-[9px] text-slate-500 font-medium">
                          <span>50m (Precise)</span>
                          <span>1000m (Broad)</span>
                        </div>
                      </div>

                      {/* Min Density Selector */}
                      <div className="space-y-2 text-left">
                        <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                          <span>Minimum Complaint Density</span>
                          <span className="text-indigo-400 font-bold">{minClusterSize} tickets</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {[2, 3, 4, 5, 6, 8, 10, 15].map((val) => (
                            <button
                              key={val}
                              onClick={() => setMinClusterSize(val)}
                              className={`py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                                minClusterSize === val
                                  ? 'bg-white border-white text-black shadow-lg shadow-white/5'
                                  : 'bg-zinc-950 border-white/10 hover:border-white/20 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {val}+
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-500 leading-relaxed mt-2">
                          Hotspots require at least this number of active complaints of the same category clustered within the radius.
                        </p>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-zinc-800/10 border border-zinc-700/20 text-[11px] text-slate-350 leading-relaxed">
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

            {/* Row 1: CWI Gauge Hero + 6 Domain Health Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              {/* CWI Radial Gauge */}
              <div className="content-card flex flex-col items-center justify-center py-8 px-6">
                <div
                  className="cwi-gauge"
                  style={{
                    '--gauge-pct': cityWellnessData.cwi,
                    '--gauge-color': cityWellnessData.cwi >= 80 ? '#34d399' : cityWellnessData.cwi >= 60 ? '#fbbf24' : '#f87171'
                  }}
                >
                  <div className="cwi-gauge-glow" />
                  <div className="cwi-gauge-ring" />
                  <div className="cwi-gauge-value">{cityWellnessData.cwi}</div>
                  <div className="cwi-gauge-label">City Wellness</div>
                </div>
                <div className={`mt-5 text-2xl font-black cwi-grade-${cityWellnessData.grade}`}>
                  Grade {cityWellnessData.grade}
                </div>
                <div className="text-[10px] text-slate-500 font-semibold mt-1 uppercase tracking-wider">
                  Composite Health Index
                </div>
                <div className="mt-4 flex items-center gap-2 text-[10px] text-slate-400">
                  <Heart size={12} className="text-slate-500" />
                  <span className="font-semibold">Based on {filteredReports.length} reports</span>
                </div>
              </div>

              {/* 6 Domain Health Cards */}
              <div className="lg:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(cityWellnessData.domains).map(([key, domain]) => (
                  <div key={key} className="domain-card">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">{domain.name}</span>
                      <span className={`text-lg font-black ${domain.score >= 80 ? 'text-emerald-400' : domain.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                        {domain.score}
                      </span>
                    </div>
                    <div className="domain-score-bar">
                      <div
                        className="domain-score-fill"
                        style={{
                          width: `${domain.score}%`,
                          backgroundColor: domain.score >= 80 ? '#34d399' : domain.score >= 60 ? '#fbbf24' : '#f87171'
                        }}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium mt-2">
                      {domain.activeIssues > 0 ? `${domain.activeIssues} active issues` : 'No active issues'} · {domain.totalReports} total
                    </div>
                  </div>
                ))}
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
                        <PolarGrid stroke="rgba(255,255,255,0.08)" />
                        <PolarAngleAxis dataKey="domain" tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 700 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar name="Score" dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#cbd5e1' }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-center text-[10px] text-slate-500 font-medium mt-2">
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
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="week" stroke="#cbd5e1" fontSize={10} tickLine={false} />
                        <YAxis stroke="#cbd5e1" fontSize={10} tickLine={false} domain={[0, 100]} />
                        <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 12 }} itemStyle={{ color: '#f1f5f9' }} labelStyle={{ color: '#cbd5e1' }} />
                        <Area type="monotone" dataKey="CWI" stroke="#6366f1" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCWI)" name="City Wellness Index" />
                        <Area type="monotone" dataKey="Infrastructure" stroke="#34d399" strokeWidth={1.5} fillOpacity={0} dot={false} />
                        <Area type="monotone" dataKey="Environment" stroke="#fbbf24" strokeWidth={1.5} fillOpacity={0} dot={false} />
                        <Area type="monotone" dataKey="Safety" stroke="#f87171" strokeWidth={1.5} fillOpacity={0} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  {/* Chart Legend */}
                  <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-3 text-[10px] font-bold text-slate-400">
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
                  <Lightbulb size={16} className="text-amber-400" />
                  Actionable Urban Insights
                </div>
                <div className="text-[10px] font-semibold text-slate-500">
                  {actionableInsights.length} insights generated
                </div>
              </div>
              <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[440px] overflow-y-auto pr-1 scrollbar-thin">
                  {actionableInsights.length === 0 ? (
                    <div className="col-span-2 h-32 flex flex-col items-center justify-center text-slate-500 text-xs">
                      <CheckCircle2 className="text-slate-600 mb-2" size={20} />
                      No actionable insights generated from current data.
                    </div>
                  ) : (
                    actionableInsights.map(insight => (
                      <div key={insight.id} className={`insight-card ${insight.type}`}>
                        <div className="flex items-start gap-3">
                          <div className={`insight-icon mt-0.5 flex-shrink-0 ${
                            insight.type === 'critical' ? 'text-red-400' :
                            insight.type === 'warning' ? 'text-amber-400' :
                            insight.type === 'success' ? 'text-emerald-400' : 'text-indigo-400'
                          }`}>
                            {insight.type === 'critical' ? <AlertCircle size={16} /> :
                             insight.type === 'warning' ? <AlertTriangle size={16} /> :
                             insight.type === 'success' ? <CheckCircle2 size={16} /> :
                             <Info size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-extrabold text-slate-200">{insight.title}</div>
                            <div className="text-[11px] leading-relaxed text-slate-400 mt-1">{insight.description}</div>
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-zinc-800/50 border border-white/5 text-slate-400">
                                {insight.zone}
                              </span>
                            </div>
                            <div className="text-[10px] leading-relaxed text-slate-300 mt-2 italic">
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
                  <MapPin size={16} className="text-indigo-400" />
                  Zone / Area Wellness Scorecard
                </div>
                <div className="text-[10px] font-semibold text-slate-500">
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
                          <td colSpan={7} className="text-center text-slate-500 py-8">No zone data available</td>
                        </tr>
                      ) : (
                        zoneScorecard.map(zone => (
                          <tr key={zone.name}>
                            <td className="font-bold text-slate-200">{zone.name}</td>
                            <td>{zone.total}</td>
                            <td>
                              <span className={zone.active > 3 ? 'text-amber-400 font-bold' : ''}>
                                {zone.active}
                              </span>
                            </td>
                            <td className="text-emerald-400">{zone.resolved}</td>
                            <td>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden max-w-[60px]">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${zone.resolutionRate}%`,
                                      backgroundColor: zone.resolutionRate >= 80 ? '#34d399' : zone.resolutionRate >= 60 ? '#fbbf24' : '#f87171'
                                    }}
                                  />
                                </div>
                                <span className="text-[10px] font-bold">{zone.resolutionRate}%</span>
                              </div>
                            </td>
                            <td className={zone.avgDays > 3 ? 'text-red-400 font-bold' : 'text-slate-300'}>
                              {zone.avgDays || '—'}
                            </td>
                            <td>
                              <span className={`wellness-grade grade-${zone.grade}`}>{zone.grade}</span>
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
