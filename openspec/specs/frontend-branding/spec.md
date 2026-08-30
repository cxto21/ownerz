# frontend-branding Specification

## Purpose

Rebrand DataVaultz to the OWNERZ system (near-black navy canvas, cool blue/violet light, warm `#FF7138`, chamfered geometry, Orbitron/Inter/IBM Plex Mono). Style/asset-only; logic, `dv-` classes untouched. Popup keeps "STRK20 Hackathon" copy; features/metrics placeholder-level; single PR ≤400 lines.

## Requirements

### Requirement: OWNERZ token remap

MUST remap `:root` in `styles/globals.css` per brand.md §Color (canvas `#02040A`, surfaces `#050812`–`#0C1220`, warm `#FF7138`/`#C84D25`, hairlines `rgba(91,112,168,.30)`/`.10`, text `#EEF3FF`, selection `#FF7138`/`#08030A`) with fonts Orbitron/Inter/IBM Plex Mono; MUST NOT rename `dv-` classes.

#### Scenario: palette rebrand
- GIVEN legacy tokens in use
- WHEN tokens are remapped
- THEN palette applies, classes unchanged

### Requirement: Brand assets

MUST copy `ownerz_logotype.png`, `ownerz-background-1.jpg`, `background.svg` to `public/`; convert JPEG-as-ICO `favicon.ico` to a valid ICO; keep `brand-asset-orange.png` until verified.

#### Scenario: assets resolve
- GIVEN reference assets exist
- WHEN copied and referenced
- THEN they render per reference; build passes

### Requirement: Header and navigation restyle

MUST show hairline frame, mono nav labels with warm active dot, chamfered CONNECT button (clip-path, inset hairline); flow unchanged.

#### Scenario: chamfered connect
- GIVEN the header renders
- WHEN CONNECT is visible
- THEN chamfered corners, hover lift apply; flow intact

### Requirement: Hero restyle

MUST display background artwork, logotype, mono eyebrow, cool-white gradient headline, and flow card per reference.

#### Scenario: hero composition
- GIVEN the hero section
- WHEN rendered
- THEN composition matches; artwork unaltered

### Requirement: Entrance popup restyle

MUST keep "STRK20 Hackathon" content, restyled: chamfered box, dark raised surface, inset hairline, mono headline, warm close control.

#### Scenario: content preserved
- GIVEN the popup opens
- WHEN restyled
- THEN Hackathon copy is unchanged

#### Scenario: dismissible
- GIVEN the popup is open
- WHEN close or overlay activated
- THEN it closes without regression

### Requirement: Flow card restyle (SellFlow/BuyFlow)

MUST use chamfered glass, luminous top rule, hairline tabs, warm active dot; behavior unchanged.

#### Scenario: reference match
- GIVEN the flow card renders
- WHEN tabs switch
- THEN glass chamfer, luminous rule, warm dot appear

### Requirement: Inline orange swaps

MUST replace hardcoded `#c53400`/`rgba(197,52,0,…)` inline styles in `SellFlow.js`/`BuyFlow.js` with brand warm tokens, style-only.

#### Scenario: PQC badge recolored
- GIVEN a PQC badge renders
- WHEN token-styled
- THEN warm color shows; toggle retained

#### Scenario: no strays remain
- GIVEN the change applied
- WHEN grepping for `c53400`/`197,52,0`
- THEN none remain outside tokens

### Requirement: ShieldModal and balance panel restyle

MUST adopt new surface, hairline, glow, mono-label tokens; shield interactions and error readability preserved.

#### Scenario: surfaces rebranded
- GIVEN ShieldModal opens
- WHEN rendered with new tokens
- THEN surfaces match; actions and errors readable

### Requirement: App shell fonts and favicon

`_app.js` MUST load Orbitron, Inter, IBM Plex Mono with preconnect and reference the valid favicon.

#### Scenario: fonts load
- GIVEN the app shell
- WHEN fonts load
- THEN faces apply, render blocking mitigated

### Requirement: Marketing sections (placeholder)

A features grid and metrics bar MUST render below the hero, marked in-progress; copy and values placeholder, not live data.

#### Scenario: sections render
- GIVEN the hero
- WHEN scrolled to the sections
- THEN grid and metrics appear, placeholder values only

### Requirement: Motion

MUST use reveals (`opacity 0→1`, 18px rise, `.7s`, `cubic-bezier(.2,.7,.2,1)`, ~`.05s` stagger), hover lifts; MUST disable animations under `prefers-reduced-motion: reduce`.

#### Scenario: reveal on scroll
- GIVEN elements enter the viewport
- WHEN scrolled to
- THEN reveal with signature easing

#### Scenario: reduced motion
- GIVEN `prefers-reduced-motion: reduce`
- WHEN the page renders
- THEN no animation plays

### Requirement: Responsive adaptation

MUST keep the 768px breakpoint, adapt the new patterns, simplify decorative geometry.

#### Scenario: tablet adaptation
- GIVEN a viewport at/below 768px
- WHEN the hero and flow card render
- THEN layout stacks without overflow

#### Scenario: mobile simplification
- GIVEN a phone viewport
- WHEN decorative rails render
- THEN they simplify (single column, rail hidden)