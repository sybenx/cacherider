// The window's size class: a phone's layout under 840 px (a tablet upright too), expanded 840 and up. The number is
// here for the scripts; the stylesheet's @media rules say the same, 840px (a media query can't read a variable).
export const EXPANDED = 840;
export const WIDE_MQ = `(min-width: ${EXPANDED}px)`;
/** Expanded: the page as a column beside the map, the header's links for the tab bar. */
export const isWide = () => matchMedia(WIDE_MQ).matches;
