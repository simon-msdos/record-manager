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
    { name: 'Dashboard', href: '/dashboard', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />' },
    { name: 'Domains', href: '/domains', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />' },
    ...(user?.role === 'owner' || user?.role === 'admin' ? [{ name: 'Audit Logs', href: '/logs', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />' }] : []),
    ...(user?.role === 'owner' ? [
      { name: 'User Management', href: '/users', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />' },
      { name: 'Blacklist', href: '/blacklist', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />' },
      { name: 'Settings', href: '/setup', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />' }
    ] : [])
  ]

  const isLoginPage = title === 'Welcome';
  const isUnauthPage = !user;

  if (isUnauthPage) {
    return `
<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-50">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Record Manager</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        brand: {
                            bg: '#f8fafc',
                            panel: '#ffffff',
                            border: '#e2e8f0',
                            text: '#0f172a',
                            primary: '#4f46e5',
                        }
                    },
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    }
                }
            }
        }
    </script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        
        .main-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
        }
        
        input[type="text"], input[type="password"], input[type="email"], select {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #0f172a;
            border-radius: 6px;
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
            transition: all 0.1s ease-in-out;
        }
        input:focus, select:focus {
            outline: none;
            border-color: #4f46e5;
            box-shadow: 0 0 0 1px #4f46e5;
        }
        
        .btn-primary {
            background: #0f172a;
            color: #ffffff;
            border-radius: 6px;
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.15s ease-in-out;
        }
        .btn-primary:hover {
            background: #1e293b;
        }
    </style>
</head>
<body class="h-full bg-slate-50 text-slate-900 flex flex-col justify-between min-h-screen">
    <!-- Main Content -->
    <div class="flex-1 flex flex-col items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
        ${isLoginPage ? content : `
            <div class="main-card w-full max-w-xl rounded-xl p-8 shadow-sm">
                <div class="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                    <div class="h-8 w-8 rounded bg-slate-900 flex items-center justify-center text-white font-bold font-sans text-sm">
                        R
                    </div>
                    <h2 class="text-base font-semibold text-slate-900">${title}</h2>
                </div>
                ${content}
            </div>
        `}
    </div>
    
    <!-- Footer -->
    <div class="py-6 border-t border-slate-200 text-center text-xs text-slate-400 font-mono flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4">
        <span>Record Manager v2.2 • Powered by Cloudflare Workers & D1</span>
        <span class="hidden sm:inline text-slate-300">|</span>
        <a href="https://github.com/simon-msdos/record-manager" target="_blank" class="hover:text-slate-600 underline flex items-center gap-1">
            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.646.64.699 1.026 1.592 1.026 2.683 0 3.842-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            simon-msdos/record-manager
        </a>
    </div>
</body>
</html>
    `;
  }

  // Authenticated Layout
  return `
<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-50">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Record Manager</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        brand: {
                            bg: '#f8fafc',
                            panel: '#ffffff',
                            border: '#e2e8f0',
                            text: '#0f172a',
                            primary: '#4f46e5',
                        }
                    },
                    fontFamily: {
                        sans: ['Inter', 'sans-serif'],
                        mono: ['JetBrains Mono', 'monospace'],
                    }
                }
            }
        }
    </script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
        body { font-family: 'Inter', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        
        .main-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05);
        }
        
        .sidebar-active {
            background: #f1f5f9;
            color: #0f172a !important;
            font-weight: 600;
        }
        
        .sidebar-active svg {
            color: #0f172a !important;
        }
        
        .btn-primary {
            background: #0f172a;
            color: #ffffff;
            border-radius: 6px;
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
            font-weight: 500;
            transition: all 0.15s ease-in-out;
        }
        .btn-primary:hover {
            background: #1e293b;
        }
        
        input[type="text"], input[type="password"], input[type="email"], select {
            background: #ffffff;
            border: 1px solid #cbd5e1;
            color: #0f172a;
            border-radius: 6px;
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
            transition: all 0.15s ease-in-out;
        }
        input:focus, select:focus {
            outline: none;
            border-color: #4f46e5;
            box-shadow: 0 0 0 1px #4f46e5;
        }
        
        /* Badges */
        .badge {
            font-size: 0.75rem;
            font-weight: 500;
            padding: 0.125rem 0.625rem;
            border-radius: 9999px;
            display: inline-flex;
            align-items: center;
        }
        .badge-owner { background-color: #fef2f2; color: #ef4444; border: 1px solid #fee2e2; }
        .badge-admin { background-color: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe; }
        .badge-user { background-color: #f0f9ff; color: #0284c7; border: 1px solid #e0f2fe; }

        ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
        }
        ::-webkit-scrollbar-track {
            background: #f8fafc;
        }
        ::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 3px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
        }
        
        .table-header {
            background-color: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
        }
    </style>
    <script>
        // Real-time client active navigation highlight
        document.addEventListener('DOMContentLoaded', () => {
            const currentPath = window.location.pathname;
            const navLinks = document.querySelectorAll('nav a');
            navLinks.forEach(link => {
                const href = link.getAttribute('href');
                if (href === currentPath || (currentPath.startsWith(href) && href !== '/' && href !== '/dashboard')) {
                    link.classList.add('sidebar-active');
                    link.classList.remove('text-slate-600', 'hover:bg-slate-50', 'hover:text-slate-900');
                }
            });
        });
        
        // Auto-refresh logic for real-time feel
        if (window.location.pathname !== '/' && window.location.pathname !== '/setup') {
            setInterval(() => {
                const activeEl = document.activeElement;
                const isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA');
                if (!isTyping) {
                    fetch(window.location.href)
                        .then(response => response.text())
                        .then(html => {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(html, 'text/html');
                            const newContent = doc.querySelector('.main-card').innerHTML;
                            const currentContent = document.querySelector('.main-card').innerHTML;
                            if (newContent !== currentContent) {
                                document.querySelector('.main-card').innerHTML = newContent;
                                console.log('Content updated via live refresh');
                            }
                        });
                }
            }, 30000); // 30 seconds
        }
    </script>
</head>
<body class="h-full overflow-hidden bg-slate-50 text-slate-900">
    <div class="flex h-full">
        <!-- Sidebar -->
        <div class="hidden md:flex md:flex-shrink-0 border-r border-slate-200">
            <div class="flex flex-col w-64 bg-white">
                <div class="flex items-center gap-3 h-16 px-5 border-b border-slate-200">
                    <div class="h-8 w-8 rounded bg-slate-900 flex items-center justify-center text-white font-bold text-sm">
                        R
                    </div>
                    <span class="text-slate-900 text-base font-semibold tracking-tight">Record Manager</span>
                </div>
                <div class="flex-1 flex flex-col overflow-y-auto pt-5 pb-4">
                    <div class="px-4 mb-4">
                        <div class="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200">
                            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                            <span class="text-[10px] font-semibold text-slate-500 uppercase tracking-wider font-mono">System Active</span>
                        </div>
                    </div>
                    <nav class="flex-1 px-3 space-y-1">
                        ${sidebarItems.map(item => `
                            <a href="${item.href}" class="group flex items-center px-3 py-2 text-sm font-medium rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all duration-150">
                                <svg class="mr-3 h-5 w-5 text-slate-400 group-hover:text-slate-500 transition-colors" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    ${item.icon}
                                </svg>
                                ${item.name}
                            </a>
                        `).join('')}
                    </nav>
                </div>
                <div class="flex-shrink-0 flex bg-slate-50 p-4 border-t border-slate-200">
                    <div class="flex-shrink-0 w-full group block">
                        <div class="flex items-center">
                            <div class="w-full">
                                <p class="text-xs font-medium text-slate-700 truncate font-mono">${user.email}</p>
                                <div class="flex justify-between items-center mt-2">
                                    <span class="badge badge-${user.role}">${user.role}</span>
                                    <a href="/logout" class="text-xs text-slate-500 hover:text-slate-800 font-medium hover:underline flex items-center gap-1">
                                        Logout
                                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Main content -->
        <div class="flex flex-col w-0 flex-1 overflow-hidden">
            <main class="flex-1 relative z-0 overflow-y-auto focus:outline-none py-6 bg-slate-50">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 flex justify-between items-center mb-6">
                    <h1 class="text-xl font-bold text-slate-900 tracking-tight">${title}</h1>
                    <div class="flex items-center gap-4">
                        <a href="https://github.com/simon-msdos/record-manager" target="_blank" class="text-xs text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1.5">
                            <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.646.64.699 1.026 1.592 1.026 2.683 0 3.842-2.337 4.687-4.565 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.137 20.162 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                            </svg>
                            GitHub
                        </a>
                        <span class="text-slate-300 text-xs hidden md:block">|</span>
                        <div class="text-xs text-slate-400 font-mono hidden md:block">Connected</div>
                    </div>
                </div>
                <div class="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pb-10">
                    <div class="main-card p-6 md:p-8 rounded-xl min-h-[450px]">
                        ${content}
                    </div>
                </div>
            </main>
        </div>
    </div>
</body>
</html>
`;
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
    <div class="max-w-4xl mx-auto py-4">
      <div class="mb-10 border-b border-brand-border/30 pb-6 flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Configuration Wizard</h2>
          <p class="text-slate-400 text-sm">Deploy keys to authenticate Cloudflare DNS and Google Identity accounts.</p>
        </div>
        <span class="text-xs font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded bg-brand-primary/10 text-brand-primary border border-brand-primary/20 mt-3 md:mt-0">v1.2 Portal</span>
      </div>
      
      <form id="setup-form" method="POST" action="/setup" class="space-y-12">
        <!-- Cloudflare Section -->
        <section class="relative bg-brand-dark/40 border border-brand-border/40 rounded-2xl p-6 md:p-8">
          <div class="absolute -top-3.5 left-6 px-3 bg-brand-deep text-xs font-bold text-brand-primary tracking-widest uppercase border border-brand-border/40 rounded-full flex items-center gap-1.5 shadow-sm">
            <span class="h-4 w-4 bg-brand-primary/20 text-brand-primary rounded-full flex items-center justify-center text-[10px]">1</span>
            Cloudflare Connection
          </div>
          
          <div class="bg-brand-primary/5 border border-brand-primary/25 rounded-xl p-5 mb-6 mt-2">
            <h4 class="font-bold text-white font-display mb-2 text-sm">Step A: Provision your API Token</h4>
            <p class="text-slate-400 text-sm mb-4 leading-relaxed">Instantiate a secure scoped API token on Cloudflare with pre-defined Zone:Read and DNS:Edit permissions.</p>
            <a href="${cfTokenUrl}" target="_blank" class="btn-primary text-white text-xs px-5 py-2.5 rounded-lg font-bold inline-flex items-center gap-2 shadow-md">
              Create Token on Cloudflare 
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </a>
          </div>
          
          <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
            <label class="block text-xs font-bold text-slate-400 mb-2.5 uppercase tracking-wider font-mono">Step B: Paste Created Token</label>
            <input type="password" id="cf-token" name="CF_API_TOKEN" value="${settings.CF_API_TOKEN || ''}" 
                   placeholder="Paste your z6-... token here" required 
                   class="w-full text-sm font-mono focus:border-brand-primary focus:ring-brand-primary"
                   oninput="if(this.value.length > 20) { setTimeout(() => { document.getElementById('setup-form').submit(); }, 100); }">
            <p class="mt-2 text-[10px] text-slate-500 italic font-mono">(Form automatically saves on valid paste)</p>
          </div>
        </section>

        <!-- Google OAuth Section -->
        <section class="relative bg-brand-dark/40 border border-brand-border/40 rounded-2xl p-6 md:p-8">
          <div class="absolute -top-3.5 left-6 px-3 bg-brand-deep text-xs font-bold text-brand-secondary tracking-widest uppercase border border-brand-border/40 rounded-full flex items-center gap-1.5 shadow-sm">
            <span class="h-4 w-4 bg-brand-secondary/20 text-brand-secondary rounded-full flex items-center justify-center text-[10px]">2</span>
            Google OAuth Authentication
          </div>
          
          <div class="grid grid-cols-1 gap-6 mt-2">
            <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
              <label class="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider font-mono">Administrator Identity</label>
              <p class="text-[11px] text-slate-500 mb-3 font-mono">This Google email will possess administrative "Owner" clearance.</p>
              <input type="email" name="ADMIN_EMAIL" value="${settings.ADMIN_EMAIL || ''}" placeholder="admin@example.com" required class="w-full text-sm">
            </div>

            <div class="bg-brand-secondary/5 border border-brand-secondary/25 rounded-xl p-5">
              <h4 class="font-bold text-white font-display mb-2 text-sm">Step A: Add Authorized Redirect URI</h4>
              <p class="text-slate-400 text-sm mb-4 leading-relaxed">Map this secure callback endpoint inside your Google Cloud Console Credentials menu.</p>
              <div class="relative">
                <code class="block bg-slate-950 p-3.5 rounded-lg border border-brand-border/40 text-xs text-brand-secondary font-mono break-all pr-12 select-all">${redirectUri}</code>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
                <label class="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider font-mono">Step B: Client ID</label>
                <input type="text" name="GOOGLE_CLIENT_ID" value="${settings.GOOGLE_CLIENT_ID || ''}" placeholder="...apps.googleusercontent.com" required class="w-full text-xs font-mono">
              </div>
              <div class="bg-brand-deep/30 border border-brand-border/20 rounded-xl p-5">
                <label class="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider font-mono">Step C: Client Secret</label>
                <input type="password" name="GOOGLE_CLIENT_SECRET" value="${settings.GOOGLE_CLIENT_SECRET || ''}" required class="w-full text-xs font-mono">
              </div>
            </div>
          </div>
        </section>

        <div class="pt-8 flex justify-end">
          <button type="submit" class="btn-primary text-white px-8 py-3.5 rounded-xl font-bold text-sm tracking-wide flex items-center gap-2 transform transition hover:scale-102 active:scale-98">
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
            Save & Establish Portal
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
          ${zones.map((z: any) => `
            <tr class="hover:bg-brand-deep/30 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-white font-display">${z.name}</td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">${z.id}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${z.status === 'active' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}">
                  ${z.status}
                </span>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-bold">
                ${user.role === 'owner' ? `
                  ${syncedIds.has(z.id) 
                    ? `<form method="POST" action="/domains/unsync" style="display:inline;"><input type="hidden" name="id" value="${z.id}"><button type="submit" class="text-rose-500 hover:text-rose-400 font-bold transition">Disable Sync</button></form>`
                    : `<form method="POST" action="/domains/sync" style="display:inline;"><input type="hidden" name="id" value="${z.id}"><input type="hidden" name="name" value="${z.name}"><button type="submit" class="text-brand-primary hover:text-brand-primary/80 font-bold transition">Enable Sync</button></form>`
                  }
                ` : '<span class="text-slate-500 italic text-xs font-mono">Owner Required</span>'}
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
  
  // Get ownership metadata
  const { results: ownership } = await c.env.record_manager_db.prepare(
    'SELECT record_id, created_by_email FROM record_metadata WHERE domain_id = ?'
  ).bind(domainId).all()
  const ownershipMap = new Map(ownership.map((o: any) => [o.record_id, o.created_by_email]))

  const getTypeColor = (type: string) => {
    const colors: any = {
      'A': 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
      'AAAA': 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
      'CNAME': 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
      'TXT': 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
      'MX': 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
    }
    return colors[type] || 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
  }

  return c.html(layout(`Manage ${domain.zone_name}`, `
    <div class="flex justify-between items-center mb-8 pb-4 border-b border-brand-border/30">
      <div>
        <h2 class="text-2xl font-bold font-display text-white tracking-tight">${domain.zone_name}</h2>
        <p class="text-sm text-slate-400">Configure real-time DNS records on Cloudflare edge servers.</p>
      </div>
      <div class="flex gap-2">
        <button onclick="document.getElementById('add-record-panel').classList.toggle('hidden')" class="btn-primary text-white text-xs px-4 py-2.5 rounded-lg font-bold flex items-center gap-1.5 shadow-md">
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
          Add Record
        </button>
      </div>
    </div>
    
    <!-- Add Record Panel -->
    <div id="add-record-panel" class="hidden mb-8 bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6">
      <h3 class="text-xs font-bold text-white font-mono mb-4 uppercase tracking-wider">Create New DNS Record</h3>
      <form method="POST" action="/domains/${domainId}/records">
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
            <input type="text" name="name" placeholder="example.com" required class="w-full text-xs font-mono">
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-bold text-slate-400 mb-1 uppercase font-mono">Content</label>
            <input type="text" name="content" placeholder="1.2.3.4" required class="w-full text-xs font-mono">
          </div>
          <div class="md:col-span-1 flex flex-col items-center pb-2">
             <label class="block text-xs font-bold text-slate-400 mb-1.5 uppercase font-mono">Proxied</label>
             <input type="checkbox" name="proxied" class="h-4 w-4 rounded border-brand-border/40 text-brand-primary focus:ring-brand-primary bg-brand-deep/50">
          </div>
          <div class="md:col-span-5">
             <input type="hidden" name="ttl" value="1">
          </div>
          <div class="md:col-span-1">
            <button type="submit" class="w-full btn-primary text-white py-2 rounded-lg font-bold text-xs">Create</button>
          </div>
        </div>
      </form>
    </div>

    <div class="mb-6 flex justify-between items-center gap-4">
      <div class="relative w-full max-w-sm">
        <input type="text" id="record-search" placeholder="Filter records..." class="w-full pl-10 pr-4 py-2 bg-brand-deep/30 border border-brand-border/20 rounded-lg text-sm text-white placeholder-slate-500 focus:border-brand-primary focus:ring-brand-primary font-mono" onkeyup="filterRecords()">
        <svg class="absolute left-3 top-3 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <div class="text-xs text-slate-400 font-mono">Showing ${records.length} records</div>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-brand-border/20">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Type</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Name</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Content</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">TTL</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Proxy</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Actions</th>
          </tr>
        </thead>
        <tbody id="record-table-body" class="bg-transparent divide-y divide-brand-border/20">
          ${records.map((r: any) => {
            const creator = ownershipMap.get(r.id)
            const isOwnerOfRecord = creator === user.email
            const hasEditPermission = can(userLevel, 'edit') || isOwnerOfRecord
            const hasDeletePermission = can(userLevel, 'delete') || isOwnerOfRecord

            return `
            <tr class="record-row hover:bg-brand-deep/30 transition-colors" data-search="${r.type} ${r.name} ${r.content}">
              <td class="px-4 py-4 whitespace-nowrap">
                <div class="flex flex-col">
                  <span class="badge ${getTypeColor(r.type)} w-min">${r.type}</span>
                  ${isOwnerOfRecord ? '<span class="text-[9px] text-brand-primary font-bold mt-1 uppercase font-mono tracking-wider">Owner Only</span>' : ''}
                </div>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-white font-display">${r.name}</td>
              <td class="px-4 py-4 text-xs text-slate-300 font-mono break-all max-w-xs">${r.content}</td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-400 font-mono">${r.ttl === 1 ? 'Auto' : r.ttl}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                ${r.proxied ? `
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <svg class="h-2 w-2 mr-1.5 text-amber-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg> Proxied
                  </span>
                ` : `
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
                    <svg class="h-2 w-2 mr-1.5 text-slate-400" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" /></svg> DNS Only
                  </span>
                `}
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                <div class="flex justify-end gap-2">
                  ${hasEditPermission ? `<a href="/domains/${domainId}/records/${r.id}/edit" class="text-brand-primary hover:text-brand-primary/80 p-1 rounded transition hover:bg-brand-primary/10" title="Edit"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg></a>` : ''}
                  ${hasDeletePermission ? `
                    <form method="POST" action="/domains/${domainId}/records/${r.id}/delete" style="display:inline;" onsubmit="return confirm('Are you sure?')">
                      <button type="submit" class="text-rose-500 hover:text-rose-400 p-1 rounded transition hover:bg-rose-500/10" title="Delete">
                        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </form>
                  ` : ''}
                </div>
              </td>
            </tr>
          `}).join('')}
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
  
  // Track ownership
  if (result && result.id) {
    await c.env.record_manager_db.prepare(
      'INSERT INTO record_metadata (record_id, domain_id, created_by_email) VALUES (?, ?, ?)'
    ).bind(result.id, domainId, user.email).run()
  }

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
    <div class="max-w-2xl mx-auto py-4">
      <div class="mb-8 border-b border-brand-border/30 pb-5">
        <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Edit DNS Record</h2>
        <p class="text-slate-400 text-sm">Update DNS configurations and proxy status for <span class="font-mono text-brand-secondary font-bold">${record.name}</span>.</p>
      </div>

      <form method="POST" action="/domains/${domainId}/records/${recordId}" class="space-y-6 bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6 md:p-8">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">Record Type</label>
            <select name="type" class="w-full text-xs font-mono">
              ${['A', 'AAAA', 'CNAME', 'TXT', 'MX'].map(t => `<option value="${t}" ${record.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">TTL (Time To Live)</label>
            <input type="number" name="ttl" value="${record.ttl}" class="w-full text-xs font-mono">
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">Record Name</label>
          <input type="text" name="name" value="${record.name}" required class="w-full text-xs font-mono font-bold text-brand-secondary">
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-400 mb-2 uppercase font-mono">IPv4 Address / Target Content</label>
          <input type="text" name="content" value="${record.content}" required class="w-full text-xs font-mono">
        </div>

        <div class="flex items-center gap-2.5 py-2">
          <input type="checkbox" id="edit-proxied" name="proxied" ${record.proxied ? 'checked' : ''} class="h-4 w-4 rounded border-brand-border/40 text-brand-primary focus:ring-brand-primary bg-brand-deep/50">
          <label for="edit-proxied" class="text-xs font-bold text-slate-300 uppercase font-mono cursor-pointer">Proxy through Cloudflare Edge (CF CDN)</label>
        </div>

        <div class="pt-6 border-t border-brand-border/20 flex gap-4 justify-end">
          <a href="/domains/${domainId}" class="px-5 py-2.5 rounded-lg border border-brand-border/40 text-slate-300 hover:text-white font-bold text-xs tracking-wider transition">Cancel</a>
          <button type="submit" class="btn-primary text-white text-xs px-5 py-2.5 rounded-lg font-bold tracking-wider shadow-md">Update Configuration</button>
        </div>
      </form>
    </div>
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
    <div class="mb-8 border-b border-brand-border/30 pb-5">
      <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Identity Management</h2>
      <p class="text-slate-400 text-sm">Delegate domain access levels to trusted engineers and external operators.</p>
    </div>

    <div class="mb-8">
      <h3 class="text-xs font-bold text-slate-300 mb-4 uppercase tracking-wider font-mono">Provision Team Member</h3>
      <form method="POST" action="/users" class="bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6">
        <div class="flex flex-col md:flex-row gap-4 items-end">
          <div class="flex-1 w-full">
            <label class="block text-xs font-bold text-slate-400 mb-1.5 uppercase font-mono">Email Address</label>
            <input type="email" name="email" placeholder="user@example.com" required class="w-full text-xs font-mono">
          </div>
          <div class="w-full md:w-48">
            <label class="block text-xs font-bold text-slate-400 mb-1.5 uppercase font-mono">System Role</label>
            <select name="role" class="w-full text-xs">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" class="w-full md:w-auto btn-primary text-white px-6 py-2.5 rounded-xl font-bold text-xs tracking-wider transition">Add Identity</button>
        </div>
      </form>
    </div>
    
    <div class="overflow-x-auto mt-10">
      <table class="min-w-full divide-y divide-brand-border/20">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">User</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Role</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Access Clearances</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-border/20 bg-transparent">
          ${users.map((u: any) => `
            <tr class="hover:bg-brand-deep/20 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-sm font-semibold text-white font-display">${u.email}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="badge badge-${u.role}">${u.role}</span>
              </td>
              <td class="px-4 py-4 text-xs text-slate-300 font-mono">
                ${u.role === 'owner' ? '<span class="text-slate-500 italic">Full Administrative Override</span>' : `
                  <div class="space-y-3">
                    <ul class="list-disc pl-4 space-y-1 text-slate-400">
                      ${permissions.filter((p: any) => p.user_id === u.id).map((p: any) => {
                        const d = domains.find((dom: any) => dom.id === p.domain_id)
                        return `<li>${d?.zone_name}: <strong class="text-brand-primary uppercase">${p.level}</strong></li>`
                      }).join('')}
                    </ul>
                    <form method="POST" action="/users/${u.id}/permissions" class="flex gap-2 mt-3 items-center">
                      <select name="domain_id" class="text-xs py-1 px-2 border-brand-border/30 bg-slate-900 rounded font-mono text-slate-300">
                        ${domains.map((d: any) => `<option value="${d.id}">${d.zone_name}</option>`).join('')}
                      </select>
                      <select name="level" class="text-xs py-1 px-2 border-brand-border/30 bg-slate-900 rounded font-mono text-slate-300">
                        <option value="read">Read</option>
                        <option value="add">Add</option>
                        <option value="edit">Edit</option>
                        <option value="delete">Delete</option>
                      </select>
                      <button type="submit" class="bg-brand-primary/10 text-brand-primary border border-brand-primary/20 px-2.5 py-1.5 rounded text-xs font-bold hover:bg-brand-primary hover:text-white transition">Grant</button>
                    </form>
                  </div>
                `}
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-xs font-bold">
                ${u.role !== 'owner' ? `
                  <form method="POST" action="/users/${u.id}/delete" style="display:inline;" onsubmit="return confirm('Are you sure?')">
                    <button type="submit" class="text-rose-500 hover:text-rose-400 font-bold transition">Remove Identity</button>
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
    <div class="mb-8 border-b border-brand-border/30 pb-5">
      <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Audit Logs</h2>
      <p class="text-slate-400 text-sm">Chronological registry of DNS deployments and credential alterations.</p>
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
          ${logs.map((l: any) => `
            <tr class="hover:bg-brand-deep/30 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-400 font-mono">${l.user_email}</td>
              <td class="px-4 py-4 whitespace-nowrap">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-brand-primary/10 text-brand-primary border border-brand-primary/20 uppercase tracking-wider font-mono">${l.action}</span>
              </td>
              <td class="px-4 py-4 whitespace-nowrap">
                <div class="text-sm font-semibold text-white font-display">${l.resource_name}</div>
                <div class="text-xs text-slate-500 font-mono uppercase">${l.resource_type}</div>
              </td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">${l.created_at}</td>
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
    <div class="mb-8 border-b border-brand-border/30 pb-5">
      <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Access Blacklist</h2>
      <p class="text-slate-400 text-sm">Designate protected subdomains that are restricted to Owner-only write configurations.</p>
    </div>

    <div class="mb-8">
      <h3 class="text-xs font-bold text-slate-300 mb-4 uppercase tracking-wider font-mono">Create Protection Rule</h3>
      <form method="POST" action="/blacklist" class="bg-brand-deep/30 border border-brand-border/20 rounded-2xl p-6">
        <div class="flex flex-col md:flex-row gap-4 items-end">
          <div class="flex-1 w-full">
            <label class="block text-xs font-bold text-slate-400 mb-1.5 uppercase font-mono">Pattern (e.g. *.internal.com)</label>
            <input type="text" name="pattern" placeholder="*.dev.example.com" required class="w-full text-xs font-mono">
          </div>
          <button type="submit" class="w-full md:w-auto btn-primary text-white px-6 py-2.5 rounded-xl font-bold text-xs tracking-wider transition">Deploy Rule</button>
        </div>
      </form>
    </div>
    
    <div class="overflow-x-auto mt-10">
      <table class="min-w-full divide-y divide-brand-border/20">
        <thead class="table-header">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Blacklist Pattern</th>
            <th class="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Deployed Date</th>
            <th class="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-brand-border/20 bg-transparent">
          ${patterns.map((p: any) => `
            <tr class="hover:bg-brand-deep/20 transition-colors">
              <td class="px-4 py-4 whitespace-nowrap font-mono text-xs text-brand-secondary font-bold">${p.pattern}</td>
              <td class="px-4 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">${p.created_at}</td>
              <td class="px-4 py-4 whitespace-nowrap text-right text-xs font-bold">
                <form method="POST" action="/blacklist/${p.id}/delete" style="display:inline;">
                  <button type="submit" class="text-rose-500 hover:text-rose-400 font-bold transition">Remove Rule</button>
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
      <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 pb-5 border-b border-brand-border/30">
        <div>
          <h2 class="text-2xl font-bold font-display text-white mb-2 tracking-tight">Overview</h2>
          <p class="text-slate-400 text-sm">Authenticated clearance: <span class="text-brand-primary font-bold uppercase font-mono text-xs px-2 py-0.5 rounded bg-brand-primary/10 border border-brand-primary/25">${user.role}</span>. Scanned ${displayZones.length} domains.</p>
        </div>
        <div class="relative w-full md:w-64">
          <input type="text" id="domain-search" placeholder="Search domains..." class="w-full pl-10 pr-4 py-2.5 bg-brand-deep/30 border border-brand-border/20 rounded-lg text-sm text-white placeholder-slate-500 focus:border-brand-primary focus:ring-brand-primary font-mono" onkeyup="filterDomains()">
          <svg class="absolute left-3 top-3.5 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      ${displayZones.length === 0 ? `
        <div class="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-8 text-center">
          <div class="inline-flex items-center justify-center h-16 w-16 rounded-full bg-amber-500/10 text-amber-400 mb-4 border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.1)]">
            <svg class="h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 class="text-xl font-bold text-white font-display mb-2">No Registered Domains</h3>
          <p class="text-slate-400 mb-6 max-w-md mx-auto leading-relaxed text-sm">Cloudflare returned 0 active zones for your API token. Verify your configuration scopes or token status.</p>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-left max-w-2xl mx-auto mb-8">
            <div class="bg-brand-deep/30 p-4 rounded-xl border border-brand-border/20">
              <h4 class="font-bold text-white text-sm mb-1 font-display">Check API Scopes</h4>
              <p class="text-xs text-slate-400 font-mono leading-normal">Ensure your token is provisioned with Zone:Read and DNS:Edit policies.</p>
            </div>
            <div class="bg-brand-deep/30 p-4 rounded-xl border border-brand-border/20">
              <h4 class="font-bold text-white text-sm mb-1 font-display">Zone Account Mapping</h4>
              <p class="text-xs text-slate-400 font-mono leading-normal">Ensure the token account target matches the domain namespace on your profile.</p>
            </div>
          </div>
          
          <a href="/setup" class="btn-primary text-white text-xs px-6 py-3 rounded-lg font-bold inline-block shadow-md">Update Configuration</a>
        </div>
      ` : `
        <div id="domain-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          ${displayZones.map((z: any) => {
            const synced = syncedMap.get(z.id) as any
            const statusColor = z.status === 'active' ? 'text-green-400' : 'text-amber-400'
            const statusBg = z.status === 'active' ? 'bg-green-500/10 border-green-500/20' : 'bg-amber-500/10 border-amber-500/20'
            return `
              <div class="domain-card group relative bg-brand-dark/40 border border-brand-border/40 rounded-2xl p-5 hover:border-brand-primary/50 transition-all cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]" onclick="location.href='${synced ? `/domains/${synced.id}` : '#'}'" data-name="${z.name}">
                <div class="flex justify-between items-start mb-4">
                  <div class="h-10 w-10 bg-brand-primary/10 rounded-lg flex items-center justify-center text-brand-primary group-hover:bg-brand-primary group-hover:text-white transition-colors duration-300">
                    <svg class="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                  </div>
                  <div class="flex flex-col items-end gap-1.5">
                    <span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border ${statusBg} ${statusColor}">${z.status}</span>
                    ${synced 
                      ? '<span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-brand-primary/10 border border-brand-primary/20 text-brand-primary">Synced</span>' 
                      : '<span class="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-slate-500/10 border border-slate-500/25 text-slate-500">Unregistered</span>'}
                  </div>
                </div>
                <h3 class="text-base font-bold text-white font-display mb-1 truncate" title="${z.name}">${z.name}</h3>
                <p class="text-[11px] text-slate-500 font-mono mb-4 truncate">${z.id}</p>
                
                <div class="flex items-center justify-between pt-4 border-t border-brand-border/20">
                  ${synced ? `
                    <a href="/domains/${synced.id}" class="text-xs font-bold text-brand-primary hover:text-brand-primary/80 transition font-display">Manage DNS Gateways &rarr;</a>
                  ` : `
                    ${user.role === 'owner' ? `
                      <form method="POST" action="/domains/sync" style="margin:0" onclick="event.stopPropagation()">
                        <input type="hidden" name="id" value="${z.id}">
                        <input type="hidden" name="name" value="${z.name}">
                        <button type="submit" class="text-xs font-bold text-slate-400 hover:text-brand-primary transition">Register for Management</button>
                      </form>
                    ` : '<span class="text-xs text-slate-500 font-mono italic">Access Restricted</span>'}
                  `}
                </div>
              </div>
            `
          }).join('')}
        </div>
      `}

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
        <div class="inline-flex items-center justify-center h-16 w-16 rounded-full bg-red-500/10 text-red-400 mb-4 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)]">
          <svg class="h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 class="text-xl font-bold text-white font-display mb-2">Cloudflare Connection Timeout</h2>
        <p class="text-slate-400 mb-6 max-w-md mx-auto text-sm leading-relaxed">Could not establish contact with Cloudflare API endpoint using secure keys. Check API token validation settings.</p>
        <a href="/setup" class="btn-primary text-white text-xs px-6 py-3 rounded-lg font-bold inline-block shadow-md">Update Credentials</a>
      </div>
    `, user))
  }
})


export default app
