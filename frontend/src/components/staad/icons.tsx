// STAAD design-system icons, lifted verbatim from the exported artboards in
// .design-reference/. Stroke widths and viewBoxes are the design's own, so the
// weight matches the mockups exactly rather than approximating with an icon lib.
import React from 'react';

type P = React.SVGProps<SVGSVGElement> & { size?: number };

const mk = (viewBox: string, sw: string, inner: React.ReactNode, defSize: number) =>
  function Icon({ size = defSize, ...rest }: P) {
    return (
      <svg
        viewBox={viewBox}
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {inner}
      </svg>
    );
  };

export const BrandMark = mk('0 0 26 26', '1.84', <><path d="M13 4.1c2 2.2 2 5.3 0 7.5-2-2.2-2-5.3 0-7.5z" /><path d="M4.4 10.4c2.9-.6 5.7.7 6.9 3.3-2.9.6-5.8-.7-6.9-3.3zM21.6 10.4c-1.1 2.6-4 3.9-6.9 3.3 1.2-2.6 4-3.9 6.9-3.3z" /><path d="M7.6 20.9h10.8" /></>, 26);
export const IconDashboard = mk('0 0 20 20', '1.33', <><rect x="2.9" y="2.9" width="5.8" height="5.8" rx="1.4" /><rect x="11.3" y="2.9" width="5.8" height="5.8" rx="1.4" /><rect x="2.9" y="11.3" width="5.8" height="5.8" rx="1.4" /><rect x="11.3" y="11.3" width="5.8" height="5.8" rx="1.4" /></>, 20);
export const IconClients = mk('0 0 20 20', '1.33', <><circle cx="7.6" cy="6.6" r="2.7" /><path d="M2.9 16.7v-1.4a3 3 0 0 1 3-3h3.4a3 3 0 0 1 3 3v1.4M13.6 5.5a2.6 2.6 0 0 1 0 5M15.3 12.4a3 3 0 0 1 2 2.8v1.5" /></>, 20);
export const IconSessions = mk('0 0 20 20', '1.33', <><rect x="4.2" y="3.8" width="11.6" height="13.1" rx="2" /><path d="M7.1 8.3h5.8M7.1 11.7h3.9" /></>, 20);
export const IconSchedule = mk('0 0 20 20', '1.33', <><rect x="2.9" y="4.2" width="14.2" height="12.9" rx="2.4" /><path d="M2.9 8.3h14.2M7.1 2.5v2.5M12.9 2.5v2.5" /></>, 20);
export const IconModules = mk('0 0 20 20', '1.33', <><path d="M10 2.5 17.5 6.7 10 10.8 2.5 6.7z" /><path d="M2.5 10.4 10 14.6l7.5-4.2M2.5 13.8 10 18l7.5-4.2" /></>, 20);
export const IconPlans = mk('0 0 20 20', '1.33', <><rect x="2.5" y="4.6" width="15" height="10.8" rx="2.2" /><path d="M2.5 8.3h15M5.8 12.1h2.9" /></>, 20);
export const IconProfile = mk('0 0 20 20', '1.33', <><circle cx="10" cy="6.9" r="3" /><path d="M4.2 16.7v-1a3.3 3.3 0 0 1 3.3-3.3h5a3.3 3.3 0 0 1 3.3 3.3v1" /></>, 20);
export const IconHelp = mk('0 0 20 20', '1.33', <><circle cx="10" cy="10" r="7.1" /><path d="M8 8a2 2 0 1 1 2.7 1.9c-.5.2-.7.6-.7 1.1v.4" /><path d="M10 13.8h.01" /></>, 20);
export const IconThemeA = mk('0 0 20 20', '1.33', <><path d="M16.3 11.4A6.7 6.7 0 0 1 8.6 3.7a6.7 6.7 0 1 0 7.7 7.7z" /></>, 20);
export const IconThemeB = mk('0 0 20 20', '1.33', <><circle cx="10" cy="10" r="3.3" /><path d="M10 2.5v1.7M10 15.8v1.7M2.5 10h1.7M15.8 10h1.7M4.7 4.7l1.2 1.2M14.1 14.1l1.2 1.2M4.7 15.3l1.2-1.2M14.1 5.9l1.2-1.2" /></>, 20);
export const IconLogout = mk('0 0 20 20', '1.33', <><path d="M11.7 3.3H15a1.7 1.7 0 0 1 1.7 1.7v10a1.7 1.7 0 0 1-1.7 1.7h-3.3M7.5 13.3 3.3 10l4.2-3.3M3.3 10h8.4" /></>, 20);
export const IconCollapse = mk('0 0 20 20', '1.33', <><path d="M10.4 5.8 6.3 10l4.1 4.2M15 5.8 10.9 10l4.1 4.2" /></>, 20);
export const IconCalendarSm = mk('0 0 16 16', '1.07', <><rect x="2.33" y="3.33" width="11.33" height="10.34" rx="2" /><path d="M2.33 6.67h11.33" /></>, 16);
export const IconArrowUpRight = mk('0 0 20 20', '1.33', <><path d="M5.83 14.17 14.17 5.83M5.83 5.83h8.34v8.34" /></>, 20);
export const IconChevronDown = mk('0 0 16 16', '1.07', <><path d="M4 6.5 8 10l4-3.5" /></>, 16);
export const IconFilter = mk('0 0 16 16', '1.07', <><path d="M2.33 4h11.34M4.67 8h6.66M6.67 12h2.66" /></>, 16);
export const IconUserPlus = mk('0 0 16 16', '1.07', <><path d="M2.33 13.5v-1.17a2.33 2.33 0 0 1 2.34-2.33h2.33a2.33 2.33 0 0 1 2.33 2.33V13.5M5.83 7.67a2.08 2.08 0 1 0 0-4.17 2.08 2.08 0 0 0 0 4.17M12 5.5v3.67M13.83 7.33h-3.66" /></>, 16);
export const IconStatA = mk('0 0 20 20', '1.33', <><circle cx="7.6" cy="6.6" r="2.7" /><path d="M2.9 16.7v-1.4a3 3 0 0 1 3-3h3.4a3 3 0 0 1 3 3v1.4M13.6 5.5a2.6 2.6 0 0 1 0 5" /></>, 20);
export const IconStatB = mk('0 0 20 20', '1.33', <><path d="M17.1 10A7.1 7.1 0 1 1 10 2.9" /><path d="M10 5.8V10l2.9 1.7" /></>, 20);
export const IconArrowUpRightSm = mk('0 0 16 16', '1.07', <><path d="M4.67 11.33 11.33 4.67M4.67 4.67h6.66v6.66" /></>, 16);
export const IconNotePending = mk('0 0 20 20', '1.33', <><path d="M11.7 2.9H5.8a1.7 1.7 0 0 0-1.7 1.7v10.8a1.7 1.7 0 0 0 1.7 1.7h8.4a1.7 1.7 0 0 0 1.7-1.7V6.7z" /><path d="M11.7 2.9v3.8h3.8" /></>, 20);
export const IconSearch = mk('0 0 16 16', '1.07', <><circle cx="7.3" cy="7.3" r="4.7" /><path d="M13.7 13.7l-3.1-3.1" /></>, 16);
export const IconMore = mk('0 0 16 16', '1.5', <><circle cx="8" cy="3.3" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="8" cy="12.7" r="1" /></>, 16);
export const IconChat = mk('0 0 16 16', '1.07', <><path d="M13.67 7.67a5.6 5.6 0 0 1-.6 2.53 5.67 5.67 0 0 1-5.07 3.13 5.6 5.6 0 0 1-2.53-.6L2.33 14l1.27-3.13a5.6 5.6 0 0 1-.6-2.54 5.67 5.67 0 0 1 3.13-5.06 5.6 5.6 0 0 1 2.54-.6h.33a5.66 5.66 0 0 1 5.33 5.33z" /></>, 16);
export const IconFaqSign = mk('0 0 16 16', '1.2', <><path d="M8 3.5v9M3.5 8h9" /></>, 16);
export const IconArrowRightXs = mk('0 0 14 14', '0.93', <><path d="M5.25 3.5 8.75 7l-3.5 3.5" /></>, 14);
export const IconModuleA = mk('0 0 24 24', '1.6', <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></>, 24);
export const IconModuleB = mk('0 0 24 24', '1.6', <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>, 24);
export const IconRowA = mk('0 0 16 16', '1.07', <><rect x="1.67" y="3.33" width="12.67" height="9.34" rx="2" /><path d="m2.33 4.67 5.67 4 5.67-4" /></>, 16);
export const IconRowB = mk('0 0 16 16', '1.07', <><path d="M14.67 11.28v2a1.33 1.33 0 0 1-1.46 1.33 13.2 13.2 0 0 1-5.75-2.04 13 13 0 0 1-4-4A13.2 13.2 0 0 1 1.41 2.79 1.33 1.33 0 0 1 2.74 1.33h2a1.33 1.33 0 0 1 1.33 1.15c.08.64.24 1.27.46 1.87a1.33 1.33 0 0 1-.3 1.4l-.85.85a10.67 10.67 0 0 0 4 4l.85-.85a1.33 1.33 0 0 1 1.4-.3c.6.22 1.23.38 1.87.46a1.33 1.33 0 0 1 1.17 1.37z" /></>, 16);
export const IconRowC = mk('0 0 16 16', '1.07', <><circle cx="8" cy="8" r="6" /><path d="M8 5.33v3.34M8 11h.01" /></>, 16);
export const IconTick = mk('0 0 14 14', '1.4', <><path d="M3 7.3 5.8 10l5.2-6" /></>, 14);
export const IconDownload = mk('0 0 16 16', '1.07', <><path d="M8 2.33v8M4.67 7l3.33 3.33L11.33 7M2.67 13.67h10.66" /></>, 16);
export const IconCheckSm = mk('0 0 16 16', '1.07', <><path d="M12.67 4 6 10.67 3.33 8" /></>, 16);
export const IconUpload = mk('0 0 16 16', '1.07', <><path d="M8 10.67V3.33M5 6.33 8 3.33l3 3M3 12.67h10" /></>, 16);
export const IconRowD = mk('0 0 16 16', '1.07', <><path d="M8 1.33 10 5.6l4.67.67-3.34 3.26.79 4.6L8 12l-4.12 2.13.79-4.6L1.33 6.27 6 5.6z" /></>, 16);
export const IconRowE = mk('0 0 16 16', '1.07', <><circle cx="8" cy="8" r="5.67" /><path d="M8 4.67V8l2.33 1.33" /></>, 16);
export const IconRowF = mk('0 0 16 16', '1.07', <><path d="M2.67 11.33 6 8l2.67 2.67L13.33 6" /><path d="M10 6h3.33v3.33" /></>, 16);
export const IconCalendarPlus = mk('0 0 16 16', '1.07', <><rect x="2.33" y="3.33" width="11.33" height="10.34" rx="2" /><path d="M2.33 6.67h11.33M5.5 2v2.33M10.5 2v2.33" /></>, 16);
export const IconChevronLeft = mk('0 0 16 16', '1.07', <><path d="M9.5 3.5 6 7l3.5 3.5" /></>, 16);
export const IconChevronRight = mk('0 0 16 16', '1.07', <><path d="M6.5 3.5 10 7l-3.5 3.5" /></>, 16);
export const IconStatC = mk('0 0 20 20', '1.33', <><circle cx="10" cy="10" r="7.1" /><path d="M10 5.8V10l2.9 1.7" /></>, 20);
export const IconStatD = mk('0 0 20 20', '1.33', <><path d="M2.9 16.7 10 3.3l7.1 13.4z" /></>, 20);
export const IconStatE = mk('0 0 20 20', '1.33', <><rect x="2.9" y="4.2" width="14.2" height="12.9" rx="2.4" /><path d="M2.9 8.3h14.2" /></>, 20);
export const IconPlus = mk('0 0 16 16', '1.07', <><path d="M8 3.33v9.34M3.33 8h9.34" /></>, 16);
export const IconSchTile = mk('0 0 26 26', '1.73', <><rect x="3.3" y="7" width="13.5" height="12" rx="2.4" /><path d="M16.8 11.5l5.9-2.8v8.6l-5.9-2.8z" /></>, 26);
export const IconNoteAdd = mk('0 0 16 16', '1.07', <><path d="M9.33 2.33H4.67a1.33 1.33 0 0 0-1.34 1.34v9.33a1.33 1.33 0 0 0 1.34 1.33h6.66a1.33 1.33 0 0 0 1.34-1.33V5.33z" /><path d="M9.33 2.33v3h3" /></>, 16);
export const IconTrendUp = mk('0 0 14 14', '0.93', <><path d="M2.33 9.92 6.42 5.83l2.33 2.34 3.5-3.5" /></>, 14);
export const IconStatF = mk('0 0 20 20', '1.33', <><circle cx="10" cy="10" r="7.1" /><path d="M6.7 10.1 9 12.4l4.3-4.4" /></>, 20);
export const IconModuleC = mk('0 0 24 24', '1.6', <><path d="M12 3a4.5 4.5 0 0 0-4.5 4.5c0 1 .3 1.8.9 2.5A4.5 4.5 0 0 0 12 21a4.5 4.5 0 0 0 3.6-11c.6-.7.9-1.5.9-2.5A4.5 4.5 0 0 0 12 3z" /><path d="M12 3v18" /></>, 24);
export const IconModuleD = mk('0 0 24 24', '1.6', <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /></>, 24);
export const IconModuleE = mk('0 0 24 24', '1.6', <><path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7z" /></>, 24);
export const IconModuleF = mk('0 0 24 24', '1.6', <><path d="M4 20h4v-4H4zM10 20h4v-9h-4zM16 20h4V6h-4z" /></>, 24);
export const IconModuleG = mk('0 0 24 24', '1.6', <><path d="M3 17l5-5 4 4 8-8" /><path d="M15 8h5v5" /></>, 24);
export const IconModuleH = mk('0 0 24 24', '1.6', <><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8 13h8M8 16.5h5" /></>, 24);
