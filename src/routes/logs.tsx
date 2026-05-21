import { Hono } from 'hono'
import { h, Fragment } from 'hono/jsx'
import { layout } from '../templates/layout'
import { Badge } from '../templates/components'

type Bindings = {
  record_manager_db: D1Database
}

type Variables = {
  user: any
  flash: any
}

const logs = new Hono<{ Bindings: Bindings; Variables: Variables }>()

logs.get('/', async (c) => {
  const user = c.get('user')
  if (!user || (user.role !== 'owner' && user.role !== 'admin' && user.role !== 'manager')) return c.redirect('/')

  const { results: auditLogs } = await c.env.record_manager_db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100').all()

  return c.html(layout('Audit Logs', (
    <Fragment>
    <div class="mb-8 border-b border-brand-border/30 pb-5">
      <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Audit Logs</h2>
      <p class="text-slate-400 text-sm">Chronological registry of DNS deployments and system alterations.</p>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-brand-border/20">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Operator</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Action</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Target Resource</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Timestamp</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-border/20 bg-transparent">
          {auditLogs.map((l: any) => (
            <tr class="hover:bg-brand-deep/30 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-400 font-mono">{l.user_email}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-brand-primary/10 text-brand-primary border border-brand-primary/20 uppercase tracking-wider font-mono">{l.action}</span>
              </td>
              <td class="px-4 py-4 whitespace-nowrap">
                <div class="text-sm font-semibold text-white font-display">{l.resource_name}</div>
                <div class="text-xs text-slate-500 font-mono uppercase">{l.resource_type}</div>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">{l.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </Fragment>
  ), user, c.get('flash')))
})

export default logs
