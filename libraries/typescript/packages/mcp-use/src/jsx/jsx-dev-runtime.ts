/**
 * Development JSX runtime — delegates to the production runtime.
 */
export { jsx, jsxs, Fragment, type JSX } from "./jsx-runtime.js";

import { jsx } from "./jsx-runtime.js";

export function jsxDEV(
  type: any,
  props: any,
  key?: any,
  _isStaticChildren?: boolean,
  _source?: any,
  _self?: any
): any {
  return jsx(type, props, key);
}
