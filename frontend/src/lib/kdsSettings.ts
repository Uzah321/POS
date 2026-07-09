export interface KdsSettings {
  // Kitchen Display
  kdsTheme: 'dark' | 'light' | 'high-contrast';
  kdsRefreshInterval: 2 | 4 | 6 | 10;
  kdsColumns: 'auto' | '2' | '3' | '4' | '5';
  kdsUrgentMinutes: number;
  kdsShowServed: boolean;
  kdsSoundEnabled: boolean;
  kdsDisplayName: string;
  // Queue Display
  queueTheme: 'dark' | 'light' | 'high-contrast';
  queueTicketSize: 'sm' | 'md' | 'lg' | 'xl';
  queuePreparingLabel: string;
  queueReadyLabel: string;
  queueFooterMessage: string;
  queueShowClock: boolean;
  queueStoreName: string;
}

export const DEFAULT_KDS_SETTINGS: KdsSettings = {
  kdsTheme: 'dark',
  kdsRefreshInterval: 4,
  kdsColumns: 'auto',
  kdsUrgentMinutes: 5,
  kdsShowServed: false,
  kdsSoundEnabled: true,
  kdsDisplayName: 'Kitchen Display',
  queueTheme: 'dark',
  queueTicketSize: 'xl',
  queuePreparingLabel: 'Now Preparing',
  queueReadyLabel: 'Ready for Collection',
  queueFooterMessage: 'Watch this screen — your number will appear when your order is ready',
  queueShowClock: true,
  queueStoreName: 'Order Status',
};

const KEY = 'Core-kds-settings';

export function loadKdsSettings(): KdsSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_KDS_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_KDS_SETTINGS };
}

export function saveKdsSettings(s: KdsSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function kdsSettingsFromBackend(data: Record<string, any>): Partial<KdsSettings> {
  const out: Partial<KdsSettings> = {};
  if (data.kds_theme)               out.kdsTheme             = data.kds_theme;
  if (data.kds_refresh_interval)    out.kdsRefreshInterval   = Number(data.kds_refresh_interval) as KdsSettings['kdsRefreshInterval'];
  if (data.kds_columns)             out.kdsColumns           = data.kds_columns;
  if (data.kds_urgent_minutes)      out.kdsUrgentMinutes     = Number(data.kds_urgent_minutes);
  if (data.kds_display_name)        out.kdsDisplayName       = data.kds_display_name;
  if (data.kds_show_served !== undefined) out.kdsShowServed  = data.kds_show_served === 'true' || data.kds_show_served === true;
  if (data.kds_sound_enabled !== undefined) out.kdsSoundEnabled = data.kds_sound_enabled === 'true' || data.kds_sound_enabled === true;
  if (data.queue_theme)             out.queueTheme           = data.queue_theme;
  if (data.queue_ticket_size)       out.queueTicketSize      = data.queue_ticket_size;
  if (data.queue_preparing_label)   out.queuePreparingLabel  = data.queue_preparing_label;
  if (data.queue_ready_label)       out.queueReadyLabel      = data.queue_ready_label;
  if (data.queue_footer_message)    out.queueFooterMessage   = data.queue_footer_message;
  if (data.queue_store_name)        out.queueStoreName       = data.queue_store_name;
  if (data.queue_show_clock !== undefined) out.queueShowClock = data.queue_show_clock === 'true' || data.queue_show_clock === true;
  return out;
}

export function kdsSettingsToBackend(s: KdsSettings): Record<string, string> {
  return {
    kds_theme:              s.kdsTheme,
    kds_refresh_interval:   String(s.kdsRefreshInterval),
    kds_columns:            s.kdsColumns,
    kds_urgent_minutes:     String(s.kdsUrgentMinutes),
    kds_display_name:       s.kdsDisplayName,
    kds_show_served:        String(s.kdsShowServed),
    kds_sound_enabled:      String(s.kdsSoundEnabled),
    queue_theme:            s.queueTheme,
    queue_ticket_size:      s.queueTicketSize,
    queue_preparing_label:  s.queuePreparingLabel,
    queue_ready_label:      s.queueReadyLabel,
    queue_footer_message:   s.queueFooterMessage,
    queue_store_name:       s.queueStoreName,
    queue_show_clock:       String(s.queueShowClock),
  };
}

// ── Theme token maps ─────────────────────────────────────────────────────────

export interface KdsThemeTokens {
  bg: string;         // full-page bg
  header: string;     // header bar bg
  headerBorder: string;
  cardBg: string;     // order card bg
  cardBorderNew: string;
  cardBorderPrep: string;
  cardBorderReady: string;
  cardBorderServed: string;
  ringNew: string;    // ring around new orders
  text: string;
  textMuted: string;
  itemQty: string;
  badgeNew: string;
  badgePrep: string;
  badgeReady: string;
  badgeServed: string;
  divider: string;
  emptyText: string;
}

const KDS_THEMES: Record<KdsSettings['kdsTheme'], KdsThemeTokens> = {
  dark: {
    bg: 'bg-gray-950', header: 'bg-gray-900', headerBorder: 'border-gray-800',
    cardBg: 'bg-gray-900', cardBorderNew: 'border-blue-500', cardBorderPrep: 'border-amber-400',
    cardBorderReady: 'border-green-400', cardBorderServed: 'border-gray-600',
    ringNew: 'ring-blue-500 ring-offset-gray-950',
    text: 'text-white', textMuted: 'text-gray-400', itemQty: 'text-amber-400',
    badgeNew: 'bg-blue-600 text-white', badgePrep: 'bg-amber-500 text-white',
    badgeReady: 'bg-green-500 text-white', badgeServed: 'bg-gray-600 text-white',
    divider: 'border-gray-800', emptyText: 'text-gray-700',
  },
  light: {
    bg: 'bg-gray-100', header: 'bg-white', headerBorder: 'border-gray-200',
    cardBg: 'bg-white', cardBorderNew: 'border-blue-400', cardBorderPrep: 'border-amber-400',
    cardBorderReady: 'border-green-500', cardBorderServed: 'border-gray-300',
    ringNew: 'ring-blue-400 ring-offset-gray-100',
    text: 'text-gray-900', textMuted: 'text-gray-500', itemQty: 'text-amber-600',
    badgeNew: 'bg-blue-100 text-blue-700', badgePrep: 'bg-amber-100 text-amber-700',
    badgeReady: 'bg-green-100 text-green-700', badgeServed: 'bg-gray-100 text-gray-500',
    divider: 'border-gray-200', emptyText: 'text-gray-400',
  },
  'high-contrast': {
    bg: 'bg-black', header: 'bg-black', headerBorder: 'border-yellow-500',
    cardBg: 'bg-black', cardBorderNew: 'border-cyan-400', cardBorderPrep: 'border-yellow-400',
    cardBorderReady: 'border-lime-400', cardBorderServed: 'border-gray-700',
    ringNew: 'ring-cyan-400 ring-offset-black',
    text: 'text-white', textMuted: 'text-gray-300', itemQty: 'text-yellow-300',
    badgeNew: 'bg-cyan-500 text-black font-black', badgePrep: 'bg-yellow-400 text-black font-black',
    badgeReady: 'bg-lime-400 text-black font-black', badgeServed: 'bg-gray-700 text-gray-300',
    divider: 'border-gray-700', emptyText: 'text-gray-600',
  },
};

export function getKdsTheme(theme: KdsSettings['kdsTheme']): KdsThemeTokens {
  return KDS_THEMES[theme] ?? KDS_THEMES.dark;
}

export interface QueueThemeTokens {
  bg: string;
  header: string;
  headerBorder: string;
  footer: string;
  footerBorder: string;
  divider: string;
  titleText: string;
  clockText: string;
  errorText: string;
  prepHeaderBg: string;
  prepHeaderBorder: string;
  prepHeaderLabel: string;
  prepHeaderSub: string;
  prepCardBg: string;
  prepCardBorder: string;
  prepTicket: string;
  readyHeaderBg: string;
  readyHeaderBorder: string;
  readyHeaderLabel: string;
  readyHeaderSub: string;
  readyCardBg: string;
  readyCardBorder: string;
  readyTicket: string;
  emptyText: string;
  footerText: string;
}

const QUEUE_THEMES: Record<KdsSettings['queueTheme'], QueueThemeTokens> = {
  dark: {
    bg: 'bg-gray-950', header: 'bg-gray-900', headerBorder: 'border-gray-800',
    footer: 'bg-gray-900', footerBorder: 'border-gray-800',
    divider: 'border-gray-800',
    titleText: 'text-white', clockText: 'text-gray-400', errorText: 'text-amber-400',
    prepHeaderBg: 'bg-blue-950', prepHeaderBorder: 'border-blue-900',
    prepHeaderLabel: 'text-blue-300', prepHeaderSub: 'text-gray-500',
    prepCardBg: 'bg-blue-900/40', prepCardBorder: 'border-blue-600', prepTicket: 'text-white',
    readyHeaderBg: 'bg-green-950', readyHeaderBorder: 'border-green-900',
    readyHeaderLabel: 'text-green-300', readyHeaderSub: 'text-gray-500',
    readyCardBg: 'bg-green-900/40', readyCardBorder: 'border-green-500', readyTicket: 'text-green-300',
    emptyText: 'text-gray-700', footerText: 'text-gray-600',
  },
  light: {
    bg: 'bg-gray-50', header: 'bg-white', headerBorder: 'border-gray-200',
    footer: 'bg-white', footerBorder: 'border-gray-200',
    divider: 'border-gray-200',
    titleText: 'text-gray-900', clockText: 'text-gray-500', errorText: 'text-orange-500',
    prepHeaderBg: 'bg-blue-50', prepHeaderBorder: 'border-blue-200',
    prepHeaderLabel: 'text-blue-700', prepHeaderSub: 'text-gray-400',
    prepCardBg: 'bg-blue-100', prepCardBorder: 'border-blue-400', prepTicket: 'text-blue-900',
    readyHeaderBg: 'bg-green-50', readyHeaderBorder: 'border-green-200',
    readyHeaderLabel: 'text-green-700', readyHeaderSub: 'text-gray-400',
    readyCardBg: 'bg-green-100', readyCardBorder: 'border-green-500', readyTicket: 'text-green-900',
    emptyText: 'text-gray-400', footerText: 'text-gray-400',
  },
  'high-contrast': {
    bg: 'bg-black', header: 'bg-black', headerBorder: 'border-yellow-500',
    footer: 'bg-black', footerBorder: 'border-yellow-500',
    divider: 'border-yellow-600',
    titleText: 'text-white', clockText: 'text-yellow-400', errorText: 'text-yellow-300',
    prepHeaderBg: 'bg-black', prepHeaderBorder: 'border-cyan-500',
    prepHeaderLabel: 'text-cyan-300', prepHeaderSub: 'text-gray-400',
    prepCardBg: 'bg-gray-950', prepCardBorder: 'border-cyan-400', prepTicket: 'text-white',
    readyHeaderBg: 'bg-black', readyHeaderBorder: 'border-lime-400',
    readyHeaderLabel: 'text-lime-300', readyHeaderSub: 'text-gray-400',
    readyCardBg: 'bg-gray-950', readyCardBorder: 'border-lime-400', readyTicket: 'text-lime-300',
    emptyText: 'text-gray-600', footerText: 'text-gray-500',
  },
};

export function getQueueTheme(theme: KdsSettings['queueTheme']): QueueThemeTokens {
  return QUEUE_THEMES[theme] ?? QUEUE_THEMES.dark;
}

export const TICKET_SIZE: Record<KdsSettings['queueTicketSize'], string> = {
  sm: 'text-3xl',
  md: 'text-5xl',
  lg: 'text-7xl',
  xl: 'text-8xl',
};
