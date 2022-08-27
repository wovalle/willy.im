// https://github.com/sindresorhus/type-fest/blob/main/source/promise-value.d.ts
export type PromiseValue<PromiseType, Otherwise = PromiseType> = PromiseType extends Promise<
  infer Value
>
  ? { 0: PromiseValue<Value>; 1: Value }[PromiseType extends Promise<unknown> ? 0 : 1]
  : Otherwise

//https://stackoverflow.com/a/60889260/2533474
export type ExtractReturnedPromiseFn<T extends (...args: any) => any> = PromiseValue<ReturnType<T>>
