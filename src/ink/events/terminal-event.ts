import { Event } from './event.js'

type EventPhase = 'none' | 'capturing' | 'at_target' | 'bubbling'

type TerminalEventInit = {
  bubbles?: boolean
  cancelable?: boolean
}

export class TerminalEvent extends Event {
  readonly type: string
  readonly timeStamp: number
  readonly bubbles: boolean
  readonly cancelable: boolean

  private _target: EventTarget | null = null
  private _currentTarget: EventTarget | null = null
  private _eventPhase: EventPhase = 'none'
  private _propagationStopped = false
  private _defaultPrevented = false

  constructor(type: string, init?: TerminalEventInit) {
    super()
    this.type = type
    this.timeStamp = performance.now()
    this.bubbles = init?.bubbles ?? true
    this.cancelable = init?.cancelable ?? true
  }

  get target(): EventTarget | null {
    return this._target
  }

  get currentTarget(): EventTarget | null {
    return this._currentTarget
  }

  get eventPhase(): EventPhase {
    return this._eventPhase
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented
  }

  stopPropagation(): void {
    this._propagationStopped = true
  }

  override stopImmediatePropagation(): void {
    super.stopImmediatePropagation()
    this._propagationStopped = true
  }

  preventDefault(): void {
    if (this.cancelable) {
      this._defaultPrevented = true
    }
  }

  

  
  _setTarget(target: EventTarget): void {
    this._target = target
  }

  
  _setCurrentTarget(target: EventTarget | null): void {
    this._currentTarget = target
  }

  
  _setEventPhase(phase: EventPhase): void {
    this._eventPhase = phase
  }

  
  _isPropagationStopped(): boolean {
    return this._propagationStopped
  }

  
  _isImmediatePropagationStopped(): boolean {
    return this.didStopImmediatePropagation()
  }

  

  _prepareForTarget(_target: EventTarget): void {}
}

export type EventTarget = {
  parentNode: EventTarget | undefined
  _eventHandlers?: Record<string, unknown>
}
