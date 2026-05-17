import { Hono } from 'hono'
import { googleAuth } from '@hono/oauth-providers/google'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { CloudflareClient } from './cloudflare'

type Bindings = {
  record_manager_db: D1Database
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
}

type Variables = {
  settings: any
  user: any
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Helper to get settings from D1
async function getSettings(db: D1Database) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all()
  return results.reduce((acc: any, row: any) => {
    acc[row.key] = row.value
    return acc
  }, {})
}

// Layout helper
const layout = (title: string, content: string, user?: any) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Record Manager</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 1000px; margin: 0 auto; padding: 2rem; background: #f4f7f6; }
        .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-top: 1rem; }
        h1 { color: #2c3e50; margin-top: 0; }
        nav { display: flex; gap: 1rem; margin-bottom: 1rem; align-items: center; }
        nav a { color: #3498db; text-decoration: none; font-weight: bold; }
        nav a:hover { text-decoration: underline; }
        .btn { display: inline-block; background: #3498db; color: white; padding: 0.6rem 1.2rem; text-decoration: none; border-radius: 4px; border: none; cursor: pointer; font-size: 0.9rem; }
        .btn:hover { background: #2980b9; }
        .btn-danger { background: #e74c3c; }
        .btn-danger:hover { background: #c0392b; }
        .btn-secondary { background: #95a5a6; }
        .btn-google { background: #4285F4; }
        input[type="text"], input[type="password"], select { width: 100%; padding: 0.8rem; margin: 0.5rem 0 1rem; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        label { font-weight: bold; }
        .hint { font-size: 0.9rem; color: #666; margin-bottom: 1rem; }
        code { background: #eee; padding: 0.2rem 0.4rem; border-radius: 3px; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { text-align: left; padding: 0.8rem; border-bottom: 1px solid #eee; }
        th { background: #f8f9fa; }
        .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }
        .badge-owner { background: #f1c40f; color: #000; }
        .badge-admin { background: #9b59b6; color: #fff; }
        .badge-user { background: #3498db; color: #fff; }
    </style>
</head>
<body>
    <nav>
        <a href="/">Home</a>
        ${user ? `
            <a href="/dashboard">Dashboard</a>
            <a href="/domains">Domains</a>
            ${user.role === 'owner' || user.role === 'admin' ? '<a href="/logs">Logs</a>' : ''}
            ${user.role === 'owner' ? `
                <a href="/users">Users</a>
                <a href="/blacklist">Blacklist</a>
                <a href="/setup">Setup</a>
            ` : ''}
            <span style="flex-grow: 1"></span>
            <span>${user.email} <span class="badge badge-${user.role}">${user.role}</span></span>
            <a href="/logout">Logout</a>
        ` : '<span style="flex-grow: 1"></span><a href="/auth/google" class="btn btn-google">Login</a>'}
    </nav>
    <div class="card">
        ${content}
    </div>
</body>
</html>
`

async function logAudit(db: D1Database, userEmail: string, action: string, resourceType: string, resourceName: string, details?: any) {
  await db.prepare(
    'INSERT INTO audit_logs (user_email, action, resource_type, resource_name, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(userEmail, action, resourceType, resourceName, details ? JSON.stringify(details) : null).run()
}

async function isBlacklisted(db: D1Database, name: string) {
  const { results } = await db.prepare('SELECT pattern FROM blacklist').all()
  return results.some((row: any) => {
    const pattern = new RegExp('^' + row.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$', 'i')
    return pattern.test(name)
  })
}

async function getPermissionLevel(db: D1Database, user: any, domainId: number) {
  if (!user) return null
  if (user.role === 'owner') return 'delete'
  const perm = await db.prepare('SELECT level FROM permissions WHERE user_id = ? AND domain_id = ?').bind(user.id, domainId).first<any>()
  return perm?.level || null
}

const PERMISSION_HIERARCHY: Record<string, number> = {
  'read': 1,
  'add': 2,
  'edit': 3,
  'delete': 4
}

function can(userLevel: string | null, requiredLevel: string) {
  if (!userLevel) return false
  return PERMISSION_HIERARCHY[userLevel] >= PERMISSION_HIERARCHY[requiredLevel]
}

// Middleware to check if setup is needed
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.pathname.startsWith('/static')) {
    return next()
  }

  const settings = await getSettings(c.env.record_manager_db)
  c.set('settings', settings)

  const userEmail = getCookie(c, 'user')
  if (userEmail) {
    const user = await c.env.record_manager_db.prepare('SELECT * FROM users WHERE email = ?').bind(userEmail).first<any>()
    c.set('user', user)
  }

  if (url.pathname === '/setup') {
    return next()
  }

  if (!settings.GOOGLE_CLIENT_ID || !settings.GOOGLE_CLIENT_SECRET || !settings.CF_API_TOKEN) {
    return c.redirect('/setup')
  }

  await next()
})

app.get('/', (c) => {
  const user = c.get('user')
  if (user) {
    return c.html(layout('Home', `
      <h1>Welcome, ${user.email}</h1>
      <p>Manage your DNS records simply and easily.</p>
      <div style="margin-top: 2rem;">
          <a href="/dashboard" class="btn">Go to Dashboard</a>
      </div>
    `, user))
  }
  return c.html(layout('Login', `
    <h1>Record Manager</h1>
    <p>Please sign in to manage your records.</p>
    <a href="/auth/google" class="btn btn-google">Login with Google</a>
  `))
})

app.get('/setup', async (c) => {
  const user = c.get('user')
  if (user && user.role !== 'owner') return c.text('Forbidden', 403)
  const settings = c.get('settings')
  
  // Cloudflare Token Template URL with Zone:Read and DNS:Edit permissions
  const permissions = JSON.stringify([
    { key: 'zone_read', type: 'zone' },
    { key: 'dns_edit', type: 'zone' }
  ])
  const cfTokenUrl = `https://dash.cloudflare.com/profile/api-tokens?name=Record-Manager&permissionGroupKeys=${encodeURIComponent(permissions)}&accountId=*&zoneId=all`
  
  return c.html(layout('Setup', `
    <h1>Configuration v1.1</h1>
    <p>Follow these steps to connect your Cloudflare account and enable Google Login.</p>
    
    <form method="POST" action="/setup">
      <div style="margin-bottom: 2.5rem; border-left: 4px solid #3498db; padding-left: 1.5rem;">
        <h3 style="margin-top:0">1. Cloudflare Connection</h3>
        <p class="hint">We need permission to <strong>Read Zones</strong> (to list your domains) and <strong>Edit DNS</strong> (to manage records).</p>
        
        <div style="background: #e1f5fe; padding: 1rem; border-radius: 4px; margin-bottom: 1rem;">
          <strong>Step A:</strong> 
          <a href="${cfTokenUrl}" target="_blank" class="btn" style="margin: 0 0.5rem;">Generate Token on Cloudflare</a>
          <span class="hint">Click "Continue to summary" and then "Create Token" on the next page.</span>
        </div>
        
        <label>Step B: Paste the generated token here</label>
        <input type="password" name="CF_API_TOKEN" value="${settings.CF_API_TOKEN || ''}" placeholder="Example: z6-..." required>
      </div>

      <div style="margin-bottom: 2.5rem; border-left: 4px solid #4285F4; padding-left: 1.5rem;">
        <h3 style="margin-top:0">2. Google OAuth (for Login)</h3>
        <p class="hint">Required for secure authentication. Create these in the <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console</a>.</p>
        
        <label>Google Client ID</label>
        <input type="text" name="GOOGLE_CLIENT_ID" value="${settings.GOOGLE_CLIENT_ID || ''}" placeholder="...apps.googleusercontent.com" required>
        
        <label>Google Client Secret</label>
        <input type="password" name="GOOGLE_CLIENT_SECRET" value="${settings.GOOGLE_CLIENT_SECRET || ''}" required>
      </div>

      <div style="background: #fff; position: sticky; bottom: 0; padding: 1rem 0; border-top: 1px solid #eee;">
        <button type="submit" class="btn" style="width: 100%; font-size: 1.1rem; padding: 1rem;">Save & Complete Setup</button>
      </div>
    </form>
  `, user))
})

app.post('/setup', async (c) => {
  const user = c.get('user')
  if (user && user.role !== 'owner') return c.text('Forbidden', 403)
  const body = await c.req.parseBody()
  const db = c.env.record_manager_db

  const keys = ['CF_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
  for (const key of keys) {
    if (body[key]) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .bind(key, body[key])
        .run()
    }
  }

  return c.redirect('/')
})

app.get(
  '/auth/google',
  async (c, next) => {
    const settings = await getSettings(c.env.record_manager_db)
    if (!settings.GOOGLE_CLIENT_ID || !settings.GOOGLE_CLIENT_SECRET) {
      return c.redirect('/setup')
    }
    
    const handler = googleAuth({
      client_id: settings.GOOGLE_CLIENT_ID,
      client_secret: settings.GOOGLE_CLIENT_SECRET,
      scope: ['email', 'profile'],
    })
    return handler(c, next)
  },
  async (c) => {
    const user = c.get('user-google')
    if (user && user.email) {
      const db = c.env.record_manager_db
      
      // Check if this is the first user
      const { count } = await db.prepare('SELECT count(*) as count FROM users').first<{ count: number }>() || { count: 0 }
      
      const role = count === 0 ? 'owner' : 'user'
      
      // Upsert user
      await db.prepare(`
        INSERT INTO users (email, role) 
        VALUES (?, ?) 
        ON CONFLICT(email) DO UPDATE SET email=email
      `).bind(user.email, role).run()

      setCookie(c, 'user', user.email, {
        path: '/',
        secure: true,
        httpOnly: true,
        maxAge: 60 * 60 * 24,
      })
      return c.redirect('/')
    }
    return c.text('Auth failed', 401)
  }
)

app.get('/logout', (c) => {
  deleteCookie(c, 'user')
  return c.redirect('/')
})

app.get('/domains', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/')
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const zones = await cf.listZones()
  
  const { results: syncedDomains } = await c.env.record_manager_db.prepare('SELECT zone_id FROM domains').all()
  const syncedIds = new Set(syncedDomains.map((d: any) => d.zone_id))

  return c.html(layout('Cloudflare Zones', `
    <h1>Cloudflare Zones</h1>
    <p>Select zones to sync with Record Manager.</p>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>ID</th>
          <th>Status</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${zones.map((z: any) => `
          <tr>
            <td>${z.name}</td>
            <td><code>${z.id}</code></td>
            <td>${syncedIds.has(z.id) ? '<span class="badge badge-user">Synced</span>' : '<em>Not Synced</em>'}</td>
            <td>
              ${user.role === 'owner' ? `
                ${syncedIds.has(z.id) 
                  ? `<form method="POST" action="/domains/unsync" style="display:inline;"><input type="hidden" name="id" value="${z.id}"><button type="submit" class="btn btn-danger">Unsync</button></form>`
                  : `<form method="POST" action="/domains/sync" style="display:inline;"><input type="hidden" name="id" value="${z.id}"><input type="hidden" name="name" value="${z.name}"><button type="submit" class="btn">Sync</button></form>`
                }
              ` : '-'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `, user))
})

app.post('/domains/sync', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  
  const { id, name } = await c.req.parseBody() as { id: string, name: string }
  await c.env.record_manager_db.prepare('INSERT INTO domains (zone_id, zone_name) VALUES (?, ?) ON CONFLICT(zone_id) DO NOTHING')
    .bind(id, name)
    .run()
  
  await logAudit(c.env.record_manager_db, user.email, 'SYNC', 'DOMAIN', name, { zone_id: id })
  
  return c.redirect('/domains')
})

app.post('/domains/unsync', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  
  const { id } = await c.req.parseBody() as { id: string }
  const domain = await c.env.record_manager_db.prepare('SELECT zone_name FROM domains WHERE zone_id = ?').bind(id).first<any>()
  
  await c.env.record_manager_db.prepare('DELETE FROM domains WHERE zone_id = ?').bind(id).run()
  
  if (domain) {
    await logAudit(c.env.record_manager_db, user.email, 'UNSYNC', 'DOMAIN', domain.zone_name, { zone_id: id })
  }
  
  return c.redirect('/domains')
})

app.get('/domains/:id', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  if (!user) return c.redirect('/')
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  if (!domain) return c.text('Domain not found', 404)
  
  const userLevel = await getPermissionLevel(c.env.record_manager_db, user, domainId)
  if (!can(userLevel, 'read')) return c.text('Forbidden', 403)
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const records = await cf.listRecords(domain.zone_id)
  
  return c.html(layout(`Manage ${domain.zone_name}`, `
    <h1>${domain.zone_name}</h1>
    <p>Manage DNS records for this domain.</p>
    
    ${can(userLevel, 'add') ? `
      <h3>Add New Record</h3>
      <form method="POST" action="/domains/${domainId}/records">
        <div style="display: grid; grid-template-columns: 100px 1fr 1fr 100px 100px; gap: 0.5rem; align-items: end;">
          <div>
            <label>Type</label>
            <select name="type">
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="TXT">TXT</option>
              <option value="MX">MX</option>
            </select>
          </div>
          <div>
            <label>Name</label>
            <input type="text" name="name" placeholder="example.com" required style="margin-bottom:0">
          </div>
          <div>
            <label>Content</label>
            <input type="text" name="content" placeholder="1.2.3.4" required style="margin-bottom:0">
          </div>
          <div>
            <label>TTL</label>
            <input type="text" name="ttl" value="1" placeholder="1" style="margin-bottom:0">
          </div>
          <button type="submit" class="btn" style="height: 38px;">Add</button>
        </div>
      </form>
      <hr style="margin: 2rem 0; border: 0; border-top: 1px solid #eee;">
    ` : ''}
    
    <h3>Current Records</h3>
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Name</th>
          <th>Content</th>
          <th>TTL</th>
          <th>Proxied</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${records.map((r: any) => `
          <tr>
            <td><span class="badge badge-user">${r.type}</span></td>
            <td>${r.name}</td>
            <td style="word-break: break-all;">${r.content}</td>
            <td>${r.ttl === 1 ? 'Auto' : r.ttl}</td>
            <td>${r.proxied ? '✅' : '❌'}</td>
            <td>
              ${can(userLevel, 'edit') ? `<a href="/domains/${domainId}/records/${r.id}/edit" class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Edit</a>` : ''}
              ${can(userLevel, 'delete') ? `
                <form method="POST" action="/domains/${domainId}/records/${r.id}/delete" style="display:inline;" onsubmit="return confirm('Are you sure?')">
                  <button type="submit" class="btn btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Delete</button>
                </form>
              ` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `, user))
})

app.post('/domains/:id/records', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  if (!user) return c.redirect('/')
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  if (!domain) return c.text('Domain not found', 404)
  
  const userLevel = await getPermissionLevel(c.env.record_manager_db, user, domainId)
  if (!can(userLevel, 'add')) return c.text('Forbidden', 403)
  
  const body = await c.req.parseBody() as any
  
  if (user.role !== 'owner' && await isBlacklisted(c.env.record_manager_db, body.name)) {
    return c.text('This record name is blacklisted.', 403)
  }
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const result = await cf.createRecord(domain.zone_id, {
    type: body.type,
    name: body.name,
    content: body.content,
    ttl: parseInt(body.ttl) || 1,
    proxied: body.proxied === 'on'
  })
  
  await logAudit(c.env.record_manager_db, user.email, 'CREATE', 'RECORD', body.name, { domain: domain.zone_name, type: body.type, content: body.content })
  
  return c.redirect(`/domains/${domainId}`)
})

app.get('/domains/:id/records/:recordId/edit', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const recordId = c.req.param('recordId')
  if (!user) return c.redirect('/')
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  const userLevel = await getPermissionLevel(c.env.record_manager_db, user, domainId)
  if (!can(userLevel, 'edit')) return c.text('Forbidden', 403)
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const records = await cf.listRecords(domain.zone_id)
  const record = records.find((r: any) => r.id === recordId)
  if (!record) return c.text('Record not found', 404)
  
  return c.html(layout(`Edit Record - ${domain.zone_name}`, `
    <h1>Edit Record</h1>
    <form method="POST" action="/domains/${domainId}/records/${recordId}">
      <label>Type</label>
      <select name="type">
        ${['A', 'AAAA', 'CNAME', 'TXT', 'MX'].map(t => `<option value="${t}" ${record.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      
      <label>Name</label>
      <input type="text" name="name" value="${record.name}" required>
      
      <label>Content</label>
      <input type="text" name="content" value="${record.content}" required>
      
      <label>TTL</label>
      <input type="text" name="ttl" value="${record.ttl}">
      
      <label><input type="checkbox" name="proxied" ${record.proxied ? 'checked' : ''}> Proxied</label>
      
      <div style="margin-top: 2rem;">
        <button type="submit" class="btn">Update Record</button>
        <a href="/domains/${domainId}" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
  `, user))
})

app.post('/domains/:id/records/:recordId', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const recordId = c.req.param('recordId')
  if (!user) return c.redirect('/')
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  const userLevel = await getPermissionLevel(c.env.record_manager_db, user, domainId)
  if (!can(userLevel, 'edit')) return c.text('Forbidden', 403)
  
  const body = await c.req.parseBody() as any
  
  if (user.role !== 'owner' && await isBlacklisted(c.env.record_manager_db, body.name)) {
    return c.text('This record name is blacklisted.', 403)
  }
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  await cf.updateRecord(domain.zone_id, recordId, {
    type: body.type,
    name: body.name,
    content: body.content,
    ttl: parseInt(body.ttl) || 1,
    proxied: body.proxied === 'on'
  })
  
  await logAudit(c.env.record_manager_db, user.email, 'UPDATE', 'RECORD', body.name, { domain: domain.zone_name, record_id: recordId })
  
  return c.redirect(`/domains/${domainId}`)
})

app.post('/domains/:id/records/:recordId/delete', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const recordId = c.req.param('recordId')
  if (!user) return c.redirect('/')
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  const userLevel = await getPermissionLevel(c.env.record_manager_db, user, domainId)
  if (!can(userLevel, 'delete')) return c.text('Forbidden', 403)
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  // Get record name for audit log before deleting
  const records = await cf.listRecords(domain.zone_id)
  const record = records.find((r: any) => r.id === recordId)
  
  await cf.deleteRecord(domain.zone_id, recordId)
  
  if (record) {
    await logAudit(c.env.record_manager_db, user.email, 'DELETE', 'RECORD', record.name, { domain: domain.zone_name, record_id: recordId })
  }
  
  return c.redirect(`/domains/${domainId}`)
})

app.get('/users', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.redirect('/')
  
  const { results: users } = await c.env.record_manager_db.prepare('SELECT * FROM users').all()
  const { results: domains } = await c.env.record_manager_db.prepare('SELECT * FROM domains').all()
  const { results: permissions } = await c.env.record_manager_db.prepare('SELECT * FROM permissions').all()

  return c.html(layout('User Management', `
    <h1>User Management</h1>
    
    <h3>Add User</h3>
    <form method="POST" action="/users">
      <div style="display: flex; gap: 1rem; align-items: end;">
        <div style="flex-grow: 1;">
          <label>Email</label>
          <input type="text" name="email" placeholder="user@example.com" required style="margin-bottom:0">
        </div>
        <div>
          <label>Role</label>
          <select name="role" style="margin-bottom:0; height: 38px;">
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" class="btn" style="height: 38px;">Add User</button>
      </div>
    </form>
    
    <hr style="margin: 2rem 0; border: 0; border-top: 1px solid #eee;">
    
    <h3>Users & Permissions</h3>
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Role</th>
          <th>Domain Permissions</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${users.map((u: any) => `
          <tr>
            <td>${u.email}</td>
            <td><span class="badge badge-${u.role}">${u.role}</span></td>
            <td>
              ${u.role === 'owner' ? '<em>Full Access</em>' : `
                <ul style="padding-left: 1.2rem; margin: 0;">
                  ${permissions.filter((p: any) => p.user_id === u.id).map((p: any) => {
                    const d = domains.find((dom: any) => dom.id === p.domain_id)
                    return `<li>${d?.zone_name}: <strong>${p.level}</strong></li>`
                  }).join('')}
                </ul>
                <form method="POST" action="/users/${u.id}/permissions" style="margin-top: 0.5rem; display: flex; gap: 0.2rem;">
                  <select name="domain_id" style="width: auto; padding: 0.2rem; margin:0; font-size: 0.8rem;">
                    ${domains.map((d: any) => `<option value="${d.id}">${d.zone_name}</option>`).join('')}
                  </select>
                  <select name="level" style="width: auto; padding: 0.2rem; margin:0; font-size: 0.8rem;">
                    <option value="read">Read</option>
                    <option value="add">Add</option>
                    <option value="edit">Edit</option>
                    <option value="delete">Delete</option>
                  </select>
                  <button type="submit" class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Set</button>
                </form>
              `}
            </td>
            <td>
              ${u.role !== 'owner' ? `
                <form method="POST" action="/users/${u.id}/delete" style="display:inline;" onsubmit="return confirm('Are you sure?')">
                  <button type="submit" class="btn btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Remove</button>
                </form>
              ` : '-'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `, user))
})

app.post('/users', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  const { email, role } = await c.req.parseBody() as { email: string, role: string }
  
  await c.env.record_manager_db.prepare('INSERT INTO users (email, role) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET role = ?')
    .bind(email, role, role)
    .run()
    
  return c.redirect('/users')
})

app.post('/users/:id/permissions', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  const userId = parseInt(c.req.param('id'))
  const { domain_id, level } = await c.req.parseBody() as { domain_id: string, level: string }
  
  await c.env.record_manager_db.prepare('INSERT INTO permissions (user_id, domain_id, level) VALUES (?, ?, ?) ON CONFLICT(user_id, domain_id) DO UPDATE SET level = ?')
    .bind(userId, parseInt(domain_id), level, level)
    .run()
    
  return c.redirect('/users')
})

app.post('/users/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  const userId = parseInt(c.req.param('id'))
  
  const target = await c.env.record_manager_db.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<any>()
  if (target?.role === 'owner') return c.text('Cannot delete owner', 403)
  
  await c.env.record_manager_db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return c.redirect('/users')
})

app.get('/logs', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'owner' && user.role !== 'admin')) return c.redirect('/')
  
  const { results: logs } = await c.env.record_manager_db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all()
  
  return c.html(layout('Audit Logs', `
    <h1>Audit Logs</h1>
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Action</th>
          <th>Type</th>
          <th>Resource</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${logs.map((l: any) => `
          <tr>
            <td>${l.user_email}</td>
            <td><strong>${l.action}</strong></td>
            <td>${l.resource_type}</td>
            <td>${l.resource_name}</td>
            <td style="font-size: 0.8rem;">${l.created_at}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `, user))
})

app.get('/blacklist', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.redirect('/')
  
  const { results: patterns } = await c.env.record_manager_db.prepare('SELECT * FROM blacklist').all()
  
  return c.html(layout('Blacklist Management', `
    <h1>Blacklist Management</h1>
    <p class="hint">Patterns can use * as wildcard (e.g. *.dev.example.com or private-*)</p>
    
    <form method="POST" action="/blacklist">
      <div style="display: flex; gap: 1rem; align-items: end;">
        <div style="flex-grow: 1;">
          <label>Pattern</label>
          <input type="text" name="pattern" placeholder="*.internal.com" required style="margin-bottom:0">
        </div>
        <button type="submit" class="btn" style="height: 38px;">Add Pattern</button>
      </div>
    </form>
    
    <h3>Current Patterns</h3>
    <table>
      <thead>
        <tr>
          <th>Pattern</th>
          <th>Created</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${patterns.map((p: any) => `
          <tr>
            <td><code>${p.pattern}</code></td>
            <td>${p.created_at}</td>
            <td>
              <form method="POST" action="/blacklist/${p.id}/delete" style="display:inline;">
                <button type="submit" class="btn btn-danger" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;">Remove</button>
              </form>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `, user))
})

app.post('/blacklist', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  const { pattern } = await c.req.parseBody() as { pattern: string }
  
  await c.env.record_manager_db.prepare('INSERT INTO blacklist (pattern) VALUES (?) ON CONFLICT(pattern) DO NOTHING')
    .bind(pattern)
    .run()
    
  return c.redirect('/blacklist')
})

app.post('/blacklist/:id/delete', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  const id = parseInt(c.req.param('id'))
  
  await c.env.record_manager_db.prepare('DELETE FROM blacklist WHERE id = ?').bind(id).run()
  return c.redirect('/blacklist')
})

app.get('/dashboard', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/')
  
  const { results: domains } = await c.env.record_manager_db.prepare('SELECT * FROM domains').all()
  
  return c.html(layout('Dashboard', `
    <h1>Dashboard</h1>
    <p>Logged in as: <strong>${user.email}</strong></p>
    
    <h3>Synced Domains</h3>
    ${domains.length === 0 ? '<p>No domains synced yet.</p>' : `
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Zone ID</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${domains.map((d: any) => `
            <tr>
              <td>${d.zone_name}</td>
              <td><code>${d.zone_id}</code></td>
              <td><a href="/domains/${d.id}" class="btn btn-secondary">Manage Records</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `}
    
    ${user.role === 'owner' ? '<div style="margin-top: 1rem;"><a href="/domains" class="btn">Sync New Domains</a></div>' : ''}
  `, user))
})

export default app
