import chalk from 'chalk'
import type { DailyActivity } from './stats.js'
import { toDateString } from './statsCache.js'

export type HeatmapOptions = {
  terminalWidth?: number 
  showMonthLabels?: boolean
}

type Percentiles = {
  p25: number
  p50: number
  p75: number
}

function calculatePercentiles(
  dailyActivity: DailyActivity[],
): Percentiles | null {
  const counts = dailyActivity
    .map(a => a.messageCount)
    .filter(c => c > 0)
    .sort((a, b) => a - b)

  if (counts.length === 0) return null

  return {
    p25: counts[Math.floor(counts.length * 0.25)]!,
    p50: counts[Math.floor(counts.length * 0.5)]!,
    p75: counts[Math.floor(counts.length * 0.75)]!,
  }
}

export function generateHeatmap(
  dailyActivity: DailyActivity[],
  options: HeatmapOptions = {},
): string {
  const { terminalWidth = 80, showMonthLabels = true } = options

  
  
  const dayLabelWidth = 4
  const availableWidth = terminalWidth - dayLabelWidth
  const width = Math.min(52, Math.max(10, availableWidth))

  
  const activityMap = new Map<string, DailyActivity>()
  for (const activity of dailyActivity) {
    activityMap.set(activity.date, activity)
  }

  
  const percentiles = calculatePercentiles(dailyActivity)

  
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  
  const currentWeekStart = new Date(today)
  currentWeekStart.setDate(today.getDate() - today.getDay())

  
  const startDate = new Date(currentWeekStart)
  startDate.setDate(startDate.getDate() - (width - 1) * 7)

  
  
  const grid: string[][] = Array.from({ length: 7 }, () =>
    Array(width).fill(''),
  )
  const monthStarts: { month: number; week: number }[] = []
  let lastMonth = -1

  const currentDate = new Date(startDate)
  for (let week = 0; week < width; week++) {
    for (let day = 0; day < 7; day++) {
      
      if (currentDate > today) {
        grid[day]![week] = ' '
        currentDate.setDate(currentDate.getDate() + 1)
        continue
      }

      const dateStr = toDateString(currentDate)
      const activity = activityMap.get(dateStr)

      
      if (day === 0) {
        const month = currentDate.getMonth()
        if (month !== lastMonth) {
          monthStarts.push({ month, week })
          lastMonth = month
        }
      }

      
      const intensity = getIntensity(activity?.messageCount || 0, percentiles)
      grid[day]![week] = getHeatmapChar(intensity)

      currentDate.setDate(currentDate.getDate() + 1)
    }
  }

  
  const lines: string[] = []

  
  if (showMonthLabels) {
    const monthNames = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]

    
    const uniqueMonths = monthStarts.map(m => m.month)
    const labelWidth = Math.floor(width / Math.max(uniqueMonths.length, 1))
    const monthLabels = uniqueMonths
      .map(month => monthNames[month]!.padEnd(labelWidth))
      .join('')

    
    lines.push('    ' + monthLabels)
  }

  
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  
  for (let day = 0; day < 7; day++) {
    
    const label = [1, 3, 5].includes(day) ? dayLabels[day]!.padEnd(3) : '   '
    const row = label + ' ' + grid[day]!.join('')
    lines.push(row)
  }

  
  lines.push('')
  lines.push(
    '    Less ' +
      [
        claudeOrange('░'),
        claudeOrange('▒'),
        claudeOrange('▓'),
        claudeOrange('█'),
      ].join(' ') +
      ' More',
  )

  return lines.join('\n')
}

function getIntensity(
  messageCount: number,
  percentiles: Percentiles | null,
): number {
  if (messageCount === 0 || !percentiles) return 0

  if (messageCount >= percentiles.p75) return 4
  if (messageCount >= percentiles.p50) return 3
  if (messageCount >= percentiles.p25) return 2
  return 1
}

const claudeOrange = chalk.hex('#da7756')

function getHeatmapChar(intensity: number): string {
  switch (intensity) {
    case 0:
      return chalk.gray('·')
    case 1:
      return claudeOrange('░')
    case 2:
      return claudeOrange('▒')
    case 3:
      return claudeOrange('▓')
    case 4:
      return claudeOrange('█')
    default:
      return chalk.gray('·')
  }
}
