import {
  ADMIN_EMAIL,
  COUNTRY_OPTIONS,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_PHONE,
  DEFAULT_SETTINGS,
  OFFICIAL_VIP_CATALOG,
  clampStr,
  isEligibleCountry,
  sanitizeId,
  validateEligiblePhone,
} from '../data/catalog';
import { supabase } from '../supabase';
import type {
  InvestmentItem,
  PhoneAuthPayload,
  PlatformSettings,
  ProjectItem,
  ReferralItem,
  TransactionItem,
  TransactionStatus,
  TransactionType,
  UserProfile,
} from '../types';

export function isSupabaseSchemaMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === 'PGRST205' ||
    e.code === '42P01' ||
    String(e.message || '').includes('Could not find the table') ||
    String(e.message || '').includes('does not exist')
  );
}

export function normalizePhoneDigits(dialCode: string, rawPhone: string): string {
  const compact = rawPhone.replace(/\s+/g, '').trim();
  const digits = compact.replace(/\D/g, '');
  const dialDigits = dialCode.replace(/\D/g, '');
  if (dialDigits && digits.startsWith(`00${dialDigits}`) && digits.length >= dialDigits.length + 8) {
    return digits.slice(2 + dialDigits.length);
  }
  if (dialDigits && digits.startsWith(dialDigits) && digits.length >= dialDigits.length + 7) {
    return digits.slice(dialDigits.length);
  }
  return digits || compact;
}

export function isUniqueAdminPhone(phone?: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  const adminDigits = DEFAULT_ADMIN_PHONE.replace(/\D/g, '');
  return digits === adminDigits;
}

export function phoneToAuthEmail(dialCode: string, cleanPhone: string): string {
  const dialDigits = dialCode.replace(/\D/g, '');
  const phoneDigits = cleanPhone.replace(/\D/g, '');
  return `${dialDigits}${phoneDigits}@aureliamobile.africa`;
}

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  const adminPhoneEmail = `${DEFAULT_ADMIN_PHONE.replace(/\D/g, '')}@aureliamobile.africa`;
  return lower === ADMIN_EMAIL.toLowerCase() || lower === adminPhoneEmail;
}

export function isEligibleAuthEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  if (lower === ADMIN_EMAIL.toLowerCase()) return true;
  const localPart = lower.split('@')[0] || '';
  return ['229', '237', '226', '221', '228'].some((prefix) => localPart.startsWith(prefix));
}

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  return {
    uid: String(row.uid || ''),
    email: String(row.email || ''),
    displayName: String(row.display_name || ''),
    phone: String(row.phone || ''),
    withdrawalCountry: row.withdrawal_country ? String(row.withdrawal_country) : 'Burkina Faso',
    withdrawalMethod: row.withdrawal_method ? String(row.withdrawal_method) : 'Orange Money Burkina',
    withdrawalAccount: row.withdrawal_account ? String(row.withdrawal_account) : '',
    withdrawalHolder: row.withdrawal_holder ? String(row.withdrawal_holder) : '',
    balance: Number(row.balance || 0),
    totalInvested: Number(row.total_invested || 0),
    totalEarned: Number(row.total_earned || 0),
    referralCode: String(row.referral_code || ''),
    referredBy: row.referred_by ? String(row.referred_by) : '',
    referralBonus: Number(row.referral_bonus || 0),
    referralCount: Number(row.referral_count || 0),
    role: row.role === 'admin' ? 'admin' : 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProjectRow(row: Record<string, unknown>): ProjectItem {
  return {
    id: String(row.id || ''),
    title: String(row.title || ''),
    category: String(row.category || ''),
    description: String(row.description || ''),
    location: String(row.location || ''),
    imageUrl: String(row.image_url || 'preset:hero'),
    returnRate: Number(row.return_rate || 900),
    durationDays: Number(row.duration_days || 90),
    minInvestment: Number(row.min_investment || 4000),
    dailyIncome: Number(row.daily_income || 400),
    targetAmount: Number(row.target_amount || 20000000),
    raisedAmount: Number(row.raised_amount || 0),
    investorsCount: Number(row.investors_count || 0),
    status: row.status === 'paused' ? 'paused' : 'active',
    visibility: row.visibility === 'private' ? 'private' : 'public',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInvestmentRow(row: Record<string, unknown>): InvestmentItem {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    userName: String(row.user_name || ''),
    projectId: String(row.project_id || ''),
    projectTitle: String(row.project_title || ''),
    projectCategory: String(row.project_category || ''),
    amount: Number(row.amount || 0),
    dailyIncome: Number(row.daily_income || 0),
    returnRate: Number(row.return_rate || 900),
    expectedProfit: Number(row.expected_profit || 0),
    durationDays: Number(row.duration_days || 90),
    daysCredited: Number(row.days_credited || 0),
    totalEarnedSoFar: Number(row.total_earned_so_far || 0),
    purchasedAtMs: Number(row.purchased_at_ms || Date.now()),
    status: (row.status as InvestmentItem['status']) || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTransactionRow(row: Record<string, unknown>): TransactionItem {
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    userName: String(row.user_name || ''),
    type: (row.type as TransactionType) || 'deposit',
    amount: Number(row.amount || 0),
    method: String(row.method || ''),
    phoneOrAccount: String(row.phone_or_account || ''),
    reference: String(row.reference || ''),
    status: (row.status as TransactionStatus) || 'pending',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReferralRow(row: Record<string, unknown>): ReferralItem {
  return {
    id: String(row.id || ''),
    referrerUid: String(row.referrer_uid || ''),
    referredUid: String(row.referred_uid || ''),
    referredName: String(row.referred_name || ''),
    level: Number(row.level || 1),
    commissionEarned: Number(row.commission_earned || 0),
    status: row.status === 'rewarded' ? 'rewarded' : 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSettingsRow(row: Record<string, unknown>): PlatformSettings {
  return {
    id: String(row.id || 'global'),
    referralRate: Number(row.referral_rate ?? DEFAULT_SETTINGS.referralRate),
    minDeposit: Number(row.min_deposit ?? DEFAULT_SETTINGS.minDeposit),
    minWithdrawal: Number(row.min_withdrawal ?? DEFAULT_SETTINGS.minWithdrawal),
    supportPhone: String(row.support_phone || DEFAULT_SETTINGS.supportPhone),
    supportEmail: String(row.support_email || DEFAULT_SETTINGS.supportEmail),
    adminPhone: DEFAULT_ADMIN_PHONE,
    announcement: String(row.announcement || DEFAULT_SETTINGS.announcement),
    allowMultipleSameVip: row.allow_multiple_same_vip !== false,
    visibility: 'public',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function sbFetchPublicData(): Promise<{
  projects: ProjectItem[];
  settings: PlatformSettings;
  schemaMissing: boolean;
}> {
  if (!supabase) {
    return { projects: OFFICIAL_VIP_CATALOG, settings: DEFAULT_SETTINGS, schemaMissing: false };
  }
  const [projRes, setRes] = await Promise.all([
    supabase.from('projects').select('*').order('min_investment', { ascending: true }),
    supabase.from('settings').select('*').eq('id', 'global').maybeSingle(),
  ]);

  if (isSupabaseSchemaMissing(projRes.error) || isSupabaseSchemaMissing(setRes.error)) {
    return { projects: OFFICIAL_VIP_CATALOG, settings: DEFAULT_SETTINGS, schemaMissing: true };
  }

  const projects =
    projRes.data && projRes.data.length > 0
      ? projRes.data.map((r) => mapProjectRow(r as Record<string, unknown>))
      : OFFICIAL_VIP_CATALOG;
  const settings = setRes.data
    ? mapSettingsRow(setRes.data as Record<string, unknown>)
    : DEFAULT_SETTINGS;

  return { projects, settings, schemaMissing: false };
}

export async function sbEnsureProfileForAuthUser(
  authUid: string,
  email: string,
  opts?: {
    country?: string;
    phone?: string;
    referralCode?: string;
    referredBy?: string;
  }
): Promise<UserProfile> {
  if (!supabase) throw new Error('Supabase non configuré.');

  if (!isEligibleAuthEmail(email)) {
    await supabase.auth.signOut();
    throw new Error(
      'Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, le Sénégal et le Togo sont autorisés.'
    );
  }

  const existingRes = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_uid', authUid)
    .maybeSingle();

  if (existingRes.error) {
    if (isSupabaseSchemaMissing(existingRes.error)) {
      throw new Error(
        'Les tables Supabase ne sont pas encore créées. Exécutez la migration SQL dans votre projet Supabase (SQL Editor).'
      );
    }
    throw new Error(existingRes.error.message);
  }

  if (existingRes.data) {
    const profile = mapProfileRow(existingRes.data as Record<string, unknown>);
    const shouldBeAdmin = isAdminEmail(email) || isUniqueAdminPhone(profile.phone);
    if (shouldBeAdmin && profile.role !== 'admin') {
      await supabase.from('profiles').update({ role: 'admin' }).eq('uid', profile.uid);
      profile.role = 'admin';
    }
    return profile;
  }

  const digitsFromEmail = email.split('@')[0].replace(/\D/g, '');
  const cleanPhone = opts?.phone || (digitsFromEmail ? `+${digitsFromEmail}` : '');
  const uid = digitsFromEmail
    ? sanitizeId(`usr_${digitsFromEmail}`)
    : sanitizeId(`usr_${authUid.replace(/-/g, '').slice(0, 16)}`);
  const referralCode =
    opts?.referralCode ||
    sanitizeId(
      `AM-${(digitsFromEmail || authUid.replace(/[^a-zA-Z0-9]/g, '')).slice(-6).toUpperCase().padStart(6, '0')}`
    );
  const country = opts?.country || 'Burkina Faso';
  const defaultMethod =
    COUNTRY_OPTIONS.find((c) => c.country === country)?.methods[0] || 'Orange Money Burkina';
  const isAdminUser = isAdminEmail(email) || isUniqueAdminPhone(cleanPhone);

  const insertPayload = {
    uid,
    auth_uid: authUid,
    email: clampStr(email, 3, 254),
    display_name: clampStr(cleanPhone || email.split('@')[0], 1, 100),
    phone: clampStr(cleanPhone, 0, 30),
    withdrawal_country: country,
    withdrawal_method: defaultMethod,
    withdrawal_account: cleanPhone,
    withdrawal_holder: cleanPhone || email.split('@')[0],
    balance: 0,
    total_invested: 0,
    total_earned: 0,
    referral_code: referralCode,
    referred_by: '',
    referral_bonus: 0,
    referral_count: 0,
    role: isAdminUser ? 'admin' : 'user',
  };

  const insertRes = await supabase.from('profiles').insert(insertPayload).select('*').single();
  if (insertRes.error) {
    throw new Error(insertRes.error.message);
  }

  if (opts?.referredBy) {
    await supabase.rpc('register_referral_tree', {
      p_invite_code: opts.referredBy,
    });
    const refreshed = await supabase
      .from('profiles')
      .select('*')
      .eq('auth_uid', authUid)
      .maybeSingle();
    if (refreshed.data) {
      return mapProfileRow(refreshed.data as Record<string, unknown>);
    }
  }

  return mapProfileRow(insertRes.data as Record<string, unknown>);
}

export async function sbPhoneAuth(payload: PhoneAuthPayload): Promise<UserProfile> {
  if (!supabase) throw new Error('Supabase non configuré.');

  const dialCode = payload.dialCode.trim();
  if (!isEligibleCountry(payload.country, dialCode)) {
    throw new Error(
      'Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, le Sénégal et le Togo sont autorisés.'
    );
  }
  const phoneCheck = validateEligiblePhone(dialCode, payload.phone, payload.country);
  if (phoneCheck.ok === false) {
    throw new Error(phoneCheck.error);
  }
  const cleanPhone = phoneCheck.cleanDigits;
  const fullPhone = phoneCheck.fullPhone;
  const isAdminCredential = isUniqueAdminPhone(fullPhone);
  const email = phoneToAuthEmail(dialCode, cleanPhone);
  const referralCode = sanitizeId(
    `AM-${cleanPhone.replace(/\D/g, '').slice(-6).padStart(6, '0')}`
  );
  const rawInvite = payload.invitationCode.trim();
  const referredBy = rawInvite ? sanitizeId(rawInvite.toUpperCase()) : '';

  if (payload.mode === 'register') {
    if (isAdminCredential) {
      throw new Error(
        "Ce numéro est réservé à l'administrateur unique. Veuillez vous connecter dans l'onglet Connexion."
      );
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password: payload.password,
      options: {
        data: {
          phone: fullPhone,
          country: payload.country,
        },
      },
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists')) {
        throw new Error('Ce numéro de téléphone est déjà inscrit. Veuillez vous connecter.');
      }
      if (msg.includes('password')) {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères.');
      }
      throw new Error(error.message);
    }

    if (!data.session || !data.user) {
      throw new Error(
        'Inscription créée, mais la confirmation par e-mail est encore activée dans Supabase. Désactivez « Confirm email » dans Authentication → Providers → Email.'
      );
    }

    return sbEnsureProfileForAuthUser(data.user.id, email, {
      country: payload.country,
      phone: fullPhone,
      referralCode,
      referredBy,
    });
  }

  // Login mode
  const signInRes = await supabase.auth.signInWithPassword({
    email,
    password: payload.password,
  });

  if (signInRes.error) {
    const errMsg = signInRes.error.message.toLowerCase();
    if (errMsg.includes('email not confirmed')) {
      throw new Error(
        'Compte non confirmé dans Supabase. Désactivez « Confirm email » dans Supabase (Authentication → Providers → Email).'
      );
    }

    if (isAdminCredential) {
      if (payload.password !== DEFAULT_ADMIN_PASSWORD) {
        throw new Error('Mot de passe administrateur incorrect. Veuillez vérifier votre saisie.');
      }
      // First-time bootstrap of the unique admin account in Supabase Auth
      const adminSignUp = await supabase.auth.signUp({
        email,
        password: payload.password,
        options: {
          data: { phone: fullPhone, country: payload.country, is_admin: true },
        },
      });
      if (adminSignUp.error) {
        const upMsg = adminSignUp.error.message.toLowerCase();
        if (upMsg.includes('already registered')) {
          throw new Error('Mot de passe administrateur incorrect.');
        }
        throw new Error(adminSignUp.error.message);
      }
      if (!adminSignUp.data.session || !adminSignUp.data.user) {
        throw new Error(
          'Compte administrateur créé, mais « Confirm email » est activé dans Supabase. Désactivez « Confirm email » dans Authentication → Providers → Email.'
        );
      }
      return sbEnsureProfileForAuthUser(adminSignUp.data.user.id, email, {
        country: payload.country,
        phone: fullPhone,
        referralCode,
      });
    }

    if (errMsg.includes('invalid login credentials')) {
      throw new Error(
        'Numéro ou mot de passe incorrect. Si vous êtes nouveau, cliquez sur « Créer un compte ».'
      );
    }
    throw new Error(signInRes.error.message);
  }

  if (!signInRes.data.user) {
    throw new Error('Impossible de démarrer la session.');
  }

  return sbEnsureProfileForAuthUser(signInRes.data.user.id, email, {
    country: payload.country,
    phone: fullPhone,
    referralCode,
  });
}

export async function sbLoadUserData(uid: string): Promise<{
  investments: InvestmentItem[];
  transactions: TransactionItem[];
  referrals: ReferralItem[];
}> {
  if (!supabase) return { investments: [], transactions: [], referrals: [] };

  const [invRes, txRes, refRes] = await Promise.all([
    supabase
      .from('investments')
      .select('*')
      .eq('user_id', uid)
      .order('purchased_at_ms', { ascending: false }),
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false }),
    supabase
      .from('referrals')
      .select('*')
      .eq('referrer_uid', uid)
      .order('created_at', { ascending: false }),
  ]);

  return {
    investments: (invRes.data || []).map((r) => mapInvestmentRow(r as Record<string, unknown>)),
    transactions: (txRes.data || []).map((r) => mapTransactionRow(r as Record<string, unknown>)),
    referrals: (refRes.data || []).map((r) => mapReferralRow(r as Record<string, unknown>)),
  };
}

export async function sbLoadAdminData(): Promise<{
  users: UserProfile[];
  transactions: TransactionItem[];
  investments: InvestmentItem[];
  referrals: ReferralItem[];
  projects: ProjectItem[];
}> {
  if (!supabase) {
    return { users: [], transactions: [], investments: [], referrals: [], projects: [] };
  }

  const [uRes, txRes, invRes, refRes, projRes] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('transactions').select('*').order('created_at', { ascending: false }),
    supabase.from('investments').select('*').order('purchased_at_ms', { ascending: false }),
    supabase.from('referrals').select('*').order('created_at', { ascending: false }),
    supabase.from('projects').select('*').order('min_investment', { ascending: true }),
  ]);

  return {
    users: (uRes.data || []).map((r) => mapProfileRow(r as Record<string, unknown>)),
    transactions: (txRes.data || []).map((r) => mapTransactionRow(r as Record<string, unknown>)),
    investments: (invRes.data || []).map((r) => mapInvestmentRow(r as Record<string, unknown>)),
    referrals: (refRes.data || []).map((r) => mapReferralRow(r as Record<string, unknown>)),
    projects: (projRes.data || []).map((r) => mapProjectRow(r as Record<string, unknown>)),
  };
}

export async function sbSyncDailyPayouts(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc('sync_daily_payouts');
  if (error) {
    console.debug('sync_daily_payouts info:', error.message);
    return 0;
  }
  return Number(data || 0);
}

export async function sbCreateDeposit(
  amount: number,
  method: string,
  phoneOrAccount: string
): Promise<string> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.rpc('create_deposit', {
    p_amount: Math.round(amount),
    p_method: clampStr(method, 2, 60),
    p_phone_or_account: clampStr(phoneOrAccount, 2, 80),
  });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : '';
}

export async function sbRequestWithdrawal(
  amount: number,
  method: string,
  account: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.rpc('request_withdrawal', {
    p_amount: Math.round(amount),
    p_method: clampStr(method, 2, 60),
    p_account: clampStr(account, 2, 80),
  });
  if (error) throw new Error(error.message);
}

export async function sbPurchaseVip(projectId: string, quantity: number): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.rpc('purchase_vip_product', {
    p_project_id: projectId,
    p_quantity: Math.max(1, Math.min(20, Math.round(quantity))),
  });
  if (error) throw new Error(error.message);
}

export async function sbSaveWithdrawalAccount(
  uid: string,
  payload: {
    country: string;
    method: string;
    account: string;
    holder: string;
  }
): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase
    .from('profiles')
    .update({
      withdrawal_country: clampStr(payload.country, 2, 60),
      withdrawal_method: clampStr(payload.method, 2, 60),
      withdrawal_account: clampStr(payload.account, 4, 80),
      withdrawal_holder: clampStr(payload.holder, 2, 100),
      updated_at: new Date().toISOString(),
    })
    .eq('uid', uid);
  if (error) throw new Error(error.message);
}

export async function sbChangePassword(newPassword: string): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function sbAdminSaveProject(project: ProjectItem): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const id = sanitizeId(project.id);
  const { error } = await supabase.from('projects').upsert({
    id,
    title: clampStr(project.title, 2, 120),
    category: clampStr(project.category, 2, 60),
    description: clampStr(project.description, 5, 1000),
    location: clampStr(project.location, 2, 100),
    image_url: clampStr(project.imageUrl, 1, 500),
    return_rate: Math.max(1, Math.round(project.returnRate)),
    duration_days: Math.max(1, Math.min(3650, Math.round(project.durationDays || 90))),
    min_investment: Math.max(500, Math.round(project.minInvestment)),
    daily_income: Math.max(50, Math.round(project.dailyIncome)),
    target_amount: Math.max(1000, Math.round(project.targetAmount)),
    raised_amount: Math.max(0, Math.round(project.raisedAmount)),
    investors_count: Math.max(0, Math.round(project.investorsCount)),
    status: project.status,
    visibility: project.visibility,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function sbAdminSyncOfficialCatalog(): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const presetKeyMap: Record<string, string> = {
    vip_1: 'preset:titanium',
    vip_2: 'preset:hero',
    vip_3: 'preset:foldable',
    vip_4: 'preset:ceramic',
    vip_5: 'preset:hero',
  };
  const rows = OFFICIAL_VIP_CATALOG.map((item) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    description: item.description,
    location: item.location,
    image_url: presetKeyMap[item.id] || 'preset:hero',
    return_rate: item.returnRate,
    duration_days: item.durationDays,
    min_investment: item.minInvestment,
    daily_income: item.dailyIncome,
    target_amount: item.targetAmount,
    raised_amount: item.raisedAmount,
    investors_count: item.investorsCount,
    status: item.status,
    visibility: item.visibility,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase.from('projects').upsert(rows);
  if (error) throw new Error(error.message);
}

export async function sbAdminProcessTransaction(
  txId: string,
  nextStatus: 'approved' | 'rejected'
): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.rpc('admin_process_transaction', {
    p_tx_id: txId,
    p_next_status: nextStatus,
  });
  if (error) throw new Error(error.message);
}

export async function sbAdminAdjustBalance(
  targetUid: string,
  delta: number,
  reason: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.rpc('admin_adjust_balance', {
    p_target_uid: targetUid,
    p_delta: Math.round(delta),
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function sbAdminGiftProduct(
  targetUid: string,
  projectId: string,
  quantity: number,
  reason: string
): Promise<void> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { error } = await supabase.rpc('admin_gift_product', {
    p_target_uid: targetUid,
    p_project_id: projectId,
    p_quantity: Math.max(1, Math.min(20, Math.round(quantity))),
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function sbAdminSaveSettings(settings: PlatformSettings): Promise<PlatformSettings> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const cleaned: PlatformSettings = {
    id: 'global',
    referralRate: Math.max(0, Math.min(50, Number(settings.referralRate) || 0)),
    minDeposit: Math.max(500, Number(settings.minDeposit) || 4000),
    minWithdrawal: Math.max(500, Number(settings.minWithdrawal) || 1000),
    supportPhone: clampStr(settings.supportPhone, 3, 50, DEFAULT_SETTINGS.supportPhone),
    supportEmail: clampStr(settings.supportEmail, 3, 120, DEFAULT_SETTINGS.supportEmail),
    adminPhone: DEFAULT_ADMIN_PHONE,
    announcement: clampStr(settings.announcement, 2, 300, DEFAULT_SETTINGS.announcement),
    allowMultipleSameVip: settings.allowMultipleSameVip !== false,
    visibility: 'public',
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase.from('settings').upsert({
    id: 'global',
    referral_rate: cleaned.referralRate,
    min_deposit: cleaned.minDeposit,
    min_withdrawal: cleaned.minWithdrawal,
    support_phone: cleaned.supportPhone,
    support_email: cleaned.supportEmail,
    admin_phone: DEFAULT_ADMIN_PHONE,
    announcement: cleaned.announcement,
    allow_multiple_same_vip: cleaned.allowMultipleSameVip,
    visibility: 'public',
    updated_at: cleaned.updatedAt,
  });
  if (error) throw new Error(error.message);
  return cleaned;
}
