// /login now returns a real `agency` field resolved server-side from the
// staff member's Agency foreign key, so pass it in as `agency` and it's used
// directly — no guessing needed for anyone who has logged in since that
// shipped. The role/username guess below only remains as a fallback for a
// session already in localStorage from before this field existed; it self-heals
// the next time that person logs in.
export function getDeptId(role, username, agency) {
  if (agency) return agency;
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
