import { pino } from 'pino'
import { env, isProd } from './env.js'

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : isProd ? 'info' : 'debug',
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { ignore: 'pid,hostname,reqId,responseTime' } } }),
})
