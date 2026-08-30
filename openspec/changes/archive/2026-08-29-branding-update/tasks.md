# Tasks: DataVaultz Branding Update

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 250–320 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Token remap + fonts + assets | PR 1 | `npm run build` | `npm run dev` → visual check vs `index.html` | `globals.css` + `_app.js` + `public/images/` |
| 2 | Shell + hero + popup + flows | PR 1 | `npm run build` + `grep -r "c53400\|197,52,0" components/` | Manual page load, upload/shield/connect flows | `index.js` + `SellFlow.js` + `BuyFlow.js` + `ShieldModal.js` |
| 3 | Motion + polish + verification | PR 1 | `npm run build` + visual + `prefers-reduced-motion` check | Browser dev tools animation audit | CSS utilities only (reversible) |

## Phase 1: Token Foundation + App Shell (~80 lines)

- [x] 1.1 Remap `:root` tokens in `styles/globals.css` to OWNERZ palette: canvas `#02040A`, surfaces `#050812`–`#0C1220`, warm `#FF7138`/`#C84D25`, hairlines `rgba(91,112,168,.30)`/`.10`, text `#EEF3FF`, selection `#FF7138`/`#08030A`. Keep all `dv-` class names unchanged.
- [x] 1.2 Add font tokens: `--display: "Orbitron",...`, `--body: "Inter",...`, `--mono: "IBM Plex Mono",...` to `:root` in `styles/globals.css`.
- [x] 1.3 Update `pages/_app.js`: swap font `@import` URLs to Orbitron, Inter, IBM Plex Mono; add preconnects; fix favicon reference to `public/images/favicon.ico`.
- [x] 1.4 **Verify**: `npm run build` passes; inspect computed styles in browser DevTools confirm palette applied.

## Phase 2: Brand Assets (~5 lines code + file copies)

- [x] 2.1 Copy `ownerz_logotype.png`, `ownerz-background-1.jpg`, `background.svg` from `/home/kiox/ownerz-marketing-hub/brand/` to `public/images/`.
- [x] 2.2 Convert existing `public/images/favicon.ico` (JPEG-as-ICO) to valid ICO using ImageMagick: `convert public/images/favicon.ico -define icon:auto-resize=16,32,48 public/images/favicon.ico`.
- [x] 2.3 **Verify**: assets exist in `public/images/`, `npm run build` passes, favicon renders in browser tab.

## Phase 3: Shell + Hero + Popup Restyle (~100 lines)

- [x] 3.1 Update `pages/index.js` header: hairline frame (`border: 1px solid var(--line)`), mono nav labels (`font-family: var(--mono)`), chamfered CONNECT button (`clip-path`, inset hairline, hover lift).
- [x] 3.2 Update `pages/index.js` hero: swap hero image src to `ownerz-background-1.jpg`, add logotype (`ownerz_logotype.png`), add mono eyebrow (`QUANTUM INFRASTRUCTURE`), gradient headline (`linear-gradient(178deg, #F7F9FF … #C9CEDDB)`).
- [x] 3.3 Restyle entrance popup in `pages/index.js`: chamfered box, dark raised surface (`var(--bg-raised)`), inset hairline (`var(--line)`), mono headline (`var(--mono)`), warm close control (`var(--accent)`). Keep "STRK20 Hackathon" copy unchanged.
- [x] 3.4 **Verify**: `npm run build` passes; header/hero/popup visually match `index.html` reference; CONNECT flow still works.

## Phase 4: Flow Card + Inline Orange Swaps (~60 lines)

- [x] 4.1 Restyle flow card in `pages/index.js`: chamfered glass (`clip-path`, `var(--bg-raised)`), top luminous rule (`var(--blue-glow)`), hairline tabs (`var(--line)`), warm active dot (`var(--accent)`).
- [x] 4.2 Replace hardcoded `#c53400` and `rgba(197,52,0,...)` in `components/SellFlow.js` with `var(--accent)` and `var(--accent-glow)` tokens. Style-only, no logic changes.
- [x] 4.3 Replace hardcoded `#c53400` and `rgba(197,52,0,...)` in `components/BuyFlow.js` with `var(--accent)` and `var(--accent-glow)` tokens. Style-only.
- [x] 4.4 **Verify**: `grep -rn "c53400\|197,52,0" components/` returns zero results; `npm run build` passes; upload/access flows functional.

## Phase 5: ShieldModal + Marketing Placeholders (~50 lines)

- [x] 5.1 Restyle `components/ShieldModal.js` surfaces: new bg tokens (`var(--bg-raised)`), hairline borders (`var(--line)`), glow (`var(--blue-glow)`), mono labels (`var(--mono)`). Preserve shield interactions and error readability.
- [x] 5.2 Add placeholder features grid and metrics bar below hero in `pages/index.js` (placeholder values, marked in-progress). Match reference structure.
- [x] 5.3 **Verify**: `npm run build` passes; ShieldModal opens/closes with new styling; features grid and metrics visible.

## Phase 6: Motion + Reduced Motion + Final Polish (~40 lines)

- [x] 6.1 Add reveal utilities in `styles/globals.css`: `@keyframes reveal` (`opacity:0→1`, `translateY(18px)→0`, `.7s`, `cubic-bezier(.2,.7,.2,1)`), stagger mixin, hover lift.
- [x] 6.2 Add `@media (prefers-reduced-motion: reduce)` in `globals.css` that disables all animations and transitions.
- [x] 6.3 Apply reveal classes to hero elements, flow card, ShieldModal entry in `pages/index.js`.
- [x] 6.4 Final verification: `npm run build` passes; `grep -rn "c53400\|197,52,0" pages/ components/ styles/` returns zero; visual pass vs `index.html`; `prefers-reduced-motion` tested via DevTools; upload, access, shield, connect flows functional.

## Relevant Files

- `styles/globals.css` — token remap, utilities, reduced-motion
- `pages/_app.js` — font imports, favicon
- `pages/index.js` — header, hero, popup, flow card, marketing placeholders, reveals
- `components/SellFlow.js` — inline orange → token swap
- `components/BuyFlow.js` — inline orange → token swap
- `components/ShieldModal.js` — surface/hairline/glow restyle
- `public/images/` — ownerz_logotype.png, ownerz-background-1.jpg, background.svg, favicon.ico
