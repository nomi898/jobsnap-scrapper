export function requireCronSecret(req, res, next) {
  const secret = String(process.env.CRON_SECRET ?? '').trim()
  if (!secret) {
    res.status(503).json({
      error: 'CRON_SECRET is not configured on the server',
    })
    return
  }

  const header =
    req.headers['x-cron-secret'] ||
    String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()

  if (header !== secret) {
    res.status(401).json({ error: 'Invalid cron secret' })
    return
  }

  next()
}

export function requireSitePassword(req, res, next) {
  const password = String(process.env.SITE_PASSWORD ?? '').trim()
  if (!password) {
    next()
    return
  }

  const header = String(req.headers.authorization ?? '')
  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const supplied = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded
      if (supplied === password) {
        next()
        return
      }
    } catch {
      // fall through to 401
    }
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="JobSnap"')
  res.status(401).send('Authentication required')
}
