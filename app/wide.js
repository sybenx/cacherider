// The window's size class, by Material's: compact (a phone) under 600 px, medium (a portrait tablet) 600 to 839,
// expanded 840 and up. The numbers are here for the scripts; the stylesheet's @media rules say the same, 600px and
// 840px (a media query can't read a variable).
export const MEDIUM = 600, EXPANDED = 840;
export const WIDE_MQ = `(min-width: ${EXPANDED}px)`;
/** Expanded: the page as a column beside the map, the header's links for the tab bar. */
export const isWide = () => matchMedia(WIDE_MQ).matches;
