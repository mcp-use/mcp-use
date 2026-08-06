/** Web-standard request handler used by CLI-owned HTTP adapters. */
export type FetchHandler = (request: Request) => Promise<Response>;
