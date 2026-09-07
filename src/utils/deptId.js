// The real backend returns a plain role ("worker", "authority") with the
// department living in a separate `agency` field that /login doesn't send
// back — so there's no clean way to know a staff member's department from
// the session alone. This guesses from the username as a fallback, matching
// the handful of demo accounts seeded on the backend (worker1/worker2, and
// authority usernames that are themselves the department id).
//
// This was previously copy-pasted identically into DashboardPage, ReportsPage,
// MapPage and Sidebar — one shared copy so a new alias only needs adding once.
// The real fix is still /login returning a real agency id; this only patches
// what's visible until that happens.
export function getDeptId(role, username) {
  if (!role) return null;
  if (role.includes('_')) {
    return role.split('_').slice(1).join('_');
  }
  if (role === 'authority' && username) {
    return username.toLowerCase();
  }
  if (role === 'worker' && username) {
    const name = username.toLowerCase();
    if (name.includes('mbmb') || name === 'worker1' || name === 'worker') return 'mbmb';
    if (name.includes('jkr') || name === 'worker2') return 'jkr';
    if (name.includes('swcorp')) return 'swcorp';
    if (name.includes('mphtj')) return 'mphtj';
  }
  return null;
}
