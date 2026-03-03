import type { HiveRole } from '../types.js';

const roleRank: Record<HiveRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export function hasRoleAtLeast(role: HiveRole, minimumRole: HiveRole): boolean {
  return roleRank[role] >= roleRank[minimumRole];
}
