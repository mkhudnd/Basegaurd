/** Pure helpers for role-based navigation. Real authorization remains in Supabase RLS/RPC. */
export type AccountRole = 'guard' | 'supervisor' | 'admin';
export type RoleProfile = {role: string; is_active: boolean} | null;

export function roleForProfile(profile: RoleProfile): AccountRole {
  if (!profile?.is_active || !['guard', 'supervisor', 'admin'].includes(profile.role)) {
    throw new Error('This account has no active SmartOps role. Contact your administrator.');
  }
  return profile.role as AccountRole;
}

/** A verified guard may still view their local queue offline, never gain network privileges. */
export function cachedOfflineRole(isOnline: boolean, cachedRole: string | null): 'guard' | null {
  return !isOnline && cachedRole === 'guard' ? 'guard' : null;
}
