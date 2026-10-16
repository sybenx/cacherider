import { PumpkinVines } from 'cacherider';

// A stand-in for the map of the walk: the map's own ground and the shuttle's loop in the Pumpkin Walk's colour, its
// two stops with their next times, framed inside the vines as the app frames it.
const Walk = () => (
  <svg width="100%" height="100%" viewBox="0 0 390 520" preserveAspectRatio="xMidYMid slice" style={{ background: 'var(--color-surface)' }}>
    <g stroke="var(--color-bg)" strokeWidth="6" fill="none"><path d="M0 120H390M0 300H390M0 430H390M120 0V520M250 0V520" /></g>
    <rect x="216" y="196" width="110" height="98" fill="#9fd8b5" opacity=".7" />
    <path d="M70 182H330V322H66Z" stroke="#c8410b" strokeWidth="5" fill="none" strokeLinejoin="round" />
    <circle cx="86" cy="182" r="7" fill="#c8410b" stroke="#fff" strokeWidth="2" /><circle cx="300" cy="182" r="7" fill="#c8410b" stroke="#fff" strokeWidth="2" />
    <text x="72" y="168" fontFamily="var(--font-heading)" fontWeight="600" fontSize="16" fill="var(--color-text)">6:20</text>
    <text x="284" y="168" fontFamily="var(--font-heading)" fontWeight="600" fontSize="16" fill="var(--color-text)">6:22</text>
  </svg>
);

/** On a phone: the map of the walk, the vine along the bottom of its search box. */
export const OverTheMap = () => (
  <div style={{ width: 390, height: 520 }}><PumpkinVines><Walk /></PumpkinVines></div>
);
