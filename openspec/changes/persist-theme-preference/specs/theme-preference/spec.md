## Purpose

Defines how the site resolves, persists, applies, and exposes an explicit light or dark theme without showing the opposite palette during startup.

## ADDED Requirements

### Requirement: THEME-001 Explicit theme preference persists
The site SHALL persist a valid explicit user choice of `light` or `dark` and SHALL restore that choice across reloads and in-app navigation. An explicit choice SHALL take precedence over the operating-system color preference until the user explicitly selects the other theme. Invalid or unavailable persisted values MUST NOT be treated as an explicit choice.

#### Scenario: Dark theme survives reload
- **WHEN** the user explicitly selects `dark` and reloads the site
- **THEN** the site resolves and displays `dark`
- **AND** the stored preference remains `dark`

#### Scenario: Explicit light overrides a dark system preference
- **WHEN** the operating system prefers dark and the user explicitly selects `light`
- **THEN** the site persists and continues to display `light`
- **AND** later system preference changes do not replace the explicit choice

### Requirement: THEME-002 System preference is a non-persisted fallback
When no valid explicit preference exists, the site SHALL resolve the initial theme from `prefers-color-scheme`. While no explicit preference exists, a system preference change SHALL update the displayed theme without creating an explicit stored choice.

#### Scenario: First visit follows the system
- **WHEN** no valid theme preference is stored and the system prefers dark
- **THEN** the site displays `dark`
- **AND** it does not persist `dark` as an explicit choice

#### Scenario: Invalid stored value is ignored
- **WHEN** storage contains a value other than `light` or `dark`
- **THEN** the site resolves the theme from the current system preference
- **AND** the invalid value does not override that preference

### Requirement: THEME-003 Resolved theme is applied before visible content
The site SHALL resolve and apply the initial theme to the root document before visible application content is painted. The bootstrap SHALL tolerate unavailable preference storage or media-query APIs and SHALL fall back safely without preventing the page from loading.

#### Scenario: Stored theme is applied during document bootstrap
- **WHEN** a valid explicit theme exists before the page loads
- **THEN** the root document receives that theme before application content is rendered
- **AND** the page does not first display the opposite theme

#### Scenario: Preference storage is unavailable
- **WHEN** reading preference storage throws an error
- **THEN** the bootstrap uses the available system preference or the light fallback
- **AND** page rendering continues

### Requirement: THEME-004 Theme toggle exposes accessible state
The theme control SHALL be a keyboard-operable button with a stable accessible name and an `aria-pressed` state that indicates whether dark theme is selected. Its visible icon SHALL be supplemental and hidden from assistive technology.

#### Scenario: Dark theme is selected
- **WHEN** the current resolved theme is `dark`
- **THEN** the theme button exposes `aria-pressed="true"`
- **AND** its accessible name identifies the dark-theme setting without relying on the icon or color

#### Scenario: Theme is toggled by keyboard
- **WHEN** a keyboard user activates the native theme button
- **THEN** the opposite theme is applied and persisted as an explicit choice
- **AND** the button's pressed state is updated
