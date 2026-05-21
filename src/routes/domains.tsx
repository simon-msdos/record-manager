import { Hono } from 'hono'
import { h, Fragment } from 'hono/jsx'
import { layout } from '../templates/layout'
import { CloudflareClient } from '../cloudflare'
import { getSettings, logAudit, isBlacklisted } from '../lib/db'
import { getPermissionLevel, can } from '../lib/auth'
import { setFlash } from '../lib/session'
import { Badge, Button, Card } from '../templates/components'

type Bindings = {
  record_manager_db: D1Database
}

type Variables = {
  settings: any
  user: any
  systemSecret: string
  flash: any
}

const domains = new Hono<{ Bindings: Bindings; Variables: Variables }>()

domains.get('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/')
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const zones = await cf.listZones()
  
  const { results: syncedDomains } = await c.env.record_manager_db.prepare('SELECT zone_id FROM domains').all()
  const syncedIds = new Set(syncedDomains.map((d: any) => d.zone_id))

  return c.html(layout('Cloudflare Zones', (
    <Fragment>
    <div class="mb-8 border-b border-brand-border/30 pb-5">
      <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Account Zones</h2>
      <p class="text-slate-400 text-sm">Enable or disable DNS synchronization for Cloudflare active domains.</p>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-brand-border/20">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Zone Name</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">ID</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Status</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Management</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-border/20 bg-transparent">
          {zones.map((z: any) => (
            <tr class="hover:bg-brand-deep/30 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-white font-display">{z.name}</td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">{z.id}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <Badge type={z.status === 'active' ? 'success' : 'warning'}>{z.status}</Badge>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-bold">
                {user.role === 'owner' ? (
                  syncedIds.has(z.id) 
                    ? <form method="POST" action="/domains/unsync" style="display:inline;"><input type="hidden" name="id" value={z.id} /><button type="submit" class="text-rose-500 hover:text-rose-400 font-bold transition">Disable Sync</button></form>
                    : <form method="POST" action="/domains/sync" style="display:inline;"><input type="hidden" name="id" value={z.id} /><input type="hidden" name="name" value={z.name} /><button type="submit" class="text-brand-primary hover:text-brand-primary/80 font-bold transition">Enable Sync</button></form>
                ) : <span class="text-slate-500 italic text-xs font-mono">Owner Required</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </Fragment>
  ), user, c.get('flash')))
})

domains.post('/sync', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  
  const { id, name } = await c.req.parseBody() as { id: string, name: string }
  await c.env.record_manager_db.prepare('INSERT INTO domains (zone_id, zone_name) VALUES (?, ?) ON CONFLICT(zone_id) DO NOTHING')
    .bind(id, name)
    .run()
  
  await logAudit(c.env.record_manager_db, user.email, 'SYNC', 'DOMAIN', name, { zone_id: id })
  await setFlash(c, { type: 'success', text: `Domain ${name} is now synced.` })
  
  return c.redirect('/domains')
})

domains.post('/unsync', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  
  const { id } = await c.req.parseBody() as { id: string }
  const domain = await c.env.record_manager_db.prepare('SELECT zone_name FROM domains WHERE zone_id = ?').bind(id).first<any>()
  
  await c.env.record_manager_db.prepare('DELETE FROM domains WHERE zone_id = ?').bind(id).run()
  
  if (domain) {
    await logAudit(c.env.record_manager_db, user.email, 'UNSYNC', 'DOMAIN', domain.zone_name, { zone_id: id })
    await setFlash(c, { type: 'info', text: `Sync disabled for ${domain.zone_name}.` })
  }
  
  return c.redirect('/domains')
})

domains.get('/:id', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  if (!user) return c.redirect('/')
  
  const levels = [
    { key: 'read', short: 'READ', desc: 'Read-only access' },
    { key: 'add', short: 'ADD', desc: 'Create new records' },
    { key: 'edit_own', short: 'EDIT OWN', desc: 'Manage own records' },
    { key: 'edit', short: 'EDIT ANY', desc: 'Edit all records' },
    { key: 'delete_own', short: 'DEL OWN', desc: 'Delete own records' },
    { key: 'delete', short: 'DEL ANY', desc: 'Full management' },
    { key: 'domain_admin', short: 'ADMIN', desc: 'Full administration' }
  ]
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  if (!domain) return c.text('Domain not found', 404)
  
  const userLevel = await getPermissionLevel(c.env.record_manager_db, user, domainId)
  
  const { results: recordPerms } = await c.env.record_manager_db.prepare(
    'SELECT record_id, level FROM record_permissions WHERE user_id = ? AND domain_id = ?'
  ).bind(user.id, domainId).all()
  
  const hasAccess = user.role === 'owner' || user.role === 'admin' || user.role === 'manager' || userLevel || recordPerms.length > 0
  if (!hasAccess) return c.text('Forbidden', 403)
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  let records = await cf.listRecords(domain.zone_id)
  
  const recordPermMap = new Map(recordPerms.map((rp: any) => [rp.record_id, rp.level]))
  const isRecordLevelOnly = !userLevel && user.role !== 'owner' && user.role !== 'admin' && user.role !== 'manager'
  
  if (isRecordLevelOnly) {
    records = records.filter((r: any) => recordPermMap.has(r.id))
  }
  
  const { results: ownership } = await c.env.record_manager_db.prepare(
    'SELECT record_id, created_by_email FROM record_metadata WHERE domain_id = ?'
  ).bind(domainId).all()
  const ownershipMap = new Map(ownership.map((o: any) => [o.record_id, o.created_by_email]))

  const canAdd = user.role === 'owner' || user.role === 'admin' || user.role === 'manager' || (userLevel && can(userLevel, 'add'))
  const isDomainAdmin = user.role === 'owner' || user.role === 'admin' || user.role === 'manager' || userLevel === 'domain_admin'
  
  let domainPermissionsList: any[] = []
  let recordPermissionsList: any[] = []
  let allUsersList: any[] = []
  
  if (isDomainAdmin) {
    const { results: dp } = await c.env.record_manager_db.prepare(
      'SELECT p.*, u.email FROM permissions p JOIN users u ON p.user_id = u.id WHERE p.domain_id = ?'
    ).bind(domainId).all()
    domainPermissionsList = dp
    
    const { results: rp } = await c.env.record_manager_db.prepare(
      'SELECT rp.*, u.email FROM record_permissions rp JOIN users u ON rp.user_id = u.id WHERE rp.domain_id = ?'
    ).bind(domainId).all()
    recordPermissionsList = rp
    
    const { results: uList } = await c.env.record_manager_db.prepare('SELECT id, email, role FROM users WHERE role = "user"').all()
    allUsersList = uList
  }

  return c.html(layout(`Manage ${domain.zone_name}`, (
    <Fragment>
    <div class="flex justify-between items-center mb-8 pb-4 border-b border-brand-border/30">
      <div>
        <h2 class="text-2xl font-bold font-display text-white tracking-tight">{domain.zone_name}</h2>
        <p class="text-sm text-slate-400">Configure real-time DNS records on Cloudflare edge servers.</p>
      </div>
      <div class="flex gap-2">
        {canAdd && (
          <Button onclick="document.getElementById('add-record-panel').classList.toggle('hidden')">
            <svg class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
            Add Record
          </Button>
        )}
      </div>
    </div>
    
    {/* Add Record Panel */}
    <div id="add-record-panel" class="hidden mb-8 bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6">
      <h3 class="text-xs font-bold text-white font-mono mb-4 uppercase tracking-wider">Create New DNS Record</h3>
      <form method="POST" action={`/domains/${domainId}/records`}>
        <div class="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
          <div class="md:col-span-1">
            <label class="block text-xs font-bold text-slate-400 mb-1 uppercase font-mono">Type</label>
            <select name="type" class="w-full text-xs">
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="TXT">TXT</option>
              <option value="MX">MX</option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-slate-400 mb-1 uppercase font-mono">Name</label>
            <input type="text" name="name" placeholder="example.com" required class="w-full text-xs font-mono" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-slate-400 mb-1 uppercase font-mono">Content</label>
            <input type="text" name="content" placeholder="1.2.3.4" required class="w-full text-xs font-mono" />
          </div>
          <div class="md:col-span-1 flex flex-col items-center pb-2">
             <label class="block text-xs font-bold text-slate-400 mb-1.5 uppercase font-mono">Proxied</label>
             <input type="checkbox" name="proxied" class="h-4 w-4 rounded border-brand-border/40 text-brand-primary focus:ring-brand-primary bg-brand-deep/50" />
          </div>
          <div class="md:col-span-5">
             <input type="hidden" name="ttl" value="1" />
          </div>
          <div class="md:col-span-1">
            <button type="submit" class="w-full btn-primary text-white py-2 rounded-lg font-bold text-xs">Create</button>
          </div>
        </div>
      </form>
    </div>

    <div class="mb-6 flex justify-between items-center gap-4">
      <div class="relative w-full max-w-sm">
        <input type="text" id="record-search" placeholder="Filter records..." class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:border-brand-primary focus:ring-brand-primary font-mono" onkeyup="filterRecords()" />
        <svg class="absolute left-3 top-3 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <div class="text-xs text-slate-500 font-mono">Showing {records.length} records</div>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">Type</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">Name</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">Content</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">TTL</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">Proxy</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider font-mono">Actions</th>
          </tr>
        </thead>
        <tbody id="record-table-body" class="bg-transparent divide-y divide-slate-100">
          {records.map((r: any) => {
            const creator = ownershipMap.get(r.id)
            const isOwnerOfRecord = creator === user.email
            const rPerm = recordPermMap.get(r.id)
            
            const hasEditPermission = 
              user.role === 'owner' || user.role === 'admin' || user.role === 'manager' ||
              (userLevel === 'domain_admin') || (userLevel === 'delete') || (userLevel === 'edit') || 
              (userLevel === 'edit_own' && isOwnerOfRecord) || (rPerm === 'edit' || rPerm === 'delete')
              
            const hasDeletePermission = 
              user.role === 'owner' || user.role === 'admin' || user.role === 'manager' ||
              (userLevel === 'domain_admin') || (userLevel === 'delete') || 
              ((userLevel === 'delete_own' || userLevel === 'edit_own') && isOwnerOfRecord) || (rPerm === 'delete')

            return (
              <tr class="record-row hover:bg-slate-50/80 transition-colors" data-search={`${r.type} ${r.name} ${r.content}`}>
                <td class="px-4 py-4 whitespace-nowrap">
                  <div class="flex flex-col">
                    <Badge type="user">{r.type}</Badge>
                    {creator && <span class="text-[9px] text-slate-500 font-mono mt-1">{creator.split('@')[0]}</span>}
                  </div>
                </td>
                <td class="px-4 py-4 whitespace-nowrap">
                  <div class="text-sm font-semibold text-slate-900 font-display">{r.name}</div>
                  <div class="flex items-center gap-1 mt-0.5">
                    <span class="text-[9px] text-slate-400 font-mono select-all">{r.id}</span>
                  </div>
                </td>
                <td class="px-4 py-4 text-xs text-slate-700 font-mono break-all max-w-xs">{r.content}</td>
                <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-600 font-mono">{r.ttl === 1 ? 'Auto' : r.ttl}</td>
                <td class="px-4 py-4 whitespace-nowrap">
                  {r.proxied ? (
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-600 border border-amber-500/30">
                      <svg class="h-2 w-2 mr-1.5 text-amber-500" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg> Proxied
                    </span>
                  ) : (
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/15 text-slate-600 border border-slate-500/30">
                      <svg class="h-2 w-2 mr-1.5 text-slate-500" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg> DNS Only
                    </span>
                  )}
                </td>
                <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div class="flex justify-end gap-2">
                    {hasEditPermission && <a href={`/domains/${domainId}/records/${r.id}/edit`} class="text-brand-primary hover:text-brand-primary/80 p-1 rounded transition hover:bg-brand-primary/10" title="Edit"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></a>}
                    {hasDeletePermission && (
                      <form method="POST" action={`/domains/${domainId}/records/${r.id}/delete`} style="display:inline;" onsubmit="return confirm('Are you sure?')">
                        <button type="submit" class="text-rose-500 hover:text-rose-400 p-1 rounded transition hover:bg-rose-500/10" title="Delete">
                          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    {isDomainAdmin && (
      <div class="mt-12 pt-8 border-t border-slate-200">
        <h3 class="text-xl font-bold font-display text-slate-900 mb-2 tracking-tight">Zone Access Delegation</h3>
        <p class="text-slate-500 text-sm mb-6 font-sans">Manage clearances and grant specific record privileges specifically for this zone.</p>
        
        <div class="flex flex-col gap-8 font-mono">
          <div class="bg-slate-50 border border-slate-200 rounded-2xl p-6 w-full">
            <h4 class="text-xs font-bold text-slate-700 mb-4 uppercase tracking-wider">Domain Access Matrix</h4>
            <div class="space-y-4">
              <div class="divide-y divide-slate-200">
                {allUsersList.map((u: any) => {
                  const currentPerm = domainPermissionsList.find((p: any) => p.user_id === u.id)
                  const currentLevel = currentPerm ? currentPerm.level : 'none'
                  
                  return (
                    <div class="py-3 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                      <div class="flex flex-col">
                        <span class="text-slate-800 font-bold text-xs">{u.email}</span>
                        <span class="text-[9px] text-slate-400 font-mono">System Role: {u.role}</span>
                      </div>
                      <div class="inline-flex flex-wrap items-center bg-slate-200/50 p-1 rounded-xl border border-slate-200/30 gap-1">
                        <form method="POST" action={`/domains/${domainId}/delegation/revoke-domain`} class="inline" style="margin:0;">
                          <input type="hidden" name="user_id" value={u.id} />
                          <button type="submit" class={`px-2.5 py-1 text-[9px] font-bold rounded-lg transition-all ${currentLevel === 'none' ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:text-rose-600 hover:bg-slate-200/80'}`} title="No access">
                            NONE
                          </button>
                        </form>
                        
                        {levels.map(lvl => {
                          const isActive = currentLevel === lvl.key
                          return (
                            <form method="POST" action={`/domains/${domainId}/delegation/grant-domain`} class="inline" style="margin:0;">
                              <input type="hidden" name="user_id" value={u.id} />
                              <input type="hidden" name="level" value={lvl.key} />
                              <button type="submit" class={`px-2.5 py-1 text-[9px] font-bold rounded-lg transition-all ${isActive ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-indigo-600 hover:bg-slate-200/80'}`} title={lvl.desc}>
                                {lvl.short}
                              </button>
                            </form>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    )}

    <script dangerouslySetInnerHTML={{ __html: `
      function filterRecords() {
        const query = document.getElementById('record-search').value.toLowerCase();
        const rows = document.querySelectorAll('.record-row');
        rows.forEach(row => {
          const content = row.getAttribute('data-search').toLowerCase();
          row.style.display = content.includes(query) ? '' : 'none';
        });
      }
    `}} />
    </Fragment>
  ), user, c.get('flash')))
})

domains.post('/sync', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  
  const { id, name } = await c.req.parseBody() as { id: string, name: string }
  await c.env.record_manager_db.prepare('INSERT INTO domains (zone_id, zone_name) VALUES (?, ?) ON CONFLICT(zone_id) DO NOTHING')
    .bind(id, name)
    .run()
  
  await logAudit(c.env.record_manager_db, user.email, 'SYNC', 'DOMAIN', name, { zone_id: id })
  await setFlash(c, { type: 'success', text: `Domain ${name} successfully integrated.` })
  return c.redirect('/domains')
})

domains.post('/unsync', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.text('Forbidden', 403)
  
  const { id } = await c.req.parseBody() as { id: string }
  const domain = await c.env.record_manager_db.prepare('SELECT zone_name FROM domains WHERE zone_id = ?').bind(id).first<any>()
  
  await c.env.record_manager_db.prepare('DELETE FROM domains WHERE zone_id = ?').bind(id).run()
  
  if (domain) {
    await logAudit(c.env.record_manager_db, user.email, 'UNSYNC', 'DOMAIN', domain.zone_name, { zone_id: id })
    await setFlash(c, { type: 'info', text: `Domain ${domain.zone_name} detached from management.` })
  }
  
  return c.redirect('/domains')
})

domains.post('/:id/delegation/grant-domain', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const { user_id, level } = await c.req.parseBody() as { user_id: string, level: string }
  
  await c.env.record_manager_db.prepare('INSERT INTO permissions (user_id, domain_id, level) VALUES (?, ?, ?) ON CONFLICT(user_id, domain_id) DO UPDATE SET level = ?')
    .bind(parseInt(user_id), domainId, level, level)
    .run()
    
  await setFlash(c, { type: 'success', text: 'Domain clearance updated.' })
  return c.redirect(`/domains/${domainId}`)
})

domains.post('/:id/records', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  const body = await c.req.parseBody() as any
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const result = await cf.createRecord(domain.zone_id, {
    type: body.type,
    name: body.name,
    content: body.content,
    ttl: 1,
    proxied: body.proxied === 'on'
  })
  
  await logAudit(c.env.record_manager_db, user.email, 'CREATE', 'RECORD', body.name, { domain: domain.zone_name, type: body.type })
  
  if (result && result.id) {
    await c.env.record_manager_db.prepare(
      'INSERT INTO record_metadata (record_id, domain_id, created_by_email) VALUES (?, ?, ?)'
    ).bind(result.id, domainId, user.email).run()
  }

  await setFlash(c, { type: 'success', text: `Record ${body.name} created successfully.` })
  return c.redirect(`/domains/${domainId}`)
})

domains.get('/:id/records/:recordId/edit', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const recordId = c.req.param('recordId')
  
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  const records = await cf.listRecords(domain.zone_id)
  const record = records.find((r: any) => r.id === recordId)
  
  return c.html(layout(`Edit Record - ${domain.zone_name}`, (
    <div class="max-w-2xl mx-auto py-4">
      <div class="mb-8 border-b border-brand-border/30 pb-5">
        <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Edit DNS Record</h2>
        <p class="text-slate-400 text-sm">Update DNS configurations for <span class="font-mono text-brand-secondary font-bold">{record.name}</span>.</p>
      </div>

      <form method="POST" action={`/domains/${domainId}/records/${recordId}`} class="space-y-6 bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6 md:p-8">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">Record Type</label>
            <select name="type" class="w-full text-xs font-mono">
              {['A', 'AAAA', 'CNAME', 'TXT', 'MX'].map(t => <option value={t} selected={record.type === t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">TTL</label>
            <input type="number" name="ttl" value={record.ttl} class="w-full text-xs font-mono" />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">Record Name</label>
          <input type="text" name="name" value={record.name} required class="w-full text-xs font-mono font-bold text-brand-secondary" />
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">Content</label>
          <input type="text" name="content" value={record.content} required class="w-full text-xs font-mono" />
        </div>

        <div class="flex items-center gap-2.5 py-2">
          <input type="checkbox" id="edit-proxied" name="proxied" checked={record.proxied} class="h-4 w-4 rounded border-brand-border/40 text-brand-primary focus:ring-brand-primary bg-brand-deep/50" />
          <label for="edit-proxied" class="text-xs font-bold text-slate-300 uppercase font-mono cursor-pointer">Proxy through Cloudflare Edge</label>
        </div>

        <div class="pt-6 border-t border-brand-border/20 flex gap-4 justify-end">
          <a href={`/domains/${domainId}`} class="px-5 py-2.5 rounded-lg border border-brand-border/40 text-slate-300 hover:text-white font-bold text-xs tracking-wider transition">Cancel</a>
          <button type="submit" class="btn-primary text-white text-xs px-5 py-2.5 rounded-lg font-bold tracking-wider shadow-md">Update Configuration</button>
        </div>
      </form>
    </div>
  ), user, c.get('flash')))
})

domains.post('/:id/records/:recordId', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const recordId = c.req.param('recordId')
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  const body = await c.req.parseBody() as any
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  await cf.updateRecord(domain.zone_id, recordId, {
    type: body.type,
    name: body.name,
    content: body.content,
    ttl: 1,
    proxied: body.proxied === 'on'
  })
  
  await logAudit(c.env.record_manager_db, user.email, 'UPDATE', 'RECORD', body.name, { domain: domain.zone_name })
  await setFlash(c, { type: 'success', text: `DNS configuration for ${body.name} deployed.` })
  return c.redirect(`/domains/${domainId}`)
})

domains.post('/:id/records/:recordId/delete', async (c) => {
  const user = c.get('user')
  const domainId = parseInt(c.req.param('id'))
  const recordId = c.req.param('recordId')
  const domain = await c.env.record_manager_db.prepare('SELECT * FROM domains WHERE id = ?').bind(domainId).first<any>()
  
  const cf = new CloudflareClient(c.get('settings').CF_API_TOKEN)
  await cf.deleteRecord(domain.zone_id, recordId)
  
  await logAudit(c.env.record_manager_db, user.email, 'DELETE', 'RECORD', 'UNKNOWN', { domain: domain.zone_name, record_id: recordId })
  await setFlash(c, { type: 'info', text: 'DNS record has been purged.' })
  return c.redirect(`/domains/${domainId}`)
})

export default domains
