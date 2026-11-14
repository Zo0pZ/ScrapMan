/* ScrapMan — display labels and icons.
 *
 * Pure data, extracted from app.js. Nothing here touches the DOM or Supabase, so it is
 * safe to import from anywhere and cheap to unit-test.
 */

export const WEIGHT_LABEL = { small: "Car boot", medium: "Trailer load", large: "Skip load" };
export const URGENCY_LABEL = { today: "Today", week: "This week", norush: "No rush" };
export const TYPE_LABEL = { ferrous: "Ferrous", nonferrous: "Non-ferrous", appliance: "Appliance", mixed: "Mixed" };

export const TYPE_ICON = {
  ferrous: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  nonferrous: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z"/></svg>',
  appliance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="5" y1="9" x2="19" y2="9"/><circle cx="9" cy="6" r="0.6" fill="currentColor" stroke="none"/></svg>',
  mixed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="9.5" r="5"/></svg>'
};

/** Fall back to the raw value so an unknown type never renders as "undefined". */
export function labelForType(type) {
  return TYPE_LABEL[type] || type || "";
}

export function iconForType(type) {
  return TYPE_ICON[type] || TYPE_ICON.mixed;
}
