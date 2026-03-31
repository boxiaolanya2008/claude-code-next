

import { createSignal } from './signal.js'

export class QueryGuard {
  private _status: 'idle' | 'dispatching' | 'running' = 'idle'
  private _generation = 0
  private _changed = createSignal()

  

  reserve(): boolean {
    if (this._status !== 'idle') return false
    this._status = 'dispatching'
    this._notify()
    return true
  }

  

  cancelReservation(): void {
    if (this._status !== 'dispatching') return
    this._status = 'idle'
    this._notify()
  }

  

  tryStart(): number | null {
    if (this._status === 'running') return null
    this._status = 'running'
    ++this._generation
    this._notify()
    return this._generation
  }

  

  end(generation: number): boolean {
    if (this._generation !== generation) return false
    if (this._status !== 'running') return false
    this._status = 'idle'
    this._notify()
    return true
  }

  

  forceEnd(): void {
    if (this._status === 'idle') return
    this._status = 'idle'
    ++this._generation
    this._notify()
  }

  

  get isActive(): boolean {
    return this._status !== 'idle'
  }

  get generation(): number {
    return this._generation
  }

  
  

  
  subscribe = this._changed.subscribe

  
  getSnapshot = (): boolean => {
    return this._status !== 'idle'
  }

  private _notify(): void {
    this._changed.emit()
  }
}
