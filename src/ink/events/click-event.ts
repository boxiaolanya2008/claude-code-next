import { Event } from './event.js'

export class ClickEvent extends Event {
  /** 0-indexed screen column of the click */
  readonly col: number
  
  readonly row: number
  

  localCol = 0
  
  localRow = 0
  

  readonly cellIsBlank: boolean

  constructor(col: number, row: number, cellIsBlank: boolean) {
    super()
    this.col = col
    this.row = row
    this.cellIsBlank = cellIsBlank
  }
}
