import type {
  CountryOption,
  InvestmentItem,
  PlatformSettings,
  ProjectItem,
} from '../types';

import heroFlagshipImg from '../assets/images/hero_flagship_phones_1794514388316.jpg';
import phoneTitaniumImg from '../assets/images/phone_compact_titanium_1794514386099.jpg';
import phoneFoldableImg from '../assets/images/phone_foldable_edition_1794514385919.jpg';
import phoneCeramicImg from '../assets/images/phone_sovereign_ceramic_1794514387657.jpg';

export const BRAND_IMAGES = {
  hero: heroFlagshipImg,
  titanium: phoneTitaniumImg,
  foldable: phoneFoldableImg,
  ceramic: phoneCeramicImg,
} as const;

export function resolveBrandImageUrl(url?: string): string {
  if (!url) return BRAND_IMAGES.hero;
  const trimmed = url.trim();
  if (trimmed === 'preset:hero' || trimmed.includes('hero_flagship_phones')) return BRAND_IMAGES.hero;
  if (trimmed === 'preset:titanium' || trimmed.includes('phone_compact_titanium')) return BRAND_IMAGES.titanium;
  if (trimmed === 'preset:foldable' || trimmed.includes('phone_foldable_edition')) return BRAND_IMAGES.foldable;
  if (trimmed === 'preset:ceramic' || trimmed.includes('phone_sovereign_ceramic')) return BRAND_IMAGES.ceramic;
  if (/^(https?:\/\/|\/|data:image\/)/i.test(trimmed)) return trimmed;
  return BRAND_IMAGES.hero;
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  {
    country: 'Bénin',
    dialCode: '+229',
    methods: ['MTN MoMo Bénin', 'Moov Money Bénin', 'Celtiis Cash', 'Virement Bancaire'],
  },
  {
    country: 'Cameroun',
    dialCode: '+237',
    methods: ['Orange Money Cameroun', 'MTN MoMo Cameroun', 'Virement Bancaire'],
  },
  {
    country: 'Burkina Faso',
    dialCode: '+226',
    methods: ['Orange Money Burkina', 'Moov Money Burkina', 'Wave Burkina', 'Virement Bancaire'],
  },
  {
    country: 'Sénégal',
    dialCode: '+221',
    methods: ['Wave Sénégal', 'Orange Money Sénégal', 'Free Money', 'Virement Bancaire'],
  },
  {
    country: 'Togo',
    dialCode: '+228',
    methods: ['TMoney', 'Flooz Moov', 'Virement Bancaire'],
  },
];

export const ELIGIBLE_COUNTRIES = COUNTRY_OPTIONS.map((c) => c.country);
export const ELIGIBLE_DIAL_CODES = COUNTRY_OPTIONS.map((c) => c.dialCode);

export function isEligibleCountry(country?: string, dialCode?: string): boolean {
  const cleanCountry = (country || '').trim();
  const cleanDial = (dialCode || '').trim();
  if (!cleanCountry && !cleanDial) return false;
  return COUNTRY_OPTIONS.some(
    (opt) =>
      (!cleanCountry || opt.country === cleanCountry) &&
      (!cleanDial || opt.dialCode === cleanDial)
  );
}

export function validateEligiblePhone(
  dialCode: string,
  rawPhone: string,
  country?: string
): { ok: true; cleanDigits: string; fullPhone: string } | { ok: false; error: string } {
  const cleanDial = dialCode.trim();
  if (!isEligibleCountry(country, cleanDial)) {
    return {
      ok: false,
      error:
        'Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, le Sénégal et le Togo sont autorisés.',
    };
  }

  const compact = rawPhone.replace(/\s+/g, '').trim();
  const dialDigits = cleanDial.replace(/\D/g, '');

  if (compact.startsWith('+') || compact.startsWith('00')) {
    const intlDigits = compact.replace(/^\+/, '').replace(/^00/, '').replace(/\D/g, '');
    if (!intlDigits.startsWith(dialDigits)) {
      return {
        ok: false,
        error:
          'Indicatif non éligible. Seuls le Bénin (+229), le Cameroun (+237), le Burkina Faso (+226), le Sénégal (+221) et le Togo (+228) sont autorisés.',
      };
    }
  }

  let digits = compact.replace(/\D/g, '');
  if (digits.startsWith(`00${dialDigits}`) && digits.length >= dialDigits.length + 7) {
    digits = digits.slice(2 + dialDigits.length);
  } else if (digits.startsWith(dialDigits) && digits.length >= dialDigits.length + 7) {
    digits = digits.slice(dialDigits.length);
  }

  if (digits.length < 7 || digits.length > 12) {
    return {
      ok: false,
      error: 'Veuillez saisir un numéro de téléphone valide pour le pays sélectionné.',
    };
  }

  return {
    ok: true,
    cleanDigits: digits,
    fullPhone: `${cleanDial} ${digits}`,
  };
}

export const PAYMENT_CHANNELS = [
  {
    id: 'Mobile Money (Bénin · Burkina Faso · Togo)',
    label: 'Mobile Money (Bénin · Burkina Faso · Togo)',
  },
  {
    id: 'Mobile Money & Wave (Cameroun · Sénégal)',
    label: 'Mobile Money & Wave (Cameroun · Sénégal)',
  },
];

export const QUICK_DEPOSIT_AMOUNTS = [5000, 10000, 15000, 60000];

export const SUPPORT_CHANNELS = [
  { id: 'telegram_support', label: 'Telegram', href: 'https://t.me/aureliamobile_support' },
  { id: 'telegram_channel', label: 'Chaîne Telegram', href: 'https://t.me/aureliamobile_officiel' },
  { id: 'telegram_group', label: 'Groupe Telegram', href: 'https://t.me/aureliamobile_communaute' },
];

export const DEFAULT_SETTINGS: PlatformSettings = {
  id: 'global',
  referralRate: 30,
  minDeposit: 4000,
  minWithdrawal: 1000,
  supportPhone: '+226 70 00 88 99',
  supportEmail: 'support@aureliamobile.africa',
  adminPhone: '+226 77409899',
  announcement:
    'Programme Gamme VIP AURELIA MOBILE : 5 téléphones haut de gamme dès 4 000 F CFA avec revenus quotidiens automatiques pendant 90 jours.',
  allowMultipleSameVip: true,
  visibility: 'public',
};

export const OFFICIAL_VIP_CATALOG: ProjectItem[] = [
  {
    id: 'vip_1',
    title: 'VIP 1 · Aurelia S1 Compact',
    category: 'Titane Brossé · 256 Go',
    description:
      'Smartphone compact de haute précision doté d’un châssis en titane brossé, écran OLED LTPO 120 Hz et optique saphir. Génère 400 F CFA chaque jour pendant 90 jours.',
    location: 'Distribution Ouagadougou & Bobo-Dioulasso',
    imageUrl: BRAND_IMAGES.titanium,
    returnRate: 900,
    durationDays: 90,
    minInvestment: 4000,
    dailyIncome: 400,
    targetAmount: 20000000,
    raisedAmount: 8400000,
    investorsCount: 310,
    status: 'active',
    visibility: 'public',
  },
  {
    id: 'vip_2',
    title: 'VIP 2 · Aurelia X2 Pro',
    category: 'Verre Saphir · 512 Go',
    description:
      'Flagship photographie équipé d’un triple module téléobjectif périscopique, verre saphir anti-rayures et charge rapide 100 W. Génère 1 000 F CFA chaque jour pendant 90 jours.',
    location: 'Showrooms Abidjan & Dakar',
    imageUrl: BRAND_IMAGES.hero,
    returnRate: 1500,
    durationDays: 90,
    minInvestment: 6000,
    dailyIncome: 1000,
    targetAmount: 30000000,
    raisedAmount: 14400000,
    investorsCount: 245,
    status: 'active',
    visibility: 'public',
  },
  {
    id: 'vip_3',
    title: 'VIP 3 · Aurelia Fold V',
    category: 'Édition Pliable OLED · 1 To',
    description:
      'Terminal pliable ultra-fin à charnière aérospatiale en titane et double dalle AMOLED HDR10+ pour dirigeants. Génère 2 500 F CFA chaque jour pendant 90 jours.',
    location: 'Ouagadougou, Abidjan & Lomé',
    imageUrl: BRAND_IMAGES.foldable,
    returnRate: 1500,
    durationDays: 90,
    minInvestment: 15000,
    dailyIncome: 2500,
    targetAmount: 45000000,
    raisedAmount: 22500000,
    investorsCount: 180,
    status: 'active',
    visibility: 'public',
  },
  {
    id: 'vip_4',
    title: 'VIP 4 · Aurelia Ultra Céramique',
    category: 'Céramique & Or · 1 To',
    description:
      'Fleuron technologique sculpté en céramique noire micro-polie, processeur gravé 3 nm et sécurité biométrique matérielle. Génère 8 000 F CFA chaque jour pendant 90 jours.',
    location: 'Hub Commercial Afrique de l’Ouest',
    imageUrl: BRAND_IMAGES.ceramic,
    returnRate: 1200,
    durationDays: 90,
    minInvestment: 60000,
    dailyIncome: 8000,
    targetAmount: 80000000,
    raisedAmount: 38400000,
    investorsCount: 96,
    status: 'active',
    visibility: 'public',
  },
  {
    id: 'vip_5',
    title: 'VIP 5 · Aurelia Sovereign',
    category: 'Titane Grade 5 · 2 To',
    description:
      'Série manufacture limitée assemblée en titane Grade 5 avec connectivité satellite mondiale et conciergerie privée. Génère 10 000 F CFA chaque jour pendant 90 jours.',
    location: 'Réseau Flagship International & Export',
    imageUrl: BRAND_IMAGES.hero,
    returnRate: 900,
    durationDays: 90,
    minInvestment: 100000,
    dailyIncome: 10000,
    targetAmount: 150000000,
    raisedAmount: 65000000,
    investorsCount: 65,
    status: 'active',
    visibility: 'public',
  },
];

export const OFFICIAL_VIP_IDS = ['vip_1', 'vip_2', 'vip_3', 'vip_4', 'vip_5'];

export const ADMIN_EMAIL = 'ismailasawadogo10@gmail.com';
export const DEFAULT_ADMIN_PHONE = '+226 77409899';
export const DEFAULT_ADMIN_PASSWORD = 'Redbook@1';

const ONE_DAY_MS = 86_400_000;

export function getProjectDailyIncome(project: ProjectItem): number {
  if (typeof project.dailyIncome === 'number' && project.dailyIncome > 0) {
    return project.dailyIncome;
  }
  const presets: Record<string, number> = {
    vip_1: 400,
    vip_2: 1000,
    vip_3: 2500,
    vip_4: 8000,
    vip_5: 10000,
  };
  if (presets[project.id]) return presets[project.id];
  return Math.max(
    100,
    Math.round((project.minInvestment * (project.returnRate / 100)) / (project.durationDays || 90))
  );
}

export function getInvestmentPurchaseMs(inv: InvestmentItem): number {
  if (typeof inv.purchasedAtMs === 'number' && inv.purchasedAtMs > 0) {
    return inv.purchasedAtMs;
  }
  const c = inv.createdAt as { toMillis?: () => number } | string | undefined;
  if (c && typeof c === 'object' && typeof c.toMillis === 'function') {
    return c.toMillis();
  }
  if (typeof c === 'string') {
    const parsed = Date.parse(c);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export function computeInvestmentMetrics(inv: InvestmentItem, nowMs = Date.now()) {
  const durationDays = inv.durationDays || 90;
  const dailyIncome =
    typeof inv.dailyIncome === 'number' && inv.dailyIncome > 0
      ? inv.dailyIncome
      : Math.max(100, Math.round(inv.expectedProfit / durationDays));
  const purchasedAtMs = getInvestmentPurchaseMs(inv);
  const elapsedDays = Math.min(
    durationDays,
    Math.floor(Math.max(0, nowMs - purchasedAtMs) / ONE_DAY_MS)
  );
  const daysCredited = Math.min(durationDays, Math.max(0, inv.daysCredited || 0));
  const isExpired =
    inv.status === 'expired' ||
    inv.status === 'completed' ||
    inv.status === 'cancelled' ||
    elapsedDays >= durationDays;
  const daysRemaining = isExpired ? 0 : Math.max(0, durationDays - elapsedDays);
  const pendingDaysToCredit =
    inv.status === 'active' ? Math.max(0, elapsedDays - daysCredited) : 0;

  return {
    dailyIncome,
    durationDays,
    elapsedDays,
    daysRemaining,
    daysCredited,
    pendingDaysToCredit,
    pendingAmountToCredit: pendingDaysToCredit * dailyIncome,
    totalEarnedSoFar:
      typeof inv.totalEarnedSoFar === 'number' ? inv.totalEarnedSoFar : daysCredited * dailyIncome,
    totalExpected90Days: dailyIncome * durationDays,
    isExpired,
    displayStatus: isExpired ? 'Expiré' : 'Actif',
  };
}

export function formatCFA(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  return `${safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F CFA`;
}

export function formatDateFr(value: unknown): string {
  if (!value) return '';
  try {
    const obj = value as { toDate?: () => Date };
    const date =
      typeof obj === 'object' && obj !== null && typeof obj.toDate === 'function'
        ? obj.toDate()
        : new Date(value as string | number);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 128) || 'id_default';
}

export function clampStr(raw: string | undefined, min: number, max: number, fallback = 'N/A'): string {
  const trimmed = (raw || '').trim();
  if (trimmed.length < min) return fallback.slice(0, max);
  return trimmed.slice(0, max);
}

export function phonesMatch(phoneA?: string, phoneB?: string): boolean {
  if (!phoneA || !phoneB) return false;
  const a = phoneA.replace(/\D/g, '');
  const b = phoneB.replace(/\D/g, '');
  if (!a || !b) return false;
  return (
    a === b ||
    (a.length >= 8 && b.endsWith(a)) ||
    (b.length >= 8 && a.endsWith(b))
  );
}
