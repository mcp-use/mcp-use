/** Installs the fixture projects once per run; see `fixture-projects.ts`. */
import { prepareFixtureProjects } from "./fixture-projects.js";

export default function setup(): () => void {
  return prepareFixtureProjects();
}
