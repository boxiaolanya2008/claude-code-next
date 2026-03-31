

export class FlushGate<T> {
  private _active = false
  private _pending: T[] = []

  get active(): boolean {
    return this._active
  }

  get pendingCount(): number {
    return this._pending.length
  }

  
  start(): void {
    this._active = true
  }

  

  end(): T[] {
    this._active = false
    return this._pending.splice(0)
  }

  

  enqueue(...items: T[]): boolean {
    if (!this._active) return false
    this._pending.push(...items)
    return true
  }

  

  drop(): number {
    this._active = false
    const count = this._pending.length
    this._pending.length = 0
    return count
  }

  

  deactivate(): void {
    this._active = false
  }
}
