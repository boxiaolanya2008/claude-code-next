import { Database } from 'bun:sqlite'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

export interface SessionRecord {
  id: string
  startTime: number
  endTime?: number
  model: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  messageCount: number
  toolUseCount: number
}

export interface TokenUsageRecord {
  id: number
  sessionId: string
  timestamp: number
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  messageType: 'user' | 'assistant'
}

export interface DailyStatRecord {
  date: string
  totalInput: number
  totalOutput: number
  totalCacheRead: number
  totalCacheCreation: number
  sessionCount: number
}

let db: Database | null = null

function getDbPath(): string {
  const appDataDir = process.env.APPDATA || join(process.env.HOME || '~', '.config')
  const claudeDir = join(appDataDir, '.claude')
  
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true })
  }
  
  return join(claudeDir, 'sessions.db')
}

// Convert UTC timestamp to Beijing time date string (YYYY-MM-DD)
function utcToBeijingDate(timestamp: number): string {
  const date = new Date(timestamp)
  const beijingOffset = 8 * 60 * 60 * 1000
  const beijingTime = new Date(date.getTime() + beijingOffset)
  const year = beijingTime.getUTCFullYear()
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0')
  const day = String(beijingTime.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function initDatabase(): Database {
  if (db) return db
  
  try {
    const dbPath = getDbPath()
    db = new Database(dbPath)
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        startTime INTEGER NOT NULL,
        endTime INTEGER,
        model TEXT NOT NULL,
        totalInputTokens INTEGER DEFAULT 0,
        totalOutputTokens INTEGER DEFAULT 0,
        totalCacheReadTokens INTEGER DEFAULT 0,
        totalCacheCreationTokens INTEGER DEFAULT 0,
        messageCount INTEGER DEFAULT 0,
        toolUseCount INTEGER DEFAULT 0
      )
    `)
    
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        model TEXT NOT NULL,
        inputTokens INTEGER DEFAULT 0,
        outputTokens INTEGER DEFAULT 0,
        cacheReadTokens INTEGER DEFAULT 0,
        cacheCreationTokens INTEGER DEFAULT 0,
        messageType TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES sessions(id)
      )
    `)
    
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_startTime ON sessions(startTime);
      CREATE INDEX IF NOT EXISTS idx_token_usage_sessionId ON token_usage(sessionId);
      CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp);
    `)
    
    return db
  } catch (error) {
    console.error('[Dashboard] Failed to initialize database:', error)
    throw error
  }
}

export function getDatabase(): Database {
  if (!db) {
    return initDatabase()
  }
  return db
}

export function insertSession(session: SessionRecord): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO sessions 
    (id, startTime, endTime, model, totalInputTokens, totalOutputTokens, 
     totalCacheReadTokens, totalCacheCreationTokens, messageCount, toolUseCount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    session.id,
    session.startTime,
    session.endTime || null,
    session.model,
    session.totalInputTokens,
    session.totalOutputTokens,
    session.totalCacheReadTokens,
    session.totalCacheCreationTokens,
    session.messageCount,
    session.toolUseCount
  )
}

export function updateSession(sessionId: string, updates: Partial<SessionRecord>): void {
  const db = getDatabase()
  const fields: string[] = []
  const values: any[] = []
  
  if (updates.endTime !== undefined) {
    fields.push('endTime = ?')
    values.push(updates.endTime)
  }
  if (updates.totalInputTokens !== undefined) {
    fields.push('totalInputTokens = ?')
    values.push(updates.totalInputTokens)
  }
  if (updates.totalOutputTokens !== undefined) {
    fields.push('totalOutputTokens = ?')
    values.push(updates.totalOutputTokens)
  }
  if (updates.totalCacheReadTokens !== undefined) {
    fields.push('totalCacheReadTokens = ?')
    values.push(updates.totalCacheReadTokens)
  }
  if (updates.totalCacheCreationTokens !== undefined) {
    fields.push('totalCacheCreationTokens = ?')
    values.push(updates.totalCacheCreationTokens)
  }
  if (updates.messageCount !== undefined) {
    fields.push('messageCount = ?')
    values.push(updates.messageCount)
  }
  if (updates.toolUseCount !== undefined) {
    fields.push('toolUseCount = ?')
    values.push(updates.toolUseCount)
  }
  
  if (fields.length === 0) return
  
  values.push(sessionId)
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
  stmt.run(...values)
}

export function insertTokenUsage(usage: Omit<TokenUsageRecord, 'id'>): void {
  const db = getDatabase()
  const stmt = db.prepare(`
    INSERT INTO token_usage 
    (sessionId, timestamp, model, inputTokens, outputTokens, 
     cacheReadTokens, cacheCreationTokens, messageType)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  
  stmt.run(
    usage.sessionId,
    usage.timestamp,
    usage.model,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheCreationTokens,
    usage.messageType
  )
}

export function getAllSessions(): SessionRecord[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY startTime DESC')
  return stmt.all() as SessionRecord[]
}

export function getSessionById(sessionId: string): SessionRecord | undefined {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?')
  return stmt.get(sessionId) as SessionRecord | undefined
}

export function getTokenUsageBySession(sessionId: string): TokenUsageRecord[] {
  const db = getDatabase()
  const stmt = db.prepare('SELECT * FROM token_usage WHERE sessionId = ? ORDER BY timestamp')
  return stmt.all(sessionId) as TokenUsageRecord[]
}

export function getTokenUsageCount(): number {
  const db = getDatabase()
  const result = db.prepare('SELECT COUNT(*) as cnt FROM token_usage').get() as { cnt: number }
  return result.cnt
}

export function getDailyStats(days: number = 30): DailyStatRecord[] {
  const db = getDatabase()
  const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000)
  
  const stmt = db.prepare(`
    SELECT 
      timestamp,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      sessionId
    FROM token_usage
    WHERE timestamp >= ?
    ORDER BY timestamp
  `)
  
  const rows = stmt.all(cutoffTime) as Array<{
    timestamp: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    sessionId: string
  }>
  
  // Group by Beijing time date
  const dailyMap = new Map<string, DailyStatRecord>()
  const sessionSetByDay = new Map<string, Set<string>>()
  
  for (const row of rows) {
    const dateStr = utcToBeijingDate(row.timestamp)
    
    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, {
        date: dateStr,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        sessionCount: 0,
      })
      sessionSetByDay.set(dateStr, new Set())
    }
    
    const day = dailyMap.get(dateStr)!
    day.totalInput += row.inputTokens || 0
    day.totalOutput += row.outputTokens || 0
    day.totalCacheRead += row.cacheReadTokens || 0
    day.totalCacheCreation += row.cacheCreationTokens || 0
    sessionSetByDay.get(dateStr)!.add(row.sessionId)
  }
  
  // Update session counts
  for (const [date, sessions] of sessionSetByDay) {
    const day = dailyMap.get(date)
    if (day) {
      day.sessionCount = sessions.size
    }
  }
  
  // Sort by date and return
  const result = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))
  
  // Fill in missing dates with zero values
  const allDates: string[] = []
  const now = new Date()
  const beijingOffset = 8 * 60 * 60 * 1000
  const beijingNow = new Date(now.getTime() + beijingOffset)
  
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(beijingNow.getTime() - i * 24 * 60 * 60 * 1000)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    allDates.push(`${year}-${month}-${day}`)
  }
  
  const filled: DailyStatRecord[] = []
  for (const date of allDates) {
    if (dailyMap.has(date)) {
      filled.push(dailyMap.get(date)!)
    } else {
      filled.push({
        date,
        totalInput: 0,
        totalOutput: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        sessionCount: 0,
      })
    }
  }
  
  return filled
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
