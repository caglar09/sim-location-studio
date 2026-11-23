# Design context

## Product

Sim Location Studio is a location-testing instrument for application developers. Its primary surface is a route planner beside a live map; users need to understand endpoints, route mode, distance, estimated travel time, and playback state at a glance.

## Visual language

- **Palette:** charcoal `#131a18`, paper `#f4f3ec`, raised paper `#fffef9`, hairline `#e2e0d5`, chartreuse `#d2f35b`, route green `#738b3d`, transit violet `#7769bf`.
- **Type:** Avenir Next / Segoe UI / system sans for controls and headings; system monospace for coordinates and speed values. Avoid externally hosted font dependencies.
- **Layout:** compact dark app bar; paper route planner at left; map as the largest canvas; persistent trip playback dock. At narrow widths, map leads and planner follows it.
- **Signature:** the chartreuse route marker and primary action indicate the active test path; use the color only for actions and selected route state.

## Behavior contract

- Selecting locations is reversible; search suggestions are keyboard-focusable buttons.
- A route is not shown as ready until the router returns geometry.
- Transit is unavailable until OpenTripPlanner is configured; do not imply live train schedules otherwise.
- Route preview never sends locations to a phone. Screen control is a separate browser-to-TrollVNC connection that requires the phone's own VNC server to be running.
- Every active playback has a visible pause, resume, stop, progress, and status message.
- The access token is required before device discovery or location-changing calls.
