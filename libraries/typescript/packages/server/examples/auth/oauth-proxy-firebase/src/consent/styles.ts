/**
 * Styles for the consent page, rendered into a `<style>` element. The proxy
 * serves the page with a Content Security Policy that allows inline styles
 * and no stylesheets or web fonts.
 */
export const consentStyles = `
/* The design language of the mcp-use landing page. */
:root {
  --canvas: #fdfcfc;
  --ink: #172037;
  --body: #1e293b;
  --muted: #64748b;
  --rule: rgb(0 0 0 / 0.08);
  --chip: #f1f5f9;
  --mesh-blue: #e0eaff;
  --mesh-lime: #f9ffbd;
  --mesh-grey: #dedede;
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-brand: "Outfit", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

*,
::before,
::after {
  box-sizing: border-box;
}

h1,
p,
dl,
dd,
ul {
  margin: 0;
}

ul {
  padding: 0;
  list-style: none;
}

svg {
  display: block;
}

body {
  display: flex;
  align-items: center;
  min-height: 100vh;
  margin: 0;
  padding: 2.5rem 0;
  background: var(--canvas);
  color: var(--body);
  font-family: var(--font-sans);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.page {
  position: relative;
  width: 100%;
  max-width: 36rem;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}

/* The landing page's thin rails with a cross mark at each corner. */
.rail {
  position: absolute;
  background: var(--rule);
}
.rail-left,
.rail-right {
  top: 0;
  bottom: 0;
  width: 1px;
}
.rail-left {
  left: 1.5rem;
}
.rail-right {
  right: 1.5rem;
}
.rail-top,
.rail-bottom {
  left: 1.5rem;
  right: 1.5rem;
  height: 1px;
}
.rail-top {
  top: 0;
}
.rail-bottom {
  bottom: 0;
}
.corner {
  position: absolute;
  width: 21px;
  height: 21px;
  color: var(--rule);
}
.corner-top-left {
  top: 0;
  left: 1.5rem;
  transform: translate(-50%, -50%);
}
.corner-top-right {
  top: 0;
  right: 1.5rem;
  transform: translate(50%, -50%);
}
.corner-bottom-left {
  bottom: 0;
  left: 1.5rem;
  transform: translate(-50%, 50%);
}
.corner-bottom-right {
  bottom: 0;
  right: 1.5rem;
  transform: translate(50%, 50%);
}

/* The landing page draws its hero with WebGL. The policy allows only the
 * proxy's Firebase sign-in script, so the same colors are blended with
 * gradients instead. */
.hero {
  padding: 2rem 1.5rem 1.75rem;
  border-block: 1px solid var(--rule);
  text-align: center;
  background-color: #fff;
  background-image:
    radial-gradient(at 12% 18%, var(--mesh-blue) 0, transparent 55%),
    radial-gradient(at 88% 12%, var(--mesh-lime) 0, transparent 50%),
    radial-gradient(at 78% 92%, var(--mesh-grey) 0, transparent 55%),
    radial-gradient(at 20% 95%, var(--mesh-blue) 0, transparent 45%);
}
.badges {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}
.badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  border: 1px solid rgb(0 0 0 / 0.1);
  border-radius: 14px;
  background: #fff;
  box-shadow:
    0 1px 3px 0 rgb(0 0 0 / 0.1),
    0 1px 2px -1px rgb(0 0 0 / 0.1);
  color: var(--ink);
  font-size: 1.25rem;
  font-weight: 600;
}
.provider-mark {
  width: 1.75rem;
  height: 1.75rem;
}
.dots {
  display: flex;
  gap: 0.25rem;
}
.dots span {
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: rgb(23 32 55 / 0.3);
}
.hero h1 {
  margin-top: 1.25rem;
  color: var(--ink);
  font-size: 1.75rem;
  font-weight: 700;
  line-height: 1.25;
  text-wrap: balance;
}
.lead {
  max-width: 28rem;
  margin: 0.5rem auto 0;
  color: rgb(23 32 55 / 0.8);
}

.card {
  margin-top: 1.5rem;
  padding: 1.25rem 1.5rem;
  border-block: 1px solid var(--rule);
  background: #fff;
}
.details {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
.row {
  display: grid;
  gap: 0.375rem;
  padding: 0.75rem 0;
}
.row + .row {
  border-top: 1px solid var(--rule);
}
.row:first-child {
  padding-top: 0;
}
.row:last-child {
  padding-bottom: 0;
}
.row dt,
.muted {
  color: var(--muted);
}
.row dd {
  min-width: 0;
}
.app {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.app-name {
  color: var(--ink);
  font-weight: 600;
}
.value {
  color: var(--ink);
}
.pill {
  padding: 0.125rem 0.5rem;
  border: 1px solid;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
}
.pill-ok {
  border-color: #a7f3d0;
  background: #ecfdf5;
  color: #065f46;
}
.pill-warn {
  border-color: #fde68a;
  background: #fffbeb;
  color: #78350f;
}
code {
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  background: var(--chip);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}
.client-id {
  display: block;
  margin-top: 0.5rem;
  word-break: break-all;
}
.scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}
.note {
  margin-top: 1rem;
  color: var(--muted);
  font-size: 0.875rem;
  line-height: 1.25rem;
}
/* Without the consent details, the note opens the card. */
.card > .note:first-child {
  margin-top: 0;
}

.consent-form {
  margin-top: 1.5rem;
}
.actions {
  display: flex;
  flex-direction: column-reverse;
  gap: 0.5rem;
}
.button {
  padding: 0.625rem 1.25rem;
  border: 1px solid;
  border-radius: 9999px;
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
}
.button-secondary {
  border-color: rgb(23 32 55 / 0.2);
  background: rgb(255 255 255 / 0.7);
  color: var(--ink);
  transition: background-color 150ms;
}
.button-secondary:hover {
  background: #fff;
}
.button-primary {
  border-color: rgb(0 0 0 / 0.1);
  background-image: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.12),
    0 2px 8px rgb(15 23 42 / 0.15);
  color: #fff;
}
.button-primary:hover {
  background-image: linear-gradient(180deg, #334155 0%, #1e293b 100%);
}

@media (min-width: 40rem) {
  .row {
    grid-template-columns: 8rem 1fr;
    gap: 1rem;
  }
  .actions {
    flex-direction: row;
    justify-content: flex-end;
  }
}

footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding-top: 0.5rem;
  color: rgb(23 32 55 / 0.6);
  font-family: var(--font-brand);
  font-size: 0.875rem;
  line-height: 1.25rem;
  font-weight: 500;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--ink);
}
.brand svg {
  width: 1rem;
  height: 1rem;
}
`;
