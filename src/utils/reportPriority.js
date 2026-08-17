// A category-based severity proxy. The backend has a real `priority` column
// on Complaint (see DBComplaint.priority in main.py) that nothing ever
// writes to, so this heuristic stands in for it — kept in one shared place
// so Analytics, the Reports table, and the worker notification badge can't
// drift into disagreeing about what counts as High.
export function getReportPriority(status, categories) {
  if (status === 'Resolved') return 'Resolved';
  const cat = categories || '';
  if (cat.includes('Damage') || cat.includes('Drainage') || cat.includes('Tree')) {
    return 'High';
  }
  return 'Medium';
}

// Numeric rank for sorting — higher sorts first under a descending sort,
// matching the convention the rest of the Reports table already uses
// (upvotes descending, timestamp descending).
export function priorityRank(priority) {
  if (priority === 'High') return 2;
  if (priority === 'Medium') return 1;
  return 0;
}

export const PRIORITY_TONE = {
  High: { color: '#b91c1c', bg: 'rgba(185,28,28,0.10)', border: 'rgba(185,28,28,0.30)' },
  Medium: { color: '#b45309', bg: 'rgba(180,83,9,0.10)', border: 'rgba(180,83,9,0.30)' },
  Resolved: { color: '#4a5d3f', bg: 'rgba(74,93,63,0.10)', border: 'rgba(74,93,63,0.20)' },
};
