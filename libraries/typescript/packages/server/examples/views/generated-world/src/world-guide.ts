/** Model-facing contract and authoring guide for the render_world tool. */
export const WORLD_GUIDE = `# Generated World source contract

The \`render_world\` tool turns JavaScript into an ephemeral Three.js environment. While the source argument is being written, syntactically complete prefixes are compiled and rendered inside a nested sandboxed iframe. Each viable prefix replaces the previous scene, so write the world in a useful construction order: establish atmosphere and lighting, then major structures, then details and animation. During construction, the camera is locked in an elevated three-quarter view looking toward the origin. The final source switches to the returned spawn and unlocks exploration. Final syntax and runtime failures are shown in the view and added to model context for the next revision. This app does not persist the source or send it to a separate upload service.

## What to send

\`source\` is the BODY of this async function. Do not include the function declaration or markdown fences.

\`\`\`js
async function buildWorld({ THREE, scene, random, onFrame }) {
  // Your source is inserted here.
  return {
    spawn: [0, 2, 8],
    lookAt: [0, 1.5, 0],
    moveSpeed: 5,
  };
}
\`\`\`

## Available values

- \`THREE\`: the complete Three.js module, version 0.180.0.
- \`scene\`: a new \`THREE.Scene\`. Add every visible object to it.
- \`random()\`: deterministic seeded random number in [0, 1).
- \`onFrame(callback)\`: register up to 64 animation callbacks. A callback receives \`(deltaSeconds, elapsedSeconds)\`.

The runtime owns the renderer, camera, resize behavior, flying controls, and a subtle sky-plus-sun lighting rig that keeps the world readable. Add scene-specific lights for mood and emphasis, but do not rely on darkness to hide unfinished geometry. Do not create a renderer, camera, canvas, controls, or render loop.

## Rules

- Build the environment around the world origin so it stays visible from the elevated construction camera.
- Never add a roof, ceiling, awning, canopy, or other overhead geometry. This rule is absolute: every interior must remain open from above so the user can watch it being built.
- Never set \`scene.fog\` or create fog effects. The runtime removes scene fog so the world remains unobstructed during construction and exploration.
- Use no imports or exports.
- Do not access window, document, globalThis, parent, top, navigator, location, storage, workers, timers, network APIs, eval, or Function.
- Use \`onFrame\` instead of \`requestAnimationFrame\` or timers.
- Do not write unbounded loops. Keep the world below 1,500 objects, 1,000,000 triangles, and 32 lights.
- Prefer reusable helper functions, groups, and \`InstancedMesh\` for repeated geometry.
- Set \`scene.background\` to complement the environment.
- Add ambient plus directional/point lighting. The runtime enables shadows.
- Return a spawn point, look-at point, and optional movement speed. Movement speed is clamped to 1–20.

These are authoring instructions for the model, not server-side keyword checks. The source is still sent to the sandbox if a rule is missed, and the viewer reports syntax or runtime failures for the next revision.

## Tiny example

\`\`\`js
scene.background = new THREE.Color(0x101426);

scene.add(new THREE.HemisphereLight(0x9db7ff, 0x24180e, 1.6));
const moon = new THREE.DirectionalLight(0xdde7ff, 2.2);
moon.position.set(6, 12, 4);
moon.castShadow = true;
scene.add(moon);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(30, 64),
  new THREE.MeshStandardMaterial({ color: 0x243322, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const crystal = new THREE.Mesh(
  new THREE.OctahedronGeometry(1.2, 0),
  new THREE.MeshStandardMaterial({
    color: 0x875cff,
    emissive: 0x3a1670,
    emissiveIntensity: 2,
  })
);
crystal.position.set(0, 1.3, 0);
crystal.castShadow = true;
scene.add(crystal);

onFrame((_delta, elapsed) => {
  crystal.rotation.y = elapsed * 0.45;
  crystal.position.y = 1.3 + Math.sin(elapsed * 1.4) * 0.15;
});

return { spawn: [0, 2.4, 9], lookAt: [0, 1.3, 0], moveSpeed: 5 };
\`\`\`

Build complete, coherent environments rather than isolated objects. For a magical tavern, include an open-top room shell, floor, bar, shelves, bottles, tables, chairs, fireplace, lanterns, windows, signs, atmospheric particles, and warm lighting. Never add its roof or ceiling.`;
