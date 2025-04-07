import { describe, it, spyOn, expect } from 'bun:test'
import { Subscription } from 'rxjs'
import { SerialSubscription } from './serial-subscription'

describe('SerialSubscription', () => {
  it('should dispose previous subscription when new one is set', () => {
    const serialDisposable = new SerialSubscription()
    const sub1 = new Subscription()
    const sub2 = new Subscription()

    spyOn(sub1, 'unsubscribe')
    spyOn(sub2, 'unsubscribe')

    serialDisposable.current = sub1
    expect(serialDisposable.current).toBe(sub1)
    expect(sub1.unsubscribe).not.toHaveBeenCalled()

    serialDisposable.current = sub2
    expect(serialDisposable.current).toBe(sub2)
    expect(sub1.unsubscribe).toHaveBeenCalled()
    expect(sub2.unsubscribe).not.toHaveBeenCalled()
  })

  it('should dispose current subscription when SerialSubscription is unsubscribed', () => {
    const serialDisposable = new SerialSubscription()
    const sub = new Subscription()

    spyOn(sub, 'unsubscribe')

    serialDisposable.current = sub
    expect(sub.unsubscribe).not.toHaveBeenCalled()

    serialDisposable.unsubscribe()
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(serialDisposable.closed).toBe(true)
  })

  it('should immediately dispose new subscription if SerialSubscription is already closed', () => {
    const serialDisposable = new SerialSubscription()
    serialDisposable.unsubscribe()

    const sub = new Subscription()
    spyOn(sub, 'unsubscribe')

    serialDisposable.current = sub
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(serialDisposable.current).toBeUndefined()
  })
})
