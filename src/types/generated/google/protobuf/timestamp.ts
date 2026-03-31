

export interface Timestamp {
  

  seconds?: number | undefined
  

  nanos?: number | undefined
}

function createBaseTimestamp(): Timestamp {
  return { seconds: 0, nanos: 0 }
}

export const Timestamp: MessageFns<Timestamp> = {
  fromJSON(object: any): Timestamp {
    return {
      seconds: isSet(object.seconds) ? globalThis.Number(object.seconds) : 0,
      nanos: isSet(object.nanos) ? globalThis.Number(object.nanos) : 0,
    }
  },

  toJSON(message: Timestamp): unknown {
    const obj: any = {}
    if (message.seconds !== undefined) {
      obj.seconds = Math.round(message.seconds)
    }
    if (message.nanos !== undefined) {
      obj.nanos = Math.round(message.nanos)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Timestamp>, I>>(base?: I): Timestamp {
    return Timestamp.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Timestamp>, I>>(
    object: I,
  ): Timestamp {
    const message = createBaseTimestamp()
    message.seconds = object.seconds ?? 0
    message.nanos = object.nanos ?? 0
    return message
  },
}

type Builtin =
  | Date
  | Function
  | Uint8Array
  | string
  | number
  | boolean
  | undefined

type DeepPartial<T> = T extends Builtin
  ? T
  : T extends globalThis.Array<infer U>
    ? globalThis.Array<DeepPartial<U>>
    : T extends ReadonlyArray<infer U>
      ? ReadonlyArray<DeepPartial<U>>
      : T extends {}
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : Partial<T>

type KeysOfUnion<T> = T extends T ? keyof T : never
type Exact<P, I extends P> = P extends Builtin
  ? P
  : P & { [K in keyof P]: Exact<P[K], I[K]> } & {
      [K in Exclude<keyof I, KeysOfUnion<P>>]: never
    }

function isSet(value: any): boolean {
  return value !== null && value !== undefined
}

interface MessageFns<T> {
  fromJSON(object: any): T
  toJSON(message: T): unknown
  create<I extends Exact<DeepPartial<T>, I>>(base?: I): T
  fromPartial<I extends Exact<DeepPartial<T>, I>>(object: I): T
}
