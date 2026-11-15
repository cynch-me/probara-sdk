/**
 * The environment of a capture: the page, the browser, the OS, the device and the screen, with
 * the field names and limits a Vis accepts on creation (`environment`, `pageUrl` and
 * `pageTitle`). Every field is optional: what the browser does not expose, or what does not fit
 * the limits, is left out rather than guessed or cut.
 */
import { redactString } from './redact.js';

export interface Software {
  name?: string;
  version?: string;
}

export interface Dimensions {
  width?: number;
  height?: number;
}

/** The `environment` of a Vis, as a client reports it. */
export interface VisEnvironment {
  browser?: Software;
  os?: Software;
  /** `desktop`, `tablet` or `mobile`. */
  device?: string;
  /** The viewport in CSS pixels. */
  viewport?: Dimensions;
  /** The screen in CSS pixels. */
  screen?: Dimensions;
  pixelRatio?: number;
  /** BCP 47, such as `en-US`. */
  locale?: string;
  /** IANA, such as `America/Mexico_City`. */
  timeZone?: string;
  userAgent?: string;
  /** The effective connection type, such as `4g`. */
  networkType?: string;
}

export interface CapturedEnvironment {
  /** The http(s) URL of the page, with secrets redacted; absent for any other URL or one too long. */
  pageUrl?: string;
  pageTitle?: string;
  environment: VisEnvironment;
}

interface BrandVersion {
  brand: string;
  version: string;
}

/** The User-Agent Client Hints of Chromium browsers (`navigator.userAgentData`). */
interface UserAgentData {
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?(
    hints: string[],
  ): Promise<{ platformVersion?: string; fullVersionList?: BrandVersion[] }>;
}

/** What `collectEnvironment` reads: `globalThis` unless another window is given. */
export interface EnvironmentTarget {
  location: { href: string };
  document?: { title?: string };
  navigator: {
    userAgent: string;
    language?: string;
    connection?: { effectiveType?: string };
    userAgentData?: UserAgentData;
  };
  innerWidth?: number;
  innerHeight?: number;
  screen?: { width?: number; height?: number };
  devicePixelRatio?: number;
}

/** The limits of a Vis's fields. */
const MAX_PAGE_URL = 2048;
const MAX_PAGE_TITLE = 500;
const MAX_NAME = 100;
const MAX_LOCALE = 35;
const MAX_USER_AGENT = 1000;
const MAX_NETWORK_TYPE = 20;
const MAX_DIMENSION = 100_000;
const MAX_PIXEL_RATIO = 20;

/** First match wins: the specific browsers built on Chromium come before Chrome. */
const BROWSERS: [string, RegExp][] = [
  ['Edge', /\bEdg(?:e|A|iOS)?\/([\d.]+)/],
  ['Opera', /\b(?:OPR|OPT)\/([\d.]+)/],
  ['Samsung Internet', /\bSamsungBrowser\/([\d.]+)/],
  ['Firefox', /\b(?:Firefox|FxiOS)\/([\d.]+)/],
  ['Chrome', /\b(?:Chrome|CriOS|HeadlessChrome)\/([\d.]+)/],
  ['Safari', /\bVersion\/([\d.]+).*\bSafari\//],
];

/** Client hint brands, most specific first. */
const BRANDS: [string, string][] = [
  ['Microsoft Edge', 'Edge'],
  ['Opera', 'Opera'],
  ['Samsung Internet', 'Samsung Internet'],
  ['Google Chrome', 'Chrome'],
  ['Chromium', 'Chromium'],
];

function osOf(userAgent: string): Software | undefined {
  let match = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+(?:_\d+)*)/.exec(userAgent);
  if (match?.[1] !== undefined) return { name: 'iOS', version: match[1].replace(/_/g, '.') };
  match = /\bWindows NT (\d+\.\d+)/.exec(userAgent);
  if (match?.[1] !== undefined) {
    // "Windows NT 10.0" is also Windows 11: only client hints tell them apart.
    const versions: Record<string, string> = { '10.0': '10', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    const version = versions[match[1]];
    return version === undefined ? { name: 'Windows' } : { name: 'Windows', version };
  }
  match = /\bAndroid (\d+(?:\.\d+)*)/.exec(userAgent);
  if (match?.[1] !== undefined) return { name: 'Android', version: match[1] };
  match = /\bMac OS X (\d+(?:[_.]\d+)*)/.exec(userAgent);
  if (match?.[1] !== undefined) return { name: 'macOS', version: match[1].replace(/_/g, '.') };
  if (/\bCrOS\b/.test(userAgent)) return { name: 'ChromeOS' };
  if (/\bLinux\b/.test(userAgent)) return { name: 'Linux' };
  return undefined;
}

function deviceOf(userAgent: string): string {
  if (/\biPad\b|\bTablet\b/.test(userAgent)) return 'tablet';
  if (/\bAndroid\b/.test(userAgent) && !/\bMobile\b/.test(userAgent)) return 'tablet';
  if (/\bMobi|\biPhone\b|\biPod\b/.test(userAgent)) return 'mobile';
  return 'desktop';
}

/** The browser, OS and device class a user agent string names; what it does not name is absent. */
export function parseUserAgent(
  userAgent: string,
): Pick<VisEnvironment, 'browser' | 'os' | 'device'> {
  const out: Pick<VisEnvironment, 'browser' | 'os' | 'device'> = {};
  for (const [name, pattern] of BROWSERS) {
    const version = pattern.exec(userAgent)?.[1];
    if (version !== undefined) {
      out.browser = { name, version };
      break;
    }
  }
  const os = osOf(userAgent);
  if (os !== undefined) out.os = os;
  out.device = deviceOf(userAgent);
  return out;
}

const PLATFORMS: Record<string, string> = {
  macOS: 'macOS',
  Windows: 'Windows',
  Linux: 'Linux',
  Android: 'Android',
  'Chrome OS': 'ChromeOS',
  ChromeOS: 'ChromeOS',
  iOS: 'iOS',
};

/** The browser and OS from client hints, over what the user agent string said. */
async function fromClientHints(
  data: UserAgentData,
  parsed: Pick<VisEnvironment, 'browser' | 'os' | 'device'>,
): Promise<Pick<VisEnvironment, 'browser' | 'os' | 'device'>> {
  const out = { ...parsed };
  if (data.mobile === true && out.device === 'desktop') out.device = 'mobile';
  const values = await data.getHighEntropyValues?.(['platformVersion', 'fullVersionList']);
  if (values === undefined) return out;
  const list = values.fullVersionList ?? [];
  for (const [brand, name] of BRANDS) {
    const found = list.find((entry) => entry.brand === brand);
    if (found !== undefined) {
      out.browser = { name, version: found.version };
      break;
    }
  }
  const platform = data.platform === undefined ? undefined : PLATFORMS[data.platform];
  const platformVersion = values.platformVersion;
  if (platform !== undefined && platformVersion !== undefined && platformVersion !== '') {
    let version = platformVersion;
    // Windows reports its platform version 13 and above for Windows 11, 1 to 12 for Windows 10.
    if (platform === 'Windows') {
      const major = Number(platformVersion.split('.')[0]);
      version = major >= 13 ? '11' : major > 0 ? '10' : platformVersion;
    }
    out.os = { name: platform, version };
  }
  return out;
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.length > max ? undefined : trimmed;
}

function software(value: Software | undefined): Software | undefined {
  if (value === undefined) return undefined;
  const out: Software = {};
  const name = text(value.name, MAX_NAME);
  const version = text(value.version, MAX_NAME);
  if (name !== undefined) out.name = name;
  if (version !== undefined) out.version = version;
  return Object.keys(out).length === 0 ? undefined : out;
}

function dimension(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded > 0 && rounded <= MAX_DIMENSION ? rounded : undefined;
}

function dimensions(width: unknown, height: unknown): Dimensions | undefined {
  const out: Dimensions = {};
  const w = dimension(width);
  const h = dimension(height);
  if (w !== undefined) out.width = w;
  if (h !== undefined) out.height = h;
  return Object.keys(out).length === 0 ? undefined : out;
}

function timeZone(): string | undefined {
  try {
    return text(Intl.DateTimeFormat().resolvedOptions().timeZone, MAX_NAME);
  } catch {
    return undefined;
  }
}

function pageUrl(href: string): string | undefined {
  if (!/^https?:\/\//i.test(href)) return undefined;
  const redacted = redactString(href);
  return redacted.length > MAX_PAGE_URL ? undefined : redacted;
}

/**
 * The page and environment of `target` (`globalThis` unless another window is given). Never
 * rejects: a value the browser does not expose, or one that does not fit, is left out.
 */
export async function collectEnvironment(target?: EnvironmentTarget): Promise<CapturedEnvironment> {
  const win: EnvironmentTarget = target ?? globalThis;
  const out: CapturedEnvironment = { environment: {} };
  const environment = out.environment;
  try {
    const url = pageUrl(win.location.href);
    if (url !== undefined) out.pageUrl = url;
    const title = win.document?.title?.trim();
    if (title !== undefined && title !== '') out.pageTitle = title.slice(0, MAX_PAGE_TITLE);

    const nav = win.navigator;
    let parsed = parseUserAgent(nav.userAgent);
    if (nav.userAgentData !== undefined) {
      try {
        parsed = await fromClientHints(nav.userAgentData, parsed);
      } catch {
        // Client hints refused: the user agent string stands.
      }
    }
    const browser = software(parsed.browser);
    const os = software(parsed.os);
    if (browser !== undefined) environment.browser = browser;
    if (os !== undefined) environment.os = os;
    if (parsed.device !== undefined) environment.device = parsed.device;
    const viewport = dimensions(win.innerWidth, win.innerHeight);
    if (viewport !== undefined) environment.viewport = viewport;
    const screen = dimensions(win.screen?.width, win.screen?.height);
    if (screen !== undefined) environment.screen = screen;
    const ratio = win.devicePixelRatio;
    if (typeof ratio === 'number' && ratio > 0 && ratio <= MAX_PIXEL_RATIO)
      environment.pixelRatio = ratio;
    const locale = text(nav.language, MAX_LOCALE);
    if (locale !== undefined) environment.locale = locale;
    const zone = timeZone();
    if (zone !== undefined) environment.timeZone = zone;
    if (nav.userAgent !== '') environment.userAgent = nav.userAgent.slice(0, MAX_USER_AGENT);
    const networkType = text(nav.connection?.effectiveType, MAX_NETWORK_TYPE);
    if (networkType !== undefined) environment.networkType = networkType;
  } catch {
    // A window that cannot be read: what was read so far stands.
  }
  return out;
}
