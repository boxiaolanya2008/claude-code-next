import { getActiveTimeCounter as getActiveTimeCounterImpl } from '../bootstrap/state.js'

type ActivityManagerOptions = {
  getNow?: () => number
  getActiveTimeCounter?: typeof getActiveTimeCounterImpl
}

export class ActivityManager {
  private activeOperations = new Set<string>()

  private lastUserActivityTime: number = 0 
  private lastCLIRecordedTime: number

  private isCLIActive: boolean = false

  private readonly USER_ACTIVITY_TIMEOUT_MS = 5000 

  private readonly getNow: () => number
  private readonly getActiveTimeCounter: typeof getActiveTimeCounterImpl

  private static instance: ActivityManager | null = null

  constructor(options?: ActivityManagerOptions) {
    this.getNow = options?.getNow ?? (() => Date.now())
    this.getActiveTimeCounter =
      options?.getActiveTimeCounter ?? getActiveTimeCounterImpl
    this.lastCLIRecordedTime = this.getNow()
  }

  static getInstance(): ActivityManager {
    if (!ActivityManager.instance) {
      ActivityManager.instance = new ActivityManager()
    }
    return ActivityManager.instance
  }

  

  static resetInstance(): void {
    ActivityManager.instance = null
  }

  

  static createInstance(options?: ActivityManagerOptions): ActivityManager {
    ActivityManager.instance = new ActivityManager(options)
    return ActivityManager.instance
  }

  

  recordUserActivity(): void {
    
    if (!this.isCLIActive && this.lastUserActivityTime !== 0) {
      const now = this.getNow()
      const timeSinceLastActivity = (now - this.lastUserActivityTime) / 1000

      if (timeSinceLastActivity > 0) {
        const activeTimeCounter = this.getActiveTimeCounter()
        if (activeTimeCounter) {
          const timeoutSeconds = this.USER_ACTIVITY_TIMEOUT_MS / 1000

          
          if (timeSinceLastActivity < timeoutSeconds) {
            activeTimeCounter.add(timeSinceLastActivity, { type: 'user' })
          }
        }
      }
    }

    
    this.lastUserActivityTime = this.getNow()
  }

  

  startCLIActivity(operationId: string): void {
    
    
    
    if (this.activeOperations.has(operationId)) {
      this.endCLIActivity(operationId)
    }

    const wasEmpty = this.activeOperations.size === 0
    this.activeOperations.add(operationId)

    if (wasEmpty) {
      this.isCLIActive = true
      this.lastCLIRecordedTime = this.getNow()
    }
  }

  

  endCLIActivity(operationId: string): void {
    this.activeOperations.delete(operationId)

    if (this.activeOperations.size === 0) {
      
      
      const now = this.getNow()
      const timeSinceLastRecord = (now - this.lastCLIRecordedTime) / 1000

      if (timeSinceLastRecord > 0) {
        const activeTimeCounter = this.getActiveTimeCounter()
        if (activeTimeCounter) {
          activeTimeCounter.add(timeSinceLastRecord, { type: 'cli' })
        }
      }

      this.lastCLIRecordedTime = now
      this.isCLIActive = false
    }
  }

  

  async trackOperation<T>(
    operationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.startCLIActivity(operationId)
    try {
      return await fn()
    } finally {
      this.endCLIActivity(operationId)
    }
  }

  

  getActivityStates(): {
    isUserActive: boolean
    isCLIActive: boolean
    activeOperationCount: number
  } {
    const now = this.getNow()
    const timeSinceUserActivity = (now - this.lastUserActivityTime) / 1000
    const isUserActive =
      timeSinceUserActivity < this.USER_ACTIVITY_TIMEOUT_MS / 1000

    return {
      isUserActive,
      isCLIActive: this.isCLIActive,
      activeOperationCount: this.activeOperations.size,
    }
  }
}

export const activityManager = ActivityManager.getInstance()
