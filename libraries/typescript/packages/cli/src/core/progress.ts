import { clearLine, cursorTo } from "node:readline";

/** Animate only on an interactive terminal; keep pipes and JSON scriptable. */
export function createProgress(label: string, json: boolean) {
  const animated =
    process.stderr.isTTY === true && process.env["TERM"] !== "dumb";
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let timer: ReturnType<typeof setInterval> | undefined;
  let active = false;
  let announced = false;
  return {
    start() {
      if (json || active) return;
      active = true;
      if (!animated) {
        if (!announced) process.stderr.write(`${label}\n`);
        announced = true;
        return;
      }
      let frame = 0;
      const render = () => {
        process.stderr.write(`\r${frames[frame++ % frames.length]} ${label}`);
      };
      render();
      timer = setInterval(render, 80);
      timer.unref();
    },
    stop() {
      active = false;
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
      clearLine(process.stderr, 0);
      cursorTo(process.stderr, 0);
    },
  };
}

/** Clear progress before returning a result or reporting an error. */
export async function withProgress<T>(
  label: string,
  json: boolean,
  run: (progress: ReturnType<typeof createProgress>) => Promise<T>
): Promise<T> {
  const progress = createProgress(label, json);
  progress.start();
  try {
    return await run(progress);
  } finally {
    progress.stop();
  }
}
