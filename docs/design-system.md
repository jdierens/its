# ITS design system

Direction: glass gradient. Surfaces are frosted white cards on a pale violet, cyan, and rose mesh. The sidebar is a solid near-black. This is the visual system for the shell, lists, forms, login, admin, and Lens.

Tokens live in two places that stay in step:

- `app/globals.css` `@theme` is the Tailwind v4 theme. Utilities such as `bg-accent`, `text-muted`, `rounded-lg`, `shadow-glass`, and `backdrop-blur-glass` read it.
- The same file's `:root` block is what the existing class names use (`--ink`, `--muted`, `--accent`, `--card`, `--radius-card`, `--shadow-card`, `--blur-glass`).

Do not invent a one-off hex in a new screen. Add the color to both blocks, or use a token that is already there.

## Color

| Token | Value | Use |
|---|---|---|
| `--bg` / `--color-canvas` | `#e8edff` | Page base under the mesh |
| `--ink` / `--color-ink` | `#0f172a` | Text on glass and white |
| `--muted` / `--color-muted` | `#334155` | Secondary text. Dark enough for AA on the frosted cards |
| `--accent` / `--color-accent` | `#5b21b6` | Primary buttons and links. White label text |
| `--sidebar` / `--color-sidebar` | `#0a0e1c` | Sidebar and the mobile drawer. Solid, not translucent |
| `--sidebar-ink` | `#e2e8f0` | Sidebar text |
| `--sidebar-muted` | `#94a3b8` | Sidebar group labels and the signed-in name |
| `--input-border` | `#64748b` | Field borders, so the control is visible on white |
| `--danger-ink` | `#8a1f11` | Errors |
| `--ok-ink` | `#166534` | Success |

The mesh is a background on `body` only. It is not `background-attachment: fixed`, which jumps on iOS Safari.

Contrast targets are WCAG AA: 4.5:1 for text, 3:1 for control borders. Primary buttons are solid `#5b21b6` with white text (about 9:1). They are not a light gradient. The violet-to-teal gradient is only the small ITS mark, which also uses white on those dark ends.

Chips:

| Tone | Background | Text |
|---|---|---|
| Draft, pending | `#fde68a` | `#92400e` |
| Open | `#bae6fd` | `#075985` |
| Received, approved | `#bbf7d0` | `#166534` |
| Cancelled, disabled | `#fecdd3` | `#9f1239` |
| Neutral, closed | `#e2e8f0` | `#1e293b` |

## Radius, shadow, blur

| Token | Value |
|---|---|
| `--radius-md` | `10px`, buttons and fields |
| `--radius-lg` / `--radius-card` | `18px`, cards, forms, the items grid |
| `--shadow-glass` / `--shadow-card` | `0 20px 50px rgba(49, 30, 90, 0.12)` |
| `--blur-glass` | `18px` |

## Glass and the solid fallback

Cards, forms, the top bar, stats, and banners default to `--card` (`rgba(255, 255, 255, 0.94)`). That is already readable with no blur.

When the browser supports `backdrop-filter`, those surfaces drop to `rgba(255, 255, 255, 0.86)` and blur by `--blur-glass`. The items grid and the sidebar stay solid: the grid is a data surface, and the sidebar has to stay dark when it overlays the page.

`prefers-reduced-transparency: reduce` turns the blur off and uses `--card-solid` (`#ffffff`).

Do not put `backdrop-filter` on `body`, `.app-shell`, `.shell-content`, or `.page`. On iOS that containing box breaks `position: fixed` and can keep a camera preview from painting. The scan video stays outside any blurred form. Lens and item photos open the system camera with `<input capture="environment">`.

On viewports at 800px and below, fields use a 16px font so iOS Safari does not zoom on focus. Camera and upload controls in `.gallery-actions` and `.file-button` have a 44px minimum height.

## Type

Plus Jakarta Sans, loaded with `next/font` as `--font-jakarta` on `<html>`. Weights 400, 500, 600, and 700. Printed labels keep Helvetica. Legal pages keep their serif article face.

Numbers in money and SKU columns use `font-variant-numeric: tabular-nums` and sit right-aligned.

## Components

New controls go in `components/ui` and use `cn` from `lib/cn.ts`.

| Component | Notes |
|---|---|
| `Button` | Variants `default`, `secondary`, `danger`. Renders the shared `button` classes so it matches the rest of the app |
| `Card` | The shared `card` surface |
| `Badge` | Status chips. Pass the status string (`draft`, `open`, `approved`, …). Unknown values use the neutral chip |
| `Input` | A text field. Existing screens can keep a plain `<input>`; it already uses the field tokens |

Tailwind utilities are available and live in a cascade layer under the hand-written CSS, so existing class names such as `.grid` keep their layout.

## What not to restyle per screen

Shell, item list, item detail, purchase orders, login, admin users, and Lens should pick up these tokens without a local palette. A new page uses `main.page`, `card` or `form`, `Button`, and `Badge` instead of new colors.
