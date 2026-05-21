export const PERMISSION_HIERARCHY: Record<string, number> = {
  'read': 1,
  'add': 2,
  'edit_own': 3,
  'edit': 4,
  'delete_own': 5,
  'delete': 6,
  'domain_admin': 7
}

export async function getPermissionLevel(db: D1Database, user: any, domainId: number) {
  if (!user) return null
  if (user.role === 'owner' || user.role === 'admin' || user.role === 'manager') return 'domain_admin'
  const perm = await db.prepare('SELECT level FROM permissions WHERE user_id = ? AND domain_id = ?').bind(user.id, domainId).first<any>()
  return perm?.level || null
}

export function can(userLevel: string | null, requiredLevel: string) {
  if (!userLevel) return false
  return PERMISSION_HIERARCHY[userLevel] >= PERMISSION_HIERARCHY[requiredLevel]
}
