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

The mesh is a background on `body` only. It is not `background-attachment: fixed`, which jumps on iOS Safari. The three washes (violet, cyan, rose) sit at about 0.62, 0.50, and 0.40 so the color reads on the canvas without covering the cards.

Contrast targets are WCAG AA: 4.5:1 for text, 3:1 for control borders. Primary buttons (Save, Add, Find, Sign in) use `linear-gradient(135deg, #1d4ed8, #4f46e5, #6d28d9)`. White text stays above 4.5:1 on every stop (`#1d4ed8` about 6.7:1, `#4f46e5` about 6.3:1, `#6d28d9` about 7.1:1). Secondary buttons are quiet: ink text on a light fill with a neutral hairline, not an accent outline. The small ITS mark keeps the violet-to-teal gradient.

Icon-only controls on that dark primary fill use `--icon-on-dark` (`#eef2ff`), a light tint of the fill, for the glyph and its stroke. That includes sales-order icon actions, the new-order plus, the items New button, the enabled toolbar save icon, and the pricing save icon. Do not set those to `color: inherit`: page text is dark on the light theme, and the icon disappears into the button. Light chips (`.icon-button`, `.secondary`) keep `--ink` on the light surface. Danger icon buttons stay white on `--danger-ink`.

The sidebar is sticky, `100dvh` tall, and solid `#0a0e1c`. The mobile drawer uses the same height so it fills the screen instead of stopping after the links. The ITS mark and the version share one line, for example `ITS v0.21.0`. The version is small muted text. Hover the logo for the commit, branch, and Pacific build time. A collapsed sidebar hides the version and keeps that detail on the logo tooltip. The mobile drawer shows the version beside the mark again. When someone is signed in, their name sits at the bottom in `--sidebar-muted`, with a ghost **Sign out** control: a log-out icon and small muted text, no fill, border, or gradient. Hover adds a light highlight and leaves the text muted. A collapsed sidebar shows the icon only. The tooltip and accessible name are Sign out.

The items list uses icon buttons for First page, Previous page, Next page, Last page, Export, and New item. Each has an accessible name and a tooltip. The four page buttons sit together. On viewports at 700px and below those controls are at least 44px square, including when a page button is disabled. Every icon in the app has a hover tooltip. Icon-only controls use the native title, and it matches the accessible name. The items toolbar uses its own tooltip for the same words. An icon that sits beside a visible label still has that title on the control.

Chips:

| Tone | Background | Text |
|---|---|---|
| Draft, pending | `#fde68a` | `#92400e` |
| Open | `#bae6fd` | `#075985` |
| Received, approved | `#bbf7d0` | `#166534` |
| Cancelled, disabled | `#fecdd3` | `#9f1239` |
| Neutral, closed, other file | `#e2e8f0` | `#1e293b` |
| Vendor invoice | `#a5f3fc` | `#155e75` |
| Quote | `#ddd6fe` | `#5b21b6` |
| Order confirmation | `#bbf7d0` | `#166534` |

## Radius, shadow, blur

| Token | Value |
|---|---|
| `--radius-md` | `10px`, buttons and fields |
| `--radius-lg` / `--radius-card` | `18px`, cards, forms, the items grid |
| `--shadow-glass` / `--shadow-card` | `0 20px 50px rgba(49, 30, 90, 0.12)` |
| `--blur-glass` | `18px` |

## Glass and the solid fallback

Cards, forms, the top bar, stats, and banners default to `--card` (`rgba(255, 255, 255, 0.94)`). That is already readable with no blur.

When the browser supports `backdrop-filter`, cards, the top bar, stats, and banners drop to `rgba(255, 255, 255, 0.86)` and blur by `--blur-glass`. Forms stay on the solid card color. A form repaints while someone types, and a blur on that paint is what makes keystrokes feel late on phones. The items grid and the sidebar stay solid: the grid is a data surface, and the sidebar has to stay dark when it overlays the page.

`prefers-reduced-transparency: reduce` turns the blur off and uses `--card-solid` (`#ffffff`).

Do not put `backdrop-filter` on `body`, `.app-shell`, `.shell-content`, or `.page`. On iOS that containing box breaks `position: fixed` and can keep a camera preview from painting. The scan video stays outside any blurred form. Lens and item photos open the system camera with `<input capture="environment">`.

On viewports at 800px and below, fields use a 16px font so iOS Safari does not zoom on focus. Camera and upload controls in `.gallery-actions` and `.file-button` have a 44px minimum height.

Below 768px, each purchase-order line is a stacked card: item and description, then a two-by-two grid of qty, unit, unit price, and ext price. The line table does not scroll sideways. Subtotal, shipping, and total sit right-aligned under the cards.

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

## Zinc surface (opt in)

Sales orders use a second surface. Add the class `ds` next to `page` (`main.page.so-page.ds`). Other pages can follow the same way. Do not copy these hexes into a one-off screen, and do not replace the `:root` glass tokens. The sidebar stays the app sidebar.

| Token | Light | Dark |
|---|---|---|
| `--ds-canvas` | `#fafafa` | `#09090b` |
| `--ds-card` | `#ffffff` | `#18181b` |
| `--ds-ink` | `#18181b` | `#fafafa` |
| `--ds-muted` | `#737373` | `#a1a1aa` |

Dark follows `prefers-color-scheme: dark`. While that matches, `.shell-body:has(.ds)` paints the same canvas, including the top bar, so the violet mesh does not frame the page. `--ds-muted` is neutral-500 in light. In dark it lifts to zinc-400 so metadata still clears AA on `#18181b`.

Cards, the order banner, and drawers use `--ds-card` and a soft shadow. They do not use a heavy border or the glass blur. Page padding is 24px, and 16px below 800px. Fields use a 10px radius, a hairline zinc border, and a 200ms transition into a soft indigo ring (`box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.28)`).

Status chips inside `.ds` use a desaturated background and a rich foreground: draft and pending are warm amber (`#f5f0e6` / `#92400e`), not neon yellow. Cancelled is a quiet rose, not neon red. The chips in the glass section above stay as they are, so purchase orders do not change.

On a sales order, a sticky header holds the order identity, the sales order number, and icon actions for save, approve, and cancel. The banner under it is the first field row. Terms and shipping sit in a drawer that starts open. Those fields are not required to approve. Addresses sit in the narrow column, ship-to above bill-to. An eBay order shows ship-to only. The line table, eBay amounts, and payment use the wide column. Customer notes, internal notes, and attachments are one row under payment. Below 960px that split stacks in the same field order.
