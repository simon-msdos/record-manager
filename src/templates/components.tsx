import { h, Fragment } from 'hono/jsx'
import { FlashMessage as FlashMessageType } from '../lib/session'

export const Badge = ({ children, type = 'user' }: { children: any, type?: 'owner' | 'admin' | 'user' | 'success' | 'error' | 'warning' }) => {
  const styles: any = {
    owner: 'badge-owner',
    admin: 'badge-admin',
    user: 'badge-user',
    success: 'bg-green-500/10 text-green-400 border border-green-500/20',
    error: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
  }
  return (
    <span class={`badge ${styles[type] || styles.user} uppercase font-mono`}>
      {children}
    </span>
  )
}

export const Button = ({ children, type = 'button', variant = 'primary', ...props }: any) => {
  const variants: any = {
    primary: 'btn-primary',
    secondary: 'px-5 py-2.5 rounded-lg border border-brand-border/40 text-slate-300 hover:text-white font-bold text-xs tracking-wider transition',
    danger: 'text-rose-500 hover:text-rose-400 p-1 rounded transition hover:bg-rose-500/10'
  }
  return (
    <button type={type} class={variants[variant]} {...props}>
      {children}
    </button>
  )
}

export const Card = ({ children, title, icon, class: className = '' }: any) => (
  <div class={`main-card p-6 md:p-8 rounded-xl ${className}`}>
    {title && (
      <div class="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
        {icon}
        <h2 class="text-base font-semibold text-slate-900">{title}</h2>
      </div>
    )}
    {children}
  </div>
)

export const Flash = ({ message }: { message: FlashMessageType }) => {
  const styles: any = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    error: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    info: 'bg-brand-primary/10 text-brand-primary border-brand-primary/20'
  }
  return (
    <div class={`mb-6 p-4 rounded-xl border ${styles[message.type]} flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300`}>
      {message.type === 'success' && <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      {message.type === 'error' && <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      <span class="text-sm font-medium">{message.text}</span>
    </div>
  )
}
