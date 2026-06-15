export function requireCronSecret(req, res, next) {
  const result = checkCronSecret(req)
  if (!result.ok) {
    res.status(result.status).json(result.data)
    return
  }
  next()
}

export function requireSitePassword(req, res, next) {
  const result = checkSitePassword(req)
  if (!result.ok) {
    if (result.wwwAuthenticate) {
      res.setHeader('WWW-Authenticate', result.wwwAuthenticate)
    }
    res.status(result.status).send(result.data)
    return
  }
  next()
}

export function checkCronSecret(req) {
  const secret = String(process.env.CRON_SECRET ?? '').trim()
  if (!secret) {
    return {
      ok: false,
      status: 503,
      data: {
        error: 'CRON_SECRET is not configured on the server',
      },
    }
  }

  const header =
    req.headers['x-cron-secret'] ||
    String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim()

  if (header !== secret) {
    return { ok: false, status: 401, data: { error: 'Invalid cron secret' } }
  }

  return { ok: true }
}

export function checkSitePassword(req) {
  const password = String(process.env.SITE_PASSWORD ?? '').trim()
  if (!password) {
    return { ok: true }
  }

  const header = String(req.headers.authorization ?? '')
  if (header.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
      const supplied = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded
      if (supplied === password) {
        return { ok: true }
      }
    } catch {
      // fall through to 401
    }
  }

  return {
    ok: false,
    status: 401,
    data: 'Authentication required',
    wwwAuthenticate: 'Basic realm="JobSnap"',
  }
}
