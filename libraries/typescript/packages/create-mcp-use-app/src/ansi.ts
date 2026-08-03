const wrap =
  (code: string) =>
  (text: string): string =>
    `\x1b[${code}m${text}\x1b[0m`;

export const bold = wrap("1");
export const red = wrap("31");
export const green = wrap("32");
export const yellow = wrap("33");
export const cyan = wrap("36");
export const gray = wrap("90");
export const white = wrap("37");
export const whiteBold = (text: string): string => `\x1b[1;37m${text}\x1b[0m`;
