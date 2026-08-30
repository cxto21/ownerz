# Proposal: DataVaultz Branding Update (OWNERZ visual identity)

## Intent

Rebrand the DataVaultz frontend from brutalist black/orange to the OWNERZ cinematic system in `ownerz-marketing-hub/brand/` (near-black navy canvas, cool blue/violet light, warm `#FF7138`, chamfered geometry, Orbitron/Inter/IBM Plex Mono). Entrance popup + upload-card "flow" (SellFlow/BuyFlow — the `index.html` pantallazo) must match the reference. Preserve component modularity and the `dv-` token-driven aesthetic. No logic, contract, or dependency changes.

## Scope

### In Scope
- `styles/globals.css`: remap palette/glow/font tokens; add chamfer `clip-path`, hairline + luminous-rule utilities, reveal motion + `prefers-reduced-motion`
- Assets → `public/`: `ownerz_logotype.png`, `ownerz-background-1.jpg`, `background.svg`; convert JPEG-as-ico favicon into a valid one
- `pages/index.js`: header/nav (hairline frame, mono labels, chamfered CONNECT), hero (background + logotype, eyebrow, gradient headline), entrance popup → brand modal
- Flow card: chamfered glass, top luminous rule, tabs with warm active dot; swap hardcoded `#c53400` inline styles in SellFlow/BuyFlow for tokens (style-only)
- ShieldModal + shielded-balance panel; `_app.js` font/favicon refs

### Out of Scope
- No wallet/STRK20/S3/contract logic; `lib/*`, `pages/api/*`, contracts untouched
- No new landing sections (features grid, metrics bar); no Tailwind/TS/refactor; DeploySection.js unchanged
- Old `brand-asset-orange.png` kept until verified

## Capabilities

### New Capabilities
- `frontend-branding`: OWNERZ tokens, typography, chamfer/hairline styles, brand assets, motion for the DataVaultz frontend

### Modified Capabilities
- None (`openspec/specs/` empty)

## Approach

Token-first: remap `:root` (most `dv-` components rebrand automatically) → copy/convert assets → restyle shell (header, hero, popup) → restyle flow card + inline oranges → polish + verify (`npm run build`, visual pass vs `index.html`). All `dv-` class names kept — modularity preserved.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| clip-path + backdrop-filter break | Med | Mirror reference; test Chrome/Safari/Firefox |
| Missed hardcoded inline oranges | Med | Grep `c53400` / `197,52,0` after change |
| Fonts `@import` render-block | Low | Keep `@import` + preconnect |
| 400-line PR budget | Med | Change values, not class names; chained slice if high |

## Rollback Plan

Pure CSS/assets change — `git revert` the PR commits; old assets stay on disk; tokens isolated in `:root`.

## Dependencies

- Read access to `/home/kiox/ownerz-marketing-hub/brand/`
- ImageMagick (or similar) for favicon conversion

## Success Criteria

- [ ] `npm run build` passes
- [ ] Header, hero, popup, flow card match `index.html`
- [ ] Upload, access, shield, connect flows functional, unchanged
- [ ] No `dv-` class renamed; component structure preserved
- [ ] `prefers-reduced-motion` disables animations

## Open Questions

1. Keep STRK20 hackathon popup copy or generic brand modal?
2. Add features/metrics sections now or defer?