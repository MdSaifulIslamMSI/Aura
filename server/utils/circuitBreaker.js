/**
 * circuitBreaker.js — Lightweight circuit breaker for external service calls
 *
 * Implements the classic CLOSED → OPEN → HALF-OPEN state machine.
 *
 * CLOSED  : normal operation, failures are counted.
 * OPEN    : circuit tripped — calls fail immediately (fail fast), no upstream hit.
 * HALF-OPEN: after cooldown, one probe request is allowed through to test recovery.
 *
 * Used to protect calls to:
 *   - Groq AI API
 *   - Voyage embedding API
 *   - Resend email API
 *   - Any other external HTTP dependency
 *
 * Usage:
 *   const breaker = new CircuitBreaker({ name: 'groq', failureThreshold: 5 });
 *   const result = await breaker.call(() => fetch(...));
 */

const logger = require('./logger');

const STATE = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

class CircuitBreaker {
    /**
     * @param {object} opts
     * @param {string}  opts.name             — Human-readable name for logging
     * @param {number}  [opts.failureThreshold=5]  — Failures before opening
     * @param {number}  [opts.successThreshold=2]  — Successes in HALF_OPEN to close
     * @param {number}  [opts.cooldownMs=30000]     — Time OPEN before moving to HALF_OPEN
     * @param {number}  [opts.callTimeoutMs=15000]  — Max ms to wait for a single call
     */
    constructor({
        name,
        failureThreshold = 5,
        successThreshold = 2,
        cooldownMs = 30_000,
        callTimeoutMs = 15_000,
    } = {}) {
        this.name = String(name || 'unnamed');
        this.failureThreshold = failureThreshold;
        this.successThreshold = successThreshold;
        this.cooldownMs = cooldownMs;
        this.callTimeoutMs = callTimeoutMs;

        this._state = STATE.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        this._lastFailureAt = null;
        this._openedAt = null;
    }

    get state() { return this._state; }

    _toOpen() {
        this._state = STATE.OPEN;
        this._openedAt = Date.now();
        this._successCount = 0;
        logger.warn('circuit_breaker.opened', {
            name: this.name,
            failureCount: this._failureCount,
        });
    }

    _toClosed() {
        this._state = STATE.CLOSED;
        this._failureCount = 0;
        this._successCount = 0;
        logger.info('circuit_breaker.closed', { name: this.name });
    }

    _toHalfOpen() {
        this._state = STATE.HALF_OPEN;
        this._successCount = 0;
        logger.info('circuit_breaker.half_open', { name: this.name });
    }

    _recordSuccess() {
        if (this._state === STATE.HALF_OPEN) {
            this._successCount += 1;
            if (this._successCount >= this.successThreshold) this._toClosed();
        } else {
            this._failureCount = Math.max(0, this._failureCount - 1);
        }
    }

    _recordFailure(error) {
        this._lastFailureAt = Date.now();
        this._failureCount += 1;
        if (this._state === STATE.HALF_OPEN || this._failureCount >= this.failureThreshold) {
            this._toOpen();
        }
        logger.warn('circuit_breaker.failure_recorded', {
            name: this.name,
            failureCount: this._failureCount,
            state: this._state,
            error: error?.message || String(error),
        });
    }

    _shouldAttempt() {
        if (this._state === STATE.CLOSED) return true;
        if (this._state === STATE.HALF_OPEN) return true;
        // OPEN — check if cooldown has elapsed to move to HALF_OPEN
        if (Date.now() - this._openedAt >= this.cooldownMs) {
            this._toHalfOpen();
            return true;
        }
        return false;
    }

    /**
     * Execute fn() through the circuit breaker.
     * @param {() => Promise<any>} fn
     * @returns {Promise<any>}
     */
    async call(fn) {
        if (!this._shouldAttempt()) {
            const err = new Error(`Circuit breaker OPEN for service: ${this.name}`);
            err.code = 'CIRCUIT_OPEN';
            err.circuitName = this.name;
            throw err;
        }

        try {
            // Wrap with timeout using AbortSignal
            const result = await Promise.race([
                fn(),
                new Promise((_, reject) =>
                    setTimeout(
                        () => reject(Object.assign(new Error(`Call timeout: ${this.name}`), { code: 'CALL_TIMEOUT' })),
                        this.callTimeoutMs
                    )
                ),
            ]);
            this._recordSuccess();
            return result;
        } catch (error) {
            this._recordFailure(error);
            throw error;
        }
    }

    stats() {
        return {
            name: this.name,
            state: this._state,
            failureCount: this._failureCount,
            successCount: this._successCount,
            lastFailureAt: this._lastFailureAt,
            openedAt: this._openedAt,
        };
    }
}

// Singleton registry so controllers/services share circuit state.
const _registry = new Map();

/**
 * getBreaker(name, opts?) — get or create a named circuit breaker.
 * Pass opts only on first call; subsequent calls with same name reuse existing.
 */
const getBreaker = (name, opts = {}) => {
    if (!_registry.has(name)) {
        _registry.set(name, new CircuitBreaker({ name, ...opts }));
    }
    return _registry.get(name);
};

const getAllBreakerStats = () =>
    Array.from(_registry.values()).map((b) => b.stats());

module.exports = { CircuitBreaker, getBreaker, getAllBreakerStats, STATE };
