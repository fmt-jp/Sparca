// Toolbar icons: 20×20 viewBox, 1.6px strokes, no fills unless noted, so all icons share one style.
import type { ReactElement } from 'react';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const paths: Record<string, ReactElement> = {
  select: <path {...S} fill="currentColor" d="M5 3 L5 16 L8.5 12.5 L11 17.5 L13 16.5 L10.6 11.6 L15.5 11.5 Z" />,
  subselect: <path {...S} d="M5 3 L5 16 L8.5 12.5 L11 17.5 L13 16.5 L10.6 11.6 L15.5 11.5 Z" />,
  crop: <path {...S} d="M6 2 V14 H18 M2 6 H14 V18" />,
  'marquee-rect': <rect {...S} x="3" y="4" width="14" height="12" strokeDasharray="2.2 2" />,
  'marquee-ellipse': <ellipse {...S} cx="10" cy="10" rx="7.5" ry="6" strokeDasharray="2.2 2" />,
  lasso: (
    <path {...S} d="M6 14 C1 10 4 3 11 3 C17 3 19 8 15 11 C12 13 8 12 7 14 C6.5 15.5 7.5 17.5 9 17.5" strokeDasharray="2.2 2" />
  ),
  'polygon-lasso': <path {...S} d="M3 15 L5 4 L12 7 L17 3 L16 16 Z" strokeDasharray="2.2 2" />,
  eyedropper: (
    <>
      <path {...S} d="M12 4.5 L15.5 8 M13.8 2.8 a2 2 0 0 1 3.4 3.4 L14.5 9 L11 5.5 Z" />
      <path {...S} d="M12.5 7.5 L5 15 L4 18 L7 17 L14.5 9.5" />
    </>
  ),
  hand: (
    <path
      {...S}
      d="M7 10 V4.5 a1.3 1.3 0 0 1 2.6 0 V9 M9.6 9 V3.5 a1.3 1.3 0 0 1 2.6 0 V9 M12.2 9 V5 a1.3 1.3 0 0 1 2.6 0 V12 c0 3 -2 5.5 -5 5.5 c-2.5 0 -3.6 -1 -5 -3.2 L3 11.5 a1.3 1.3 0 0 1 2.2 -1.3 L7 12.5"
    />
  ),
  zoom: (
    <>
      <circle {...S} cx="8.5" cy="8.5" r="5.5" />
      <path {...S} d="M12.5 12.5 L17.5 17.5 M6 8.5 H11 M8.5 6 V11" />
    </>
  ),
  line: <path {...S} d="M4 16 L16 4" />,
  arrow: <path {...S} d="M4 16 L15 5 M9 4.5 H15.5 V11" />,
  pen: (
    <>
      <path {...S} d="M10 2.5 L15 11 L12 17 H8 L5 11 Z" />
      <circle {...S} cx="10" cy="11" r="1.4" />
      <path {...S} d="M10 2.5 V9.6" />
    </>
  ),
  rect: <rect {...S} x="3" y="4.5" width="14" height="11" />,
  'rounded-rect': <rect {...S} x="3" y="4.5" width="14" height="11" rx="3.5" />,
  ellipse: <ellipse {...S} cx="10" cy="10" rx="7.5" ry="6" />,
  polygon: <path {...S} d="M10 2.5 L17 7.5 L14.5 16.5 H5.5 L3 7.5 Z" />,
  star: <path {...S} d="M10 2.5 L12.2 7.5 L17.5 7.9 L13.4 11.3 L14.7 16.6 L10 13.7 L5.3 16.6 L6.6 11.3 L2.5 7.9 L7.8 7.5 Z" />,
  text: <path {...S} d="M4 5 V3.5 H16 V5 M10 3.5 V16.5 M7.5 16.5 H12.5" />,
};

export function ToolIcon({ name }: { name: string }): ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {paths[name] ?? <circle {...S} cx="10" cy="10" r="6" />}
    </svg>
  );
}

export function SmallIcon({ d, title }: { d: string; title?: string }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path {...S} strokeWidth={1.4} d={d} />
    </svg>
  );
}

export const ICON = {
  eye: 'M1.5 8 C3.5 4.5 6 3.5 8 3.5 C10 3.5 12.5 4.5 14.5 8 C12.5 11.5 10 12.5 8 12.5 C6 12.5 3.5 11.5 1.5 8 Z M8 6 a2 2 0 1 0 0.01 0',
  eyeOff: 'M1.5 8 C3.5 4.5 6 3.5 8 3.5 C10 3.5 12.5 4.5 14.5 8 C12.5 11.5 10 12.5 8 12.5 C6 12.5 3.5 11.5 1.5 8 Z M2.5 13.5 L13.5 2.5',
  lock: 'M4 7.5 H12 V14 H4 Z M5.5 7.5 V5 a2.5 2.5 0 0 1 5 0 V7.5',
  unlock: 'M4 7.5 H12 V14 H4 Z M5.5 7.5 V5 a2.5 2.5 0 0 1 5 0',
  plus: 'M8 3 V13 M3 8 H13',
  trash: 'M3 4.5 H13 M6 4.5 V3 H10 V4.5 M4.5 4.5 L5.2 14 H10.8 L11.5 4.5',
  copy: 'M5.5 5.5 H13.5 V13.5 H5.5 Z M3 10.5 V2.5 H10.5',
  folder: 'M2 4 H6.5 L8 5.5 H14 V13 H2 Z',
  chevronRight: 'M6 4 L10 8 L6 12',
  chevronDown: 'M4 6 L8 10 L12 6',
};
