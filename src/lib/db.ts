export async function ensureSystemSecret(db: D1Database) {
  const secret = await db.prepare('SELECT value FROM settings WHERE key = ?').bind('SYSTEM_SECRET').first<any>('value')
  if (secret) return secret

  const newSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('SYSTEM_SECRET', newSecret).run()
  return newSecret
}

export async function getSettings(db: D1Database) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all()
  return results.reduce((acc: any, row: any) => {
    acc[row.key] = row.value
    return acc
  }, {})
}

export async function logAudit(db: D1Database, userEmail: string, action: string, resourceType: string, resourceName: string, details?: any) {
  await db.prepare(
    'INSERT INTO audit_logs (user_email, action, resource_type, resource_name, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(userEmail, action, resourceType, resourceName, details ? JSON.stringify(details) : null).run()
}

export async function isBlacklisted(db: D1Database, name: string) {
  const { results } = await db.prepare('SELECT pattern FROM blacklist').all()
  return results.some((row: any) => {
    const pattern = new RegExp('^' + row.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
    return pattern.test(name)
  })
}
