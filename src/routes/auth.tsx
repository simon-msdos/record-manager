import { Hono } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import { googleAuth } from '@hono/oauth-providers/google'
import { h, Fragment } from 'hono/jsx'
import { layout } from '../templates/layout'

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
}

const auth = new Hono<{ Bindings: Bindings; Variables: Variables }>()

auth.use('/google', (c, next) => {
  const settings = c.get('settings')
  if (!settings.GOOGLE_CLIENT_ID || !settings.GOOGLE_CLIENT_SECRET) {
    return c.text('Google OAuth not configured', 400)
  }
  
  const googleAuthMiddleware = googleAuth({
    client_id: settings.GOOGLE_CLIENT_ID,
    client_secret: settings.GOOGLE_CLIENT_SECRET,
    scope: ['email', 'profile']
  })
  return googleAuthMiddleware(c, next)
})

auth.get('/google', async (c) => {
  const user = c.get('user-google')
  
  if (!user?.email) return c.redirect('/')

  // Check if user exists, if not and first user, make owner
  const db = c.env.record_manager_db
  let dbUser = await db.prepare('SELECT * FROM users WHERE email = ?').bind(user.email).first<any>()
  
  if (!dbUser) {
    const { count } = await db.prepare('SELECT COUNT(*) as count FROM users').first<any>()
    const role = count === 0 ? 'owner' : 'user'
    await db.prepare('INSERT INTO users (email, role) VALUES (?, ?)').bind(user.email, role).run()
    dbUser = { email: user.email, role }
  }

  // Set cookie for 30 days
  const expiration = new Date()
  expiration.setDate(expiration.getDate() + 30)
  
  await setSignedCookie(c, 'user', user.email, c.get('systemSecret'), {
    path: '/',
    secure: true,
    httpOnly: true,
    expires: expiration,
    sameSite: 'Lax'
  })

  return c.redirect('/dashboard')
})

auth.get('/logout', (c) => {
  deleteCookie(c, 'user')
  return c.redirect('/')
})

export default auth
