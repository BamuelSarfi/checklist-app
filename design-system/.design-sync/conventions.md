## Conventions

**No wrapper needed.** No component reads from React context — mount any component directly, no provider/root wrapper required. Styling is applied automatically once `styles.css`'s import closure is loaded (already the case for every bound preview and every design built with this DS).

**Styling idiom: CSS custom properties (design tokens) + BEM-ish component classes.** Never invent ad hoc class names or inline hex colors — always reach for one of these tokens via `var(--token-name)` in any custom CSS layered around a component, and reuse the component's own class family (`ds-<component>`, `ds-<component>--<variant>`) rather than restyling from scratch.

| Token | Value | Use for |
|---|---|---|
| `--color-success` | `#4CAF50` | Positive/success state (borders, active tabs, progress) |
| `--color-error` | `#f44336` | Errors, destructive actions, missed/failed states |
| `--color-info` | `#0066cc` | Accent, focus outlines |
| `--color-warning-bg` / `--color-warning-text` | `#fff3cd` / `#856404` | Warning banners |
| `--color-bg-hover` / `--color-bg-active` | `#f0f0f0` / `#e0e0e0` | Interactive hover/active surfaces |
| `--color-text-heading` / `--color-text-muted` | `#111` / `#555` | Text hierarchy |
| `--radius-sm` … `--radius-lg` | `4px` … `12px` | Corner rounding scale — no arbitrary radius values |
| `--font-family-base` | system sans-serif fallback | Base typography (see note below) |

Component class naming follows `ds-<Component>` for the root and `ds-<Component>--<variant>` for variant modifiers (e.g. `ds-button--primary`, `ds-card--record`, `ds-status-badge--synced`). Status/semantic colors (success/error/warning/info) are consistent across every component that has state — `Badge`, `Banner`, `StatusBadge`, and `Modal` all key off the same four-way semantic split.

**Note on typography**: the source app referenced `'Myriad Pro'` (a commercial font never actually shipped, even in production) — this DS renders with the system sans-serif fallback intentionally, not as a gap to fill.

**Where the truth lives**: read `styles.css` at the bundle root first — its `@import` chain is the complete, real style source (tokens + every component's CSS). Each component's own `.prompt.md` documents its exact props and variants; trust those over guessing from the name.

**Idiomatic build example** — a checklist list page composed from real exports:

```jsx
import { Card, CardTitle, CardDescription, CardBadge, CardArrow, Button } from 'checklist-kitchen-ds';

function ChecklistItem() {
  return (
    <Card variant="list-item">
      <div>
        <CardTitle>
          SC1 - Food Delivery Records <CardBadge>Required</CardBadge>
        </CardTitle>
        <CardDescription>Food delivery conditions and organization check</CardDescription>
      </div>
      <CardArrow />
    </Card>
  );
}

function PrimaryAction() {
  return <Button variant="primary" fullWidth>+ Add Record</Button>;
}
```

Layout glue outside these components (page containers, spacing between cards) should use the same `--radius-*`/color tokens above via plain CSS — never a new hardcoded value when a token already covers it.
