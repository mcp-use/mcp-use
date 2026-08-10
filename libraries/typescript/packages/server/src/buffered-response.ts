const bufferedResponses = new WeakSet<Response>();
const bufferedSources = new WeakMap<Request, Response>();

/**
 * Mark a framework-owned response whose body is already buffered in memory.
 *
 * @internal
 */
export function markBufferedResponse(response: Response): Response {
  if (response.body !== null) {
    bufferedResponses.add(response);
  }
  return response;
}

/**
 * Associate a known-buffered SDK response with the request that produced it.
 *
 * Keeping the source response lets the Node bridge recognize framework-owned
 * header wrappers by body identity without trusting a content type. If any
 * middleware clones or replaces the body, the identity check fails closed.
 *
 * @internal
 */
export function trackBufferedResponse(
  request: Request,
  response: Response
): Response {
  markBufferedResponse(response);
  bufferedSources.set(request, response);
  return response;
}

/** Whether a response body is covered by the framework's buffered contract. */
export function isBufferedResponse(
  response: Response,
  request?: Request
): boolean {
  if (response.body === null) {
    return false;
  }
  if (bufferedResponses.has(response)) {
    return true;
  }
  const source =
    request === undefined ? undefined : bufferedSources.get(request);
  return (
    source !== undefined &&
    source.body !== null &&
    source.body === response.body
  );
}

/**
 * Preserve the marker across a framework-owned, header-only response wrapper.
 *
 * Body-transforming user middleware does not call this helper, so replacing a
 * response still drops the buffered contract automatically.
 *
 * @internal
 */
export function inheritBufferedResponse(
  source: Response,
  target: Response
): Response {
  return isBufferedResponse(source) ? markBufferedResponse(target) : target;
}
