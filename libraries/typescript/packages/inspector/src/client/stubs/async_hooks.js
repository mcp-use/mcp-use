// Browser stub for node:async_hooks
export class AsyncLocalStorage {
    constructor() {
        this.store = undefined
    }

    getStore() {
        return this.store
    }

    run(store, callback, ...args) {
        this.store = store
        try {
            return callback(...args)
        } finally {
            this.store = undefined
        }
    }

    exit(callback, ...args) {
        const previousStore = this.store
        this.store = undefined
        try {
            return callback(...args)
        } finally {
            this.store = previousStore
        }
    }

    enterWith(store) {
        this.store = store
    }

    disable() {
        this.store = undefined
    }
}

export class AsyncResource {
    constructor() { }

    runInAsyncScope(fn, thisArg, ...args) {
        return fn.apply(thisArg, args)
    }

    emitDestroy() { }
    asyncId() { return 1 }
    triggerAsyncId() { return 0 }
}

export function executionAsyncId() {
    return 1
}

export function triggerAsyncId() {
    return 0
}

export function createHook() {
    return {
        enable() { },
        disable() { },
    }
}

export default {
    AsyncLocalStorage,
    AsyncResource,
    executionAsyncId,
    triggerAsyncId,
    createHook,
}
