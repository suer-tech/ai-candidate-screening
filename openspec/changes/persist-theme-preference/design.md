## Context

The page client currently initializes theme state to `light` and writes that value from an effect. On hydration this overwrites a stored dark choice. Theme application also waits for client effects, so the document can paint with the opposite palette first. Existing dark styles already key from `html[data-theme="dark"]`; the change only needs a reliable preference boundary and early root attribute.

## Goals / Non-Goals

**Goals:**
- Preserve an explicit `light` or `dark` selection across reload and client navigation.
- Use `prefers-color-scheme` only while no explicit selection exists.
- Apply the initial resolved theme before visible body content.
- Keep the control keyboard-native and expose its selected state to assistive technology.
- Fail safely when browser preference APIs are unavailable.

**Non-Goals:**
- Adding more themes, account-synced preferences, or a theme settings page.
- Changing colors, typography, dashboard semantics, or unrelated navigation.
- Persisting the system-derived fallback as if the user explicitly selected it.

## Decisions

### Decision: Keep a small shared theme domain module
A server-safe module owns the storage key, valid values, pure parsing/resolution helpers, and the bootstrap source. This avoids divergent rules between the root bootstrap, client control, and tests.

Alternative considered: duplicate inline logic in layout and page. Rejected because storage precedence and fallback behavior could drift.

### Decision: Run a synchronous bootstrap in the document head
The root layout emits a minimal inline script before body content. It reads a valid explicit preference, otherwise queries the system preference, and immediately sets `data-theme` and `color-scheme` on the root element. The script catches storage and media-query failures and uses a safe light fallback.

Alternative considered: resolve only in a React effect. Rejected because effects run after the initial render and permit a flash of the opposite theme.

### Decision: Client synchronization never persists a system fallback
After hydration, the client reads the already resolved root theme, listens for system changes only when no explicit preference exists, and listens for storage changes from other tabs. Only direct toggle activation writes `localStorage`.

Alternative considered: write every resolved theme. Rejected because it converts a system fallback into an explicit choice and prevents future system changes from applying.

### Decision: Use native pressed-button semantics
The existing button remains a native `button` with a stable `aria-label`, `aria-pressed`, and decorative icons marked `aria-hidden`. Textual accessible state and native keyboard behavior ensure color/icon are not the only indicators.

## Risks / Trade-offs

- Inline bootstrap must remain compatible with the active Content Security Policy. Deployment SHALL allow this reviewed bootstrap through the platform's nonce/hash mechanism if a restrictive CSP is enabled.
- Server markup cannot know a browser-only preference. The root attribute is deliberately set before body paint, and hydration warning suppression is limited to the root element.
- Browser storage can throw in restricted contexts. Safe access wrappers preserve usability but cannot provide cross-reload persistence when the browser refuses storage.

## Migration Plan

1. Add focused acceptance tests that fail against the unconditional light initialization.
2. Add the shared preference helpers and root bootstrap.
3. Replace effect-driven persistence with explicit-choice persistence and fallback synchronization.
4. Run focused tests, regression tests, lint/type checks, build, and strict OpenSpec validation.
5. Roll back by removing the bootstrap and helper while retaining existing CSS; no stored-data migration is required because the key and valid values stay compatible.

## Open Questions

None. The requested behavior determines precedence, persistence, startup timing, and accessibility semantics.
