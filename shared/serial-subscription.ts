import { SubscriptionLike } from 'rxjs'

export class SerialSubscription implements SubscriptionLike {
  private _current?: SubscriptionLike
  private _isClosed = false

  get closed(): boolean {
    return this._isClosed
  }

  /**
   * The current subscription being managed by this SerialSubscription
   */
  get current(): SubscriptionLike | undefined {
    return this._current
  }

  /**
   * Sets a new disposable. If a previous one exists, it will be disposed.
   */
  set current(value: SubscriptionLike | undefined) {
    if (this._isClosed) {
      // If we're already closed, immediately dispose the new subscription
      value?.unsubscribe()
      return
    }

    // Dispose the previous subscription if it exists
    if (this._current) {
      this._current.unsubscribe()
    }

    this._current = value
  }

  constructor() {}

  /**
   * Disposes the currently held subscription and marks this SerialSubscription as closed.
   * Any future subscriptions set will be immediately disposed.
   */
  unsubscribe(): void {
    if (!this._isClosed) {
      this._isClosed = true
      if (this._current) {
        this._current.unsubscribe()
      }
      this._current = undefined
    }
  }
}
