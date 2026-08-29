const RANK = { debug: 10, info: 20, warn: 30, error: 40 }

export function createLogger(level = 'info', sink = console) {
  const threshold = RANK[level] ?? RANK.info
  function write(severity, message, fields = {}) {
    if ((RANK[severity] ?? 100) < threshold) return
    const record = { timestamp: new Date().toISOString(), severity, message, ...fields }
    const line = JSON.stringify(record)
    const method = severity === 'error' ? 'error' : severity === 'warn' ? 'warn' : 'log'
    sink[method](line)
  }
  return Object.freeze({
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  })
}
