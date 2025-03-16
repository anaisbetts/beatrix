import { defer, firstValueFrom, from } from 'rxjs'
import { map, mergeAll, reduce, retry } from 'rxjs/operators'

export function asyncMap<T, TRet>(
  array: T[],
  selector: (x: T) => Promise<TRet>,
  maxConcurrency = 4
): Promise<Map<T, TRet>> {
  const promiseSelToObs = (k: T) =>
    defer(() => from(selector(k)).pipe(map((v) => ({ k, v }))))

  const ret = from(array).pipe(
    map(promiseSelToObs),
    mergeAll(maxConcurrency),
    reduce<{ k: T; v: TRet }, Map<T, TRet>>((acc, kvp) => {
      acc.set(kvp.k, kvp.v)
      return acc
    }, new Map())
  )

  return firstValueFrom(ret)
}

export async function asyncReduce<T, TAcc>(
  array: T[],
  selector: (acc: TAcc, x: T) => TAcc,
  seed: TAcc
) {
  let acc = seed
  for (const x of array) {
    acc = await selector(acc, x)
  }

  return acc
}

export function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function retryPromise<T>(
  func: () => Promise<T>,
  retries = 3
): Promise<T> {
  const ret = defer(() => from(func())).pipe(retry(retries))

  return firstValueFrom(ret)
}
