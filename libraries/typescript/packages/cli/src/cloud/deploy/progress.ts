import { clearLine, cursorTo } from "node:readline";

/** Animate only on an interactive terminal; keep pipes and JSON scriptable. */
export function createDeployProgress(json: boolean) {
  const animated =
    process.stderr.isTTY === true && process.env["TERM"] !== "dumb";
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = false;
  return {
    start() {
      if (json || started) return;
      started = true;
      if (!animated) {
        process.stderr.write("Deploying...\n");
        return;
      }
      let frame = 0;
      const render = () => {
        process.stderr.write(
          `\r${frames[frame++ % frames.length]} Deploying...`
        );
      };
      render();
      timer = setInterval(render, 80);
      timer.unref();
    },
    stop() {
      if (timer === undefined) return;
      clearInterval(timer);
      timer = undefined;
      clearLine(process.stderr, 0);
      cursorTo(process.stderr, 0);
    },
  };
}
