// Small inline SVG icon set (consistent stroke icons instead of OS-dependent emoji).
const P = (d) => <path d={d} />;

const ICONS = {
  plus: P("M12 5v14M5 12h14"),
  x: P("M18 6 6 18M6 6l12 12"),
  panel: (<><rect x="3" y="3" width="18" height="18" rx="2" />{P("M9 3v18")}</>),
  sliders: P("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"),
  sun: (<><circle cx="12" cy="12" r="4" />{P("M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41")}</>),
  moon: P("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"),
  monitor: (<><rect x="2" y="3" width="20" height="14" rx="2" />{P("M8 21h8M12 17v4")}</>),
  paperclip: P("m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"),
  mic: (<><rect x="9" y="2" width="6" height="12" rx="3" />{P("M19 10v2a7 7 0 0 1-14 0v-2M12 19v3")}</>),
  send: P("M12 19V5M5 12l7-7 7 7"),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />,
  copy: (<><rect x="9" y="9" width="13" height="13" rx="2" />{P("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1")}</>),
  check: P("M20 6 9 17l-5-5"),
  volume: P("M11 5 6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"),
  refresh: P("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"),
  trash: P("M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
  pencil: P("M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"),
  search: (<><circle cx="11" cy="11" r="8" />{P("m21 21-4.3-4.3")}</>),
  arrowDown: P("M12 5v14M19 12l-7 7-7-7"),
  download: P("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"),
  file: (<>{P("M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z")}{P("M14 2v6h6")}</>),
  zap: P("M13 2 3 14h9l-1 8 10-12h-9l1-8z"),
  alert: (<><circle cx="12" cy="12" r="10" />{P("M12 8v4M12 16h.01")}</>),
  info: (<><circle cx="12" cy="12" r="10" />{P("M12 16v-4M12 8h.01")}</>),
  sparkles: P("m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"),
  pin: P("M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"),
  wrap: P("M3 6h18M3 12h15a3 3 0 1 1 0 6h-4M16 16l-2 2 2 2M3 18h7"),
  image: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" />{P("m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21")}</>),
  message: P("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"),
  chevronDown: P("m6 9 6 6 6-6"),
  code: P("m16 18 6-6-6-6M8 6l-6 6 6 6"),
  bulb: P("M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5M9 18h6M10 22h4"),
  globe: (<><circle cx="12" cy="12" r="10" />{P("M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z")}</>),
  book: P("M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"),
  keyboard: (<><rect x="2" y="5" width="20" height="14" rx="2" />{P("M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 17h8M10 13h4")}</>),
};

export function Icon({ name, size = 18, className = "", strokeWidth = 2 }) {
  return (
    <svg
      className={`icon-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name] || null}
    </svg>
  );
}
