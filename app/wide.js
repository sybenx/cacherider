// The wide layout: the page as a column beside the map, the header's links for the tab bar. From this width up; a
// portrait tablet (about 800 CSS px) is in it. The stylesheet's @media rules for it say the same number, 740px.
export const WIDE_MQ = '(min-width: 740px)';
export const isWide = () => matchMedia(WIDE_MQ).matches;
