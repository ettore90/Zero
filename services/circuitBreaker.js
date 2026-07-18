export class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;

    this.failures = 0;
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.lastFailureAt = 0;
  }

  isOpen() {
    if (this.state !== 'OPEN') return false;

    const elapsed = Date.now() - this.lastFailureAt;
    if (elapsed >= this.resetTimeout) {
      this.state = 'HALF_OPEN';
      return false;
    }

    return true;
  }

  canExecute() {
    return !this.isOpen();
  }

  recordSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureAt = 0;
  }

  recordFailure() {
    this.failures += 1;
    this.lastFailureAt = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  status() {
    return {
      state: this.state,
      failures: this.failures,
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout,
      lastFailureAt: this.lastFailureAt,
    };
  }

  reset() {
    this.failures = 0;
    this.state = 'CLOSED';
    this.lastFailureAt = 0;
  }
}

export const globalCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30000,
});