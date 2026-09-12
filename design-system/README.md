# checklist-kitchen-ds

A React + TypeScript component library derived from the kitchen-kiosk app's
(`checklist-app/src/views/`) existing CSS and markup patterns. Built so it can
be fed into Claude Design (`/design-sync`) as a real, standalone package.

**This package is not wired into the live app.** `checklist-app`'s pages are
still plain server-rendered HTML/CSS/vanilla JS, unchanged except for the
token-extraction cleanup in `style.css`/`help_overlay.css` (see the repo's
top-level plan doc). Whether/how to wire these components into production is
a separate, later decision.

## Components

| Component | Unifies (from the original app) |
|---|---|
| `Button` | ~14 independently-declared button families (bottom nav, add-record, back button, logout, modal actions, sc3/sc4 action buttons, etc.) |
| `SegmentedTabs` | `.sc3_section_btn` tabs and library.html's `.segment` control |
| `TextInput` | `.sc1_text_input` / `.sc2_temp_input` / `.sc3_input` / `.sc4_input` |
| `Textarea` | `.sc2_textarea` / `.sc3_textarea` / `.sc4_textarea` |
| `PinInput` | login.html's 6-box `.pin_digit` group (auto-advance, backspace, paste) |
| `ToggleQuestion` | sc1/sc5's yes-no `.button_checklist_container` + `.checklist_circle` control |
| `Card` (+ `CardHeader`/`CardTitle`/`CardDescription`/`CardArrow`/`CardBadge`) | `.checklist_card`, `.checklist_card_l`, `.sc1_record_card`, `.sc4_row_card`, `.sc3_row_container` |
| `CalendarDayGrid` | sc2.html's `#sc2_month_grid` day grid |
| `Modal` | script.js's `showAppModal()` (the app-wide `alert()` replacement) |
| `Banner` | script.js's sync-warning banner + the `sc2_note`/`sc3_note_section` callouts |
| `StatusBadge` | js/status-badge.js's 4-state sync badge |

## Tokens

`src/tokens/tokens.css` mirrors the `:root` custom properties in
`checklist-app/src/views/style.css`. **There is no build-time link between
the two** - if the app's palette changes, update both files by hand. A few
tokens here (the warning-banner and sync-status-badge colors) don't exist in
style.css's `:root` because those specific UI pieces are built with
JS-authored inline styles (`script.js`, `status-badge.js`) rather than CSS
classes; they're included here as the canonical values for this design
system regardless.

## Build

```bash
npm install
npm run build   # esbuild -> dist/index.{esm,global}.{js,css}, tsc -> dist/**/*.d.ts
```

Open `preview.html` in a browser after building for a quick visual
sanity-check of every component (loads `dist/index.global.js`, no CDN, no
dev server needed).
