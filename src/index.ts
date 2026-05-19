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
const layout = (title: string, content: string, user?: any) => {
  const sidebarItems = [
    { name: 'Dashboard', href: '/dashboard', icon: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />' },
    { name: 'Domains', href: '/domains', icon: '<path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />' },
    ...(user?.role === 'owner' || user?.role === 'admin' ? [{ name: 'Audit Logs', href: '/logs', icon: '<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />' }] : []),
    ...(user?.role === 'owner' ? [
      { name: 'User Management', href: '/users', icon: '<path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />' },
      { name: 'Blacklist', href: '/blacklist', icon: '<path d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />' },
      { name: 'Settings', href: '/setup', icon: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />' }
    ] : [])
  ]

  return `
<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-50">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Record Manager</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .sidebar-active { background-color: rgba(255, 255, 255, 0.1); border-left: 4px solid #6366f1; }
        .btn-primary { background-color: #6366f1; transition: all 0.2s; }
        .btn-primary:hover { background-color: #4f46e5; transform: translateY(-1px); }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .table-header { background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; }
        .badge { border-radius: 9999px; padding: 2px 10px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; }
        .badge-owner { background-color: #fef3c7; color: #92400e; }
        .badge-admin { background-color: #f3e8ff; color: #6b21a8; }
        .badge-user { background-color: #e0f2fe; color: #075985; }
        input[type="text"], input[type="password"], input[type="email"], select {
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            padding: 0.6rem 1rem;
            transition: all 0.2s;
        }
        input:focus, select:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
    </style>
</head>
<body class="h-full overflow-hidden">
    <div class="flex h-full">
        ${user ? `
        <!-- Sidebar -->
        <div class="hidden md:flex md:flex-shrink-0">
            <div class="flex flex-col w-64 bg-slate-900">
                <div class="flex items-center h-16 px-4 bg-slate-900 border-b border-slate-800">
                    <span class="text-white text-xl font-bold tracking-tight">Record Manager <span class="text-indigo-500">v2</span></span>
                </div>
                <div class="flex-1 flex flex-col overflow-y-auto pt-5 pb-4">
                    <nav class="flex-1 px-2 space-y-1">
                        ${sidebarItems.map(item => `
                            <a href="${item.href}" class="group flex items-center px-3 py-2 text-sm font-medium rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors">
                                <svg class="mr-3 h-5 w-5 text-slate-400 group-hover:text-slate-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    ${item.icon}
                                </svg>
                                ${item.name}
                            </a>
                        `).join('')}
                    </nav>
                </div>
                <div class="flex-shrink-0 flex bg-slate-800 p-4">
                    <div class="flex-shrink-0 w-full group block">
                        <div class="flex items-center">
                            <div class="ml-3 w-full">
                                <p class="text-xs font-medium text-slate-400 truncate">${user.email}</p>
                                <div class="flex justify-between items-center mt-1">
                                    <span class="badge badge-${user.role}">${user.role}</span>
                                    <a href="/logout" class="text-xs text-slate-400 hover:text-white font-medium">Logout</a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        ` : ''}

        <!-- Main content -->
        <div class="flex flex-col w-0 flex-1 overflow-hidden">
            <main class="flex-1 relative z-0 overflow-y-auto focus:outline-none py-6">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 md:px-8">
                    <h1 class="text-2xl font-semibold text-slate-900">${title}</h1>
                </div>
                <div class="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-4">
                    <div class="card p-6 min-h-[400px]">
                        ${content}
                    </div>
                </div>
            </main>
        </div>
    </div>
</body>
</html>
`
}

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
    return c.redirect('/dashboard')
  }
  return c.html(layout('Welcome', `
    <div class="text-center py-20 px-4">
      <div class="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-200 mb-8 transform -rotate-6">
        <svg class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      </div>
      <h1 class="text-5xl font-extrabold text-slate-900 tracking-tight mb-4">Record Manager <span class="text-indigo-600">v2</span></h1>
      <p class="text-xl text-slate-600 mb-10 max-w-2xl mx-auto">The professional DNS management layer for Cloudflare. Automated discovery, team permissions, and real-time audit logs.</p>
      
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/auth/google" class="btn-primary text-white px-8 py-4 rounded-xl font-bold text-lg flex items-center justify-center shadow-lg shadow-indigo-100">
          <svg class="h-5 w-5 mr-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335"/>
          </svg>
          Login with Google
        </a>
      </div>
      
      <div class="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8 text-left max-w-5xl mx-auto">
        <div class="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm">
          <div class="h-12 w-12 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mb-4">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </div>
          <h3 class="font-bold text-slate-900 mb-2">Instant Sync</h3>
          <p class="text-slate-500 text-sm">Automatically fetches every zone from your Cloudflare account with zero manual configuration.</p>
        </div>
        <div class="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm">
          <div class="h-12 w-12 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mb-4">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <h3 class="font-bold text-slate-900 mb-2">Team Access</h3>
          <p class="text-slate-500 text-sm">Granular permission system to allow team members to manage specific domains safely.</p>
        </div>
        <div class="p-6 bg-white rounded-2xl border border-slate-100 shadow-sm">
          <div class="h-12 w-12 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mb-4">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <h3 class="font-bold text-slate-900 mb-2">Audit Trails</h3>
          <p class="text-slate-500 text-sm">Every change is tracked. See who changed what record and when with detailed audit logs.</p>
        </div>
      </div>
    </div>
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
  
  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/auth/google`

  return c.html(layout('System Settings', `
    <div class="max-w-4xl mx-auto">
      <div class="mb-10">
        <h2 class="text-xl font-bold text-slate-900 mb-2">Configuration v1.2</h2>
        <p class="text-slate-500 text-sm">Follow these steps to connect your Cloudflare account and enable secure authentication.</p>
      </div>
      
      <form id="setup-form" method="POST" action="/setup" class="space-y-12">
        <!-- Cloudflare Section -->
        <section class="border-l-4 border-indigo-500 pl-6">
          <h3 class="text-lg font-bold text-slate-900 mb-4 flex items-center">
            <span class="h-6 w-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs mr-2">1</span>
            Cloudflare Connection
          </h3>
          
          <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 mb-6">
            <h4 class="font-bold text-indigo-900 mb-2 text-sm">Step A: Create your API Token</h4>
            <p class="text-indigo-700 text-sm mb-4">Click the button below to go to Cloudflare. All required permissions (Zone:Read, DNS:Edit) are pre-selected for you.</p>
            <a href="${cfTokenUrl}" target="_blank" class="btn-primary text-white px-6 py-2 rounded-lg font-medium inline-block shadow-md">Create Token on Cloudflare &rarr;</a>
          </div>
          
          <div class="bg-white border border-slate-200 rounded-2xl p-6">
            <label class="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Step B: Paste your Token</label>
            <input type="password" id="cf-token" name="CF_API_TOKEN" value="${settings.CF_API_TOKEN || ''}" 
                   placeholder="Paste your z6-... token here" required 
                   class="w-full text-lg"
                   oninput="if(this.value.length > 20) { setTimeout(() => { document.getElementById('setup-form').submit(); }, 100); }">
            <p class="mt-2 text-[11px] text-slate-400 italic">(Form saves automatically on paste)</p>
          </div>
        </section>

        <!-- Google OAuth Section -->
        <section class="border-l-4 border-orange-500 pl-6">
          <h3 class="text-lg font-bold text-slate-900 mb-4 flex items-center">
            <span class="h-6 w-6 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-xs mr-2">2</span>
            Google OAuth Authentication
          </h3>
          
          <div class="grid grid-cols-1 gap-6">
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-6">
              <label class="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Administrator Email</label>
              <p class="text-[11px] text-slate-400 mb-3">The Google account that will have full "Owner" access.</p>
              <input type="email" name="ADMIN_EMAIL" value="${settings.ADMIN_EMAIL || ''}" placeholder="admin@example.com" required class="w-full">
            </div>

            <div class="bg-orange-50 border border-orange-100 rounded-2xl p-6">
              <h4 class="font-bold text-orange-900 mb-2 text-sm">Step A: Configure Redirect URI</h4>
              <p class="text-orange-700 text-sm mb-4">Copy this URL and add it to <strong>"Authorized redirect URIs"</strong> in your Google Cloud Console.</p>
              <code class="block bg-white p-3 rounded-lg border border-orange-200 text-xs text-orange-800 font-mono break-all">${redirectUri}</code>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="bg-white border border-slate-200 rounded-2xl p-6">
                <label class="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Step B: Client ID</label>
                <input type="text" name="GOOGLE_CLIENT_ID" value="${settings.GOOGLE_CLIENT_ID || ''}" placeholder="...apps.googleusercontent.com" required class="w-full text-sm">
              </div>
              <div class="bg-white border border-slate-200 rounded-2xl p-6">
                <label class="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">Step C: Client Secret</label>
                <input type="password" name="GOOGLE_CLIENT_SECRET" value="${settings.GOOGLE_CLIENT_SECRET || ''}" required class="w-full text-sm">
              </div>
            </div>
          </div>
        </section>

        <div class="pt-10 flex justify-end">
          <button type="submit" class="btn-primary text-white px-10 py-4 rounded-xl font-bold text-lg shadow-xl shadow-indigo-100 transform transition hover:scale-105 active:scale-95">
            Save & Finalize Setup
          </button>
        </div>
      </form>
    </div>
  `, user))
})


app.post('/setup', async (c) => {
  const user = c.get('user')
  if (user && user.role !== 'owner') return c.text('Forbidden', 403)
  const body = await c.req.parseBody()
  const db = c.env.record_manager_db

  const keys = ['CF_API_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ADMIN_EMAIL']
  for (const key of keys) {
    if (body[key]) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .bind(key, body[key])
        .run()
    }
  }

  // If Admin email is provided, ensure they exist with owner role
  if (body.ADMIN_EMAIL) {
    await db.prepare(`
      INSERT INTO users (email, role) 
      VALUES (?, 'owner') 
      ON CONFLICT(email) DO UPDATE SET role = 'owner'
    `).bind(body.ADMIN_EMAIL).run()
  }

  return c.redirect('/')
})

app.get(
  '/auth/google',
  async (c, next) => {
    const settings = await getSettings(c.env.record_manager_db)
    if (!settings.GOOGLE_CLIENT_ID || !settings.GOOGLE_CLIENT_SECRET) {
      console.error('Missing Google OAuth credentials')
      return c.redirect('/setup')
    }
    
    // Explicitly set redirect_uri to the current URL without query params
    const url = new URL(c.req.url)
    const redirectUri = `${url.protocol}//${url.host}${url.pathname}`
    
    const handler = googleAuth({
      client_id: settings.GOOGLE_CLIENT_ID,
      client_secret: settings.GOOGLE_CLIENT_SECRET,
      scope: ['email', 'profile'],
      redirect_uri: redirectUri
    })
    return handler(c, next)
  },
  async (c) => {
    const user = c.get('user-google')
    if (user && user.email) {
      const db = c.env.record_manager_db
      const settings = await getSettings(db)
      
      // Check if this user is the designated admin
      const isConfiguredAdmin = settings.ADMIN_EMAIL && user.email.toLowerCase() === settings.ADMIN_EMAIL.toLowerCase()
      
      // If not the admin, check if they are already in the database
      const existingUser = await db.prepare('SELECT role FROM users WHERE email = ?').bind(user.email).first<any>()
      
      if (!isConfiguredAdmin && !existingUser) {
        return c.html(layout('Access Denied', `
          <h1>Access Denied</h1>
          <p>Your email (<strong>${user.email}</strong>) is not authorized to access this system.</p>
          <p>Please contact the administrator to be invited.</p>
          <a href="/" class="btn">Back to Home</a>
        `))
      }

      const role = isConfiguredAdmin ? 'owner' : existingUser.role
      
      // Upsert user to ensure they exist and have correct role if admin
      await db.prepare(`
        INSERT INTO users (email, role) 
        VALUES (?, ?) 
        ON CONFLICT(email) DO UPDATE SET email=email, role=role
      `).bind(user.email, role).run()

      setCookie(c, 'user', user.email, {
        path: '/',
        secure: true,
        httpOnly: true,
        maxAge: 60 * 60 * 24,
      })
      return c.redirect('/')
    }
    console.error('Google Auth callback reached but no user data found')
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
    <div class="mb-6">
      <h2 class="text-lg font-bold text-slate-900 mb-1">Account Zones</h2>
      <p class="text-sm text-slate-500">Enable or disable domain management for this instance.</p>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Zone Name</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">ID</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Management</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-slate-100">
          ${zones.map((z: any) => `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">${z.name}</td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-400 font-mono">${z.id}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${z.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}">
                  ${z.status}
                </span>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                ${user.role === 'owner' ? `
                  ${syncedIds.has(z.id) 
                    ? `<form method="POST" action="/domains/unsync" style="display:inline;"><input type="hidden" name="id" value="${z.id}"><button type="submit" class="text-red-600 hover:text-red-900 font-bold">Disable Sync</button></form>`
                    : `<form method="POST" action="/domains/sync" style="display:inline;"><input type="hidden" name="id" value="${z.id}"><input type="hidden" name="name" value="${z.name}"><button type="submit" class="text-indigo-600 hover:text-indigo-900 font-bold">Enable Sync</button></form>`
                  }
                ` : '<span class="text-slate-400 italic text-xs">Owner Only</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
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
  
  const getTypeColor = (type: string) => {
    const colors: any = {
      'A': 'bg-blue-100 text-blue-800',
      'AAAA': 'bg-indigo-100 text-indigo-800',
      'CNAME': 'bg-purple-100 text-purple-800',
      'TXT': 'bg-slate-100 text-slate-800',
      'MX': 'bg-amber-100 text-amber-800'
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  return c.html(layout(`Manage ${domain.zone_name}`, `
    <div class="flex justify-between items-center mb-8 pb-4 border-b border-slate-100">
      <div>
        <h2 class="text-xl font-bold text-slate-900">${domain.zone_name}</h2>
        <p class="text-sm text-slate-500">Manage DNS records for this domain</p>
      </div>
      <div class="flex gap-2">
        <button onclick="document.getElementById('add-record-panel').classList.toggle('hidden')" class="btn-primary text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center">
          <svg class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          Add Record
        </button>
      </div>
    </div>
    
    <!-- Add Record Panel -->
    <div id="add-record-panel" class="hidden mb-8 bg-slate-50 border border-slate-200 rounded-xl p-6">
      <h3 class="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Create New DNS Record</h3>
      <form method="POST" action="/domains/${domainId}/records">
        <div class="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
          <div class="md:col-span-1">
            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Type</label>
            <select name="type" class="w-full">
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="TXT">TXT</option>
              <option value="MX">MX</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Name</label>
            <input type="text" name="name" placeholder="example.com" required class="w-full">
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Content</label>
            <input type="text" name="content" placeholder="1.2.3.4" required class="w-full">
          </div>
          <div class="md:col-span-1 flex flex-col items-center">
             <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Proxied</label>
             <input type="checkbox" name="proxied" class="h-4 w-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500">
          </div>
          <div class="md:col-span-5">
             <input type="hidden" name="ttl" value="1">
          </div>
          <div class="md:col-span-1">
            <button type="submit" class="w-full btn-primary text-white py-2 rounded-lg font-medium text-sm">Create</button>
          </div>
        </div>
      </form>
    </div>

    <div class="mb-6 flex justify-between items-center">
      <div class="relative w-full max-w-sm">
        <input type="text" id="record-search" placeholder="Filter records..." class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" onkeyup="filterRecords()">
        <svg class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <div class="text-xs text-slate-400">Showing ${records.length} records</div>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Type</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Content</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">TTL</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Proxy</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody id="record-table-body" class="bg-white divide-y divide-slate-100">
          ${records.map((r: any) => `
            <tr class="record-row hover:bg-slate-50 transition-colors" data-search="${r.type} ${r.name} ${r.content}">
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="badge ${getTypeColor(r.type)}">${r.type}</span>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900">${r.name}</td>
              <td class="px-4 py-4 text-sm text-slate-500 font-mono break-all max-w-xs">${r.content}</td>
              <td class="px-4 py-4 whitespace-nowrap text-sm text-slate-500">${r.ttl === 1 ? 'Auto' : r.ttl}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                ${r.proxied ? `
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                    <svg class="h-2 w-2 mr-1 text-orange-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg> Proxied
                  </span>
                ` : `
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                    <svg class="h-2 w-2 mr-1 text-slate-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg> DNS Only
                  </span>
                `}
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div class="flex justify-end gap-2">
                  ${can(userLevel, 'edit') ? `<a href="/domains/${domainId}/records/${r.id}/edit" class="text-indigo-600 hover:text-indigo-900 p-1 rounded-md hover:bg-indigo-50" title="Edit"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></a>` : ''}
                  ${can(userLevel, 'delete') ? `
                    <form method="POST" action="/domains/${domainId}/records/${r.id}/delete" style="display:inline;" onsubmit="return confirm('Are you sure?')">
                      <button type="submit" class="text-red-600 hover:text-red-900 p-1 rounded-md hover:bg-red-50" title="Delete">
                        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </form>
                  ` : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    <script>
      function filterRecords() {
        const query = document.getElementById('record-search').value.toLowerCase();
        const rows = document.querySelectorAll('.record-row');
        rows.forEach(row => {
          const content = row.getAttribute('data-search').toLowerCase();
          row.style.display = content.includes(query) ? '' : 'none';
        });
      }
    </script>
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
    <div class="mb-8">
      <h3 class="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Invite Team Member</h3>
      <form method="POST" action="/users" class="bg-slate-50 border border-slate-200 rounded-xl p-6">
        <div class="flex flex-col md:flex-row gap-4 items-end">
          <div class="flex-1 w-full">
            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Email Address</label>
            <input type="email" name="email" placeholder="user@example.com" required class="w-full">
          </div>
          <div class="w-full md:w-48">
            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Role</label>
            <select name="role" class="w-full">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" class="w-full md:w-auto btn-primary text-white px-6 py-2 rounded-lg font-medium">Add User</button>
        </div>
      </form>
    </div>
    
    <div class="overflow-x-auto mt-10">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Permissions</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-slate-100">
          ${users.map((u: any) => `
            <tr>
              <td class="px-4 py-4 whitespace-nowrap text-sm font-medium text-slate-900">${u.email}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="badge badge-${u.role}">${u.role}</span>
              </td>
              <td class="px-4 py-4 text-sm text-slate-500">
                ${u.role === 'owner' ? '<span class="text-slate-400 italic">Full System Access</span>' : `
                  <div class="space-y-2">
                    <ul class="list-disc pl-4 space-y-1">
                      ${permissions.filter((p: any) => p.user_id === u.id).map((p: any) => {
                        const d = domains.find((dom: any) => dom.id === p.domain_id)
                        return `<li>${d?.zone_name}: <strong>${p.level}</strong></li>`
                      }).join('')}
                    </ul>
                    <form method="POST" action="/users/${u.id}/permissions" class="flex gap-1 mt-2">
                      <select name="domain_id" class="text-xs py-1 px-2 border-slate-200">
                        ${domains.map((d: any) => `<option value="${d.id}">${d.zone_name}</option>`).join('')}
                      </select>
                      <select name="level" class="text-xs py-1 px-2 border-slate-200">
                        <option value="read">Read</option>
                        <option value="add">Add</option>
                        <option value="edit">Edit</option>
                        <option value="delete">Delete</option>
                      </select>
                      <button type="submit" class="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-bold hover:bg-slate-200">Set</button>
                    </form>
                  </div>
                `}
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                ${u.role !== 'owner' ? `
                  <form method="POST" action="/users/${u.id}/delete" style="display:inline;" onsubmit="return confirm('Are you sure?')">
                    <button type="submit" class="text-red-600 hover:text-red-900 font-bold">Remove</button>
                  </form>
                ` : '-'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
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
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Action</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Resource</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Time</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-slate-100">
          ${logs.map((l: any) => `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-sm text-slate-600">${l.user_email}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold bg-indigo-50 text-indigo-700 uppercase">${l.action}</span>
              </td>
              <td class="px-4 py-4 whitespace-nowrap">
                <div class="text-sm font-medium text-slate-900">${l.resource_name}</div>
                <div class="text-xs text-slate-400">${l.resource_type}</div>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-sm text-slate-500">${l.created_at}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `, user))
})

app.get('/blacklist', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.redirect('/')
  
  const { results: patterns } = await c.env.record_manager_db.prepare('SELECT * FROM blacklist').all()
  
  return c.html(layout('Blacklist Management', `
    <div class="mb-8">
      <h3 class="text-sm font-semibold text-slate-900 mb-4 uppercase tracking-wider">Add Protection Pattern</h3>
      <p class="text-sm text-slate-500 mb-4 text-sm">Records matching these patterns can only be modified by the System Owner.</p>
      <form method="POST" action="/blacklist" class="bg-slate-50 border border-slate-200 rounded-xl p-6">
        <div class="flex flex-col md:flex-row gap-4 items-end">
          <div class="flex-1 w-full">
            <label class="block text-xs font-bold text-slate-500 mb-1 uppercase">Pattern (e.g. *.internal.com)</label>
            <input type="text" name="pattern" placeholder="*.dev.example.com" required class="w-full">
          </div>
          <button type="submit" class="w-full md:w-auto btn-primary text-white px-6 py-2 rounded-lg font-medium">Add Pattern</button>
        </div>
      </form>
    </div>
    
    <div class="overflow-x-auto mt-10">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Pattern</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Created</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-slate-100">
          ${patterns.map((p: any) => `
            <tr>
              <td class="px-4 py-4 whitespace-nowrap font-mono text-sm text-slate-900">${p.pattern}</td>
              <td class="px-4 py-4 whitespace-nowrap text-sm text-slate-500">${p.created_at}</td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                <form method="POST" action="/blacklist/${p.id}/delete" style="display:inline;">
                  <button type="submit" class="text-red-600 hover:text-red-900 font-bold">Remove</button>
                </form>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
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
  
  const settings = c.get('settings')
  const cf = new CloudflareClient(settings.CF_API_TOKEN)
  
  try {
    const allZones = await cf.listZones()
    const { results: syncedDomains } = await c.env.record_manager_db.prepare('SELECT * FROM domains').all()
    const syncedMap = new Map(syncedDomains.map((d: any) => [d.zone_id, d]))

    // For non-owners, only show domains they have permissions for
    let displayZones = allZones
    if (user.role !== 'owner' && user.role !== 'admin') {
      const { results: permissions } = await c.env.record_manager_db.prepare('SELECT domain_id FROM permissions WHERE user_id = ?').bind(user.id).all()
      const allowedDomainIds = new Set(permissions.map((p: any) => p.domain_id))
      displayZones = allZones.filter((z: any) => {
        const synced = syncedMap.get(z.id) as any
        return synced && allowedDomainIds.has(synced.id)
      })
    }

    return c.html(layout('Dashboard', `
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 class="text-sm font-medium text-slate-500 uppercase tracking-wider">Overview</h2>
          <p class="text-slate-600">You have access to ${displayZones.length} domains.</p>
        </div>
        <div class="relative w-64">
          <input type="text" id="domain-search" placeholder="Search domains..." class="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500" onkeyup="filterDomains()">
          <svg class="absolute left-3 top-2.5 h-4 w-4 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      <div id="domain-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${displayZones.map((z: any) => {
          const synced = syncedMap.get(z.id) as any
          const statusColor = z.status === 'active' ? 'text-green-500' : 'text-amber-500'
          return `
            <div class="domain-card group relative bg-white border border-slate-200 rounded-xl p-5 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer" onclick="location.href='${synced ? `/domains/${synced.id}` : '#'}'" data-name="${z.name}">
              <div class="flex justify-between items-start mb-4">
                <div class="h-10 w-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  <svg class="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                  </svg>
                </div>
                <div class="flex flex-col items-end">
                  <span class="text-[10px] font-bold uppercase tracking-widest ${statusColor}">${z.status}</span>
                  ${synced ? '<span class="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mt-1">Synced</span>' : '<span class="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Not Synced</span>'}
                </div>
              </div>
              <h3 class="text-lg font-semibold text-slate-900 mb-1 truncate" title="${z.name}">${z.name}</h3>
              <p class="text-xs text-slate-400 font-mono mb-4 truncate">${z.id}</p>
              
              <div class="flex items-center justify-between pt-4 border-t border-slate-50">
                ${synced ? `
                  <a href="/domains/${synced.id}" class="text-sm font-medium text-indigo-600 hover:text-indigo-800">Manage Records &rarr;</a>
                ` : `
                  ${user.role === 'owner' ? `
                    <form method="POST" action="/domains/sync" style="margin:0">
                      <input type="hidden" name="id" value="${z.id}">
                      <input type="hidden" name="name" value="${z.name}">
                      <button type="submit" class="text-sm font-medium text-slate-500 hover:text-indigo-600">Enable Sync</button>
                    </form>
                  ` : '<span class="text-sm text-slate-400 italic">Access Restricted</span>'}
                `}
              </div>
            </div>
          `
        }).join('')}
      </div>

      <script>
        function filterDomains() {
          const query = document.getElementById('domain-search').value.toLowerCase();
          const cards = document.querySelectorAll('.domain-card');
          cards.forEach(card => {
            const name = card.getAttribute('data-name').toLowerCase();
            card.style.display = name.includes(query) ? '' : 'none';
          });
        }
      </script>
    `, user))
  } catch (e: any) {
    return c.html(layout('Error', `
      <div class="text-center py-12">
        <div class="inline-flex items-center justify-center h-16 w-16 rounded-full bg-red-100 text-red-600 mb-4">
          <svg class="h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 class="text-2xl font-bold text-slate-900 mb-2">Cloudflare Connection Error</h2>
        <p class="text-slate-600 mb-6">We couldn't reach Cloudflare with the provided API token. Please check your settings.</p>
        <a href="/setup" class="btn-primary text-white px-6 py-3 rounded-lg font-medium inline-block">Update Settings</a>
      </div>
    `, user))
  }
})


export default app
