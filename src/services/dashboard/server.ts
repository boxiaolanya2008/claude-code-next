import { createServer, IncomingMessage, ServerResponse } from 'http'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  getAllSessions,
  getSessionById,
  getTokenUsageBySession,
  getDailyStats,
  getTokenUsageCount,
} from './database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// SSE clients
const sseClients: ServerResponse[] = []

function sendJSON(res: ServerResponse, data: any, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function sendHTML(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

function sendSSE(res: ServerResponse, event: string, data: any): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function getApiConfig(): any {
  try {
    const { getGlobalConfig } = require('../../utils/config.js')
    const { getMainLoopModel } = require('../../utils/model/model.js')

    const config = getGlobalConfig()
    // Use getMainLoopModel to get the actual model being used
    const currentModel = getMainLoopModel()

    return {
      hasApiKey: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || config.primaryApiKey),
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      model: currentModel,
    }
  } catch (error) {
    console.error('[Dashboard] getApiConfig error:', error)
    return {
      hasApiKey: false,
      baseUrl: 'Not configured',
      model: 'Not configured',
    }
  }
}

function getDashboardData(): any {
  try {
    const sessions = getAllSessions()
    const dailyStats = getDailyStats(30)
    
    let totalInput = 0
    let totalOutput = 0
    let totalCacheRead = 0
    let totalCacheCreation = 0
    
    sessions.forEach((session: any) => {
      totalInput += session.totalInputTokens || 0
      totalOutput += session.totalOutputTokens || 0
      totalCacheRead += session.totalCacheReadTokens || 0
      totalCacheCreation += session.totalCacheCreationTokens || 0
    })
    
    const cacheEfficiency = totalInput > 0 
      ? ((totalCacheRead / (totalInput + totalCacheRead)) * 100).toFixed(1)
      : '0.0'
    
    return {
      config: getApiConfig(),
      stats: {
        totalSessions: sessions.length,
        totalInput,
        totalOutput,
        totalCacheRead,
        totalCacheCreation,
        cacheEfficiency,
      },
      sessions: sessions.slice(0, 20),
      dailyStats,
      timestamp: Date.now(),
    }
  } catch (error) {
    return { error: 'Failed to fetch data' }
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '/'
  
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  
  try {
    if (url === '/' || url === '/index.html') {
      const htmlPath = join(__dirname, 'dashboard.html')
      const html = readFileSync(htmlPath, 'utf-8')
      sendHTML(res, html)
    } else if (url === '/api/config') {
      sendJSON(res, getApiConfig())
    } else if (url === '/api/sessions') {
      sendJSON(res, getAllSessions())
    } else if (url === '/api/daily-stats') {
      const urlObj = new URL(url, `http://${req.headers.host}`)
      const days = parseInt(urlObj.searchParams.get('days') || '30', 10)
      sendJSON(res, getDailyStats(days))
    } else if (url === '/api/data') {
      sendJSON(res, getDashboardData())
    } else if (url === '/api/sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write('\n')
      
      sseClients.push(res)
      
      req.on('close', () => {
        const idx = sseClients.indexOf(res)
        if (idx !== -1) sseClients.splice(idx, 1)
      })
    } else if (url.startsWith('/api/sessions/')) {
      const sessionId = url.split('/')[3]
      const session = getSessionById(sessionId)
      if (session) {
        sendJSON(res, session)
      } else {
        sendJSON(res, { error: 'Session not found' }, 404)
      }
    } else if (url.startsWith('/api/token-usage/')) {
      const sessionId = url.split('/')[3]
      const usage = getTokenUsageBySession(sessionId)
      sendJSON(res, usage)
    } else {
      sendJSON(res, { error: 'Not found' }, 404)
    }
  } catch (error) {
    console.error('Dashboard server error:', error)
    sendJSON(res, { error: 'Internal server error' }, 500)
  }
}

let server: ReturnType<typeof createServer> | null = null

export function startDashboardServer(port = 3456): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(port)
      return
    }
    
    server = createServer(handleRequest)
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        server = null
        startDashboardServer(port + 1).then(resolve).catch(reject)
      } else {
        reject(err)
      }
    })
    
    server.listen(port, '127.0.0.1', () => {
      console.log(`\nDashboard server started at http://127.0.0.1:${port}`)
      resolve(port)
    })
  })
}

export function broadcastUpdate(): number {
  if (sseClients.length === 0) {
    console.log('[Dashboard] No SSE clients connected')
    return 0
  }

  const data = getDashboardData()
  const toRemove: number[] = []

  sseClients.forEach((client, idx) => {
    try {
      sendSSE(client, 'update', data)
    } catch {
      toRemove.push(idx)
    }
  })

  for (let i = toRemove.length - 1; i >= 0; i--) {
    sseClients.splice(toRemove[i], 1)
  }

  console.log('[Dashboard] Broadcast update sent to', sseClients.length, 'clients')
  return sseClients.length
}

export function stopDashboardServer(): void {
  if (server) {
    sseClients.forEach(client => client.end())
    sseClients.length = 0
    server.close()
    server = null
  }
}
