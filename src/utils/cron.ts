

export type CronFields = {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

type FieldRange = { min: number; max: number }

const FIELD_RANGES: FieldRange[] = [
  { min: 0, max: 59 }, 
  { min: 0, max: 23 }, 
  { min: 1, max: 31 }, 
  { min: 1, max: 12 }, 
  { min: 0, max: 6 }, 
]

function expandField(field: string, range: FieldRange): number[] | null {
  const { min, max } = range
  const out = new Set<number>()

  for (const part of field.split(',')) {
    
    const stepMatch = part.match(/^\*(?:\/(\d+))?$/)
    if (stepMatch) {
      const step = stepMatch[1] ? parseInt(stepMatch[1], 10) : 1
      if (step < 1) return null
      for (let i = min; i <= max; i += step) out.add(i)
      continue
    }

    
    const rangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (rangeMatch) {
      const lo = parseInt(rangeMatch[1]!, 10)
      const hi = parseInt(rangeMatch[2]!, 10)
      const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1
      
      const isDow = min === 0 && max === 6
      const effMax = isDow ? 7 : max
      if (lo > hi || step < 1 || lo < min || hi > effMax) return null
      for (let i = lo; i <= hi; i += step) {
        out.add(isDow && i === 7 ? 0 : i)
      }
      continue
    }

    
    const singleMatch = part.match(/^\d+$/)
    if (singleMatch) {
      let n = parseInt(part, 10)
      
      if (min === 0 && max === 6 && n === 7) n = 0
      if (n < min || n > max) return null
      out.add(n)
      continue
    }

    return null
  }

  if (out.size === 0) return null
  return Array.from(out).sort((a, b) => a - b)
}

export function parseCronExpression(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const expanded: number[][] = []
  for (let i = 0; i < 5; i++) {
    const result = expandField(parts[i]!, FIELD_RANGES[i]!)
    if (!result) return null
    expanded.push(result)
  }

  return {
    minute: expanded[0]!,
    hour: expanded[1]!,
    dayOfMonth: expanded[2]!,
    month: expanded[3]!,
    dayOfWeek: expanded[4]!,
  }
}

export function computeNextCronRun(
  fields: CronFields,
  from: Date,
): Date | null {
  const minuteSet = new Set(fields.minute)
  const hourSet = new Set(fields.hour)
  const domSet = new Set(fields.dayOfMonth)
  const monthSet = new Set(fields.month)
  const dowSet = new Set(fields.dayOfWeek)

  
  const domWild = fields.dayOfMonth.length === 31
  const dowWild = fields.dayOfWeek.length === 7

  
  const t = new Date(from.getTime())
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)

  const maxIter = 366 * 24 * 60
  for (let i = 0; i < maxIter; i++) {
    const month = t.getMonth() + 1
    if (!monthSet.has(month)) {
      
      t.setMonth(t.getMonth() + 1, 1)
      t.setHours(0, 0, 0, 0)
      continue
    }

    const dom = t.getDate()
    const dow = t.getDay()
    
    const dayMatches =
      domWild && dowWild
        ? true
        : domWild
          ? dowSet.has(dow)
          : dowWild
            ? domSet.has(dom)
            : domSet.has(dom) || dowSet.has(dow)

    if (!dayMatches) {
      
      t.setDate(t.getDate() + 1)
      t.setHours(0, 0, 0, 0)
      continue
    }

    if (!hourSet.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0)
      continue
    }

    if (!minuteSet.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1)
      continue
    }

    return t
  }

  return null
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function formatLocalTime(minute: number, hour: number): string {
  
  
  const d = new Date(2000, 0, 1, hour, minute)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatUtcTimeAsLocal(minute: number, hour: number): string {
  
  const d = new Date()
  d.setUTCHours(hour, minute, 0, 0)
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function cronToHuman(cron: string, opts?: { utc?: boolean }): string {
  const utc = opts?.utc ?? false
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]

  
  const everyMinMatch = minute.match(/^\*\/(\d+)$/)
  if (
    everyMinMatch &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const n = parseInt(everyMinMatch[1]!, 10)
    return n === 1 ? 'Every minute' : `Every ${n} minutes`
  }

  
  if (
    minute.match(/^\d+$/) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const m = parseInt(minute, 10)
    if (m === 0) return 'Every hour'
    return `Every hour at :${m.toString().padStart(2, '0')}`
  }

  
  const everyHourMatch = hour.match(/^\*\/(\d+)$/)
  if (
    minute.match(/^\d+$/) &&
    everyHourMatch &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const n = parseInt(everyHourMatch[1]!, 10)
    const m = parseInt(minute, 10)
    const suffix = m === 0 ? '' : ` at :${m.toString().padStart(2, '0')}`
    return n === 1 ? `Every hour${suffix}` : `Every ${n} hours${suffix}`
  }

  

  if (!minute.match(/^\d+$/) || !hour.match(/^\d+$/)) return cron
  const m = parseInt(minute, 10)
  const h = parseInt(hour, 10)
  const fmtTime = utc ? formatUtcTimeAsLocal : formatLocalTime

  
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every day at ${fmtTime(m, h)}`
  }

  
  if (dayOfMonth === '*' && month === '*' && dayOfWeek.match(/^\d$/)) {
    const dayIndex = parseInt(dayOfWeek, 10) % 7 
    let dayName: string | undefined
    if (utc) {
      
      
      const ref = new Date()
      const daysToAdd = (dayIndex - ref.getUTCDay() + 7) % 7
      ref.setUTCDate(ref.getUTCDate() + daysToAdd)
      ref.setUTCHours(h, m, 0, 0)
      dayName = DAY_NAMES[ref.getDay()]
    } else {
      dayName = DAY_NAMES[dayIndex]
    }
    if (dayName) return `Every ${dayName} at ${fmtTime(m, h)}`
  }

  
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${fmtTime(m, h)}`
  }

  return cron
}
