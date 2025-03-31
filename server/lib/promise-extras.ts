import { defer, firstValueFrom, from, throwError } from 'rxjs'
import { map, mergeAll, reduce, retry, timeout } from 'rxjs/operators'

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
  selector: (acc: TAcc, x: T) => Promise<TAcc>,
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

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within the specified timeout,
 * the returned promise will reject with a TimeoutError.
 *
 * @param promise The promise to wrap with a timeout
 * @param timeoutMs The timeout duration in milliseconds
 * @param errorMessage Optional custom error message
 * @returns A new promise that will resolve with the original promise's result or reject with a TimeoutError
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  return firstValueFrom(
    from(promise).pipe(
      timeout({
        first: timeoutMs,
        with: () =>
          throwError(
            () =>
              new TimeoutError(
                message ?? `Promise timed out after ${timeoutMs}ms`
              )
          ),
      })
    )
  )
}

export function retryPromise<T>(
  func: () => Promise<T>,
  retries = 3
): Promise<T> {
  const ret = defer(() => from(func())).pipe(retry(retries))

  return firstValueFrom(ret)
}
