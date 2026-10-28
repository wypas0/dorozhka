// Логотип 7.1 и «живописная вода» с холста «Дорожка × Stroke». Правило Stroke: одна живописная поверхность на экран, текста на ней нет.

/** Чёткий знак: для размеров меньше 96 px. */
export const Mark = ({ size = 34 }: { size?: number }) => (
  <svg viewBox="0 0 200 200" width={size} height={size} aria-hidden="true">
    <rect x="22" y="38" width="156" height="124" rx="22" fill="#9CCDE6" stroke="#1F5568" stroke-width="16" />
    <path d="M40 79H160M40 121H160" stroke="#2B6C8C" stroke-width="12" />
    <path d="M40 79H160M40 121H160" stroke="#D2452F" stroke-width="12" stroke-dasharray="15 15" />
  </svg>
);

const OIL = (id: string, freq: string, scale: number) => (
  <filter id={id} x="-10%" y="-20%" width="120%" height="140%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={3} seed={11} result="n" />
    <feDisplacementMap in="SourceGraphic" in2="n" scale={scale} xChannelSelector="R" yChannelSelector="G" result="d" />
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.25" numOctaves={4} seed={23} result="t" />
    <feDiffuseLighting in="t" surfaceScale={2.4} lighting-color="#fff" result="l"><feDistantLight azimuth={225} elevation={56} /></feDiffuseLighting>
    <feComposite in="l" in2="d" operator="in" result="lit" />
    <feBlend in="lit" in2="d" mode="soft-light" />
  </filter>
);

/** Живописный знак 7.1: бассейн сверху маслом, красно-синие тросы. От 96 px. */
export const PaintedMark = ({ size = 120 }: { size?: number }) => (
  <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="Дорожка">
    <defs>
      <clipPath id="pm-pool"><rect x="22" y="38" width="156" height="124" rx="22" /></clipPath>
      {OIL('pm-oil', '0.03 0.3', 12)}
    </defs>
    <g clip-path="url(#pm-pool)"><g filter="url(#pm-oil)">
      <rect x="0" y="30" width="200" height="30" fill="#DDEFF1" />
      <rect x="0" y="52" width="200" height="22" fill="#A8D5E0" />
      <rect x="30" y="68" width="110" height="10" fill="#B9B5EC" />
      <rect x="0" y="78" width="200" height="26" fill="#9CCDE6" />
      <rect x="0" y="100" width="200" height="24" fill="#6CAAC2" />
      <rect x="100" y="116" width="70" height="8" fill="#9ED8C8" />
      <rect x="0" y="124" width="200" height="22" fill="#3B7896" />
      <rect x="0" y="142" width="200" height="30" fill="#1C3F55" />
      <path d="M20 79 H180 M20 121 H180" stroke="#F2F5F4" stroke-width="9" />
      <path d="M20 79 H180 M20 121 H180" stroke="#D2452F" stroke-width="9" stroke-dasharray="14 14" />
    </g></g>
    <rect x="22" y="38" width="156" height="124" rx="22" stroke="#1F5568" stroke-width="12" fill="none" />
  </svg>
);

/** Полоса воды маслом. tall — шапка экрана входа; обычная — тонкая полоса под заголовком. */
export const Water = ({ tall = false, rope = false }: { tall?: boolean; rope?: boolean }) => {
  const id = tall ? 'w-oil-tall' : 'w-oil';
  return (
    <svg class={`water${tall ? ' tall' : ''}`} viewBox="0 0 1200 200" preserveAspectRatio="none" aria-hidden="true">
      <defs>{OIL(id, tall ? '0.008 0.16' : '0.012 0.2', tall ? 26 : 18)}</defs>
      <g filter={`url(#${id})`}>
        <rect x="-20" y="-20" width="1240" height="70" fill="#DDEFF1" />
        <rect x="-20" y="40" width="1240" height="40" fill="#A8D5E0" />
        <rect x="160" y="64" width="520" height="18" fill="#B9B5EC" />
        <rect x="-20" y="78" width="1240" height="40" fill="#9CCDE6" />
        <rect x="-20" y="112" width="1240" height="34" fill="#6CAAC2" />
        <rect x="700" y="128" width="300" height="14" fill="#9ED8C8" />
        <rect x="-20" y="142" width="1240" height="30" fill="#3B7896" />
        <rect x="-20" y="166" width="1240" height="60" fill="#1C3F55" />
        {rope && <path d="M-20 96 H1220" stroke="#F2F5F4" stroke-width="8" />}
        {rope && <path d="M-20 96 H1220" stroke="#D2452F" stroke-width="8" stroke-dasharray="26 26" />}
      </g>
    </svg>
  );
};

const I = (d: string) => () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>
);
export const Icon = {
  today: I('M3 15c2 0 2-1.5 4.5-1.5S9.5 15 12 15s2.5-1.5 4.5-1.5S19 15 21 15M3 19c2 0 2-1.5 4.5-1.5S9.5 19 12 19s2.5-1.5 4.5-1.5S19 19 21 19M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z'),
  journal: I('M4 6h16M4 12h16M4 18h16M9 3v18'),
  clients: I('M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3'),
  payments: I('M3 6h18v12H3zM3 10h18M7 15h3'),
  settings: I('M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4'),
  more: I('M4 7h16M4 12h16M4 17h10'),
};
