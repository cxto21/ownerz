# Design: DataVaultz Branding Update

## Technical Approach

Token-first rebrand: remap `:root` CSS variables to OWNERZ palette/fonts, copy brand assets to `public/`, add CSS utilities (chamfer, luminous rule, eyebrow, reveal), replace hardcoded inline orange colors with tokens, and update shell/header/hero/popup styles to match reference. No component splits, no new JS modules, no logic changes.

## Architecture Decisions

### Decision: Token remap strategy

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Remap existing tokens only | Low effort; may miss new visual features | ✅ |
| Add new tokens + remap old | More work but cleaner for future | ❌ |
| Rename dv- classes | Breaks modularity, violates constraints | ❌ |

**Choice**: Remap existing `:root` tokens to match brand palette; keep all `dv-` class names unchanged. Add new utility tokens for chamfer/glow/eyebrow.

### Decision: Asset management

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Copy assets each build | Reproducible but slow | ❌ |
| Copy once to public/images | Simple, manual sync | ✅ |
| Symlink to brand dir | Breaks portability | ❌ |

**Choice**: Copy `ownerz_logotype.png`, `ownerz-background-1.jpg`, `background.svg` to `public/images/`. Keep existing `brand-asset-orange.png` until verified. Convert JPEG-as-ICO favicon to valid ICO using ImageMagick.

### Decision: Inline color replacement

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Keep inline colors | Faster but inconsistent | ❌ |
| Replace with CSS variables | Consistent, themeable | ✅ |
| Create component-specific tokens | Overkill for this change | ❌ |

**Choice**: Replace all hardcoded `#c53400`/`rgba(197,52,0,...)` in SellFlow/BuyFlow with `var(--accent)` and `var(--accent-glow)` tokens. Style-only.

## Data Flow

Token cascade:

```
:root tokens (globals.css)
  ↓
.dv-* classes (globals.css)
  ↓
Component JSX (index.js, SellFlow, BuyFlow, ShieldModal)
  ↓
Inline styles (replaced with tokens)
```

Asset loading:

```
public/images/ ← copy from ownerz-marketing-hub/brand/
  ↓
pages/_app.js (favicon)
pages/index.js (hero image, logotype)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `styles/globals.css` | Modify | Remap tokens, add chamfer/glow/eyebrow/reveal utilities, add reduced-motion |
| `pages/index.js` | Modify | Replace inline orange styles, update hero image src, add eyebrow/gradient headline |
| `pages/_app.js` | Modify | Update font imports (Orbitron/Inter/IBM Plex Mono), fix favicon reference |
| `components/SellFlow.js` | Modify | Replace inline orange hex/rgba with CSS variables |
| `components/BuyFlow.js` | Modify | Replace inline orange hex/rgba with CSS variables |
| `components/ShieldModal.js` | Modify | Restyle with new tokens (surfaces, hairlines, glow) |
| `public/images/ownerz_logotype.png` | Create | Copy from brand dir |
| `public/images/ownerz-background-1.jpg` | Create | Copy from brand dir |
| `public/images/background.svg` | Create | Copy from brand dir |
| `public/images/favicon.ico` | Replace | Convert JPEG-as-ICO to valid ICO |

## Interfaces / Contracts

No new interfaces. All changes are style/asset-only. Existing component props remain unchanged.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | CSS token cascade | Manual visual check against reference |
| Integration | Component rendering with new tokens | `npm run build` + manual page load |
| E2E | Full flow (upload, shield, connect) | Manual functional test |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Single PR with CSS/assets changes. Git revert if issues.

## Open Questions

- [ ] Should we keep the existing `brand-asset-orange.png` after verification? (proposal says keep until verified)
- [ ] Should we add the features grid and metrics bar now or defer? (spec says placeholder-level)
- [ ] Confirm favicon conversion method (ImageMagick vs online tool)