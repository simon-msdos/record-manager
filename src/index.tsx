import { Hono } from 'hono'
import { getSignedCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'
import { h, Fragment } from 'hono/jsx'
import { CloudflareClient } from './cloudflare'
import { getSettings, ensureSystemSecret } from './lib/db'
import { getFlash, FlashMessage } from './lib/session'
import { layout } from './templates/layout'
import { Card, Button } from './templates/components'

// Routes
import auth from './routes/auth'
import setup from './routes/setup'
import domains from './routes/domains'
import users, { blacklist } from './routes/users'
import logs from './routes/logs'

type Bindings = {
  record_manager_db: D1Database
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  COOKIE_SECRET?: string
}

type Variables = {
  settings: any
  user: any
  systemSecret: string
  flash: FlashMessage | null
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// Global Middleware
app.use('*', secureHeaders())
app.use('*', csrf())
app.use('*', async (c, next) => {
  const url = new URL(c.req.url)
  if (url.pathname.startsWith('/static')) {
    return next()
  }

  const systemSecret = c.env.COOKIE_SECRET || await ensureSystemSecret(c.env.record_manager_db)
  c.set('systemSecret', systemSecret)

  const settings = await getSettings(c.env.record_manager_db)
  c.set('settings', settings)

  const userEmail = await getSignedCookie(c, systemSecret, 'user')
  if (userEmail) {
    const user = await c.env.record_manager_db.prepare('SELECT * FROM users WHERE email = ?').bind(userEmail).first<any>()
    c.set('user', user)
  }

  const flash = await getFlash(c)
  c.set('flash', flash)

  if (url.pathname === '/setup' || url.pathname.startsWith('/auth')) {
    return next()
  }

  if (!settings.GOOGLE_CLIENT_ID || !settings.GOOGLE_CLIENT_SECRET || !settings.CF_API_TOKEN) {
    return c.redirect('/setup')
  }

  await next()
})

// Root Route (Welcome or Redirect to Dashboard)
app.get('/', (c) => {
  const user = c.get('user')
  const flash = c.get('flash')
  if (user) {
    return c.redirect('/dashboard')
  }
  return c.html(layout('Welcome', (
    <div class="w-full max-w-md mx-auto py-12">
      <div class="bg-white border border-slate-200 rounded-xl p-8 shadow-sm">
        <div class="flex items-center gap-3 mb-8">
          <div class="h-9 w-9 rounded bg-slate-900 flex items-center justify-center text-white font-bold text-sm">
            R
          </div>
          <div>
            <h2 class="text-sm font-bold text-slate-900 tracking-tight">Record Manager</h2>
            <p class="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Cloudflare DNS Console</p>
          </div>
        </div>

        <h3 class="text-xl font-semibold text-slate-900 tracking-tight mb-2">Sign in to your account</h3>
        <p class="text-sm text-slate-600 mb-8">
          Manage domains, sync DNS zones, delegate fine-grained permission layers, and maintain audit trails.
        </p>

        <a href="/auth/google" class="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium px-5 py-3 rounded-lg shadow-sm transition-all duration-150 text-sm">
          <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </a>
      </div>

      <div class="mt-8 space-y-4 text-xs text-slate-500 border-t border-slate-200/60 pt-6 px-1">
        <div class="flex gap-3">
          <div class="h-5 w-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold shrink-0 text-[10px]">✓</div>
          <div>
            <p class="font-semibold text-slate-800">Direct Cloudflare Sync</p>
            <p class="text-slate-500 mt-0.5">Integrates with official Cloudflare Edge endpoints to pull and push updates dynamically.</p>
          </div>
        </div>
        <div class="flex gap-3">
          <div class="h-5 w-5 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold shrink-0 text-[10px]">✓</div>
          <div>
            <p class="font-semibold text-slate-800">Secure Access Controls</p>
            <p class="text-slate-500 mt-0.5">Define granular team permissions for records without exposing primary API tokens.</p>
          </div>
        </div>
      </div>
    </div>
  ), user, flash))
})

// Dashboard (Main Overview)
app.get('/dashboard', async (c) => {
  const user = c.get('user')
  const flash = c.get('flash')
  if (!user) return c.redirect('/')
  
  const settings = c.get('settings')
  const cf = new CloudflareClient(settings.CF_API_TOKEN)
  
  try {
    const allZones = await cf.listZones()
    const { results: syncedDomains } = await c.env.record_manager_db.prepare('SELECT * FROM domains').all()
    const syncedMap = new Map(syncedDomains.map((d: any) => [d.zone_id, d]))

    let displayZones = allZones
    if (user.role !== 'owner' && user.role !== 'admin') {
      const { results: permissions } = await c.env.record_manager_db.prepare('SELECT domain_id FROM permissions WHERE user_id = ?').bind(user.id).all()
      const { results: recordPermissions } = await c.env.record_manager_db.prepare('SELECT domain_id FROM record_permissions WHERE user_id = ?').bind(user.id).all()
      const allowedDomainIds = new Set([
        ...permissions.map((p: any) => p.domain_id),
        ...recordPermissions.map((rp: any) => rp.domain_id)
      ])
      displayZones = allZones.filter((z: any) => {
        const synced = syncedMap.get(z.id) as any
        return synced && allowedDomainIds.has(synced.id)
      })
    }

    return c.html(layout('Dashboard', (
      <Fragment>
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-5 border-b border-brand-border/30">
        <div>
          <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Overview</h2>
          <p class="text-slate-400 text-sm">Authenticated clearance: <span class="text-brand-primary font-bold uppercase font-mono text-xs px-2 py-0.5 rounded bg-brand-primary/10 border border-brand-primary/25">{user.role}</span>. Scanned {displayZones.length} domains.</p>
        </div>
        <div class="relative w-full md:w-64">
          <input type="text" id="domain-search" placeholder="Search domains..." class="w-full pl-10 pr-4 py-2.5 bg-brand-deep/30 border border-brand-border/20 rounded-lg text-sm text-white placeholder-slate-500 focus:border-brand-primary focus:ring-brand-primary font-mono" onkeyup="filterDomains()" />
          <svg class="absolute left-3 top-3.5 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {displayZones.length === 0 ? (
        <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-8 text-center">
          <div class="inline-flex items-center justify-center h-16 w-16 rounded-full bg-amber-500/10 text-amber-400 mb-4 border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]">
            <svg class="h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="text-xl font-bold text-white font-display mb-2">No Registered Domains</h3>
          <p class="text-slate-400 mb-6 max-w-md mx-auto leading-relaxed text-sm">Cloudflare returned 0 active zones for your API token. Verify your configuration scopes or token status.</p>
          <a href="/setup" class="btn-primary text-white text-xs px-6 py-3 rounded-lg font-bold inline-block shadow-md">Update Configuration</a>
        </div>
      ) : (
        <div id="domain-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {displayZones.map((z: any) => {
            const synced = syncedMap.get(z.id) as any
            const statusColor = z.status === 'active' ? 'text-green-400' : 'text-amber-400'
            const statusBg = z.status === 'active' ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'
            return (
              <div class="domain-card group relative bg-brand-dark/40 border border-brand-border/40 rounded-2xl p-5 hover:border-brand-primary/50 transition-all cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]" onclick={`location.href='${synced ? `/domains/${synced.id}` : '#'}'`} data-name={z.name}>
                <div class="flex justify-between items-start mb-4">
                  <div class="h-10 w-10 bg-brand-primary/10 rounded-lg flex items-center justify-center text-brand-primary group-hover:bg-brand-primary group-hover:text-white transition-colors duration-300">
                    <svg class="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </div>
                  <div class="flex flex-col items-end gap-1.5">
                    <span class={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${statusBg} ${statusColor}`}>{z.status}</span>
                    {synced 
                      ? <span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-brand-primary/10 border border-brand-primary/20 text-brand-primary">Synced</span> 
                      : <span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-500/10 border border-slate-500/25 text-slate-500">Unregistered</span>}
                  </div>
                </div>
                <h3 class="text-base font-bold text-white font-display mb-1 truncate" title={z.name}>{z.name}</h3>
                <p class="text-[11px] text-slate-500 font-mono mb-4 truncate">{z.id}</p>
                <div class="flex items-center justify-between pt-4 border-t border-brand-border/20">
                  {synced ? (
                    <a href={`/domains/${synced.id}`} class="text-xs font-bold text-brand-primary hover:text-brand-primary/80 transition font-display">Manage DNS Gateways &rarr;</a>
                  ) : (
                    user.role === 'owner' ? (
                      <form method="POST" action="/domains/sync" style="margin:0" onclick="event.stopPropagation()">
                        <input type="hidden" name="id" value={z.id} />
                        <input type="hidden" name="name" value={z.name} />
                        <button type="submit" class="text-xs font-bold text-slate-400 hover:text-brand-primary transition">Register for Management</button>
                      </form>
                    ) : <span class="text-xs text-slate-500 font-mono italic">Access Restricted</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <script dangerouslySetInnerHTML={{ __html: `
        function filterDomains() {
          const query = document.getElementById('domain-search').value.toLowerCase();
          const cards = document.querySelectorAll('.domain-card');
          cards.forEach(card => {
            const name = card.getAttribute('data-name').toLowerCase();
            card.style.display = name.includes(query) ? '' : 'none';
          });
        }
      `}} />
      </Fragment>
    ), user, flash))
  } catch (e: any) {
    return c.html(layout('Error', (
      <div class="text-center py-12">
        <div class="inline-flex items-center justify-center h-16 w-16 rounded-full bg-red-500/10 text-red-400 mb-4 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
          <svg class="h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 class="text-xl font-bold text-white font-display mb-2">Cloudflare Connection Timeout</h2>
        <p class="text-slate-400 mb-6 max-w-md mx-auto text-sm leading-relaxed">Could not establish contact with Cloudflare API endpoint using secure keys. Check API token validation settings.</p>
        <a href="/setup" class="btn-primary text-white text-xs px-6 py-3 rounded-lg font-bold inline-block shadow-md">Update Credentials</a>
      </div>
    ), user, flash))
  }
})

// Mount Routes
app.route('/auth', auth)
app.route('/setup', setup)
app.route('/domains', domains)
app.route('/users', users)
app.route('/blacklist', blacklist)
app.route('/logs', logs)

export default app
