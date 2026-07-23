declare module "rate-limiter-flexible/lib/RateLimiterMemory.js" {
  export default class RateLimiterMemory {
    constructor(options: { points: number; duration: number });
    consume(key: string): Promise<unknown>;
  }
}
