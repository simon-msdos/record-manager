const setup = new Hono<{ Bindings: Bindings; Variables: Variables }>()

setup.get('/', async (c) => {
  const user = c.get('user')
  if (user && user.role !== 'owner') return c.text('Forbidden', 403)
  const settings = c.get('settings')
  
  const permissions = JSON.stringify([
    { key: 'zone_read', type: 'zone' },
    { key: 'dns_edit', type: 'zone' }
  ])
  const cfTokenUrl = `https://dash.cloudflare.com/profile/api-tokens?name=Record-Manager&permissionGroupKeys=${encodeURIComponent(permissions)}&accountId=*&zoneId=all`
  
  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/auth/google`

  return c.html(layout('System Settings', (
    <div class="max-w-4xl mx-auto py-4">
      <div class="mb-10 border-b border-brand-border/30 pb-6 flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Configuration Wizard</h2>
          <p class="text-slate-400 text-sm">Deploy keys to authenticate Cloudflare DNS and Google Identity accounts.</p>
        </div>
        <span class="text-xs font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded bg-brand-primary/10 text-brand-primary border border-brand-primary/20 mt-3 md:mt-0">v1.2 Portal</span>
      </div>
      
      <form id="setup-form" method="POST" action="/setup" class="space-y-12">
        {/* Cloudflare Section */}
        <section class="relative bg-brand-dark/40 border border-brand-border/40 rounded-2xl p-6 md:p-8">
          <div class="absolute -top-3.5 left-6 px-3 bg-brand-deep text-xs font-bold text-brand-primary tracking-widest uppercase border border-brand-border/40 rounded-full flex items-center gap-1.5 shadow-sm">
            <span class="h-4 w-4 bg-brand-primary/20 text-brand-primary rounded-full flex items-center justify-center text-[10px]">1</span>
            Cloudflare Connection
          </div>
          
          <div class="bg-brand-primary/5 border border-brand-primary/25 rounded-xl p-5 mb-6 mt-2">
            <h4 class="font-bold text-white font-display mb-2 text-sm">Step A: Provision your API Token</h4>
            <p class="text-slate-400 text-sm mb-4 leading-relaxed">Instantiate a secure scoped API token on Cloudflare with pre-defined Zone:Read and DNS:Edit permissions.</p>
            <a href={cfTokenUrl} target="_blank" class="btn-primary text-white text-xs px-5 py-2.5 rounded-lg font-bold inline-flex items-center gap-2 shadow-md">
              Create Token on Cloudflare 
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
          </div>
          
          <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
            <label class="block text-xs font-bold text-slate-400 mb-2.5 uppercase tracking-wider font-mono">Step B: Paste Created Token</label>
            <input type="password" id="cf-token" name="CF_API_TOKEN" value={settings.CF_API_TOKEN || ''} 
                   placeholder="Paste your z6-... token here" required 
                   class="w-full text-sm font-mono focus:border-brand-primary focus:ring-brand-primary"
                   oninput="if(this.value.length > 20) { setTimeout(() => { document.getElementById('setup-form').submit(); }, 100); }" />
            <p class="mt-2 text-[10px] text-slate-500 italic font-mono">(Form automatically saves on valid paste)</p>
          </div>
        </section>

        {/* Google OAuth Section */}
        <section class="relative bg-brand-dark/40 border border-brand-border/40 rounded-2xl p-6 md:p-8">
          <div class="absolute -top-3.5 left-6 px-3 bg-brand-deep text-xs font-bold text-brand-secondary tracking-widest uppercase border border-brand-border/40 rounded-full flex items-center gap-1.5 shadow-sm">
            <span class="h-4 w-4 bg-brand-secondary/20 text-brand-secondary rounded-full flex items-center justify-center text-[10px]">2</span>
            Google OAuth Authentication
          </div>
          
          <div class="grid grid-cols-1 gap-6 mt-2">
            <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
              <div class="flex flex-col gap-1 mb-4">
                <label class="block text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Redirect URI</label>
                <p class="text-[10px] text-slate-500 italic leading-tight">Whitelist this exact URI in your Google Cloud Console (APIs &amp; Services &gt; Credentials).</p>
              </div>
              <div class="flex items-center gap-2">
                <input type="text" readonly value={redirectUri} class="flex-1 text-[10px] font-mono bg-brand-deep/50 border-brand-border/20 text-slate-400 cursor-default" />
                <button type="button" onclick={`navigator.clipboard.writeText('${redirectUri}')`} class="p-2 bg-brand-border/20 hover:bg-brand-border/40 text-white rounded-lg transition-colors">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
                <label class="block text-xs font-bold text-slate-400 mb-2.5 uppercase tracking-wider font-mono">Client ID</label>
                <input type="text" name="GOOGLE_CLIENT_ID" value={settings.GOOGLE_CLIENT_ID || ''} placeholder="...-....apps.googleusercontent.com" required class="w-full text-[11px] font-mono" />
              </div>
              <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
                <label class="block text-xs font-bold text-slate-400 mb-2.5 uppercase tracking-wider font-mono">Client Secret</label>
                <input type="password" name="GOOGLE_CLIENT_SECRET" value={settings.GOOGLE_CLIENT_SECRET || ''} placeholder="GOCSPX-..." required class="w-full text-[11px] font-mono" />
              </div>
            </div>
          </div>
        </section>

        <div class="flex items-center justify-end gap-4 pt-4">
          <button type="submit" class="btn-primary px-10 py-3 bg-brand-primary hover:bg-brand-primary/80 text-white font-bold rounded-xl shadow-lg shadow-brand-primary/20 transition-all">
            Deploy Configuration
          </button>
        </div>
      </form>
    </div>
  ), user, c.get('flash')))
})

setup.post('/', async (c) => {
  const user = c.get('user')
  if (user && user.role !== 'owner') return c.text('Forbidden', 403)
  
  const body = await c.req.parseBody()
  const db = c.env.record_manager_db

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string' && value.trim()) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value.trim()).run()
    }
  }

  if (user) {
    await logAudit(db, user.email, 'UPDATE_SETTINGS', 'SYSTEM', 'CONFIG', body)
  }

  await setFlash(c, { type: 'success', text: 'System configuration deployed successfully.' })
  return c.redirect('/setup')
})

export default setup
