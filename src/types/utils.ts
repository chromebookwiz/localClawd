export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
    : T extends ReadonlySet<infer U>
      ? ReadonlySet<DeepImmutable<U>>
      : T extends readonly (infer U)[]
        ? readonly DeepImmutable<U>[]
        : T extends object
          ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
          : T
