---
name: design-system-check
description: Verify UI code against the Apple-Weather premium glass design system this project mandates (tokens-only color/shadow/radius, glass surfaces, tabular-nums money, spring motion). Use before finishing any frontend change or when reviewing components/pages in apps/web.
---

# design-system-check

The design language is binding, not aspirational (see the "WHOLESALE PORTAL DESIGN
SYSTEM" and "Design-system enforcement" sections of CLAUDE.md). This skill checks
`apps/web` changes against it. It is a linter-in-prose: read the rules, scan the
changed files, report violations with `file:line` and the fix.

## What to check

### 1. Tokens only — no hardcoded values
The tokens in `apps/web/tailwind.config.ts` and `globals.css` are the ONLY source of
color, shadow, radius, and duration. Flag:
- Raw hex/rgb/hsl in className or styles (`#fff`, `rgb(...)`, `rgba(...)`).
- Default-palette Tailwind utilities used for surfaces/text/borders:
  `bg-white`, `bg-gray-*`, `text-gray-*`, `border-gray-*`, `bg-blue-*`, `text-blue-*`,
  `text-black`, `hover:bg-gray-*`, `hover:bg-blue-*`.
- Arbitrary values: `bg-[...]`, `shadow-[...]`, `rounded-[...]`, `text-[#...]`.
- Any shadow outside the token shadow scale.

Fast scan:
```
cd /root/wholesale-portal/apps/web/src
grep -rnE '#[0-9a-fA-F]{3,6}|rgba?\(|\b(bg|text|border)-(gray|blue|slate|zinc|neutral)-[0-9]|bg-white\b|text-black\b|(bg|shadow|rounded|text)-\[' app components
```
Only these palette names are legal: Ocean Blue, Sky Blue, Mint Green, Cloud White,
Fog Gray, Coral, Amber — as their token utilities, never raw.

### 2. Glass surfaces are present
Cards, navigation, sidebar, modals, tables, dropdowns, popovers, toasts must be
translucent Cloud White over `backdrop-filter: blur(28px)` with a soft, wide,
blue-gray shadow and large radius (cards 28px/22px, buttons/inputs 16px, modal 32px,
chips 9999px). Flag flat opaque `bg-white` cards, sharp corners, or missing blur on
any of those surfaces. (The old flat-minimalist style — no blur, no gradients, no
transforms — is forbidden; do not reintroduce it.)

### 3. Money cells use tabular-nums
Every monetary/numeric value cell must render with `tabular-nums`. In `DataTable`
this comes free from `align="right"`; outside it, assert the class is present. Flag
money rendered with proportional figures.

### 4. Status badges are soft solid-fill chips
Tinted fill + matching-hue label, never transparent/outline-only.

### 5. Motion
Interactive elements lift/press with spring transforms (hover `translateY(-2px)`,
press `scale(.97)`, ~150–350ms spring). Nothing appears/disappears instantly. Flag
instant show/hide, abrupt transitions, or missing hover/press affordance on buttons
and cards.

## Method
- Scope to changed files first: `git -C /root/wholesale-portal diff --name-only -- apps/web`.
- Run the grep above, then read each hit in context (a match inside a token
  definition or a gradient stop may be legitimate — verify before flagging).
- Cross-reference `tests/e2e/visual-consistency.spec.ts`, which asserts several of
  these via computed style; a violation here will likely fail that spec.

## Output
List each violation as `file:line — rule — offending code → suggested token/fix`,
grouped by rule. End with PASS (design-system clean) or `N violations` and the single
highest-impact fix to make first. Do not edit files unless explicitly asked — report.
