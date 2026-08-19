## Why

Theme selection currently initializes as light and immediately overwrites a previously stored dark preference, so dark mode does not survive reload. Theme resolution also happens after render, allowing the opposite palette to flash before the selected theme is applied.

## What Changes

- Persist an explicit light or dark choice and restore it across reload and in-app navigation.
- Use the operating-system color preference only while no explicit user choice exists.
- Apply the resolved theme before first paint to avoid an opposite-theme flash.
- Expose the theme toggle as an accessible pressed-state control with a stable label and non-color icon.
- Add focused preference/bootstrap/accessibility tests.

## Capabilities

### New Capabilities

- `theme-preference`: site-wide resolution, persistence, early application and accessible control of light/dark theme preference.

### Modified Capabilities

- `quality-gates`: add acceptance coverage for explicit persistence, system fallback, no-flash bootstrap and toggle accessibility.

## Impact

- Affects root document bootstrap, the global theme toggle, theme preference storage and UI tests.
- Does not change product workflow, dashboard data, authentication or external integrations.
