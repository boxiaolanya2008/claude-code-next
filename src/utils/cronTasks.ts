

import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  addSessionCronTask,
  getProjectRoot,
  getSessionCronTasks,
  removeSessionCronTasks,
} from '../bootstrap/state.js'
import { computeNextCronRun, parseCronExpression } from './cron.js'
import { logForDebugging } from './debug.js'
import { isFsInaccessible } from './errors.js'
import { getFsImplementation } from './fsOperations.js'
import { safeParseJSON } from './json.js'
import { logError } from './log.js'
import { jsonStringify } from './slowOperations.js'

export type CronTask = {
  id: string
  
  cron: string
  
  prompt: string
  
  createdAt: number
  

  lastFiredAt?: number
  
  recurring?: boolean
  

  permanent?: boolean
  

  durable?: boolean
  

  agentId?: string
}

type CronFile = { tasks: CronTask[] }

const CRON_FILE_REL = join('.claude', 'scheduled_tasks.json')

export function getCronFilePath(dir?: string): string {
  return join(dir ?? getProjectRoot(), CRON_FILE_REL)
}

export async function readCronTasks(dir?: string): Promise<CronTask[]> {
  const fs = getFsImplementation()
  let raw: string
  try {
    raw = await fs.readFile(getCronFilePath(dir), { encoding: 'utf-8' })
  } catch (e: unknown) {
    if (isFsInaccessible(e)) return []
    logError(e)
    return []
  }

  const parsed = safeParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return []
  const file = parsed as Partial<CronFile>
  if (!Array.isArray(file.tasks)) return []

  const out: CronTask[] = []
  for (const t of file.tasks) {
    if (
      !t ||
      typeof t.id !== 'string' ||
      typeof t.cron !== 'string' ||
      typeof t.prompt !== 'string' ||
      typeof t.createdAt !== 'number'
    ) {
      logForDebugging(
        `[ScheduledTasks] skipping malformed task: ${jsonStringify(t)}`,
      )
      continue
    }
    if (!parseCronExpression(t.cron)) {
      logForDebugging(
        `[ScheduledTasks] skipping task ${t.id} with invalid cron '${t.cron}'`,
      )
      continue
    }
    out.push({
      id: t.id,
      cron: t.cron,
      prompt: t.prompt,
      createdAt: t.createdAt,
      ...(typeof t.lastFiredAt === 'number'
        ? { lastFiredAt: t.lastFiredAt }
        : {}),
      ...(t.recurring ? { recurring: true } : {}),
      ...(t.permanent ? { permanent: true } : {}),
    })
  }
  return out
}

export function hasCronTasksSync(dir?: string): boolean {
  let raw: string
  try {
    
    raw = readFileSync(getCronFilePath(dir), 'utf-8')
  } catch {
    return false
  }
  const parsed = safeParseJSON(raw, false)
  if (!parsed || typeof parsed !== 'object') return false
  const tasks = (parsed as Partial<CronFile>).tasks
  return Array.isArray(tasks) && tasks.length > 0
}

export async function writeCronTasks(
  tasks: CronTask[],
  dir?: string,
): Promise<void> {
  const root = dir ?? getProjectRoot()
  await mkdir(join(root, '.claude'), { recursive: true })
  
  
  
  const body: CronFile = {
    tasks: tasks.map(({ durable: _durable, ...rest }) => rest),
  }
  await writeFile(
    getCronFilePath(root),
    jsonStringify(body, null, 2) + '\n',
    'utf-8',
  )
}

export async function addCronTask(
  cron: string,
  prompt: string,
  recurring: boolean,
  durable: boolean,
  agentId?: string,
): Promise<string> {
  
  
  const id = randomUUID().slice(0, 8)
  const task = {
    id,
    cron,
    prompt,
    createdAt: Date.now(),
    ...(recurring ? { recurring: true } : {}),
  }
  if (!durable) {
    addSessionCronTask({ ...task, ...(agentId ? { agentId } : {}) })
    return id
  }
  const tasks = await readCronTasks()
  tasks.push(task)
  await writeCronTasks(tasks)
  return id
}

export async function removeCronTasks(
  ids: string[],
  dir?: string,
): Promise<void> {
  if (ids.length === 0) return
  
  
  
  
  if (dir === undefined && removeSessionCronTasks(ids) === ids.length) {
    return
  }
  const idSet = new Set(ids)
  const tasks = await readCronTasks(dir)
  const remaining = tasks.filter(t => !idSet.has(t.id))
  if (remaining.length === tasks.length) return
  await writeCronTasks(remaining, dir)
}

export async function markCronTasksFired(
  ids: string[],
  firedAt: number,
  dir?: string,
): Promise<void> {
  if (ids.length === 0) return
  const idSet = new Set(ids)
  const tasks = await readCronTasks(dir)
  let changed = false
  for (const t of tasks) {
    if (idSet.has(t.id)) {
      t.lastFiredAt = firedAt
      changed = true
    }
  }
  if (!changed) return
  await writeCronTasks(tasks, dir)
}

export async function listAllCronTasks(dir?: string): Promise<CronTask[]> {
  const fileTasks = await readCronTasks(dir)
  if (dir !== undefined) return fileTasks
  const sessionTasks = getSessionCronTasks().map(t => ({
    ...t,
    durable: false as const,
  }))
  return [...fileTasks, ...sessionTasks]
}

export function nextCronRunMs(cron: string, fromMs: number): number | null {
  const fields = parseCronExpression(cron)
  if (!fields) return null
  const next = computeNextCronRun(fields, new Date(fromMs))
  return next ? next.getTime() : null
}

export type CronJitterConfig = {
  
  recurringFrac: number
  
  recurringCapMs: number
  
  oneShotMaxMs: number
  

  oneShotFloorMs: number
  

  oneShotMinuteMod: number
  

  recurringMaxAgeMs: number
}

export const DEFAULT_CRON_JITTER_CONFIG: CronJitterConfig = {
  recurringFrac: 0.1,
  recurringCapMs: 15 * 60 * 1000,
  oneShotMaxMs: 90 * 1000,
  oneShotFloorMs: 0,
  oneShotMinuteMod: 30,
  recurringMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
}

function jitterFrac(taskId: string): number {
  const frac = parseInt(taskId.slice(0, 8), 16) / 0x1_0000_0000
  return Number.isFinite(frac) ? frac : 0
}

export function jitteredNextCronRunMs(
  cron: string,
  fromMs: number,
  taskId: string,
  cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
  const t1 = nextCronRunMs(cron, fromMs)
  if (t1 === null) return null
  const t2 = nextCronRunMs(cron, t1)
  
  
  if (t2 === null) return t1
  const jitter = Math.min(
    jitterFrac(taskId) * cfg.recurringFrac * (t2 - t1),
    cfg.recurringCapMs,
  )
  return t1 + jitter
}

export function oneShotJitteredNextCronRunMs(
  cron: string,
  fromMs: number,
  taskId: string,
  cfg: CronJitterConfig = DEFAULT_CRON_JITTER_CONFIG,
): number | null {
  const t1 = nextCronRunMs(cron, fromMs)
  if (t1 === null) return null
  
  
  
  
  
  
  if (new Date(t1).getMinutes() % cfg.oneShotMinuteMod !== 0) return t1
  
  
  
  const lead =
    cfg.oneShotFloorMs +
    jitterFrac(taskId) * (cfg.oneShotMaxMs - cfg.oneShotFloorMs)
  
  
  return Math.max(t1 - lead, fromMs)
}

export function findMissedTasks(tasks: CronTask[], nowMs: number): CronTask[] {
  return tasks.filter(t => {
    const next = nextCronRunMs(t.cron, t.createdAt)
    return next !== null && next < nowMs
  })
}
