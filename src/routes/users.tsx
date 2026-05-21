import { Hono } from 'hono'
import { h, Fragment } from 'hono/jsx'
import { layout } from '../templates/layout'
import { Badge, Button } from '../templates/components'
import { setFlash } from '../lib/session'

type Bindings = {
  record_manager_db: D1Database
}

type Variables = {
  user: any
  flash: any
}

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>()

users.get('/', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'owner' && user.role !== 'admin' && user.role !== 'manager')) return c.redirect('/')
  
  const { results: userResults } = await c.env.record_manager_db.prepare('SELECT * FROM users').all()
  const { results: domains } = await c.env.record_manager_db.prepare('SELECT * FROM domains').all()
  const { results: permissions } = await c.env.record_manager_db.prepare('SELECT * FROM permissions').all()

  const isGlobalAdmin = user.role === 'owner' || user.role === 'admin'

  const levels = [
    { key: 'read', short: 'READ', desc: 'Read-only access' },
    { key: 'add', short: 'ADD', desc: 'Create new records' },
    { key: 'edit_own', short: 'EDIT OWN', desc: 'Manage own records' },
    { key: 'edit', short: 'EDIT ANY', desc: 'Edit all records' },
    { key: 'delete_own', short: 'DEL OWN', desc: 'Delete own records' },
    { key: 'delete', short: 'DEL ANY', desc: 'Full management' },
    { key: 'domain_admin', short: 'ADMIN', desc: 'Full administration' }
  ]

  return c.html(layout('User Management', (
    <Fragment>
    <div class="mb-8 border-b border-slate-200 pb-5">
      <h2 class="text-2xl font-bold font-display text-slate-900 mb-2 tracking-tight">Identity Management</h2>
      <p class="text-slate-500 text-sm">Delegate domain access levels to trusted operators.</p>
    </div>

    {isGlobalAdmin && (
      <div class="mb-8">
        <h3 class="text-xs font-bold text-slate-700 mb-4 uppercase tracking-wider font-mono">Provision Team Member</h3>
        <form method="POST" action="/users" class="bg-slate-50 border border-slate-200 rounded-2xl p-6">
          <div class="flex flex-col md:flex-row gap-4 items-end">
            <div class="flex-1 w-full">
              <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase font-mono">Email Address</label>
              <input type="email" name="email" placeholder="user@example.com" required class="w-full text-xs font-mono" />
            </div>
            <div class="w-full md:w-64">
              <label class="block text-xs font-bold text-slate-500 mb-1.5 uppercase font-mono">System Role</label>
              <select name="role" class="w-full text-xs">
                <option value="user">User (Governed by permissions)</option>
                <option value="manager">Manager (Manage records & perms)</option>
                <option value="admin">Admin (Full global access)</option>
              </select>
            </div>
            <Button type="submit">Add Identity</Button>
          </div>
        </form>
      </div>
    )}
    
    <div class="overflow-x-auto mt-10">
      <table class="min-w-full divide-y divide-slate-200 font-mono text-xs">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Role</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Access Clearances</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-transparent">
          {userResults.map((u: any) => {
            const canManageTarget = isGlobalAdmin && u.role !== 'owner'
            return (
              <tr class="hover:bg-slate-50/50 transition-colors">
                <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-slate-900 font-display">{u.email}</td>
                <td class="px-4 py-4 whitespace-nowrap">
                  <Badge type={u.role}>{u.role}</Badge>
                </td>
                <td class="px-4 py-4 text-xs text-slate-700">
                  {u.role === 'owner' || u.role === 'admin' || u.role === 'manager' ? <span class="text-slate-500 italic">Full administrative clearance</span> : (
                    <div class="space-y-3">
                      {domains.map((d: any) => {
                        const currentPerm = permissions.find((p: any) => p.user_id === u.id && p.domain_id === d.id)
                        const currentLevel = currentPerm ? currentPerm.level : 'none'
                        return (
                          <div class="flex items-center justify-between gap-3 p-2 bg-slate-50 border border-slate-200 rounded-xl">
                            <span class="font-bold text-slate-800 text-[10px] truncate max-w-[120px]">{d.zone_name}</span>
                            <div class="inline-flex items-center bg-slate-200/50 p-0.5 rounded-lg border border-slate-200/30 gap-0.5">
                              <form method="POST" action={`/users/${u.id}/permissions/revoke`} style="margin:0;">
                                <input type="hidden" name="domain_id" value={d.id} />
                                <button type="submit" class={`px-1.5 py-0.5 text-[8px] font-bold rounded ${currentLevel === 'none' ? 'bg-rose-500 text-white' : 'text-slate-500 hover:text-rose-600'}`}>NONE</button>
                              </form>
                              {levels.map(lvl => (
                                <form method="POST" action={`/users/${u.id}/permissions`} style="margin:0;">
                                  <input type="hidden" name="domain_id" value={d.id} />
                                  <input type="hidden" name="level" value={lvl.key} />
                                  <button type="submit" class={`px-1.5 py-0.5 text-[8px] font-bold rounded ${currentLevel === lvl.key ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-indigo-600'}`}>{lvl.short}</button>
                                </form>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </td>
                <td class="px-4 py-4 whitespace-nowrap text-right text-xs font-bold">
                  {canManageTarget && (
                    <form method="POST" action={`/users/${u.id}/delete`} style="display:inline;" onsubmit="return confirm('Are you sure?')">
                      <button type="submit" class="text-rose-500 hover:text-rose-600 font-bold transition">Remove Identity</button>
                    </form>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    </Fragment>
  ), user, c.get('flash')))
})

users.post('/', async (c) => {
  const { email, role } = await c.req.parseBody() as { email: string, role: string }
  await c.env.record_manager_db.prepare('INSERT INTO users (email, role) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET role = ?')
    .bind(email, role, role)
    .run()
  await setFlash(c, { type: 'success', text: `Identity ${email} provisioned.` })
  return c.redirect('/users')
})

users.post('/:id/permissions', async (c) => {
  const userId = parseInt(c.req.param('id'))
  const { domain_id, level } = await c.req.parseBody() as { domain_id: string, level: string }
  await c.env.record_manager_db.prepare('INSERT INTO permissions (user_id, domain_id, level) VALUES (?, ?, ?) ON CONFLICT(user_id, domain_id) DO UPDATE SET level = ?')
    .bind(userId, parseInt(domain_id), level, level)
    .run()
  return c.redirect('/users')
})

users.post('/:id/permissions/revoke', async (c) => {
  const userId = parseInt(c.req.param('id'))
  const { domain_id } = await c.req.parseBody() as { domain_id: string }
  await c.env.record_manager_db.prepare('DELETE FROM permissions WHERE user_id = ? AND domain_id = ?').bind(userId, parseInt(domain_id)).run()
  return c.redirect('/users')
})

users.post('/:id/delete', async (c) => {
  const userId = parseInt(c.req.param('id'))
  await c.env.record_manager_db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  await setFlash(c, { type: 'info', text: 'Identity revoked.' })
  return c.redirect('/users')
})

export const blacklist = new Hono<{ Bindings: Bindings; Variables: Variables }>()

blacklist.get('/', async (c) => {
  const user = c.get('user')
  if (!user || user.role !== 'owner') return c.redirect('/')
  const { results: patterns } = await c.env.record_manager_db.prepare('SELECT * FROM blacklist').all()
  
  return c.html(layout('Blacklist', (
    <Fragment>
    <div class="mb-8 border-b border-brand-border/30 pb-5">
      <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Access Blacklist</h2>
      <p class="text-slate-400 text-sm">Designate protected subdomains.</p>
    </div>

    <div class="mb-8">
      <form method="POST" action="/blacklist" class="bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6">
        <div class="flex flex-col md:flex-row gap-4 items-end">
          <div class="flex-1 w-full">
            <label class="block text-xs font-bold text-slate-400 mb-1.5 uppercase font-mono">Pattern</label>
            <input type="text" name="pattern" placeholder="*.dev.example.com" required class="w-full text-xs font-mono" />
          </div>
          <Button type="submit">Deploy Rule</Button>
        </div>
      </form>
    </div>
    
    <div class="overflow-x-auto mt-10">
      <table class="min-w-full divide-y divide-brand-border/20">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Pattern</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-border/20 bg-transparent">
          {patterns.map((p: any) => (
            <tr class="hover:bg-brand-deep/20 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap font-mono text-xs text-brand-secondary font-bold">{p.pattern}</td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-xs font-bold">
                <form method="POST" action={`/blacklist/${p.id}/delete`} style="display:inline;">
                  <button type="submit" class="text-rose-500 hover:text-rose-400 font-bold transition">Remove Rule</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </Fragment>
  ), user, c.get('flash')))
})

blacklist.post('/', async (c) => {
  const { pattern } = await c.req.parseBody() as { pattern: string }
  await c.env.record_manager_db.prepare('INSERT INTO blacklist (pattern) VALUES (?) ON CONFLICT(pattern) DO NOTHING').bind(pattern).run()
  await setFlash(c, { type: 'success', text: `Protection rule ${pattern} deployed.` })
  return c.redirect('/blacklist')
})

blacklist.post('/:id/delete', async (c) => {
  const id = parseInt(c.req.param('id'))
  await c.env.record_manager_db.prepare('DELETE FROM blacklist WHERE id = ?').bind(id).run()
  return c.redirect('/blacklist')
})

export default users
