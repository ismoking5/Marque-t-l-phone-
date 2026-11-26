import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Award,
  Bell,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  FileText,
  Gift,
  Headphones,
  History,
  Home,
  Info,
  KeyRound,
  Send,
  Shield,
  Smartphone,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ADMIN_EMAIL,
  BRAND_IMAGES,
  COUNTRY_OPTIONS,
  DAILY_CHECKIN_BONUS_CFA,
  DAILY_CHECKIN_COOLDOWN_MS,
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_PHONE,
  DEFAULT_GIFT_CODES,
  DEFAULT_SETTINGS,
  GIFT_CODE_MAX_CFA,
  GIFT_CODE_MIN_CFA,
  OFFICIAL_VIP_CATALOG,
  OFFICIAL_VIP_IDS,
  REGISTRATION_BONUS_CFA,
  SUPPORT_CHANNELS,
  TELEGRAM_GROUP_URL,
  clampStr,
  computeInvestmentMetrics,
  formatCFA,
  formatDateFr,
  getProjectDailyIncome,
  isEligibleCountry,
  sanitizeId,
  validateEligiblePhone,
} from './data/catalog';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  signInWithGooglePopup,
  signOutFirebase,
} from './firebase';
import {
  isAdminEmail,
  isSupabaseSchemaMissing,
  sbAdminAdjustBalance,
  sbAdminGiftProduct,
  sbAdminProcessTransaction,
  sbAdminSaveProject,
  sbAdminSaveSettings,
  sbAdminSyncOfficialCatalog,
  sbAdminUpsertGiftCode,
  sbChangePassword,
  sbClaimDailyCheckin,
  sbCreateDeposit,
  sbEnsureProfileForAuthUser,
  sbFetchPublicData,
  sbLoadAdminData,
  sbLoadUserData,
  sbPhoneAuth,
  sbPurchaseVip,
  sbRedeemGiftCode,
  sbRequestWithdrawal,
  sbSaveWithdrawalAccount,
  sbSyncDailyPayouts,
} from './lib/supabaseDb';
import { isSupabaseConfigured, supabase } from './supabase';
import type {
  GiftCodeItem,
  InvestmentItem,
  PhoneAccountRecord,
  PhoneAuthPayload,
  PlatformSettings,
  ProjectItem,
  ReferralItem,
  TransactionItem,
  TransactionStatus,
  TransactionType,
  UserProfile,
} from './types';
import { AdminPanel } from './components/AdminPanel';
import { AuthScreen } from './components/AuthScreen';
import { BrandEmblem, BrandLogo, SafeImage } from './components/Brand';
import {
  BuyVipModal,
  DepositModal,
  InfoWelcomeModal,
  ReferralModal,
  SupportModal,
  WithdrawModal,
} from './components/Modals';

const ACCOUNTS_KEY = 'aurelia_mobile_phone_accounts_v1';
const SESSION_KEY = 'aurelia_mobile_active_phone_session_v1';
const PROJECTS_KEY = 'aurelia_mobile_projects_v1';
const SETTINGS_KEY = 'aurelia_mobile_settings_v1';
const REF_UID_KEY = 'aurelia_mobile_ref_uid';
const STRICT_ADMIN_MIGRATED_KEY = 'aurelia_mobile_strict_admin_v1';
const GIFT_CODES_KEY = 'aurelia_mobile_gift_codes_v1';
const GIFT_REDEMPTIONS_KEY = 'aurelia_mobile_gift_redemptions_v1';

function isUniqueAdminPhone(phone?: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  const adminDigits = DEFAULT_ADMIN_PHONE.replace(/\D/g, '');
  return digits === adminDigits;
}

function normalizeLocalPhoneNumber(dialCode: string, rawPhone: string): string {
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

function matchesReferralRef(user: UserProfile, refValue?: string): boolean {
  if (!refValue) return false;
  const target = refValue.trim().toLowerCase();
  if (!target) return false;
  return (
    (user.referralCode || '').trim().toLowerCase() === target ||
    (user.uid || '').trim().toLowerCase() === target
  );
}

function loadAccounts(): Record<string, PhoneAccountRecord> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const parsed: Record<string, PhoneAccountRecord> = raw
      ? (JSON.parse(raw) as Record<string, PhoneAccountRecord>)
      : {};
    if (!localStorage.getItem(STRICT_ADMIN_MIGRATED_KEY)) {
      localStorage.setItem(STRICT_ADMIN_MIGRATED_KEY, '1');
      let changed = false;
      Object.entries(parsed).forEach(([k, acc]) => {
        const isTargetAdmin = isUniqueAdminPhone(acc.profile?.phone);
        const expectedRole: 'admin' | 'user' = isTargetAdmin ? 'admin' : 'user';
        if (acc.profile?.role !== expectedRole) {
          parsed[k] = {
            ...acc,
            profile: { ...acc.profile, role: expectedRole },
          };
          changed = true;
        }
        if (isTargetAdmin && acc.password !== DEFAULT_ADMIN_PASSWORD) {
          parsed[k] = {
            ...parsed[k],
            password: DEFAULT_ADMIN_PASSWORD,
          };
          changed = true;
        }
      });
      if (changed) {
        localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(parsed));
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function saveAccounts(accounts: Record<string, PhoneAccountRecord>) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore storage quota errors
  }
}

function loadLocalProjects(): ProjectItem[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return OFFICIAL_VIP_CATALOG;
    const parsed = JSON.parse(raw) as ProjectItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : OFFICIAL_VIP_CATALOG;
  } catch {
    return OFFICIAL_VIP_CATALOG;
  }
}

function saveLocalProjects(projects: ProjectItem[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {
    // ignore
  }
}

const SETTINGS_LOCAL_OVERRIDE_KEY = 'aurelia_mobile_settings_local_override_v1';
const MIN_WD_1000_MIGRATED_KEY = 'aurelia_mobile_min_wd_1000_v1';

function loadLocalSettings(): PlatformSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const merged: PlatformSettings = raw
      ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlatformSettings>) }
      : DEFAULT_SETTINGS;
    if (!localStorage.getItem(MIN_WD_1000_MIGRATED_KEY)) {
      localStorage.setItem(MIN_WD_1000_MIGRATED_KEY, '1');
      if (merged.minWithdrawal === 2500) {
        merged.minWithdrawal = 1000;
      }
    }
    if (merged.adminPhone !== DEFAULT_ADMIN_PHONE) {
      merged.adminPhone = DEFAULT_ADMIN_PHONE;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLocalSettings(settings: PlatformSettings, markLocalOverride = false) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (markLocalOverride) {
      localStorage.setItem(SETTINGS_LOCAL_OVERRIDE_KEY, '1');
    }
  } catch {
    // ignore
  }
}

function loadLocalGiftCodes(): GiftCodeItem[] {
  try {
    const raw = localStorage.getItem(GIFT_CODES_KEY);
    if (!raw) return DEFAULT_GIFT_CODES;
    const parsed = JSON.parse(raw) as GiftCodeItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_GIFT_CODES;
  } catch {
    return DEFAULT_GIFT_CODES;
  }
}

function saveLocalGiftCodes(codes: GiftCodeItem[]) {
  try {
    localStorage.setItem(GIFT_CODES_KEY, JSON.stringify(codes));
  } catch {
    // ignore
  }
}

function loadLocalGiftRedemptions(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(GIFT_REDEMPTIONS_KEY);
    if (!raw) return {};
    return (JSON.parse(raw) as Record<string, string[]>) || {};
  } catch {
    return {};
  }
}

function saveLocalGiftRedemptions(map: Record<string, string[]>) {
  try {
    localStorage.setItem(GIFT_REDEMPTIONS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function formatCountdownHhMm(ms: number): string {
  const totalMins = Math.max(1, Math.ceil(ms / 60000));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

function transactionTypeLabel(type: TransactionType): string {
  switch (type) {
    case 'deposit':
      return 'Dépôt';
    case 'withdrawal':
      return 'Retrait';
    case 'investment':
      return 'Produit acheté';
    case 'payout':
      return 'Gain reçu';
    case 'credit':
      return 'Crédit ajouté au compte';
    case 'referral':
      return 'Bonus de parrainage';
    case 'gift':
      return 'Produit offert';
    default:
      return 'Opération';
  }
}

function transactionStatusLabel(status: TransactionStatus): string {
  switch (status) {
    case 'completed':
    case 'approved':
      return 'Confirmé';
    case 'pending':
      return 'En attente';
    case 'rejected':
      return 'Rejeté';
    default:
      return status;
  }
}

export default function App() {
  const [sbUser, setSbUser] = useState<SupabaseUser | null>(null);
  const [supabaseSchemaMissing, setSupabaseSchemaMissing] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [phoneSessionKey, setPhoneSessionKey] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const [initialInviteCode, setInitialInviteCode] = useState('');
  const [authReady, setAuthReady] = useState(false);

  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeTab, setActiveTab] = useState<
    'home' | 'projects' | 'investments' | 'team' | 'account' | 'checkin' | 'admin'
  >('home');
  const [accountSubpage, setAccountSubpage] = useState<
    'menu' | 'history' | 'withdrawal_account' | 'password' | 'about' | 'support' | 'gift_code'
  >('menu');

  const [projects, setProjects] = useState<ProjectItem[]>(() => loadLocalProjects());
  const [investments, setInvestments] = useState<InvestmentItem[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [settings, setSettings] = useState<PlatformSettings>(() => loadLocalSettings());

  // Admin cloud snapshots
  const [cloudUsers, setCloudUsers] = useState<UserProfile[]>([]);
  const [cloudTransactions, setCloudTransactions] = useState<TransactionItem[]>([]);
  const [cloudInvestments, setCloudInvestments] = useState<InvestmentItem[]>([]);
  const [cloudReferrals, setCloudReferrals] = useState<ReferralItem[]>([]);
  const [cloudGiftCodes, setCloudGiftCodes] = useState<GiftCodeItem[]>(() => loadLocalGiftCodes());
  const [localSyncTick, setLocalSyncTick] = useState(0);

  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [showTeamDetails, setShowTeamDetails] = useState(false);
  const [teamLevelTab, setTeamLevelTab] = useState<1 | 2 | 3>(1);

  // Modals
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [buyModalOpen, setBuyModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [referralModalOpen, setReferralModalOpen] = useState(false);
  const [infoPopupOpen, setInfoPopupOpen] = useState(false);

  // Daily check-in & gift code
  const [claimingCheckin, setClaimingCheckin] = useState(false);
  const [checkinNowMs, setCheckinNowMs] = useState(() => Date.now());
  const [giftCodeInput, setGiftCodeInput] = useState('');
  const [redeemingGiftCode, setRedeemingGiftCode] = useState(false);
  const [giftCodeFeedback, setGiftCodeFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Withdrawal account form
  const [wdCountry, setWdCountry] = useState('Burkina Faso');
  const [wdMethod, setWdMethod] = useState('Orange Money Burkina');
  const [wdAccount, setWdAccount] = useState('');
  const [wdHolder, setWdHolder] = useState('');
  const [savingWd, setSavingWd] = useState(false);
  const [showWdForm, setShowWdForm] = useState(false);

  // Password form
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const payoutSyncingRef = useRef(false);
  const checkinLockRef = useRef(false);
  const giftCodeLockRef = useRef(false);
  const refreshSupabaseInflightRef = useRef<Promise<void> | null>(null);
  const infoShownForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authReady) return;
    if (!userProfile) {
      infoShownForSessionRef.current = null;
      setInfoPopupOpen(false);
      return;
    }
    if (infoShownForSessionRef.current !== userProfile.uid) {
      infoShownForSessionRef.current = userProfile.uid;
      setInfoPopupOpen(true);
    }
  }, [authReady, userProfile]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const isAdmin = useMemo(() => {
    if (isSupabaseConfigured) {
      return Boolean(
        sbUser &&
          (isAdminEmail(sbUser.email) ||
            isUniqueAdminPhone(userProfile?.phone) ||
            userProfile?.role === 'admin')
      );
    }
    const adminEmailLower = ADMIN_EMAIL.toLowerCase();
    if (firebaseUser) {
      return !!(
        firebaseUser.email?.toLowerCase() === adminEmailLower ||
        userProfile?.role === 'admin'
      );
    }
    if (phoneSessionKey && userProfile) {
      return isUniqueAdminPhone(userProfile.phone);
    }
    return false;
  }, [sbUser, firebaseUser, phoneSessionKey, userProfile]);

  useEffect(() => {
    if (activeTab === 'admin' && !isAdmin) {
      setActiveTab('home');
    }
  }, [activeTab, isAdmin]);

  const refreshSupabaseState = async (
    activeProfile?: UserProfile | null,
    email?: string | null,
    force = false
  ) => {
    if (!isSupabaseConfigured || !supabase) return;
    if (refreshSupabaseInflightRef.current) {
      if (!force) {
        return refreshSupabaseInflightRef.current;
      }
      await refreshSupabaseInflightRef.current.catch(() => undefined);
    }

    const task = (async () => {
      try {
        const pub = await sbFetchPublicData();
        setSupabaseSchemaMissing(pub.schemaMissing);
        setProjects(pub.projects);
        setSettings(pub.settings);
        if (pub.schemaMissing) return;

        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUser = sessionData.session?.user;
        if (!sessionUser && !activeProfile) return;

        const credited = await sbSyncDailyPayouts();
        let currentProf = activeProfile || null;
        if (sessionUser) {
          currentProf = await sbEnsureProfileForAuthUser(
            sessionUser.id,
            sessionUser.email || email || activeProfile?.email || ''
          );
          setUserProfile(currentProf);
        }
        if (!currentProf) return;
        if (credited > 0) {
          showToast(`+${formatCFA(credited)} de gains quotidiens crédités sur votre solde.`);
        }

        const userData = await sbLoadUserData(currentProf.uid);
        setInvestments(userData.investments);
        setTransactions(userData.transactions);
        setReferrals(userData.referrals);

        const adminNow =
          isAdminEmail(email || sessionUser?.email || currentProf.email) ||
          isUniqueAdminPhone(currentProf.phone) ||
          currentProf.role === 'admin';
        if (adminNow) {
          const adminData = await sbLoadAdminData();
          setCloudUsers(adminData.users);
          setCloudTransactions(adminData.transactions);
          setCloudInvestments(adminData.investments);
          setCloudReferrals(adminData.referrals);
          setCloudGiftCodes(adminData.giftCodes || []);
          if (adminData.projects.length > 0) {
            setProjects(adminData.projects);
          }
        }
      } catch (err) {
        if (isSupabaseSchemaMissing(err)) {
          setSupabaseSchemaMissing(true);
        } else {
          console.debug('Supabase refresh info:', err);
        }
      }
    })();

    refreshSupabaseInflightRef.current = task;
    try {
      await task;
    } finally {
      if (refreshSupabaseInflightRef.current === task) {
        refreshSupabaseInflightRef.current = null;
      }
    }
  };

  const { allUsers, allTransactions, allInvestments, allReferrals } = useMemo(() => {
    const localList = isSupabaseConfigured ? [] : Object.values(loadAccounts());

    const usersMap = new Map<string, UserProfile>();
    cloudUsers.forEach((u) => usersMap.set(u.uid, u));
    localList.forEach((acc) => {
      const adminFlag = isUniqueAdminPhone(acc.profile.phone);
      usersMap.set(acc.profile.uid, {
        ...acc.profile,
        role: adminFlag ? 'admin' : 'user',
      });
    });

    const txMap = new Map<string, TransactionItem>();
    cloudTransactions.forEach((t) => txMap.set(t.id, t));
    localList.forEach((acc) => (acc.transactions || []).forEach((t) => txMap.set(t.id, t)));

    const invMap = new Map<string, InvestmentItem>();
    cloudInvestments.forEach((i) => invMap.set(i.id, i));
    localList.forEach((acc) => (acc.investments || []).forEach((i) => invMap.set(i.id, i)));

    const refMap = new Map<string, ReferralItem>();
    cloudReferrals.forEach((r) => refMap.set(r.id, r));
    localList.forEach((acc) => (acc.referrals || []).forEach((r) => refMap.set(r.id, r)));

    const usersArr = Array.from(usersMap.values());
    const pairKeySet = new Set<string>();
    refMap.forEach((r) => pairKeySet.add(`${r.referrerUid}__${r.referredUid}`));

    // Reconcile up to 3 levels of referral links from user.referredBy
    usersArr.forEach((member) => {
      if (!member.referredBy) return;
      let cursorRef: string | undefined = member.referredBy;
      const visited = new Set<string>([member.uid]);
      for (let lvl = 1; lvl <= 3 && cursorRef; lvl++) {
        const sponsor = usersArr.find((u) => matchesReferralRef(u, cursorRef));
        if (!sponsor || visited.has(sponsor.uid)) break;
        visited.add(sponsor.uid);
        const pairKey = `${sponsor.uid}__${member.uid}`;
        if (!pairKeySet.has(pairKey)) {
          pairKeySet.add(pairKey);
          const synthId = sanitizeId(
            `ref_${sponsor.uid.slice(0, 14)}_${member.uid.slice(0, 14)}_l${lvl}`
          );
          refMap.set(synthId, {
            id: synthId,
            referrerUid: sponsor.uid,
            referredUid: member.uid,
            referredName: member.phone || member.displayName,
            level: lvl,
            commissionEarned: 0,
            status: 'active',
            createdAt: member.createdAt,
            updatedAt: member.updatedAt,
          });
        }
        cursorRef = sponsor.referredBy;
      }
    });

    return {
      allUsers: usersArr,
      allTransactions: Array.from(txMap.values()),
      allInvestments: Array.from(invMap.values()),
      allReferrals: Array.from(refMap.values()),
    };
  }, [cloudUsers, cloudTransactions, cloudInvestments, cloudReferrals, localSyncTick]);

  // Read URL referral params & payment return status
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    const code = params.get('code');
    if (ref) localStorage.setItem(REF_UID_KEY, sanitizeId(ref));
    if (code) setInitialInviteCode(sanitizeId(code));
    else if (ref) setInitialInviteCode(sanitizeId(ref));

    const returnToken = params.get('token');
    const depositReturn = params.get('deposit_return');
    if (returnToken || depositReturn) {
      if (returnToken && /^[a-zA-Z0-9_-]{6,128}$/.test(returnToken)) {
        void (async () => {
          let authToken = '';
          if (isSupabaseConfigured && supabase) {
            const { data } = await supabase.auth.getSession();
            authToken = data.session?.access_token || '';
          }
          const res = await fetch(`/api/deposit/verify?token=${encodeURIComponent(returnToken)}`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          }).catch(() => null);
          if (res && res.ok) {
            const info = (await res.json().catch(() => ({}))) as { status?: string; amount?: number };
            if (info.status === 'paid') {
              showToast('Paiement confirmé ! Votre dépôt est en cours de traitement.');
            } else if (info.status === 'failed') {
              showToast('Le paiement n’a pas abouti ou a été annulé.');
            } else {
              showToast('Paiement en attente de confirmation.');
            }
          }
        })();
      }
      params.delete('token');
      params.delete('deposit_return');
      const nextQs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${nextQs ? `?${nextQs}` : ''}`);
    }
  }, []);

  // Supabase Auth & session bootstrap (active when VITE_SUPABASE_* is configured)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;

    const hydrateSession = async (sessionUser: SupabaseUser | null) => {
      if (!active) return;
      setSbUser(sessionUser);
      try {
        const pub = await sbFetchPublicData();
        if (!active) return;
        setSupabaseSchemaMissing(pub.schemaMissing);
        setProjects(pub.projects);
        setSettings(pub.settings);

        if (sessionUser && !pub.schemaMissing) {
          const prof = await sbEnsureProfileForAuthUser(
            sessionUser.id,
            sessionUser.email || ''
          );
          if (!active) return;
          setUserProfile(prof);
          setWdCountry(prof.withdrawalCountry || 'Burkina Faso');
          setWdMethod(prof.withdrawalMethod || 'Orange Money Burkina');
          setWdAccount(prof.withdrawalAccount || prof.phone || '');
          setWdHolder(prof.withdrawalHolder || prof.displayName || '');
          await refreshSupabaseState(prof, sessionUser.email);
        } else if (!sessionUser) {
          setUserProfile(null);
          setInvestments([]);
          setTransactions([]);
          setReferrals([]);
          setCloudUsers([]);
          setCloudTransactions([]);
          setCloudInvestments([]);
          setCloudReferrals([]);
          setCloudGiftCodes(loadLocalGiftCodes());
        }
      } catch (err) {
        if (isSupabaseSchemaMissing(err)) {
          setSupabaseSchemaMissing(true);
        }
      } finally {
        if (active) setAuthReady(true);
      }
    };

    void supabase.auth.getSession().then(({ data }) => {
      void hydrateSession(data.session?.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void hydrateSession(session?.user ?? null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Periodic Supabase refresh while signed in (keeps Admin user list & balances fresh)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !sbUser || !userProfile) return;
    void refreshSupabaseState(userProfile, sbUser.email);
    const timer = window.setInterval(() => {
      void refreshSupabaseState(userProfile, sbUser.email);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [sbUser?.id, userProfile?.uid, activeTab]);

  // Load local phone account when not using Supabase or Firebase Auth
  useEffect(() => {
    if (isSupabaseConfigured || firebaseUser || !phoneSessionKey) return;
    const accounts = loadAccounts();
    const record = accounts[phoneSessionKey];
    if (record) {
      const dialPrefix = phoneSessionKey.split('_')[0] || '';
      if (!isEligibleCountry(undefined, dialPrefix)) {
        setPhoneSessionKey(null);
        localStorage.removeItem(SESSION_KEY);
        return;
      }
      const expectedRole: 'admin' | 'user' = isUniqueAdminPhone(record.profile.phone)
        ? 'admin'
        : 'user';
      const normalizedProfile: UserProfile =
        record.profile.role === expectedRole
          ? record.profile
          : { ...record.profile, role: expectedRole };
      if (record.profile.role !== expectedRole) {
        accounts[phoneSessionKey] = { ...record, profile: normalizedProfile };
        saveAccounts(accounts);
      }
      setUserProfile(normalizedProfile);
      setInvestments(record.investments || []);
      setTransactions(record.transactions || []);
      setReferrals(record.referrals || []);
      setWdCountry(normalizedProfile.withdrawalCountry || 'Burkina Faso');
      setWdMethod(normalizedProfile.withdrawalMethod || 'Orange Money Burkina');
      setWdAccount(normalizedProfile.withdrawalAccount || normalizedProfile.phone || '');
      setWdHolder(normalizedProfile.withdrawalHolder || normalizedProfile.displayName || '');
    } else {
      setPhoneSessionKey(null);
      localStorage.removeItem(SESSION_KEY);
    }
  }, [firebaseUser, phoneSessionKey, localSyncTick]);

  // Firebase Auth listener (fallback only when Supabase is not configured)
  useEffect(() => {
    if (isSupabaseConfigured) return;
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser);
      if (fbUser) {
        await ensureFirebaseProfile(fbUser);
      } else if (!localStorage.getItem(SESSION_KEY)) {
        setUserProfile(null);
        setInvestments([]);
        setTransactions([]);
        setReferrals([]);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  async function ensureFirebaseProfile(fbUser: FirebaseUser) {
    const userRef = doc(db, 'users', fbUser.uid);
    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        const refIdRaw = localStorage.getItem(REF_UID_KEY) || '';
        const referrerUid = refIdRaw && refIdRaw !== fbUser.uid ? sanitizeId(refIdRaw) : '';
        const code = `AM-${fbUser.uid.slice(0, 6).toUpperCase()}`;
        await setDoc(userRef, {
          uid: sanitizeId(fbUser.uid),
          email: clampStr(fbUser.email || 'membre@aureliamobile.africa', 3, 254),
          displayName: clampStr(fbUser.displayName || 'Membre AURELIA MOBILE', 1, 100),
          phone: '+226 ',
          balance: 0,
          totalInvested: 0,
          totalEarned: 0,
          referralCode: sanitizeId(code),
          referredBy: referrerUid,
          referralBonus: 0,
          referralCount: 0,
          role: 'user',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (referrerUid) {
          const refDocId = sanitizeId(`ref_${referrerUid.slice(0, 20)}_${fbUser.uid.slice(0, 20)}`);
          try {
            await setDoc(doc(db, 'referrals', refDocId), {
              id: refDocId,
              referrerUid,
              referredUid: sanitizeId(fbUser.uid),
              referredName: clampStr(fbUser.displayName || 'Nouveau Membre', 1, 100),
              level: 1,
              commissionEarned: 0,
              status: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } catch {
            // non-fatal if referrer doc doesn't exist
          }
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}`);
    }
  }

  // Real-time Firestore listeners (fallback only when Supabase is not configured)
  useEffect(() => {
    if (isSupabaseConfigured || !authReady) return;
    const unsubs: (() => void)[] = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'projects'), where('visibility', '==', 'public')),
        (snap) => {
          if (!snap.empty) {
            const list = snap.docs.map((d) => d.data() as ProjectItem);
            setProjects(list);
            saveLocalProjects(list);
          }
        },
        (err) => {
          // Ignore unauthenticated public list errors if rules restrict; fallback to catalog
          console.debug('Projects snapshot info:', err.message);
        }
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'global'),
        (snap) => {
          if (snap.exists()) {
            const hasLocalOverride =
              !firebaseUser && localStorage.getItem(SETTINGS_LOCAL_OVERRIDE_KEY) === '1';
            if (hasLocalOverride) return;
            const data: PlatformSettings = {
              ...DEFAULT_SETTINGS,
              ...(snap.data() as PlatformSettings),
              adminPhone: DEFAULT_ADMIN_PHONE,
            };
            setSettings(data);
            saveLocalSettings(data);
          }
        },
        (err) => {
          console.debug('Settings snapshot info:', err.message);
        }
      )
    );

    if (firebaseUser) {
      unsubs.push(
        onSnapshot(
          doc(db, 'users', firebaseUser.uid),
          (snap) => {
            if (snap.exists()) {
              const p = snap.data() as UserProfile;
              const isBootstrapAdmin =
                firebaseUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
              const normalized: UserProfile = isBootstrapAdmin ? { ...p, role: 'admin' } : p;
              setUserProfile(normalized);
              setWdCountry(normalized.withdrawalCountry || 'Burkina Faso');
              setWdMethod(normalized.withdrawalMethod || 'Orange Money Burkina');
              setWdAccount(normalized.withdrawalAccount || normalized.phone || '');
              setWdHolder(normalized.withdrawalHolder || normalized.displayName || '');
            }
          },
          (err) => handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`)
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'investments'), where('userId', '==', firebaseUser.uid)),
          (snap) => setInvestments(snap.docs.map((d) => d.data() as InvestmentItem)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'investments')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'transactions'), where('userId', '==', firebaseUser.uid)),
          (snap) => setTransactions(snap.docs.map((d) => d.data() as TransactionItem)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'referrals'), where('referrerUid', '==', firebaseUser.uid)),
          (snap) => setReferrals(snap.docs.map((d) => d.data() as ReferralItem)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'referrals')
        )
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [authReady, firebaseUser]);

  // Admin cloud listeners (Firestore fallback only when Supabase is not configured)
  useEffect(() => {
    if (isSupabaseConfigured || !authReady || !firebaseUser || !isAdmin) return;
    const u1 = onSnapshot(
      collection(db, 'users'),
      (snap) => setCloudUsers(snap.docs.map((d) => d.data() as UserProfile)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    );
    const u2 = onSnapshot(
      collection(db, 'transactions'),
      (snap) => setCloudTransactions(snap.docs.map((d) => d.data() as TransactionItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    );
    const u3 = onSnapshot(
      collection(db, 'investments'),
      (snap) => setCloudInvestments(snap.docs.map((d) => d.data() as InvestmentItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'investments')
    );
    const u4 = onSnapshot(
      collection(db, 'referrals'),
      (snap) => setCloudReferrals(snap.docs.map((d) => d.data() as ReferralItem)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'referrals')
    );
    const u5 = onSnapshot(
      collection(db, 'projects'),
      (snap) => {
        if (!snap.empty) {
          const list = snap.docs.map((d) => d.data() as ProjectItem);
          setProjects(list);
          saveLocalProjects(list);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'projects')
    );
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
    };
  }, [authReady, firebaseUser, isAdmin]);

  // Automatic 24h daily VIP payout synchronization (local/Firestore fallback mode)
  useEffect(() => {
    if (isSupabaseConfigured || !userProfile || investments.length === 0 || payoutSyncingRef.current) return;
    const nowMs = Date.now();
    const pendingUpdates = investments
      .filter((inv) => inv.status === 'active')
      .map((inv) => ({ inv, metrics: computeInvestmentMetrics(inv, nowMs) }))
      .filter(({ inv, metrics }) => metrics.pendingDaysToCredit > 0 || (metrics.isExpired && inv.status === 'active'));

    if (pendingUpdates.length === 0) return;

    payoutSyncingRef.current = true;
    (async () => {
      try {
        let totalPendingCredit = 0;
        if (!firebaseUser && phoneSessionKey) {
          const nowIso = new Date().toISOString();
          const payoutTxs: TransactionItem[] = [];
          const updatedInvestments = investments.map((inv) => {
            const match = pendingUpdates.find((p) => p.inv.id === inv.id);
            if (!match) return inv;
            const { metrics } = match;
            const newDaysCredited = Math.min(metrics.durationDays, metrics.elapsedDays);
            const newTotalEarned = newDaysCredited * metrics.dailyIncome;
            const nextStatus = metrics.isExpired ? ('expired' as const) : ('active' as const);
            if (metrics.pendingAmountToCredit > 0) {
              totalPendingCredit += metrics.pendingAmountToCredit;
              payoutTxs.push({
                id: sanitizeId(`tx_vipday_${inv.id.slice(-10)}_d${newDaysCredited}_${Date.now().toString().slice(-4)}`),
                userId: userProfile.uid,
                userName: userProfile.displayName,
                type: 'payout',
                amount: Math.round(metrics.pendingAmountToCredit),
                method: 'Revenu quotidien VIP',
                phoneOrAccount: userProfile.referralCode,
                reference: clampStr(`${inv.projectTitle} · Jour ${newDaysCredited}/${metrics.durationDays}`, 2, 100),
                status: 'completed',
                createdAt: nowIso,
                updatedAt: nowIso,
              });
            }
            return {
              ...inv,
              daysCredited: newDaysCredited,
              totalEarnedSoFar: newTotalEarned,
              status: nextStatus,
              updatedAt: nowIso,
            };
          });

          mutateLocalAccount((rec) => ({
            ...rec,
            profile: {
              ...rec.profile,
              balance: Math.round(rec.profile.balance + totalPendingCredit),
              totalEarned: Math.round(rec.profile.totalEarned + totalPendingCredit),
              updatedAt: nowIso,
            },
            investments: updatedInvestments,
            transactions: [...payoutTxs, ...rec.transactions],
          }));
        } else if (firebaseUser) {
          for (const { inv, metrics } of pendingUpdates) {
            const newDaysCredited = Math.min(metrics.durationDays, metrics.elapsedDays);
            const newTotalEarned = newDaysCredited * metrics.dailyIncome;
            const nextStatus = metrics.isExpired ? 'expired' : 'active';
            await updateDoc(doc(db, 'investments', inv.id), {
              daysCredited: newDaysCredited,
              totalEarnedSoFar: newTotalEarned,
              status: nextStatus,
              updatedAt: serverTimestamp(),
            });
            if (metrics.pendingAmountToCredit > 0) {
              totalPendingCredit += metrics.pendingAmountToCredit;
              const txId = sanitizeId(
                `tx_vipday_${inv.id.slice(-10)}_d${newDaysCredited}_${Date.now().toString().slice(-4)}`
              );
              await setDoc(doc(db, 'transactions', txId), {
                id: txId,
                userId: sanitizeId(firebaseUser.uid),
                userName: clampStr(userProfile.displayName, 1, 100),
                type: 'payout',
                amount: Math.round(metrics.pendingAmountToCredit),
                method: 'Revenu quotidien VIP',
                phoneOrAccount: userProfile.referralCode,
                reference: clampStr(`${inv.projectTitle} · Jour ${newDaysCredited}/90`, 2, 100),
                status: 'completed',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
            }
          }
          if (totalPendingCredit > 0) {
            await updateDoc(doc(db, 'users', firebaseUser.uid), {
              balance: Math.round(userProfile.balance + totalPendingCredit),
              totalEarned: Math.round(userProfile.totalEarned + totalPendingCredit),
              updatedAt: serverTimestamp(),
            });
          }
        }
        if (totalPendingCredit > 0) {
          showToast(`+${formatCFA(totalPendingCredit)} de gains quotidiens crédités sur votre solde.`);
        }
      } catch (err) {
        console.error('Error syncing VIP daily income:', err);
      } finally {
        payoutSyncingRef.current = false;
      }
    })();
  }, [firebaseUser, userProfile, investments, phoneSessionKey]);

  const mutateLocalAccount = (updater: (rec: PhoneAccountRecord) => PhoneAccountRecord) => {
    if (!phoneSessionKey) return;
    const accounts = loadAccounts();
    const rec = accounts[phoneSessionKey];
    if (!rec) return;
    const next = updater(rec);
    accounts[phoneSessionKey] = next;
    saveAccounts(accounts);
    setLocalSyncTick((t) => t + 1);
    setUserProfile(next.profile);
    setInvestments(next.investments);
    setTransactions(next.transactions);
    setReferrals(next.referrals);
  };

  const handlePhoneAuth = async (payload: PhoneAuthPayload) => {
    if (!isEligibleCountry(payload.country, payload.dialCode)) {
      throw new Error(
        "Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, la Côte d'Ivoire, le Sénégal et le Togo sont autorisés."
      );
    }
    const phoneCheck = validateEligiblePhone(payload.dialCode, payload.phone, payload.country);
    if (phoneCheck.ok === false) {
      throw new Error(phoneCheck.error);
    }

    if (isSupabaseConfigured && supabase) {
      const profile = await sbPhoneAuth(payload);
      const { data: sessionData } = await supabase.auth.getSession();
      setSbUser(sessionData.session?.user ?? null);
      setUserProfile(profile);
      setWdCountry(profile.withdrawalCountry || payload.country);
      setWdMethod(profile.withdrawalMethod || 'Orange Money Burkina');
      setWdAccount(profile.withdrawalAccount || profile.phone || '');
      setWdHolder(profile.withdrawalHolder || profile.displayName || '');
      setActiveTab('home');
      infoShownForSessionRef.current = profile.uid;
      setInfoPopupOpen(true);
      await refreshSupabaseState(profile, sessionData.session?.user?.email, true);
      showToast(
        payload.mode === 'register'
          ? profile.balance >= REGISTRATION_BONUS_CFA
            ? `Inscription réussie ! Bonus de bienvenue de ${formatCFA(REGISTRATION_BONUS_CFA)} crédité.`
            : 'Inscription réussie ! Bienvenue sur AURELIA MOBILE.'
          : isUniqueAdminPhone(profile.phone)
          ? 'Connexion administrateur réussie.'
          : 'Connexion réussie.'
      );
      return;
    }

    if (firebaseUser) {
      await signOutFirebase().catch(() => undefined);
      setFirebaseUser(null);
    }

    const dialCode = payload.dialCode.trim();
    const cleanPhone = phoneCheck.cleanDigits;
    const key = `${dialCode}_${cleanPhone}`;
    const fullPhone = phoneCheck.fullPhone;
    const accounts = loadAccounts();
    const isAdminCredential = isUniqueAdminPhone(fullPhone);
    const defaultMethod =
      COUNTRY_OPTIONS.find((c) => c.country === payload.country)?.methods[0] ||
      'Orange Money Burkina';

    if (payload.mode === 'register') {
      if (isAdminCredential) {
        throw new Error(
          "Ce numéro est réservé à l'administrateur unique. Veuillez vous connecter dans l'onglet Connexion."
        );
      }
      const uid = sanitizeId(`usr_${dialCode.replace(/\D/g, '')}_${cleanPhone.replace(/\D/g, '')}`);
      const existingByUid = Object.values(accounts).some((a) => a.profile.uid === uid);
      if (accounts[key] || existingByUid) {
        throw new Error('Ce numéro de téléphone est déjà inscrit. Veuillez vous connecter.');
      }
      const nowIso = new Date().toISOString();
      const referralCode = sanitizeId(
        `AM-${cleanPhone.replace(/\D/g, '').slice(-6).padStart(6, '0')}`
      );
      const rawInvite = payload.invitationCode.trim();
      const referredBy = rawInvite
        ? sanitizeId(rawInvite.toUpperCase())
        : localStorage.getItem(REF_UID_KEY) || '';

      const bonusTxId = sanitizeId(`tx_reg_bonus_${uid}`);
      const bonusTx: TransactionItem = {
        id: bonusTxId,
        userId: uid,
        userName: fullPhone,
        type: 'credit',
        amount: REGISTRATION_BONUS_CFA,
        method: "Bonus d'inscription",
        phoneOrAccount: fullPhone,
        reference: 'Bonus de bienvenue (nouvelle inscription)',
        status: 'completed',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const newProfile: UserProfile = {
        uid,
        email: `${dialCode.replace(/\D/g, '')}${cleanPhone.replace(/\D/g, '')}@aureliamobile.africa`,
        displayName: fullPhone,
        phone: fullPhone,
        withdrawalCountry: payload.country,
        withdrawalMethod: defaultMethod,
        withdrawalAccount: fullPhone,
        withdrawalHolder: fullPhone,
        balance: REGISTRATION_BONUS_CFA,
        totalInvested: 0,
        totalEarned: 0,
        referralCode,
        referredBy,
        referralBonus: 0,
        referralCount: 0,
        role: 'user',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (referredBy) {
        let cursorRef: string | undefined = referredBy;
        const visited = new Set<string>([key]);
        for (let lvl = 1; lvl <= 3 && cursorRef; lvl++) {
          const sponsor = Object.values(accounts).find((a) =>
            matchesReferralRef(a.profile, cursorRef)
          );
          if (!sponsor || visited.has(sponsor.key)) break;
          visited.add(sponsor.key);
          const alreadyHas = (sponsor.referrals || []).some((r) => r.referredUid === uid);
          if (!alreadyHas) {
            const refRecord: ReferralItem = {
              id: sanitizeId(`ref_${sponsor.profile.uid.slice(0, 14)}_${uid.slice(0, 14)}`),
              referrerUid: sponsor.profile.uid,
              referredUid: uid,
              referredName: cleanPhone,
              level: lvl,
              commissionEarned: 0,
              status: 'active',
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            sponsor.referrals = [refRecord, ...(sponsor.referrals || [])];
            sponsor.profile = {
              ...sponsor.profile,
              referralCount: sponsor.referrals.length,
            };
            accounts[sponsor.key] = sponsor;
          }
          cursorRef = sponsor.profile.referredBy;
        }
      }

      accounts[key] = {
        key,
        password: payload.password,
        profile: newProfile,
        investments: [],
        transactions: [bonusTx],
        referrals: [],
      };
      saveAccounts(accounts);
      setLocalSyncTick((t) => t + 1);
      localStorage.setItem(SESSION_KEY, key);
      setPhoneSessionKey(key);
      setUserProfile(newProfile);
      setInvestments([]);
      setTransactions([bonusTx]);
      setReferrals([]);
      setWdCountry(payload.country);
      setWdMethod(defaultMethod);
      setWdAccount(fullPhone);
      setWdHolder(fullPhone);
      setActiveTab('home');
      infoShownForSessionRef.current = newProfile.uid;
      setInfoPopupOpen(true);
      showToast(
        `Inscription réussie ! Bonus de bienvenue de ${formatCFA(REGISTRATION_BONUS_CFA)} crédité.`
      );
      return;
    }

    // Login mode
    const existing = accounts[key];
    if (existing) {
      if (existing.password !== payload.password) {
        throw new Error('Mot de passe incorrect. Veuillez vérifier votre saisie.');
      }
      const expectedRole: 'admin' | 'user' = isAdminCredential ? 'admin' : 'user';
      const nextProfile: UserProfile =
        existing.profile.role === expectedRole
          ? existing.profile
          : { ...existing.profile, role: expectedRole };
      if (nextProfile.role !== existing.profile.role) {
        accounts[key] = { ...existing, profile: nextProfile };
        saveAccounts(accounts);
      }
      setLocalSyncTick((t) => t + 1);
      localStorage.setItem(SESSION_KEY, key);
      setPhoneSessionKey(key);
      setUserProfile(nextProfile);
      setInvestments(existing.investments || []);
      setTransactions(existing.transactions || []);
      setReferrals(existing.referrals || []);
      setWdCountry(nextProfile.withdrawalCountry || payload.country);
      setWdMethod(nextProfile.withdrawalMethod || defaultMethod);
      setWdAccount(nextProfile.withdrawalAccount || fullPhone);
      setWdHolder(nextProfile.withdrawalHolder || fullPhone);
      setActiveTab('home');
      infoShownForSessionRef.current = nextProfile.uid;
      setInfoPopupOpen(true);
      showToast('Connexion réussie.');
      return;
    }

    // Admin unique login on a fresh device requires exact password Redbook@1
    if (isAdminCredential && payload.password !== DEFAULT_ADMIN_PASSWORD) {
      throw new Error('Mot de passe administrateur incorrect. Veuillez vérifier votre saisie.');
    }

    // Auto-create local profile on first sign-in (only user role unless unique admin verified above)
    const nowIso = new Date().toISOString();
    const uid = sanitizeId(`usr_${dialCode.replace(/\D/g, '')}_${cleanPhone.replace(/\D/g, '')}`);
    const referralCode = sanitizeId(
      `AM-${cleanPhone.replace(/\D/g, '').slice(-6).padStart(6, '0')}`
    );
    const createdProfile: UserProfile = {
      uid,
      email: `${dialCode.replace(/\D/g, '')}${cleanPhone.replace(/\D/g, '')}@aureliamobile.africa`,
      displayName: fullPhone,
      phone: fullPhone,
      withdrawalCountry: payload.country,
      withdrawalMethod: defaultMethod,
      withdrawalAccount: fullPhone,
      withdrawalHolder: fullPhone,
      balance: 0,
      totalInvested: 0,
      totalEarned: 0,
      referralCode,
      referredBy: '',
      referralBonus: 0,
      referralCount: 0,
      role: isAdminCredential ? 'admin' : 'user',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    accounts[key] = {
      key,
      password: payload.password,
      profile: createdProfile,
      investments: [],
      transactions: [],
      referrals: [],
    };
    saveAccounts(accounts);
    setLocalSyncTick((t) => t + 1);
    localStorage.setItem(SESSION_KEY, key);
    setPhoneSessionKey(key);
    setUserProfile(createdProfile);
    setInvestments([]);
    setTransactions([]);
    setReferrals([]);
    setWdCountry(payload.country);
    setWdMethod(defaultMethod);
    setWdAccount(fullPhone);
    setWdHolder(fullPhone);
    setActiveTab('home');
    infoShownForSessionRef.current = createdProfile.uid;
    setInfoPopupOpen(true);
    showToast(isAdminCredential ? 'Connexion administrateur réussie.' : 'Connexion réussie.');
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGooglePopup();
      showToast('Connexion Google réussie.');
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';
      if (code === 'auth/unauthorized-domain') {
        showToast(
          `Domaine non autorisé pour Google Auth (${window.location.hostname}). Ajoutez-le dans Firebase Console > Authentication > Domaines autorisés, ou utilisez le numéro administrateur (+226 77409899).`
        );
      } else {
        showToast('Connexion Google annulée ou indisponible.');
      }
    }
  };

  const handleLogout = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
      setSbUser(null);
    }
    localStorage.removeItem(SESSION_KEY);
    setPhoneSessionKey(null);
    if (firebaseUser) await signOutFirebase();
    setUserProfile(null);
    setInvestments([]);
    setTransactions([]);
    setReferrals([]);
    setCloudUsers([]);
    setCloudTransactions([]);
    setCloudInvestments([]);
    setCloudReferrals([]);
    infoShownForSessionRef.current = null;
    setInfoPopupOpen(false);
    setActiveTab('home');
    setAccountSubpage('menu');
    showToast('Vous êtes déconnecté.');
  };

  const initiateGatewayCheckout = async (params: {
    amount: number;
    method: string;
    phoneOrAccount: string;
    txId: string;
  }): Promise<{ checkoutUrl?: string; message?: string }> => {
    try {
      let authToken = '';
      if (isSupabaseConfigured && supabase) {
        const { data: sessionData } = await supabase.auth.getSession();
        authToken = sessionData.session?.access_token || '';
      }
      const res = await fetch('/api/deposit/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          amount: Math.round(params.amount),
          method: params.method,
          phoneOrAccount: params.phoneOrAccount,
          txId: params.txId,
          returnUrl: `${window.location.origin}/?deposit_return=1`,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string;
        message?: string;
      };
      if (res.ok && json.ok && json.checkoutUrl) {
        return { checkoutUrl: json.checkoutUrl };
      }
      return { message: json.message };
    } catch {
      return {};
    }
  };

  const handleDeposit = async (
    amount: number,
    method: string,
    phoneOrAccount: string,
    instantCredit: boolean
  ): Promise<{ checkoutUrl?: string; message?: string } | void> => {
    if (!userProfile) throw new Error('Veuillez vous connecter pour confirmer votre recharge.');
    if (isSupabaseConfigured && supabase) {
      const createdTxId = await sbCreateDeposit(amount, method, phoneOrAccount);
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      const gateway = await initiateGatewayCheckout({
        amount,
        method,
        phoneOrAccount,
        txId: createdTxId || `dep_${Date.now()}`,
      });
      if (gateway.checkoutUrl) {
        return { checkoutUrl: gateway.checkoutUrl };
      }
      showToast(
        gateway.message ||
          `Demande de dépôt de ${formatCFA(amount)} enregistrée (en attente de validation).`
      );
      return;
    }
    const txId = sanitizeId(`tx_dep_${Date.now()}_${userProfile.uid.slice(0, 6)}`);
    const status: TransactionStatus = instantCredit ? 'completed' : 'pending';

    if (!firebaseUser && phoneSessionKey) {
      const nowIso = new Date().toISOString();
      const tx: TransactionItem = {
        id: txId,
        userId: userProfile.uid,
        userName: userProfile.displayName,
        type: 'deposit',
        amount: Math.round(amount),
        method: clampStr(method, 2, 60),
        phoneOrAccount: clampStr(phoneOrAccount, 2, 80),
        reference: clampStr(`DEP-${Date.now().toString().slice(-6)}`, 2, 100),
        status,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      mutateLocalAccount((rec) => ({
        ...rec,
        profile: {
          ...rec.profile,
          balance: instantCredit ? Math.round(rec.profile.balance + amount) : rec.profile.balance,
          updatedAt: nowIso,
        },
        transactions: [tx, ...rec.transactions],
      }));
      const gateway = await initiateGatewayCheckout({
        amount,
        method,
        phoneOrAccount,
        txId,
      });
      if (gateway.checkoutUrl) {
        return { checkoutUrl: gateway.checkoutUrl };
      }
      showToast(
        instantCredit
          ? `Solde crédité de ${formatCFA(amount)}.`
          : `Demande de dépôt de ${formatCFA(amount)} enregistrée.`
      );
      return;
    }

    if (!firebaseUser) throw new Error('Veuillez vous connecter pour confirmer votre recharge.');
    try {
      await setDoc(doc(db, 'transactions', txId), {
        id: txId,
        userId: sanitizeId(firebaseUser.uid),
        userName: clampStr(userProfile.displayName, 1, 100),
        type: 'deposit',
        amount: Math.round(amount),
        method: clampStr(method, 2, 60),
        phoneOrAccount: clampStr(phoneOrAccount, 2, 80),
        reference: clampStr(`DEP-${Date.now().toString().slice(-6)}`, 2, 100),
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      if (instantCredit) {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          balance: Math.round(userProfile.balance + amount),
          updatedAt: serverTimestamp(),
        });
      }
      showToast(
        instantCredit
          ? `Solde crédité de ${formatCFA(amount)}.`
          : `Demande de dépôt de ${formatCFA(amount)} enregistrée.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `transactions/${txId}`);
    }
  };

  const handleWithdraw = async (amount: number, method: string, account: string) => {
    if (!userProfile) throw new Error('Veuillez vous connecter pour confirmer votre retrait.');
    if (amount > userProfile.balance) throw new Error('Solde disponible insuffisant.');
    if (isSupabaseConfigured && supabase) {
      await sbRequestWithdrawal(amount, method, account);
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        const updatedProf = await sbEnsureProfileForAuthUser(
          sessionData.session.user.id,
          sessionData.session.user.email || userProfile.email
        );
        setUserProfile(updatedProf);
        await refreshSupabaseState(updatedProf, sessionData.session.user.email, true);
      }
      showToast(`Demande de retrait de ${formatCFA(amount)} enregistrée.`);
      return;
    }
    const txId = sanitizeId(`tx_wit_${Date.now()}_${userProfile.uid.slice(0, 6)}`);

    if (!firebaseUser && phoneSessionKey) {
      const nowIso = new Date().toISOString();
      const tx: TransactionItem = {
        id: txId,
        userId: userProfile.uid,
        userName: userProfile.displayName,
        type: 'withdrawal',
        amount: Math.round(amount),
        method: clampStr(method, 2, 60),
        phoneOrAccount: clampStr(account, 2, 80),
        reference: clampStr(`RET-${Date.now().toString().slice(-6)}`, 2, 100),
        status: 'pending',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      mutateLocalAccount((rec) => ({
        ...rec,
        profile: {
          ...rec.profile,
          balance: Math.max(0, Math.round(rec.profile.balance - amount)),
          updatedAt: nowIso,
        },
        transactions: [tx, ...rec.transactions],
      }));
      showToast(`Demande de retrait de ${formatCFA(amount)} enregistrée.`);
      return;
    }

    if (!firebaseUser) throw new Error('Veuillez vous connecter pour confirmer votre retrait.');
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        balance: Math.max(0, Math.round(userProfile.balance - amount)),
        updatedAt: serverTimestamp(),
      });
      await setDoc(doc(db, 'transactions', txId), {
        id: txId,
        userId: sanitizeId(firebaseUser.uid),
        userName: clampStr(userProfile.displayName, 1, 100),
        type: 'withdrawal',
        amount: Math.round(amount),
        method: clampStr(method, 2, 60),
        phoneOrAccount: clampStr(account, 2, 80),
        reference: clampStr(`RET-${Date.now().toString().slice(-6)}`, 2, 100),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(`Demande de retrait de ${formatCFA(amount)} enregistrée.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `transactions/${txId}`);
    }
  };

  const handlePurchaseVip = async (project: ProjectItem, quantity = 1) => {
    if (!userProfile) throw new Error('Veuillez vous connecter pour acheter ce produit VIP.');
    const qty = Math.max(1, Math.min(20, Math.round(quantity)));
    const unitPrice = project.minInvestment;
    const unitDaily = getProjectDailyIncome(project);
    const durationDays = project.durationDays || 90;
    const totalCost = unitPrice * qty;
    if (totalCost > userProfile.balance) throw new Error('Solde disponible insuffisant.');

    if (isSupabaseConfigured && supabase) {
      await sbPurchaseVip(project.id, qty);
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        const updatedProf = await sbEnsureProfileForAuthUser(
          sessionData.session.user.id,
          sessionData.session.user.email || userProfile.email
        );
        setUserProfile(updatedProf);
        await refreshSupabaseState(updatedProf, sessionData.session.user.email, true);
      }
      showToast(
        `${qty > 1 ? `${qty}x ` : ''}${project.title} activé (${formatCFA(unitDaily * qty)}/jour pendant ${durationDays}j).`
      );
      return;
    }

    const nowMs = Date.now();

    if (!firebaseUser && phoneSessionKey) {
      const nowIso = new Date(nowMs).toISOString();
      const newContracts: InvestmentItem[] = [];
      for (let i = 0; i < qty; i++) {
        newContracts.push({
          id: sanitizeId(`vipinv_${nowMs}_${i}_${userProfile.uid.slice(0, 6)}`),
          userId: userProfile.uid,
          userName: userProfile.displayName,
          projectId: project.id,
          projectTitle: project.title,
          projectCategory: project.category,
          amount: Math.round(unitPrice),
          dailyIncome: Math.round(unitDaily),
          returnRate: project.returnRate,
          expectedProfit: Math.round(unitDaily * durationDays),
          durationDays,
          daysCredited: 0,
          totalEarnedSoFar: 0,
          purchasedAtMs: nowMs,
          status: 'active',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      const tx: TransactionItem = {
        id: sanitizeId(`tx_vip_${nowMs}_${userProfile.uid.slice(0, 6)}`),
        userId: userProfile.uid,
        userName: userProfile.displayName,
        type: 'investment',
        amount: Math.round(totalCost),
        method: 'Solde AURELIA MOBILE',
        phoneOrAccount: userProfile.referralCode,
        reference: clampStr(
          `Achat ${qty > 1 ? `${qty}x ` : ''}${project.title} (${formatCFA(unitDaily * qty)}/j)`,
          2,
          100
        ),
        status: 'completed',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      mutateLocalAccount((rec) => ({
        ...rec,
        profile: {
          ...rec.profile,
          balance: Math.max(0, Math.round(rec.profile.balance - totalCost)),
          totalInvested: Math.round(rec.profile.totalInvested + totalCost),
          updatedAt: nowIso,
        },
        investments: [...newContracts, ...rec.investments],
        transactions: [tx, ...rec.transactions],
      }));

      // Distribute 3-level referral cashbacks (30%, 2%, 1%) in local accounts
      if (userProfile.referredBy) {
        const accounts = loadAccounts();
        const rates = [0.3, 0.02, 0.01];
        let currentRefCode: string | undefined = userProfile.referredBy;
        for (let lvl = 0; lvl < 3 && currentRefCode; lvl++) {
          const sponsor = Object.values(accounts).find((a) =>
            matchesReferralRef(a.profile, currentRefCode)
          );
          if (!sponsor || sponsor.key === phoneSessionKey) break;
          const bonus = Math.round(totalCost * rates[lvl]);
          if (bonus > 0) {
            const refTx: TransactionItem = {
              id: sanitizeId(`tx_ref_${nowMs}_l${lvl + 1}_${sponsor.profile.uid.slice(0, 6)}`),
              userId: sponsor.profile.uid,
              userName: sponsor.profile.displayName,
              type: 'referral',
              amount: bonus,
              method: `Cashback Équipe Niveau ${lvl + 1}`,
              phoneOrAccount: userProfile.phone,
              reference: clampStr(`Commission ${rates[lvl] * 100}% sur ${project.title}`, 2, 100),
              status: 'completed',
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            const existingRef = (sponsor.referrals || []).find(
              (r) => r.referredUid === userProfile.uid
            );
            const updatedRefs: ReferralItem[] = existingRef
              ? sponsor.referrals.map((r) =>
                  r.referredUid === userProfile.uid
                    ? {
                        ...r,
                        commissionEarned: Math.round((r.commissionEarned || 0) + bonus),
                        status: 'rewarded' as const,
                        updatedAt: nowIso,
                      }
                    : r
                )
              : [
                  {
                    id: sanitizeId(
                      `ref_${sponsor.profile.uid.slice(0, 12)}_${userProfile.uid.slice(0, 12)}`
                    ),
                    referrerUid: sponsor.profile.uid,
                    referredUid: userProfile.uid,
                    referredName: userProfile.phone,
                    level: lvl + 1,
                    commissionEarned: bonus,
                    status: 'rewarded',
                    createdAt: nowIso,
                    updatedAt: nowIso,
                  },
                  ...(sponsor.referrals || []),
                ];
            accounts[sponsor.key] = {
              ...sponsor,
              profile: {
                ...sponsor.profile,
                balance: Math.round(sponsor.profile.balance + bonus),
                referralBonus: Math.round((sponsor.profile.referralBonus || 0) + bonus),
                updatedAt: nowIso,
              },
              referrals: updatedRefs,
              transactions: [refTx, ...(sponsor.transactions || [])],
            };
          }
          currentRefCode = sponsor.profile.referredBy;
        }
        saveAccounts(accounts);
      }

      showToast(
        `${qty > 1 ? `${qty}x ` : ''}${project.title} activé (${formatCFA(unitDaily * qty)}/jour pendant ${durationDays}j).`
      );
      return;
    }

    if (!firebaseUser) throw new Error('Veuillez vous connecter pour acheter ce produit VIP.');
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        balance: Math.max(0, Math.round(userProfile.balance - totalCost)),
        totalInvested: Math.round(userProfile.totalInvested + totalCost),
        updatedAt: serverTimestamp(),
      });
      for (let i = 0; i < qty; i++) {
        const invId = sanitizeId(`vipinv_${nowMs}_${i}_${firebaseUser.uid.slice(0, 6)}`);
        await setDoc(doc(db, 'investments', invId), {
          id: invId,
          userId: sanitizeId(firebaseUser.uid),
          userName: clampStr(userProfile.displayName, 1, 100),
          projectId: sanitizeId(project.id),
          projectTitle: clampStr(project.title, 2, 120),
          projectCategory: clampStr(project.category, 2, 60),
          amount: Math.round(unitPrice),
          dailyIncome: Math.round(unitDaily),
          returnRate: project.returnRate,
          expectedProfit: Math.round(unitDaily * durationDays),
          durationDays,
          daysCredited: 0,
          totalEarnedSoFar: 0,
          purchasedAtMs: nowMs,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      const txId = sanitizeId(`tx_vip_${nowMs}_${firebaseUser.uid.slice(0, 6)}`);
      await setDoc(doc(db, 'transactions', txId), {
        id: txId,
        userId: sanitizeId(firebaseUser.uid),
        userName: clampStr(userProfile.displayName, 1, 100),
        type: 'investment',
        amount: Math.round(totalCost),
        method: 'Solde AURELIA MOBILE',
        phoneOrAccount: userProfile.referralCode,
        reference: clampStr(
          `Achat ${qty > 1 ? `${qty}x ` : ''}${project.title} (${formatCFA(unitDaily * qty)}/j)`,
          2,
          100
        ),
        status: 'completed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(
        `${qty > 1 ? `${qty}x ` : ''}${project.title} activé (${formatCFA(unitDaily * qty)}/jour pendant ${durationDays}j).`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'investments');
    }
  };

  const handleSaveWithdrawalAccount = async (e: FormEvent) => {
    e.preventDefault();
    if (wdAccount.trim().length < 5) {
      showToast('Veuillez saisir un numéro ou compte de retrait valide.');
      return;
    }
    if (isSupabaseConfigured && supabase && userProfile) {
      setSavingWd(true);
      try {
        await sbSaveWithdrawalAccount(userProfile.uid, {
          country: wdCountry,
          method: wdMethod,
          account: wdAccount.trim(),
          holder: wdHolder.trim() || userProfile.displayName,
        });
        setUserProfile({
          ...userProfile,
          withdrawalCountry: wdCountry,
          withdrawalMethod: wdMethod,
          withdrawalAccount: wdAccount.trim(),
          withdrawalHolder: wdHolder.trim() || userProfile.displayName,
          phone: wdAccount.trim() || userProfile.phone,
        });
        showToast('Votre compte de retrait a été enregistré.');
        setShowWdForm(false);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
      } finally {
        setSavingWd(false);
      }
      return;
    }
    if (!firebaseUser && phoneSessionKey && userProfile) {
      const nowIso = new Date().toISOString();
      mutateLocalAccount((rec) => ({
        ...rec,
        profile: {
          ...rec.profile,
          withdrawalCountry: clampStr(wdCountry, 2, 60),
          withdrawalMethod: clampStr(wdMethod, 2, 60),
          withdrawalAccount: clampStr(wdAccount.trim(), 4, 80),
          withdrawalHolder: clampStr(wdHolder.trim() || rec.profile.displayName, 2, 100),
          phone: clampStr(wdAccount.trim(), 0, 30, rec.profile.phone),
          updatedAt: nowIso,
        },
      }));
      showToast('Votre compte de retrait a été enregistré.');
      setShowWdForm(false);
      return;
    }
    if (!firebaseUser || !userProfile) {
      showToast('Compte de retrait enregistré sur votre appareil.');
      setShowWdForm(false);
      return;
    }
    setSavingWd(true);
    try {
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        withdrawalCountry: clampStr(wdCountry, 2, 60),
        withdrawalMethod: clampStr(wdMethod, 2, 60),
        withdrawalAccount: clampStr(wdAccount.trim(), 4, 80),
        withdrawalHolder: clampStr(wdHolder.trim() || userProfile.displayName, 2, 100),
        phone: clampStr(wdAccount.trim(), 0, 30, userProfile.phone),
        updatedAt: serverTimestamp(),
      });
      showToast('Votre compte de retrait a été enregistré.');
      setShowWdForm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${firebaseUser.uid}`);
    } finally {
      setSavingWd(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);
    if (newPassword.length < 6) {
      setPasswordFeedback({
        type: 'error',
        text: 'Le nouveau mot de passe doit contenir au moins 6 caractères.',
      });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordFeedback({
        type: 'error',
        text: 'Les deux mots de passe ne correspondent pas.',
      });
      return;
    }
    if (isSupabaseConfigured && supabase) {
      setSavingPassword(true);
      try {
        await sbChangePassword(newPassword);
        setNewPassword('');
        setConfirmNewPassword('');
        setPasswordFeedback({
          type: 'success',
          text: 'Votre mot de passe a été modifié avec succès.',
        });
        showToast('Mot de passe mis à jour.');
      } catch (err) {
        setPasswordFeedback({
          type: 'error',
          text: err instanceof Error ? err.message : 'Erreur lors de la modification.',
        });
      } finally {
        setSavingPassword(false);
      }
      return;
    }
    if (!firebaseUser && phoneSessionKey) {
      mutateLocalAccount((rec) => ({ ...rec, password: newPassword }));
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordFeedback({
        type: 'success',
        text: 'Votre mot de passe a été modifié avec succès.',
      });
      showToast('Mot de passe mis à jour.');
      return;
    }
    if (firebaseUser) {
      setSavingPassword(true);
      try {
        await updatePassword(firebaseUser, newPassword);
        setNewPassword('');
        setConfirmNewPassword('');
        setPasswordFeedback({
          type: 'success',
          text: 'Votre mot de passe a été modifié avec succès.',
        });
        showToast('Mot de passe mis à jour.');
      } catch {
        if (firebaseUser.email) {
          try {
            await sendPasswordResetEmail(auth, firebaseUser.email);
            setPasswordFeedback({
              type: 'success',
              text: `Un lien sécurisé de modification de mot de passe a été envoyé à ${firebaseUser.email}.`,
            });
          } catch {
            setPasswordFeedback({
              type: 'error',
              text: 'Pour modifier votre mot de passe, veuillez vous reconnecter puis réessayer.',
            });
          }
        }
      } finally {
        setSavingPassword(false);
      }
    }
  };

  const handleSendPasswordReset = async () => {
    if (!firebaseUser?.email) return;
    setSavingPassword(true);
    setPasswordFeedback(null);
    try {
      await sendPasswordResetEmail(auth, firebaseUser.email);
      setPasswordFeedback({
        type: 'success',
        text: `Un email de réinitialisation de mot de passe a été envoyé à ${firebaseUser.email}.`,
      });
    } catch {
      setPasswordFeedback({
        type: 'error',
        text: "Impossible d'envoyer l'email pour le moment. Veuillez réessayer plus tard.",
      });
    } finally {
      setSavingPassword(false);
    }
  };

  // Daily check-in (Pointage 30 F CFA / 24h, strictly no double credit)
  useEffect(() => {
    if (activeTab !== 'checkin') return;
    setCheckinNowMs(Date.now());
    const id = window.setInterval(() => setCheckinNowMs(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [activeTab]);

  const lastCheckinMs = useMemo(() => {
    let best = 0;
    if (userProfile?.lastCheckinAt) {
      const parsed = Date.parse(userProfile.lastCheckinAt);
      if (!Number.isNaN(parsed)) best = Math.max(best, parsed);
    }
    transactions.forEach((tx) => {
      if (tx.id.startsWith('tx_checkin_') || tx.method === 'Pointage quotidien 24h') {
        const raw = tx.createdAt as { toMillis?: () => number } | string | undefined;
        if (raw && typeof raw === 'object' && typeof raw.toMillis === 'function') {
          best = Math.max(best, raw.toMillis());
        } else if (typeof raw === 'string') {
          const parsed = Date.parse(raw);
          if (!Number.isNaN(parsed)) best = Math.max(best, parsed);
        }
      }
    });
    return best;
  }, [userProfile?.lastCheckinAt, transactions]);

  const checkinRemainingMs =
    lastCheckinMs > 0
      ? Math.max(0, lastCheckinMs + DAILY_CHECKIN_COOLDOWN_MS - checkinNowMs)
      : 0;

  const handleClaimDailyCheckin = async () => {
    if (!userProfile || checkinLockRef.current || claimingCheckin) return;
    checkinLockRef.current = true;
    setClaimingCheckin(true);
    try {
      const nowMs = Date.now();
      setCheckinNowMs(nowMs);
      if (lastCheckinMs > 0 && nowMs - lastCheckinMs < DAILY_CHECKIN_COOLDOWN_MS) {
        const left = lastCheckinMs + DAILY_CHECKIN_COOLDOWN_MS - nowMs;
        showToast(`Pointage déjà effectué. Revenez dans ${formatCountdownHhMm(left)}.`);
        return;
      }

      if (isSupabaseConfigured && supabase) {
        const res = await sbClaimDailyCheckin();
        setUserProfile((prev) =>
          prev
            ? {
                ...prev,
                balance: Math.round((prev.balance || 0) + res.amount),
                lastCheckinAt: res.lastCheckinAt,
                checkinDays: res.checkinDays,
                checkinTotal: res.checkinTotal,
              }
            : prev
        );
        await refreshSupabaseState(userProfile, sbUser?.email, true);
        showToast(`+${formatCFA(res.amount)} crédités ! Pointage validé pour 24h.`);
        return;
      }

      const nowIso = new Date(nowMs).toISOString();
      const nextDays = Math.max(0, Math.round(userProfile.checkinDays || 0)) + 1;
      const nextTotal =
        Math.max(0, Math.round(userProfile.checkinTotal || 0)) + DAILY_CHECKIN_BONUS_CFA;
      const txId = sanitizeId(`tx_checkin_${userProfile.uid}_d${nextDays}`);

      if (!firebaseUser && phoneSessionKey) {
        const accounts = loadAccounts();
        const rec = accounts[phoneSessionKey];
        if (!rec) throw new Error('Session introuvable.');
        const existingLast = rec.profile.lastCheckinAt ? Date.parse(rec.profile.lastCheckinAt) : 0;
        if (existingLast > 0 && nowMs - existingLast < DAILY_CHECKIN_COOLDOWN_MS) {
          throw new Error(
            `Pointage déjà effectué. Prochain pointage dans ${formatCountdownHhMm(
              existingLast + DAILY_CHECKIN_COOLDOWN_MS - nowMs
            )}.`
          );
        }
        if ((rec.transactions || []).some((t) => t.id === txId)) {
          throw new Error('Récompense déjà créditée pour ce cycle.');
        }

        const checkinTx: TransactionItem = {
          id: txId,
          userId: userProfile.uid,
          userName: userProfile.displayName,
          type: 'credit',
          amount: DAILY_CHECKIN_BONUS_CFA,
          method: 'Pointage quotidien 24h',
          phoneOrAccount: userProfile.phone || userProfile.referralCode,
          reference: clampStr(`Bonus connexion quotidienne · Jour ${nextDays}`, 2, 100),
          status: 'completed',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        mutateLocalAccount((cur) => ({
          ...cur,
          profile: {
            ...cur.profile,
            balance: Math.round((cur.profile.balance || 0) + DAILY_CHECKIN_BONUS_CFA),
            lastCheckinAt: nowIso,
            checkinDays: nextDays,
            checkinTotal: nextTotal,
            updatedAt: nowIso,
          },
          transactions: [checkinTx, ...(cur.transactions || [])],
        }));
        showToast(
          `+${formatCFA(DAILY_CHECKIN_BONUS_CFA)} crédités ! Pointage validé pour 24h.`
        );
        return;
      }

      if (firebaseUser) {
        const existingTx = await getDoc(doc(db, 'transactions', txId));
        if (existingTx.exists()) {
          throw new Error('Récompense déjà créditée pour ce cycle.');
        }
        await setDoc(doc(db, 'transactions', txId), {
          id: txId,
          userId: sanitizeId(firebaseUser.uid),
          userName: clampStr(userProfile.displayName, 1, 100),
          type: 'credit',
          amount: DAILY_CHECKIN_BONUS_CFA,
          method: 'Pointage quotidien 24h',
          phoneOrAccount: userProfile.phone || userProfile.referralCode,
          reference: clampStr(`Bonus connexion quotidienne · Jour ${nextDays}`, 2, 100),
          status: 'completed',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          balance: Math.round((userProfile.balance || 0) + DAILY_CHECKIN_BONUS_CFA),
          lastCheckinAt: nowIso,
          checkinDays: nextDays,
          checkinTotal: nextTotal,
          updatedAt: serverTimestamp(),
        });
        showToast(
          `+${formatCFA(DAILY_CHECKIN_BONUS_CFA)} crédités ! Pointage validé pour 24h.`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erreur lors du pointage quotidien.');
    } finally {
      checkinLockRef.current = false;
      setClaimingCheckin(false);
    }
  };

  // Gift code redemption (random 10 to 100 F CFA, strictly 1 use per account per code)
  const handleRedeemGiftCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!userProfile || giftCodeLockRef.current || redeemingGiftCode) return;
    setGiftCodeFeedback(null);
    const normalized = giftCodeInput
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    if (normalized.length < 3) {
      setGiftCodeFeedback({
        type: 'error',
        text: 'Veuillez saisir un code cadeau valide.',
      });
      return;
    }

    giftCodeLockRef.current = true;
    setRedeemingGiftCode(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const res = await sbRedeemGiftCode(normalized);
        setGiftCodeInput('');
        setUserProfile((prev) =>
          prev
            ? { ...prev, balance: Math.round((prev.balance || 0) + res.amount) }
            : prev
        );
        setGiftCodeFeedback({
          type: 'success',
          text: `Félicitations ! +${formatCFA(res.amount)} crédités sur votre solde (Code ${res.code}).`,
        });
        await refreshSupabaseState(userProfile, sbUser?.email, true);
        showToast(`+${formatCFA(res.amount)} crédités grâce au code ${res.code} !`);
        return;
      }

      const codes = loadLocalGiftCodes();
      const targetCode = codes.find((c) => c.code.trim().toUpperCase() === normalized);
      if (!targetCode) {
        throw new Error('Code cadeau introuvable. Vérifiez le code dans le groupe Telegram.');
      }
      if (!targetCode.isActive) {
        throw new Error("Ce code cadeau n'est plus actif.");
      }
      if (targetCode.maxUses > 0 && targetCode.usesCount >= targetCode.maxUses) {
        throw new Error("Ce code cadeau a atteint sa limite d'utilisations.");
      }

      const redemptionsMap = loadLocalGiftRedemptions();
      const userRedeemed = redemptionsMap[userProfile.uid] || [];
      const txId = sanitizeId(`tx_giftcode_${userProfile.uid.slice(0, 12)}_${normalized}`);

      if (
        userRedeemed.includes(normalized) ||
        transactions.some((t) => t.id === txId)
      ) {
        throw new Error('Vous avez déjà utilisé ce code cadeau. Aucun double crédit autorisé.');
      }

      const minAmt = Math.max(GIFT_CODE_MIN_CFA, Math.min(GIFT_CODE_MAX_CFA, targetCode.minAmount || GIFT_CODE_MIN_CFA));
      const maxAmt = Math.max(minAmt, Math.min(GIFT_CODE_MAX_CFA, targetCode.maxAmount || GIFT_CODE_MAX_CFA));
      const randomAmount = minAmt + Math.floor(Math.random() * (maxAmt - minAmt + 1));
      const nowIso = new Date().toISOString();

      if (!firebaseUser && phoneSessionKey) {
        const giftTx: TransactionItem = {
          id: txId,
          userId: userProfile.uid,
          userName: userProfile.displayName,
          type: 'credit',
          amount: randomAmount,
          method: 'Code cadeau',
          phoneOrAccount: normalized,
          reference: clampStr(`Code cadeau ${normalized} (+${randomAmount} F CFA)`, 2, 100),
          status: 'completed',
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        const updatedCodes = codes.map((c) =>
          c.code.trim().toUpperCase() === normalized
            ? { ...c, usesCount: (c.usesCount || 0) + 1 }
            : c
        );
        saveLocalGiftCodes(updatedCodes);
        setCloudGiftCodes(updatedCodes);
        redemptionsMap[userProfile.uid] = [...userRedeemed, normalized];
        saveLocalGiftRedemptions(redemptionsMap);

        mutateLocalAccount((cur) => ({
          ...cur,
          profile: {
            ...cur.profile,
            balance: Math.round((cur.profile.balance || 0) + randomAmount),
            updatedAt: nowIso,
          },
          transactions: [giftTx, ...(cur.transactions || [])],
        }));

        setGiftCodeInput('');
        setGiftCodeFeedback({
          type: 'success',
          text: `Félicitations ! +${formatCFA(randomAmount)} crédités sur votre solde (Code ${normalized}).`,
        });
        showToast(`+${formatCFA(randomAmount)} crédités grâce au code ${normalized} !`);
        return;
      }

      if (firebaseUser) {
        const existingTx = await getDoc(doc(db, 'transactions', txId));
        if (existingTx.exists()) {
          throw new Error('Vous avez déjà utilisé ce code cadeau. Aucun double crédit autorisé.');
        }
        await setDoc(doc(db, 'transactions', txId), {
          id: txId,
          userId: sanitizeId(firebaseUser.uid),
          userName: clampStr(userProfile.displayName, 1, 100),
          type: 'credit',
          amount: randomAmount,
          method: 'Code cadeau',
          phoneOrAccount: normalized,
          reference: clampStr(`Code cadeau ${normalized} (+${randomAmount} F CFA)`, 2, 100),
          status: 'completed',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          balance: Math.round((userProfile.balance || 0) + randomAmount),
          updatedAt: serverTimestamp(),
        });
        const updatedCodes = codes.map((c) =>
          c.code.trim().toUpperCase() === normalized
            ? { ...c, usesCount: (c.usesCount || 0) + 1 }
            : c
        );
        saveLocalGiftCodes(updatedCodes);
        setCloudGiftCodes(updatedCodes);
        redemptionsMap[userProfile.uid] = [...userRedeemed, normalized];
        saveLocalGiftRedemptions(redemptionsMap);
        setGiftCodeInput('');
        setGiftCodeFeedback({
          type: 'success',
          text: `Félicitations ! +${formatCFA(randomAmount)} crédités sur votre solde (Code ${normalized}).`,
        });
        showToast(`+${formatCFA(randomAmount)} crédités grâce au code ${normalized} !`);
      }
    } catch (err) {
      setGiftCodeFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Impossible de valider ce code cadeau.',
      });
    } finally {
      giftCodeLockRef.current = false;
      setRedeemingGiftCode(false);
    }
  };

  const handleAdminSaveGiftCode = async (item: GiftCodeItem) => {
    const cleanCode = item.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '');
    if (cleanCode.length < 3) {
      throw new Error('Le code cadeau doit contenir au moins 3 caractères.');
    }
    const minAmt = Math.max(GIFT_CODE_MIN_CFA, Math.min(GIFT_CODE_MAX_CFA, Math.round(item.minAmount || GIFT_CODE_MIN_CFA)));
    const maxAmt = Math.max(minAmt, Math.min(GIFT_CODE_MAX_CFA, Math.round(item.maxAmount || GIFT_CODE_MAX_CFA)));
    const normalizedItem: GiftCodeItem = {
      code: cleanCode,
      minAmount: minAmt,
      maxAmount: maxAmt,
      maxUses: Math.max(1, Math.round(item.maxUses || 500)),
      usesCount: Math.max(0, Math.round(item.usesCount || 0)),
      isActive: item.isActive,
      createdAt: item.createdAt || new Date().toISOString(),
    };

    if (isSupabaseConfigured && supabase) {
      await sbAdminUpsertGiftCode(normalizedItem);
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      return;
    }

    const current = loadLocalGiftCodes();
    const exists = current.some((c) => c.code.toUpperCase() === cleanCode);
    const updated = exists
      ? current.map((c) =>
          c.code.toUpperCase() === cleanCode
            ? { ...c, ...normalizedItem, usesCount: c.usesCount }
            : c
        )
      : [normalizedItem, ...current];
    saveLocalGiftCodes(updated);
    setCloudGiftCodes(updated);
  };

  // Admin handlers
  const handleAdminSaveProject = async (proj: ProjectItem, isNew: boolean) => {
    const id = sanitizeId(proj.id);
    const daily = Math.max(50, Number(proj.dailyIncome || getProjectDailyIncome(proj)));
    const nowIso = new Date().toISOString();
    const cleaned: ProjectItem = {
      id,
      title: clampStr(proj.title, 2, 120),
      category: clampStr(proj.category, 2, 60),
      description: clampStr(proj.description, 5, 1000),
      location: clampStr(proj.location, 2, 100),
      imageUrl: clampStr(proj.imageUrl, 1, 500),
      returnRate: Math.max(1, Math.min(5000, Number(proj.returnRate))),
      durationDays: Math.max(1, Math.min(3650, Number(proj.durationDays))),
      minInvestment: Math.max(500, Number(proj.minInvestment)),
      dailyIncome: daily,
      targetAmount: Math.max(1000, Number(proj.targetAmount)),
      raisedAmount: Math.max(0, Number(proj.raisedAmount)),
      investorsCount: Math.max(0, Number(proj.investorsCount)),
      status: proj.status,
      visibility: proj.visibility,
      updatedAt: nowIso,
    };

    const nextList = isNew
      ? [...projects, { ...cleaned, createdAt: nowIso }]
      : projects.some((p) => p.id === id)
      ? projects.map((p) => (p.id === id ? { ...p, ...cleaned } : p))
      : [...projects, { ...cleaned, createdAt: nowIso }];
    nextList.sort((a, b) => a.minInvestment - b.minInvestment);
    setProjects(nextList);
    saveLocalProjects(nextList);

    if (isSupabaseConfigured && supabase) {
      await sbAdminSaveProject(cleaned);
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      return;
    }

    if (!firebaseUser) return;
    try {
      const ref = doc(db, 'projects', id);
      const payload = { ...cleaned, updatedAt: serverTimestamp() };
      if (isNew || !(await getDoc(ref)).exists()) {
        await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
      } else {
        await updateDoc(ref, payload);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `projects/${id}`);
    }
  };

  const handleAdminSyncOfficialCatalog = async () => {
    setProjects(OFFICIAL_VIP_CATALOG);
    saveLocalProjects(OFFICIAL_VIP_CATALOG);
    if (isSupabaseConfigured && supabase) {
      await sbAdminSyncOfficialCatalog();
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      return;
    }
    if (!firebaseUser) return;
    try {
      for (const item of OFFICIAL_VIP_CATALOG) {
        const ref = doc(db, 'projects', item.id);
        if ((await getDoc(ref)).exists()) {
          await updateDoc(ref, { ...item, updatedAt: serverTimestamp() });
        } else {
          await setDoc(ref, {
            ...item,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'projects');
    }
  };

  const handleAdminProcessTransaction = async (
    tx: TransactionItem,
    nextStatus: 'approved' | 'rejected'
  ) => {
    if (isSupabaseConfigured && supabase) {
      await sbAdminProcessTransaction(tx.id, nextStatus);
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      return;
    }
    const accounts = loadAccounts();
    const targetAcc = Object.values(accounts).find((a) => a.profile.uid === tx.userId);
    if (targetAcc) {
      const nowIso = new Date().toISOString();
      let nextBal = targetAcc.profile.balance;
      if (tx.type === 'deposit' && tx.status === 'pending' && nextStatus === 'approved') {
        nextBal = Math.round(nextBal + tx.amount);
      }
      if (tx.type === 'withdrawal' && tx.status === 'pending' && nextStatus === 'rejected') {
        nextBal = Math.round(nextBal + tx.amount);
      }
      const nextTxs = (targetAcc.transactions || []).map((t) =>
        t.id === tx.id ? { ...t, status: nextStatus, updatedAt: nowIso } : t
      );
      const updatedAcc: PhoneAccountRecord = {
        ...targetAcc,
        profile: { ...targetAcc.profile, balance: nextBal, updatedAt: nowIso },
        transactions: nextTxs,
      };
      accounts[targetAcc.key] = updatedAcc;
      saveAccounts(accounts);
      setLocalSyncTick((t) => t + 1);
      if (phoneSessionKey === targetAcc.key) {
        setUserProfile(updatedAcc.profile);
        setTransactions(updatedAcc.transactions);
      }
    }

    if (firebaseUser) {
      try {
        await updateDoc(doc(db, 'transactions', tx.id), {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        });
        const uSnap = await getDoc(doc(db, 'users', tx.userId));
        if (uSnap.exists()) {
          const uData = uSnap.data() as UserProfile;
          if (tx.type === 'deposit' && tx.status === 'pending' && nextStatus === 'approved') {
            await updateDoc(doc(db, 'users', tx.userId), {
              balance: Math.round(uData.balance + tx.amount),
              updatedAt: serverTimestamp(),
            });
          }
          if (tx.type === 'withdrawal' && tx.status === 'pending' && nextStatus === 'rejected') {
            await updateDoc(doc(db, 'users', tx.userId), {
              balance: Math.round(uData.balance + tx.amount),
              updatedAt: serverTimestamp(),
            });
          }
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `transactions/${tx.id}`);
      }
    }
  };

  const handleAdminAdjustBalance = async (
    targetUser: UserProfile,
    delta: number,
    reason: string
  ) => {
    const roundedDelta = Math.round(delta);
    if (!Number.isFinite(roundedDelta) || roundedDelta === 0) {
      throw new Error('Veuillez saisir un montant valide différent de 0.');
    }
    if (isSupabaseConfigured && supabase) {
      await sbAdminAdjustBalance(targetUser.uid, roundedDelta, reason);
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      return;
    }
    const nextBalance = Math.max(0, Math.round(targetUser.balance + roundedDelta));
    const txId = sanitizeId(`tx_cred_${Date.now()}_${targetUser.uid.slice(0, 6)}`);
    const nowIso = new Date().toISOString();
    let updatedAny = false;

    const accounts = loadAccounts();
    const acc = Object.values(accounts).find((a) => a.profile.uid === targetUser.uid);
    if (acc) {
      updatedAny = true;
      const tx: TransactionItem = {
        id: txId,
        userId: sanitizeId(targetUser.uid),
        userName: clampStr(targetUser.displayName, 1, 100),
        type: 'credit',
        amount: Math.abs(roundedDelta),
        method: roundedDelta < 0 ? 'Ajustement Administrateur' : 'Crédit Administrateur',
        phoneOrAccount: targetUser.referralCode || targetUser.phone,
        reference: clampStr(reason || 'Ajustement du solde par administration', 2, 100),
        status: 'completed',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const updated: PhoneAccountRecord = {
        ...acc,
        profile: { ...acc.profile, balance: nextBalance, updatedAt: nowIso },
        transactions: [tx, ...(acc.transactions || [])],
      };
      accounts[acc.key] = updated;
      saveAccounts(accounts);
      setLocalSyncTick((t) => t + 1);
      if (phoneSessionKey === acc.key) {
        setUserProfile(updated.profile);
        setTransactions(updated.transactions);
      }
    }

    if (firebaseUser) {
      try {
        const uSnap = await getDoc(doc(db, 'users', targetUser.uid));
        if (uSnap.exists() || !acc) {
          updatedAny = true;
          await updateDoc(doc(db, 'users', targetUser.uid), {
            balance: nextBalance,
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'transactions', txId), {
            id: txId,
            userId: sanitizeId(targetUser.uid),
            userName: clampStr(targetUser.displayName, 1, 100),
            type: 'credit',
            amount: Math.abs(roundedDelta),
            method: roundedDelta < 0 ? 'Ajustement Administrateur' : 'Crédit Administrateur',
            phoneOrAccount: targetUser.referralCode || targetUser.email,
            reference: clampStr(reason || 'Ajustement du solde par administration', 2, 100),
            status: 'completed',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      }
    }

    if (!updatedAny) {
      throw new Error('Compte utilisateur introuvable pour appliquer cette modification.');
    }
  };

  const handleAdminGiftProduct = async (
    targetUser: UserProfile,
    project: ProjectItem,
    quantity = 1,
    reason = 'Produit offert par administration'
  ) => {
    const qty = Math.max(1, Math.min(20, Math.round(quantity)));
    if (isSupabaseConfigured && supabase) {
      await sbAdminGiftProduct(targetUser.uid, project.id, qty, reason);
      await refreshSupabaseState(userProfile, sbUser?.email, true);
      return;
    }
    const unitPrice = Math.max(500, Math.round(project.minInvestment));
    const unitDaily = Math.max(50, Math.round(getProjectDailyIncome(project)));
    const durationDays = Math.max(1, Math.min(3650, Math.round(project.durationDays || 90)));
    const totalValue = unitPrice * qty;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const txId = sanitizeId(`tx_gift_${nowMs}_${targetUser.uid.slice(0, 6)}`);
    const refLabel = clampStr(
      `${reason ? `${reason.trim()} · ` : ''}${qty > 1 ? `${qty}x ` : ''}${project.title} (${formatCFA(unitDaily * qty)}/j)`,
      2,
      100
    );

    const accounts = loadAccounts();
    const acc = Object.values(accounts).find((a) => a.profile.uid === targetUser.uid);
    if (acc) {
      const giftedContracts: InvestmentItem[] = [];
      for (let i = 0; i < qty; i++) {
        giftedContracts.push({
          id: sanitizeId(`vipgift_${nowMs}_${i}_${targetUser.uid.slice(0, 6)}`),
          userId: sanitizeId(targetUser.uid),
          userName: clampStr(targetUser.displayName, 1, 100),
          projectId: sanitizeId(project.id),
          projectTitle: clampStr(project.title, 2, 120),
          projectCategory: clampStr(project.category, 2, 60),
          amount: unitPrice,
          dailyIncome: unitDaily,
          returnRate: Math.max(1, Math.round(project.returnRate || ((unitDaily * durationDays) / unitPrice) * 100)),
          expectedProfit: Math.round(unitDaily * durationDays),
          durationDays,
          daysCredited: 0,
          totalEarnedSoFar: 0,
          purchasedAtMs: nowMs,
          status: 'active',
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      const giftTx: TransactionItem = {
        id: txId,
        userId: sanitizeId(targetUser.uid),
        userName: clampStr(targetUser.displayName, 1, 100),
        type: 'gift',
        amount: Math.max(1, Math.round(totalValue)),
        method: 'Cadeau Administrateur',
        phoneOrAccount: targetUser.referralCode || targetUser.phone || targetUser.email,
        reference: refLabel,
        status: 'completed',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const updated: PhoneAccountRecord = {
        ...acc,
        profile: {
          ...acc.profile,
          totalInvested: Math.round((acc.profile.totalInvested || 0) + totalValue),
          updatedAt: nowIso,
        },
        investments: [...giftedContracts, ...(acc.investments || [])],
        transactions: [giftTx, ...(acc.transactions || [])],
      };
      accounts[acc.key] = updated;
      saveAccounts(accounts);
      setLocalSyncTick((t) => t + 1);
      if (phoneSessionKey === acc.key) {
        setUserProfile(updated.profile);
        setInvestments(updated.investments);
        setTransactions(updated.transactions);
      }
    }

    if (firebaseUser) {
      try {
        const uSnap = await getDoc(doc(db, 'users', targetUser.uid));
        if (uSnap.exists() || !acc) {
          const cloudCurrentInvested = uSnap.exists()
            ? Number((uSnap.data() as UserProfile).totalInvested || 0)
            : Number(targetUser.totalInvested || 0);
          if (uSnap.exists()) {
            await updateDoc(doc(db, 'users', targetUser.uid), {
              totalInvested: Math.round(cloudCurrentInvested + totalValue),
              updatedAt: serverTimestamp(),
            });
          }
          for (let i = 0; i < qty; i++) {
            const invId = sanitizeId(`vipgift_${nowMs}_${i}_${targetUser.uid.slice(0, 6)}`);
            await setDoc(doc(db, 'investments', invId), {
              id: invId,
              userId: sanitizeId(targetUser.uid),
              userName: clampStr(targetUser.displayName, 1, 100),
              projectId: sanitizeId(project.id),
              projectTitle: clampStr(project.title, 2, 120),
              projectCategory: clampStr(project.category, 2, 60),
              amount: unitPrice,
              dailyIncome: unitDaily,
              returnRate: Math.max(
                1,
                Math.round(project.returnRate || ((unitDaily * durationDays) / unitPrice) * 100)
              ),
              expectedProfit: Math.round(unitDaily * durationDays),
              durationDays,
              daysCredited: 0,
              totalEarnedSoFar: 0,
              purchasedAtMs: nowMs,
              status: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          await setDoc(doc(db, 'transactions', txId), {
            id: txId,
            userId: sanitizeId(targetUser.uid),
            userName: clampStr(targetUser.displayName, 1, 100),
            type: 'gift',
            amount: Math.max(1, Math.round(totalValue)),
            method: 'Cadeau Administrateur',
            phoneOrAccount: targetUser.referralCode || targetUser.phone || targetUser.email,
            reference: refLabel,
            status: 'completed',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `investments/gift_${targetUser.uid}`);
      }
    }
  };

  const handleAdminSaveSettings = async (nextSettings: PlatformSettings) => {
    const cleaned: PlatformSettings = {
      id: 'global',
      referralRate: Math.max(0, Math.min(50, Number(nextSettings.referralRate) || 0)),
      minDeposit: Math.max(500, Number(nextSettings.minDeposit) || 4000),
      minWithdrawal: Math.max(500, Number(nextSettings.minWithdrawal) || 1000),
      supportPhone: clampStr(nextSettings.supportPhone, 3, 50, DEFAULT_SETTINGS.supportPhone),
      supportEmail: clampStr(nextSettings.supportEmail, 3, 120, DEFAULT_SETTINGS.supportEmail),
      adminPhone: DEFAULT_ADMIN_PHONE,
      announcement: clampStr(nextSettings.announcement, 2, 300, DEFAULT_SETTINGS.announcement),
      allowMultipleSameVip: nextSettings.allowMultipleSameVip !== false,
      visibility: 'public',
      updatedAt: new Date().toISOString(),
    };
    setSettings(cleaned);
    if (isSupabaseConfigured && supabase) {
      const saved = await sbAdminSaveSettings(cleaned);
      setSettings(saved);
      saveLocalSettings(saved, false);
      return;
    }

    saveLocalSettings(cleaned, !firebaseUser);

    if (!firebaseUser) return;
    try {
      localStorage.removeItem(SETTINGS_LOCAL_OVERRIDE_KEY);
      const ref = doc(db, 'settings', 'global');
      const snap = await getDoc(ref);
      const existingCreatedAt = snap.exists() ? snap.data()?.createdAt : undefined;
      await setDoc(ref, {
        id: cleaned.id,
        referralRate: cleaned.referralRate,
        minDeposit: cleaned.minDeposit,
        minWithdrawal: cleaned.minWithdrawal,
        supportPhone: cleaned.supportPhone,
        supportEmail: cleaned.supportEmail,
        adminPhone: cleaned.adminPhone,
        announcement: cleaned.announcement,
        allowMultipleSameVip: cleaned.allowMultipleSameVip,
        visibility: 'public',
        createdAt: existingCreatedAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      saveLocalSettings(cleaned, true);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('permission')) {
        throw new Error(
          `Paramètres enregistrés localement. Pour synchroniser dans le cloud Firestore, connectez-vous avec le compte Google administrateur (${ADMIN_EMAIL}).`
        );
      }
      handleFirestoreError(err, OperationType.WRITE, 'settings/global');
    }
  };

  // Derived lists
  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((p) => p.status === 'active' || isAdmin);
    const list = filtered.some((p) => OFFICIAL_VIP_IDS.includes(p.id))
      ? filtered
      : OFFICIAL_VIP_CATALOG;
    return [...list].sort((a, b) => a.minInvestment - b.minInvestment);
  }, [projects, isAdmin]);

  const enrichedInvestments = useMemo(() => {
    const now = Date.now();
    return investments
      .map((inv) => ({ inv, metrics: computeInvestmentMetrics(inv, now) }))
      .sort((a, b) =>
        a.metrics.isExpired === b.metrics.isExpired
          ? b.inv.amount - a.inv.amount
          : a.metrics.isExpired
          ? 1
          : -1
      );
  }, [investments]);

  const totalDailyIncome = useMemo(
    () =>
      enrichedInvestments
        .filter((i) => !i.metrics.isExpired)
        .reduce((acc, i) => acc + i.metrics.dailyIncome, 0),
    [enrichedInvestments]
  );

  const activeInvestmentsCount = useMemo(
    () => enrichedInvestments.filter((i) => !i.metrics.isExpired).length,
    [enrichedInvestments]
  );

  const projectOwnershipMap = useMemo(() => {
    const map: Record<
      string,
      { activeCount: number; expiredCount: number; maxDaysRemaining: number }
    > = {};
    for (const { inv, metrics } of enrichedInvestments) {
      const prev = map[inv.projectId] || {
        activeCount: 0,
        expiredCount: 0,
        maxDaysRemaining: 0,
      };
      if (metrics.isExpired) {
        prev.expiredCount += 1;
      } else {
        prev.activeCount += 1;
        prev.maxDaysRemaining = Math.max(prev.maxDaysRemaining, metrics.daysRemaining);
      }
      map[inv.projectId] = prev;
    }
    return map;
  }, [enrichedInvestments]);

  const sortedTransactions = useMemo(() => {
    const getMs = (tx: TransactionItem) => {
      const c = tx.createdAt as { toMillis?: () => number } | string | undefined;
      if (c && typeof c === 'object' && typeof c.toMillis === 'function') return c.toMillis();
      if (typeof c === 'string') {
        const parsed = Date.parse(c);
        if (!Number.isNaN(parsed)) return parsed;
      }
      return 0;
    };
    return [...transactions].sort((a, b) => getMs(b) - getMs(a));
  }, [transactions]);

  const filteredHistoryTransactions = useMemo(() => {
    if (historyFilter === 'all') return sortedTransactions;
    if (historyFilter === 'credit') {
      return sortedTransactions.filter(
        (t) => t.type === 'credit' || t.type === 'referral' || t.type === 'gift'
      );
    }
    return sortedTransactions.filter((t) => t.type === historyFilter);
  }, [sortedTransactions, historyFilter]);

  const selectedCountryOption = useMemo(
    () => COUNTRY_OPTIONS.find((c) => c.country === wdCountry) || COUNTRY_OPTIONS[0],
    [wdCountry]
  );

  // Team levels breakdown (combines stored referrals + derived 3-level tree across allUsers)
  const teamByLevel = useMemo(() => {
    const mergedMap = new Map<string, ReferralItem>();
    referrals.forEach((r) => mergedMap.set(r.referredUid, r));
    if (userProfile) {
      allReferrals
        .filter((r) => r.referrerUid === userProfile.uid)
        .forEach((r) => {
          const existing = mergedMap.get(r.referredUid);
          if (!existing || (r.commissionEarned || 0) > (existing.commissionEarned || 0)) {
            mergedMap.set(r.referredUid, r);
          }
        });
    }
    const merged = Array.from(mergedMap.values());
    const lvl1 = merged.filter((r) => !r.level || r.level === 1);
    const lvl2 = merged.filter((r) => r.level === 2);
    const lvl3 = merged.filter((r) => r.level === 3);
    const sum = (list: ReferralItem[]) =>
      list.reduce((acc, item) => acc + Math.round(item.commissionEarned || 0), 0);
    return {
      1: lvl1,
      2: lvl2,
      3: lvl3,
      totalUsers: lvl1.length + lvl2.length + lvl3.length,
      revenue: { 1: sum(lvl1), 2: sum(lvl2), 3: sum(lvl3) },
      totalRevenue: sum(merged),
    };
  }, [referrals, allReferrals, userProfile]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex flex-col items-center justify-center p-6 text-center gap-4">
        <BrandLogo compact={false} />
        <p className="text-xs font-semibold text-[#475569]">Chargement sécurisé en cours...</p>
      </div>
    );
  }

  // Render Auth screen when logged out
  if (!(isSupabaseConfigured ? sbUser : firebaseUser || phoneSessionKey)) {
    return (
      <>
        {toastMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] px-4 py-3 rounded-2xl bg-[#0F172A] text-white shadow-lg border border-[#F5C533]/40 flex items-center gap-2.5 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-[#F5C533] shrink-0" />
            <span>{toastMsg}</span>
          </div>
        )}
        {!isSupabaseConfigured &&
          typeof window !== 'undefined' &&
          !['localhost', '127.0.0.1'].includes(window.location.hostname) && (
            <div className="max-w-lg mx-auto mt-3 px-4">
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
                <p className="font-extrabold">Synchronisation cloud non activée sur ce domaine</p>
                <p className="leading-relaxed">
                  Ajoutez <strong>VITE_SUPABASE_URL</strong> et{' '}
                  <strong>VITE_SUPABASE_PUBLISHABLE_KEY</strong> dans Vercel → Settings → Environment
                  Variables puis faites un <strong>Redeploy</strong> pour centraliser les
                  inscriptions.
                </p>
              </div>
            </div>
          )}
        {isSupabaseConfigured && supabaseSchemaMissing && (
          <div className="max-w-lg mx-auto mt-3 px-4">
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
              <p className="font-extrabold">Configuration Supabase requise (1 fois)</p>
              <p className="leading-relaxed">
                Exécutez la migration SQL dans votre projet Supabase (SQL Editor) et désactivez
                « Confirm email » dans Authentication → Providers → Email pour activer les
                inscriptions par téléphone.
              </p>
            </div>
          </div>
        )}
        <AuthScreen
          initialInvitationCode={initialInviteCode}
          onSubmitPhoneAuth={handlePhoneAuth}
          onGoogleAuth={isSupabaseConfigured ? undefined : handleGoogleSignIn}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#111827] pb-24">
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] px-4 py-3 rounded-2xl bg-[#111827] text-white shadow-lg border border-[#F5B800]/50 flex items-center gap-2.5 text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-[#F5B800] shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-3.5 sm:px-6 pt-3 sm:pt-5 space-y-4">
        <header className="flex items-center justify-between gap-3 bg-white border border-[#EAECEF] rounded-2xl px-4 py-2.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="text-left focus:outline-none cursor-pointer"
          >
            <BrandLogo compact={false} />
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className="min-h-[40px] px-3.5 py-1.5 rounded-md aurelia-gold-btn text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Shield className="w-4 h-4" />
              <span className="sm:hidden">Admin</span>
              <span className="hidden sm:inline">Administration</span>
            </button>
          )}
        </header>

        {/* TAB 1: ACCUEIL */}
        {activeTab === 'home' && (
          <main className="space-y-4">
            <section className="relative h-56 sm:h-72 md:h-80 rounded-2xl overflow-hidden border border-[#EAECEF] bg-[#111827] shadow-2xs">
              <SafeImage
                src={BRAND_IMAGES.brandShowcase}
                alt="Nouveautés smartphones AURELIA MOBILE"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent flex flex-col justify-end p-5 sm:p-7">
                <p className="text-xs sm:text-sm font-medium text-[#F5B800] tracking-wide">
                  AURELIA MOBILE · Gamme Flagship
                </p>
                <h1 className="text-2xl sm:text-3xl font-normal font-display text-white leading-tight mt-0.5">
                  Nouveautés
                  <span className="block font-medium">Produits phares</span>
                </h1>
              </div>
            </section>

            <section
              aria-label="Annonces et activités récentes"
              className="rounded-xl bg-white border border-[#EAECEF] px-3.5 py-2.5 flex items-center gap-2.5 shadow-2xs overflow-hidden"
            >
              <Bell className="w-5 h-5 text-[#F5B800] fill-[#F5B800] shrink-0" />
              <div className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap scrollbar-none text-xs sm:text-sm font-normal text-[#374151]">
                {sortedTransactions.length > 0 ? (
                  <span>
                    <span className="font-medium text-[#111827]">Activité :</span>{' '}
                    {transactionTypeLabel(sortedTransactions[0].type)}{' '}
                    <span className="font-mono-num font-medium text-[#111827]">
                      {formatCFA(sortedTransactions[0].amount)}
                    </span>{' '}
                    · <span>{settings.announcement}</span>
                  </span>
                ) : (
                  <span>
                    <span className="font-medium text-[#111827]">Info :</span>{' '}
                    {settings.announcement} ·{' '}
                    <span className="font-mono-num text-[#4B5563]">
                      ******9899 a rechargé 15 000 FCFA · ******4120 a perçu 2 500 FCFA
                    </span>
                  </span>
                )}
              </div>
            </section>

            <section
              aria-label="Actions rapides"
              className="grid grid-cols-4 gap-2 py-1"
            >
              <button
                type="button"
                onClick={() => setDepositModalOpen(true)}
                className="min-h-[72px] py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-white transition-colors cursor-pointer"
              >
                <div className="w-11 h-11 rounded-full bg-[#F5B800] text-white flex items-center justify-center shadow-2xs">
                  <CircleDollarSign className="w-6 h-6 stroke-[2]" />
                </div>
                <span className="text-xs sm:text-sm font-normal text-[#D97706] text-center leading-tight">
                  Dépôt
                </span>
              </button>

              <button
                type="button"
                onClick={() => setWithdrawModalOpen(true)}
                className="min-h-[72px] py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-white transition-colors cursor-pointer"
              >
                <div className="w-11 h-11 rounded-xl bg-[#F5B800] text-white flex items-center justify-center shadow-2xs">
                  <CreditCard className="w-6 h-6 stroke-[2]" />
                </div>
                <span className="text-xs sm:text-sm font-normal text-[#D97706] text-center leading-tight">
                  Retrait
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSupportModalOpen(true)}
                className="min-h-[72px] py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-white transition-colors cursor-pointer"
              >
                <div className="w-11 h-11 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#F5B800] flex items-center justify-center shadow-2xs">
                  <Headphones className="w-6 h-6 stroke-[2]" />
                </div>
                <span className="text-xs sm:text-sm font-normal text-[#D97706] text-center leading-tight">
                  Aide
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('checkin')}
                className="min-h-[72px] py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1.5 hover:bg-white transition-colors cursor-pointer"
              >
                <div className="w-11 h-11 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] text-[#F5B800] flex items-center justify-center shadow-2xs">
                  <CalendarCheck className="w-6 h-6 stroke-[2]" />
                </div>
                <span className="text-xs sm:text-sm font-normal text-[#D97706] text-center leading-tight">
                  Pointage
                </span>
              </button>
            </section>

            <section
              aria-label="Solde et cumul"
              className="grid grid-cols-1 md:grid-cols-2 gap-3.5"
            >
              <div className="rounded-2xl bg-white border border-[#EAECEF] p-4 sm:p-5 shadow-2xs flex items-center justify-between gap-4">
                <div className="w-28 h-24 sm:w-32 sm:h-28 rounded-xl overflow-hidden bg-[#F8FAFC] border border-[#F1F5F9] shrink-0">
                  <SafeImage
                    src={BRAND_IMAGES.titanium}
                    alt="Smartphone titane brossé AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 flex flex-col items-end justify-center gap-2.5 text-right">
                  <div className="aurelia-gold-box px-6 py-2 min-w-[140px] sm:min-w-[168px] text-center text-sm sm:text-base font-normal">
                    Solde
                  </div>
                  <p className="text-xl sm:text-2xl font-mono-num font-medium text-[#DC2626] tracking-tight">
                    {formatCFA(userProfile?.balance || 0)}
                  </p>
                  <p className="text-[11px] sm:text-xs text-[#6B7280] font-normal">
                    {activeInvestmentsCount > 0
                      ? `${activeInvestmentsCount} produit(s) VIP actif(s)`
                      : 'Disponible immédiatement'}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-white border border-[#EAECEF] p-4 sm:p-5 shadow-2xs flex items-center justify-between gap-4">
                <div className="w-28 h-24 sm:w-32 sm:h-28 rounded-xl overflow-hidden bg-[#F8FAFC] border border-[#F1F5F9] shrink-0">
                  <SafeImage
                    src={BRAND_IMAGES.ceramic}
                    alt="Édition Céramique & Or AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 flex flex-col items-end justify-center gap-2.5 text-right">
                  <div className="aurelia-gold-box px-6 py-2 min-w-[140px] sm:min-w-[168px] text-center text-sm sm:text-base font-normal">
                    Cumul
                  </div>
                  <p className="text-xl sm:text-2xl font-mono-num font-medium text-[#DC2626] tracking-tight">
                    {formatCFA(userProfile?.totalEarned || 0)}
                  </p>
                  <p className="text-[11px] sm:text-xs text-[#6B7280] font-mono-num font-normal">
                    +{formatCFA(totalDailyIncome)} / jour
                  </p>
                </div>
              </div>
            </section>
          </main>
        )}

        {/* TAB 1B: POINTAGE QUOTIDIEN (24H) */}
        {activeTab === 'checkin' && (
          <main className="space-y-4">
            <div className="rounded-xl bg-white border border-[#EAECEF] px-3 py-2.5 flex items-center justify-between shadow-2xs">
              <button
                type="button"
                onClick={() => setActiveTab('home')}
                className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#111827] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                aria-label="Retour à l'accueil"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-base sm:text-lg font-medium text-[#111827]">Pointage</h1>
              <div className="w-11" />
            </div>

            <section className="relative h-56 sm:h-64 rounded-2xl overflow-hidden border border-[#EAECEF] bg-[#D99B26] shadow-2xs">
              <SafeImage
                src={BRAND_IMAGES.brandShowcase}
                alt="Bonus de pointage quotidien AURELIA MOBILE"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-[#D99B26]/80 to-[#D99B26] flex flex-col items-center justify-end pb-7 px-4 text-center">
                <p className="text-sm sm:text-base font-normal text-white/95">Bonus cumulé</p>
                <p className="text-3xl sm:text-4xl font-mono-num font-medium text-white mt-1 tracking-tight">
                  {formatCFA(userProfile?.checkinTotal || 0)}
                </p>
              </div>
            </section>

            <section className="rounded-2xl bg-white border border-[#EAECEF] p-5 sm:p-6 shadow-2xs space-y-5">
              <div>
                <p className="text-xs sm:text-sm font-normal text-[#4B5563]">
                  Récompense de pointage quotidien
                </p>
                <p className="text-2xl sm:text-3xl font-mono-num font-medium text-[#111827] mt-1">
                  {formatCFA(DAILY_CHECKIN_BONUS_CFA)}
                </p>
              </div>

              <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#F3F4F6]">
                <div className="pt-3">
                  <p className="text-xs sm:text-sm font-normal text-[#4B5563]">
                    Nombre total de jours de pointage
                  </p>
                  <p className="text-2xl sm:text-3xl font-mono-num font-medium text-[#111827] mt-1">
                    {userProfile?.checkinDays || 0} jours
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void handleClaimDailyCheckin()}
                  disabled={claimingCheckin || checkinRemainingMs > 0}
                  className={`mt-3 min-h-[46px] px-6 rounded-md text-xs sm:text-sm font-medium transition-all shrink-0 ${
                    checkinRemainingMs > 0
                      ? 'bg-[#E5E7EB] text-[#6B7280] cursor-not-allowed'
                      : 'aurelia-gold-btn cursor-pointer disabled:opacity-60'
                  }`}
                >
                  {claimingCheckin
                    ? 'Validation...'
                    : checkinRemainingMs > 0
                    ? `Dans ${formatCountdownHhMm(checkinRemainingMs)}`
                    : 'Pointer (+30 FCFA)'}
                </button>
              </div>

              <div className="pt-2 space-y-1.5 text-xs sm:text-[13px] text-[#4B5563] leading-relaxed">
                <p>1. Récompense de connexion quotidienne : {formatCFA(DAILY_CHECKIN_BONUS_CFA)}.</p>
                <p>2. Connectez-vous et pointez une fois toutes les 24 heures.</p>
                <p>
                  3. Pas de double crédit : votre compte est crédité une seule fois par cycle de
                  24h.
                </p>
              </div>
            </section>

            <section className="relative h-28 sm:h-32 rounded-2xl overflow-hidden border border-[#EAECEF] bg-[#111827] shadow-2xs">
              <SafeImage
                src={BRAND_IMAGES.titanium}
                alt="Produits VIP AURELIA MOBILE"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#D99B26]/90 via-black/45 to-black/75 px-5 flex items-center justify-between gap-4">
                <div className="text-white space-y-0.5">
                  <p className="text-sm sm:text-base font-medium leading-snug">
                    Découvrez nos produits phares
                  </p>
                  <p className="text-xs text-white/85">
                    Obtenez plus de revenus quotidiens
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('projects')}
                  className="min-h-[42px] px-4 rounded-md bg-[#111827] text-white text-xs sm:text-sm font-medium border border-white/20 hover:bg-black transition-colors cursor-pointer shrink-0"
                >
                  ALLER &gt;
                </button>
              </div>
            </section>
          </main>
        )}

        {/* TAB 2: PRODUITS */}
        {activeTab === 'projects' && (
          <main className="space-y-4">
            <h2 className="text-base sm:text-lg font-normal text-[#1F2937] text-center pt-1">
              Mes produits et mes revenus
            </h2>

            <section className="grid grid-cols-2 gap-3.5 max-w-2xl mx-auto">
              <button
                type="button"
                onClick={() => setActiveTab('investments')}
                className="aurelia-gold-btn py-3.5 px-3 flex flex-col items-center justify-center text-center cursor-pointer"
              >
                <span className="text-xl sm:text-2xl font-mono-num font-medium text-[#111827] leading-tight">
                  {activeInvestmentsCount}
                </span>
                <span className="text-xs sm:text-sm font-normal text-[#111827] mt-1">
                  Mes produits &gt;
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('investments')}
                className="aurelia-gold-btn py-3.5 px-3 flex flex-col items-center justify-center text-center cursor-pointer"
              >
                <span className="text-lg sm:text-2xl font-mono-num font-medium text-[#111827] leading-tight">
                  {formatCFA(userProfile?.totalEarned || 0)}
                </span>
                <span className="text-xs sm:text-sm font-normal text-[#111827] mt-1">
                  Mes revenus &gt;
                </span>
              </button>
            </section>

            <h3 className="text-base sm:text-lg font-normal text-[#1F2937] text-center pt-1">
              Produits phares
            </h3>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {visibleProjects.map((project) => {
                const daily = getProjectDailyIncome(project);
                const duration = project.durationDays || 90;
                const totalReturn = daily * duration;
                const ownership = projectOwnershipMap[project.id];
                const isActiveOwned = !!(ownership && ownership.activeCount > 0);
                const isExpiredOwned = !!(
                  ownership &&
                  ownership.activeCount === 0 &&
                  ownership.expiredCount > 0
                );
                const remainingDays = isActiveOwned
                  ? ownership.maxDaysRemaining
                  : isExpiredOwned
                  ? 0
                  : duration;

                return (
                  <article
                    key={project.id}
                    className="rounded-xl bg-white border border-[#EAECEF] p-4 sm:p-5 shadow-2xs flex items-center justify-between gap-4"
                  >
                    <div className="flex-1 min-w-0 space-y-2">
                      <div>
                        <h4 className="text-base sm:text-lg font-normal text-[#111827] leading-snug">
                          {project.title}
                        </h4>
                        <p className="text-[11px] font-normal text-[#6B7280] truncate">
                          {project.category}
                        </p>
                      </div>

                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-[#DC2626] font-normal">Prix :</span>
                        <span className="font-mono-num font-medium text-[#DC2626] text-base">
                          {formatCFA(project.minInvestment)}
                        </span>
                      </div>

                      <div className="space-y-1 text-xs sm:text-[13px] text-[#374151] font-normal">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#4B5563]">Durée :</span>
                          <span className="font-mono-num text-[#111827]">
                            {duration} jours
                            {(isActiveOwned || isExpiredOwned) && (
                              <span className="text-[#0F766E] ml-1">
                                ({remainingDays}j ·{' '}
                                {isExpiredOwned ? 'Expiré' : `×${ownership.activeCount}`})
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#4B5563]">Revenu quotidien :</span>
                          <span className="font-mono-num text-[#111827]">{formatCFA(daily)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[#4B5563]">Revenu total :</span>
                          <span className="font-mono-num text-[#111827]">
                            {formatCFA(totalReturn)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="w-28 sm:w-32 shrink-0 flex flex-col gap-2.5">
                      <div className="w-28 h-24 sm:w-32 sm:h-28 rounded-lg overflow-hidden border border-[#EAECEF] bg-[#F8FAFC]">
                        <SafeImage
                          src={project.imageUrl}
                          alt={project.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {project.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProject(project);
                            setBuyModalOpen(true);
                          }}
                          className="min-h-[40px] w-full aurelia-gold-btn text-xs sm:text-sm font-normal tracking-wide cursor-pointer"
                        >
                          ACHETER
                        </button>
                      ) : (
                        <span className="min-h-[40px] flex items-center justify-center text-xs font-normal text-[#6B7280]">
                          Bientôt disponible
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          </main>
        )}

        {/* SUBVIEW: MES PRODUITS ACTIFS */}
        {activeTab === 'investments' && (
          <main className="space-y-4">
            <div className="rounded-xl bg-white border border-[#EAECEF] px-4 py-3 flex items-center justify-between shadow-2xs">
              <button
                type="button"
                onClick={() => setActiveTab('projects')}
                className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#111827] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                aria-label="Retour"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-sm sm:text-base font-medium text-[#111827] font-display">
                Mes produits
              </h2>
              <div className="w-11" />
            </div>

            <section className="grid grid-cols-2 gap-3.5 max-w-2xl mx-auto">
              <div className="aurelia-gold-box py-3.5 px-3 text-center">
                <span className="block text-xl sm:text-2xl font-mono-num font-medium text-[#111827] leading-tight">
                  {activeInvestmentsCount}
                </span>
                <span className="block text-xs sm:text-sm font-normal text-[#111827] mt-1">
                  Produits actifs
                </span>
              </div>
              <div className="aurelia-gold-box py-3.5 px-3 text-center">
                <span className="block text-lg sm:text-2xl font-mono-num font-medium text-[#111827] leading-tight">
                  {formatCFA(userProfile?.totalEarned || 0)}
                </span>
                <span className="block text-xs sm:text-sm font-normal text-[#111827] mt-1">
                  Mes revenus
                </span>
              </div>
            </section>

            {enrichedInvestments.length === 0 ? (
              <section className="rounded-2xl bg-white border border-[#EAECEF] py-16 px-6 text-center shadow-2xs space-y-4">
                <p className="text-sm font-normal text-[#4B5563]">
                  Vous n&apos;avez pas encore de produit actif.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('projects')}
                  className="min-h-[44px] px-7 aurelia-gold-btn text-xs sm:text-sm font-normal cursor-pointer"
                >
                  Découvrir les produits phares
                </button>
              </section>
            ) : (
              <section className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {enrichedInvestments.map(({ inv, metrics }) => {
                  const catalogItem =
                    visibleProjects.find((p) => p.id === inv.projectId) || visibleProjects[0];
                  return (
                    <article
                      key={inv.id}
                      className="rounded-xl bg-white border border-[#EAECEF] p-4 shadow-2xs flex items-center gap-4"
                    >
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden bg-[#F8FAFC] border border-[#EAECEF] shrink-0">
                        <SafeImage
                          src={catalogItem?.imageUrl || BRAND_IMAGES.hero}
                          alt={inv.projectTitle}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm sm:text-base font-medium text-[#111827] truncate">
                            {inv.projectTitle}
                          </h3>
                          <span
                            className={`text-xs font-medium shrink-0 ${
                              metrics.isExpired ? 'text-[#6B7280]' : 'text-[#0F766E]'
                            }`}
                          >
                            {metrics.displayStatus}
                          </span>
                        </div>
                        <div className="space-y-0.5 text-xs sm:text-[13px] text-[#374151] font-normal">
                          <p>
                            Prix :{' '}
                            <span className="font-mono-num font-medium text-[#DC2626]">
                              {formatCFA(inv.amount)}
                            </span>
                          </p>
                          <p>
                            Revenu quotidien :{' '}
                            <span className="font-mono-num font-medium text-[#0F766E]">
                              {formatCFA(metrics.dailyIncome)}
                            </span>
                          </p>
                          <p>
                            Durée restante :{' '}
                            <span className="font-mono-num text-[#111827]">
                              {metrics.daysRemaining} / {metrics.durationDays} jours
                            </span>
                          </p>
                          <p>
                            Revenu cumulé :{' '}
                            <span className="font-mono-num font-medium text-[#111827]">
                              {formatCFA(metrics.totalEarnedSoFar)}
                            </span>
                          </p>
                        </div>
                        {metrics.isExpired && catalogItem && (
                          <div className="pt-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProject(catalogItem);
                                setBuyModalOpen(true);
                              }}
                              className="min-h-[38px] px-4 py-1.5 aurelia-gold-btn text-xs font-normal cursor-pointer"
                            >
                              Acheter à nouveau
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </section>
            )}
          </main>
        )}

        {/* TAB 3: ÉQUIPE */}
        {activeTab === 'team' && (
          <main className="space-y-4">
            {showTeamDetails ? (
              <section className="max-w-lg mx-auto space-y-2.5">
                <div className="bg-white border border-[#EAECEF] rounded-xl px-3.5 py-2.5 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setShowTeamDetails(false)}
                    className="min-w-[44px] min-h-[44px] -ml-1 flex items-center justify-center text-[#111827] hover:bg-[#F3F4F6] rounded-lg transition-colors cursor-pointer"
                    aria-label="Retour à la page Équipe"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-sm font-medium text-[#111827]">Détails de l&apos;équipe</h2>
                  <div className="w-11" />
                </div>

                <div className="bg-white border border-[#EAECEF] rounded-xl grid grid-cols-3 text-center shadow-2xs overflow-hidden">
                  {([1, 2, 3] as const).map((lvl) => {
                    const list = teamByLevel[lvl];
                    const rewardedCount = list.filter(
                      (r) => (r.commissionEarned || 0) > 0 || r.status === 'rewarded'
                    ).length;
                    const active = teamLevelTab === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setTeamLevelTab(lvl)}
                        className={`relative min-h-[54px] py-2.5 px-2 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer ${
                          active ? 'text-[#111827]' : 'text-[#6B7280] hover:text-[#111827]'
                        }`}
                      >
                        <span className="text-xs sm:text-sm font-mono-num font-medium text-[#111827]">
                          {rewardedCount}
                        </span>
                        <span className="text-[11px] sm:text-xs font-normal text-[#4B5563]">
                          LV{lvl} ({list.length})
                        </span>
                        {active && (
                          <span className="absolute bottom-0 inset-x-0 h-[2px] bg-[#F5B800]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="bg-white border border-[#EAECEF] rounded-xl divide-y divide-[#F3F4F6] shadow-2xs overflow-hidden">
                  {teamByLevel[teamLevelTab].map((ref, idx) => {
                    const digits = (ref.referredName || '').replace(/\D/g, '');
                    const masked =
                      digits.length >= 5
                        ? `${digits.slice(0, 2)}****${digits.slice(-3)}`
                        : `${String(15 + ((idx * 17) % 80)).padStart(2, '0')}****${String(
                            110 + ((idx * 73) % 880)
                          ).padStart(3, '0')}`;
                    return (
                      <div
                        key={ref.id}
                        className="px-4 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <BrandEmblem sizeClass="w-10 h-10" shape="circle" />
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-mono-num font-medium text-[#111827] leading-tight truncate">
                              {masked}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#6B7280] mt-0.5 truncate">
                              {formatDateFr(ref.createdAt) || 'Membre actif'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono-num font-medium text-[#111827]">
                            {formatCFA(Math.round(ref.commissionEarned || 0))}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="py-4 px-4 text-center">
                    <p className="text-xs text-[#6B7280] font-normal">
                      Il ne reste plus de données
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <>
                {(() => {
                  const code = userProfile?.referralCode || 'AM-INVITE';
                  const link = userProfile
                    ? `${window.location.origin}/?ref=${userProfile.uid}&code=${userProfile.referralCode}`
                    : `${window.location.origin}/?ref=AM-INVITE`;
                  return (
                    <section className="rounded-2xl overflow-hidden bg-white border border-[#EAECEF] shadow-2xs">
                      <div className="relative h-52 sm:h-64 w-full bg-[#111827]">
                        <SafeImage
                          src={BRAND_IMAGES.hero}
                          alt="Programme Équipe & Parrainage AURELIA MOBILE"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-white via-white/15 to-transparent flex items-end p-5">
                          <h2 className="text-2xl sm:text-3xl font-normal font-display text-[#F5B800] drop-shadow-[0_1px_2px_rgba(0,0,0,0.65)]">
                            Créez votre équipe
                          </h2>
                        </div>
                      </div>

                      <div className="px-5 pt-2 pb-5 space-y-4 bg-white">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm sm:text-base font-normal text-[#F59E0B]">
                            Partagez en un clic
                          </span>
                          <button
                            type="button"
                            onClick={() => setShowTeamDetails(true)}
                            className="min-h-[36px] text-xs sm:text-sm font-normal text-[#DC2626] underline cursor-pointer"
                          >
                            Détails de l&apos;équipe &gt;
                          </button>
                        </div>

                        <p className="text-xs sm:text-sm text-[#4B5563] font-normal">
                          Partagez le code d&apos;invitation ou le lien pour inviter vos amis
                        </p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end pt-1">
                          <div className="space-y-2">
                            <p className="text-xs sm:text-sm font-normal text-[#F59E0B]">
                              Code d&apos;invitation :
                            </p>
                            <p className="text-base sm:text-lg font-mono-num font-normal text-[#111827] truncate">
                              {code}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(code);
                                showToast("Code d'invitation copié !");
                              }}
                              className="min-h-[40px] px-7 rounded-md aurelia-gold-btn text-xs sm:text-sm font-normal cursor-pointer"
                            >
                              Copier
                            </button>
                          </div>

                          <div className="space-y-2 min-w-0">
                            <p className="text-xs sm:text-sm font-normal text-[#F59E0B]">
                              Lien d&apos;invitation :
                            </p>
                            <p className="text-xs sm:text-sm font-mono-num font-normal text-[#111827] truncate">
                              {link}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(link);
                                showToast("Lien d'invitation copié !");
                              }}
                              className="min-h-[40px] px-7 rounded-md aurelia-gold-btn text-xs sm:text-sm font-normal cursor-pointer"
                            >
                              Copier
                            </button>
                          </div>
                        </div>
                      </div>
                    </section>
                  );
                })()}

                <section className="grid grid-cols-2 gap-3.5">
                  <button
                    type="button"
                    onClick={() => setShowTeamDetails(true)}
                    className="relative h-28 sm:h-32 rounded-xl overflow-hidden border border-[#EAECEF] bg-[#111827] cursor-pointer text-center"
                  >
                    <SafeImage
                      src={BRAND_IMAGES.titanium}
                      alt="Total des membres"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center p-2">
                      <span className="text-xl sm:text-2xl font-mono-num font-medium text-white">
                        {teamByLevel.totalUsers}
                      </span>
                      <span className="text-xs sm:text-sm font-normal text-white/95 mt-1">
                        Total des membres &gt;
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTeamDetails(true)}
                    className="relative h-28 sm:h-32 rounded-xl overflow-hidden border border-[#EAECEF] bg-[#111827] cursor-pointer text-center"
                  >
                    <SafeImage
                      src={BRAND_IMAGES.foldable}
                      alt="Total des récompenses"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center p-2">
                      <span className="text-lg sm:text-2xl font-mono-num font-medium text-white">
                        {formatCFA(teamByLevel.totalRevenue)}
                      </span>
                      <span className="text-xs sm:text-sm font-normal text-white/95 mt-1">
                        Total des récompenses &gt;
                      </span>
                    </div>
                  </button>
                </section>

                <section className="rounded-2xl bg-white border border-[#EAECEF] divide-y divide-[#F3F4F6] overflow-hidden shadow-2xs">
                  {[
                    {
                      level: 1 as const,
                      rate: '30%',
                      users: teamByLevel[1].length,
                      revenue: teamByLevel.revenue[1],
                    },
                    {
                      level: 2 as const,
                      rate: '2%',
                      users: teamByLevel[2].length,
                      revenue: teamByLevel.revenue[2],
                    },
                    {
                      level: 3 as const,
                      rate: '1%',
                      users: teamByLevel[3].length,
                      revenue: teamByLevel.revenue[3],
                    },
                  ].map((row) => (
                    <button
                      key={row.level}
                      type="button"
                      onClick={() => {
                        setTeamLevelTab(row.level);
                        setShowTeamDetails(true);
                      }}
                      className="w-full px-4 py-4 sm:px-5 grid grid-cols-12 items-center text-center gap-2 hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                    >
                      <div className="col-span-2 text-left">
                        <span className="text-lg sm:text-xl font-normal text-[#F59E0B]">
                          LV{row.level}
                        </span>
                      </div>
                      <div className="col-span-3 space-y-0.5">
                        <p className="text-sm sm:text-base font-mono-num font-normal text-[#111827]">
                          {row.rate}
                        </p>
                        <p className="text-[11px] sm:text-xs text-[#6B7280]">Commission</p>
                      </div>
                      <div className="col-span-3 space-y-0.5">
                        <p className="text-sm sm:text-base font-mono-num font-normal text-[#111827]">
                          {row.users}
                        </p>
                        <p className="text-[11px] sm:text-xs text-[#6B7280]">Membres</p>
                      </div>
                      <div className="col-span-4 space-y-0.5">
                        <p className="text-sm sm:text-base font-mono-num font-normal text-[#111827]">
                          {formatCFA(row.revenue)}
                        </p>
                        <p className="text-[11px] sm:text-xs text-[#6B7280]">Récompense</p>
                      </div>
                    </button>
                  ))}
                </section>

                <section className="rounded-2xl bg-white border border-[#EAECEF] p-5 space-y-3 text-xs sm:text-sm text-[#4B5563] font-normal leading-relaxed shadow-2xs">
                  <p>
                    Lorsque les amis que vous invitez s&apos;inscrivent et effectuent un
                    investissement, vous recevez instantanément un cashback de{' '}
                    <span className="font-medium text-[#111827]">30 %</span>.
                  </p>
                  <p>
                    Vous bénéficiez d&apos;un cashback de{' '}
                    <span className="font-medium text-[#111827]">2 %</span> lorsque les membres de
                    votre équipe de niveau 2 investissent, et de{' '}
                    <span className="font-medium text-[#111827]">1 %</span> au niveau 3.
                  </p>
                  <p>
                    Les récompenses en espèces sont créditées automatiquement et disponibles pour
                    un retrait immédiat.
                  </p>
                </section>
              </>
            )}
          </main>
        )}

        {/* TAB 4: MOI (MON COMPTE) */}
        {activeTab === 'account' && (
          <main className="space-y-4">
            {accountSubpage === 'menu' && (
              <div className="space-y-4">
                <section className="rounded-2xl bg-white border border-[#EAECEF] px-5 pt-4 pb-2 shadow-2xs">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="min-h-[36px] text-xs sm:text-sm font-normal text-[#F59E0B] hover:text-[#D97706] transition-colors cursor-pointer"
                    >
                      Déconnexion
                    </button>
                  </div>

                  <div className="flex items-center gap-4 mt-1">
                    <BrandEmblem sizeClass="w-16 h-16" shape="circle" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-lg sm:text-xl font-mono-num font-normal text-[#111827] truncate">
                        {userProfile?.phone ||
                          (userProfile?.withdrawalAccount &&
                          userProfile.withdrawalAccount.trim().length > 4
                            ? userProfile.withdrawalAccount
                            : userProfile?.referralCode || '+226 77409899')}
                      </p>
                      <p className="text-sm font-normal text-[#F59E0B]">
                        {activeInvestmentsCount > 0
                          ? `VIP actif (×${activeInvestmentsCount})`
                          : 'Niveau 1'}
                      </p>
                    </div>
                  </div>

                  <div className="text-center py-5 space-y-1">
                    <p className="text-3xl sm:text-4xl font-mono-num font-normal text-[#F5B800] tracking-tight">
                      {formatCFA(userProfile?.balance || 0)}
                    </p>
                    <p className="text-xs sm:text-sm text-[#4B5563] font-normal">Solde</p>
                  </div>

                  <div className="grid grid-cols-3 text-center pt-1 pb-4 border-b-[1.5px] border-[#111827]">
                    <button
                      type="button"
                      onClick={() => setDepositModalOpen(true)}
                      className="min-h-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer hover:opacity-80"
                    >
                      <span className="text-xs sm:text-sm font-normal text-[#111827]">Dépôt</span>
                      <span className="text-xs sm:text-sm font-normal text-[#F59E0B]">
                        Aller &gt;
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWithdrawModalOpen(true)}
                      className="min-h-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer hover:opacity-80"
                    >
                      <span className="text-xs sm:text-sm font-normal text-[#111827]">Retrait</span>
                      <span className="text-xs sm:text-sm font-normal text-[#F59E0B]">
                        Aller &gt;
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryFilter('all');
                        setAccountSubpage('history');
                      }}
                      className="min-h-[48px] flex flex-col items-center justify-center gap-1 cursor-pointer hover:opacity-80"
                    >
                      <span className="text-xs sm:text-sm font-normal text-[#111827]">
                        Historique
                      </span>
                      <span className="text-xs sm:text-sm font-normal text-[#F59E0B]">
                        Voir &gt;
                      </span>
                    </button>
                  </div>

                  <div className="divide-y divide-[#F3F4F6]">
                    <button
                      type="button"
                      onClick={() => setAccountSubpage('about')}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <Info className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          À propos de nous
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('investments')}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <Smartphone className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          Mes produits ({activeInvestmentsCount})
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setHistoryFilter('all');
                        setAccountSubpage('history');
                      }}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <History className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">Historique</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setAccountSubpage('support')}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <Headphones className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">Service client</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setHistoryFilter('withdrawal');
                        setAccountSubpage('history');
                      }}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <Wallet className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          Registres des retraits
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setAccountSubpage('withdrawal_account')}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <CreditCard className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          Gestion des comptes de retrait
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setPasswordFeedback(null);
                        setAccountSubpage('password');
                      }}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <KeyRound className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          Modifier le mot de passe
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => setReferralModalOpen(true)}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <Award className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          Inviter des amis
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setGiftCodeInput('');
                        setGiftCodeFeedback(null);
                        setAccountSubpage('gift_code');
                      }}
                      className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-4">
                        <Gift className="w-6 h-6 text-[#F5B800] shrink-0" />
                        <span className="text-sm font-normal text-[#1F2937]">
                          Utiliser un code cadeau
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('admin')}
                        className="w-full min-h-[54px] py-3 flex items-center justify-between gap-3 hover:bg-[#FAFAFA] transition-colors text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-4">
                          <Shield className="w-6 h-6 text-[#111827] shrink-0" />
                          <span className="text-sm font-medium text-[#111827]">
                            Espace Administrateur
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-[#111827] shrink-0" />
                      </button>
                    )}
                  </div>
                </section>

                <section className="rounded-2xl bg-white border border-[#EAECEF] p-4 sm:p-5 shadow-2xs flex items-center gap-4">
                  <div className="w-24 h-24 rounded-xl overflow-hidden bg-[#F8FAFC] border border-[#EAECEF] shrink-0">
                    <SafeImage
                      src={BRAND_IMAGES.brandShowcase}
                      alt="Gamme Smartphones VIP AURELIA MOBILE"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2">
                    <h3 className="text-base font-normal text-[#F59E0B]">Gamme Smartphones VIP</h3>
                    <p className="text-xs sm:text-sm text-[#4B5563] font-normal leading-relaxed">
                      Activez un smartphone AURELIA MOBILE et percevez vos revenus quotidiens.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('projects')}
                      className="min-h-[40px] px-6 aurelia-gold-btn text-xs sm:text-sm font-normal cursor-pointer"
                    >
                      C&apos;EST PARTI &gt;
                    </button>
                  </div>
                </section>
              </div>
            )}

            {accountSubpage === 'history' && (
              <section className="space-y-3">
                <div className="rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setAccountSubpage('menu')}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
                    aria-label="Retour"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xs sm:text-sm font-extrabold text-[#0F172A] font-display">
                    {historyFilter === 'withdrawal'
                      ? 'Registres des retraits'
                      : historyFilter === 'deposit'
                      ? 'Historique des recharges'
                      : 'Dossiers de compte'}
                  </h2>
                  <div className="w-11" />
                </div>

                {filteredHistoryTransactions.length === 0 ? (
                  <div className="rounded-2xl bg-white border border-[#E2E5EC] min-h-[380px] py-16 px-6 flex flex-col items-center justify-center text-center shadow-2xs">
                    <FileText className="w-12 h-12 text-[#CBD5E1] mb-3" />
                    <p className="text-xs sm:text-sm text-[#64748B] font-medium">
                      Il ne reste plus de données
                    </p>
                  </div>
                ) : (
                  <div className="p-4 sm:p-5 rounded-2xl bg-white border border-[#E2E5EC] space-y-4 shadow-2xs">
                    <div className="divide-y divide-[#F1F5F9]">
                      {filteredHistoryTransactions.map((tx) => {
                        const isGift = tx.type === 'gift';
                        const isCredit =
                          tx.type === 'deposit' ||
                          tx.type === 'payout' ||
                          tx.type === 'credit' ||
                          tx.type === 'referral';
                        return (
                          <div
                            key={tx.id}
                            className="py-3.5 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-start gap-3 min-w-0">
                              <div
                                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                                  isGift
                                    ? 'bg-[#0F172A] text-[#F5C533]'
                                    : isCredit
                                    ? 'bg-slate-100 text-[#0F766E]'
                                    : 'bg-amber-50 text-[#9A6B00]'
                                }`}
                              >
                                {isGift ? (
                                  <Award className="w-4 h-4" />
                                ) : isCredit ? (
                                  <ArrowDownLeft className="w-4 h-4" />
                                ) : (
                                  <ArrowUpRight className="w-4 h-4" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-extrabold text-[#0F172A] truncate">
                                  {transactionTypeLabel(tx.type)} · {tx.reference}
                                </p>
                                <p className="text-[11px] text-[#475569] truncate">
                                  {tx.method}
                                  {tx.phoneOrAccount ? ` · ${tx.phoneOrAccount}` : ''}
                                </p>
                                {Boolean(tx.createdAt) && (
                                  <p className="text-[11px] text-[#64748B] mt-0.5">
                                    {formatDateFr(tx.createdAt)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span
                                className={`block text-xs sm:text-sm font-mono-num font-extrabold ${
                                  isGift
                                    ? 'text-[#0F172A]'
                                    : isCredit
                                    ? 'text-[#0F766E]'
                                    : 'text-[#9A6B00]'
                                }`}
                              >
                                {isGift ? 'Offert · ' : isCredit ? '+' : '-'}
                                {formatCFA(tx.amount)}
                              </span>
                              <span className="text-[11px] text-[#475569]">
                                {transactionStatusLabel(tx.status)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="pt-2 pb-1 text-center text-xs text-[#64748B] font-medium">
                      Il ne reste plus de données
                    </p>
                  </div>
                )}
              </section>
            )}

            {accountSubpage === 'withdrawal_account' && (
              <section className="space-y-4">
                <div className="rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => {
                      setShowWdForm(false);
                      setAccountSubpage('menu');
                    }}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
                    aria-label="Retour"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xs sm:text-sm font-extrabold text-[#0F172A] font-display">
                    Gestion des comptes de retrait
                  </h2>
                  <div className="w-11" />
                </div>

                <div className="rounded-xl bg-white border border-[#E2E5EC] p-4 flex items-center gap-4 shadow-2xs">
                  <div className="w-12 h-9 rounded-md bg-[#0F172A] flex flex-col justify-between p-1.5 shrink-0">
                    <div className="w-full h-1.5 bg-[#F5C533] rounded-xs" />
                    <div className="w-3.5 h-1 bg-white rounded-xs" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-xs sm:text-sm font-bold text-[#0F172A] uppercase truncate">
                      {(userProfile?.withdrawalMethod || wdMethod || 'ORANGE MONEY')
                        .replace(/Burkina|Bénin|Cameroun|Côte d['’]Ivoire|Sénégal|Togo/gi, '')
                        .trim() || 'MOBILE MONEY'}
                    </p>
                    <p className="text-[11px] sm:text-xs text-[#475569] truncate">
                      {userProfile?.withdrawalHolder ||
                        wdHolder ||
                        userProfile?.displayName ||
                        'Membre AURELIA MOBILE'}
                    </p>
                    <p className="text-[11px] sm:text-xs font-mono-num text-[#475569] truncate">
                      {userProfile?.withdrawalAccount || wdAccount || userProfile?.phone || '+226'}
                    </p>
                  </div>
                </div>

                <div className="pt-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowWdForm((prev) => !prev)}
                    className="min-w-[230px] min-h-[44px] px-8 rounded-lg bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-xs sm:text-sm shadow-2xs transition-colors cursor-pointer"
                  >
                    Ajouter / Modifier
                  </button>
                </div>

                {showWdForm && (
                  <form
                    onSubmit={handleSaveWithdrawalAccount}
                    className="p-5 rounded-2xl bg-white border border-[#E2E5EC] space-y-4 shadow-2xs"
                  >
                    <div>
                      <h3 className="text-sm font-extrabold font-display text-[#0F172A]">
                        Ajouter ou modifier votre compte de retrait
                      </h3>
                      <p className="text-xs text-[#475569]">
                        Renseignez votre opérateur Mobile Money, votre nom et votre numéro de
                        réception.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Pays
                        </label>
                        <select
                          value={wdCountry}
                          onChange={(e) => {
                            const nextCountry = e.target.value;
                            setWdCountry(nextCountry);
                            const found = COUNTRY_OPTIONS.find((c) => c.country === nextCountry);
                            if (found && found.methods.length > 0) {
                              setWdMethod(found.methods[0]);
                              if (!wdAccount || wdAccount.trim().length <= 5) {
                                setWdAccount(`${found.dialCode} `);
                              }
                            }
                          }}
                          className="w-full h-11 px-3 rounded-xl border border-[#CBD5E1] bg-white text-xs font-bold text-[#0F172A]"
                        >
                          {COUNTRY_OPTIONS.map((c) => (
                            <option key={c.country} value={c.country}>
                              {c.country} ({c.dialCode})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Opérateur (Orange Money, Moov, Wave...)
                        </label>
                        <select
                          value={wdMethod}
                          onChange={(e) => setWdMethod(e.target.value)}
                          className="w-full h-11 px-3 rounded-xl border border-[#CBD5E1] bg-white text-xs font-bold text-[#0F172A]"
                        >
                          {selectedCountryOption.methods.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Nom du titulaire
                        </label>
                        <input
                          type="text"
                          value={wdHolder}
                          onChange={(e) => setWdHolder(e.target.value)}
                          placeholder="Nom complet"
                          className="w-full h-11 px-3 rounded-xl border border-[#CBD5E1] text-xs font-semibold text-[#0F172A]"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1">
                          Numéro de compte / téléphone
                        </label>
                        <input
                          type="text"
                          value={wdAccount}
                          onChange={(e) => setWdAccount(e.target.value)}
                          placeholder="Ex: 77409899"
                          className="w-full h-11 px-3 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold text-[#0F172A]"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowWdForm(false)}
                        className="min-h-[40px] px-4 rounded-xl bg-[#F3F4F6] text-[#0F172A] text-xs font-bold cursor-pointer"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={savingWd}
                        className="min-h-[40px] px-6 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold cursor-pointer"
                      >
                        {savingWd ? 'Enregistrement...' : 'Enregistrer'}
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}

            {accountSubpage === 'password' && (
              <section className="space-y-4">
                <div className="rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setAccountSubpage('menu')}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
                    aria-label="Retour"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xs sm:text-sm font-extrabold text-[#0F172A] font-display">
                    Modifier le mot de passe
                  </h2>
                  <div className="w-11" />
                </div>

                <div className="p-5 sm:p-6 rounded-2xl bg-white border border-[#E2E5EC] space-y-5">
                  <div>
                    <h3 className="text-base sm:text-lg font-extrabold font-display text-[#0F172A]">
                      Modifier le mot de passe
                    </h3>
                    <p className="text-xs text-[#475569]">
                      Définissez un nouveau mot de passe pour votre compte ({userProfile?.email}).
                    </p>
                  </div>

                  {passwordFeedback && (
                    <div
                      className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
                        passwordFeedback.type === 'success'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border-red-200 text-red-800'
                      }`}
                    >
                      {passwordFeedback.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0" />
                      )}
                      <span>{passwordFeedback.text}</span>
                    </div>
                  )}

                  <form onSubmit={handleChangePassword} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1.5">
                          Nouveau mot de passe
                        </label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Minimum 4 caractères"
                          className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs text-[#0F172A]"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#334155] mb-1.5">
                          Confirmer le nouveau mot de passe
                        </label>
                        <input
                          type="password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          placeholder="Retapez le mot de passe"
                          className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs text-[#0F172A]"
                          required
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={savingPassword}
                        className="min-h-[44px] px-6 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold cursor-pointer"
                      >
                        {savingPassword ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}
                      </button>
                      {firebaseUser?.email && (
                        <button
                          type="button"
                          onClick={handleSendPasswordReset}
                          disabled={savingPassword}
                          className="min-h-[44px] px-4 rounded-xl bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold cursor-pointer"
                        >
                          Recevoir un lien par email
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </section>
            )}

            {accountSubpage === 'about' && (
              <section className="space-y-3">
                <div className="rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setAccountSubpage('menu')}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
                    aria-label="Retour"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xs sm:text-sm font-extrabold text-[#0F172A] font-display">
                    À propos de nous
                  </h2>
                  <div className="w-11" />
                </div>

                <div className="p-3.5 sm:p-5 rounded-xl bg-white border border-[#E2E5EC] space-y-4 shadow-2xs">
                  <div className="relative w-full aspect-video max-h-[340px] rounded-xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A]">
                    <SafeImage
                      src={BRAND_IMAGES.ceramic}
                      alt="AURELIA MOBILE Haute Technologie"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent flex flex-col justify-end p-5 text-white">
                      <p className="text-xs sm:text-sm font-extrabold italic text-[#F5C533] drop-shadow-xs">
                        « L&apos;excellence du smartphone, le rendement au quotidien. »
                      </p>
                      <p className="text-[11px] sm:text-xs font-semibold uppercase tracking-wider text-slate-200 mt-0.5">
                        Titane Grade 5 · Édition Pliable &amp; Céramique
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 text-xs sm:text-sm text-[#334155] leading-relaxed px-1 pb-2">
                    <p className="font-bold text-[#0F172A]">
                      Rejoignez AURELIA MOBILE dès maintenant !
                    </p>
                    <p>
                      Nous sommes ravis de vous accueillir dans la communauté AURELIA MOBILE. Restez
                      connecté(e) pour ne rien manquer de nos lancements flagship et opportunités
                      de distribution premium.
                    </p>
                    <p className="font-bold text-[#0F172A]">Comment fonctionne l&apos;abonnement ?</p>
                    <p>
                      1 : Choisissez un modèle de téléphone VIP adapté à votre budget et activez-le
                      avec votre solde.
                    </p>
                    <p>
                      2 : Votre solde est automatiquement crédité toutes les 24 heures pendant les
                      90 jours de validité de votre forfait.
                    </p>
                    <p>
                      3 : Invitez vos amis avec votre code d&apos;invitation pour agrandir votre
                      réseau et percevoir des commissions jusqu&apos;au niveau 3.
                    </p>
                    <p>
                      AURELIA MOBILE est une marque dédiée à la conception et à la distribution de
                      smartphones d&apos;exception en titane brossé, céramique et verre saphir à
                      travers l&apos;Afrique de l&apos;Ouest.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {accountSubpage === 'support' && (
              <section className="space-y-3">
                <div className="rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setAccountSubpage('menu')}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
                    aria-label="Retour"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xs sm:text-sm font-extrabold text-[#0F172A] font-display">
                    Service client
                  </h2>
                  <div className="w-11" />
                </div>

                <div className="relative h-44 sm:h-48 w-full rounded-xl overflow-hidden bg-[#0F172A] border border-[#CBD5E1]">
                  <SafeImage
                    src={BRAND_IMAGES.hero}
                    alt="Service client AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-[#0F172A]/40 to-black/25" />
                  <div className="absolute bottom-4 left-4 text-white">
                    <p className="text-lg sm:text-xl font-mono-num font-extrabold text-white drop-shadow-xs">
                      9:00-19:00
                    </p>
                    <p className="text-xs font-medium text-slate-200 drop-shadow-xs mt-0.5">
                      Horaires du service client en ligne
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {SUPPORT_CHANNELS.map((ch) => (
                    <a
                      key={ch.id}
                      href={ch.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full min-h-[52px] rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors shadow-2xs"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-9 h-9 rounded-full bg-[#0F172A] text-[#F5C533] flex items-center justify-center shrink-0">
                          <Send className="w-4 h-4 -ml-0.5" />
                        </div>
                        <span className="text-xs sm:text-sm font-semibold text-[#0F172A]">
                          {ch.label}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                    </a>
                  ))}
                </div>

                <div className="rounded-xl bg-white border border-[#E2E5EC] p-4 space-y-2 text-xs text-[#334155] leading-relaxed shadow-2xs">
                  <p>
                    1. Pour toute question, n&apos;hésitez pas à contacter notre service client en
                    ligne. Nous serons ravis de vous aider.
                  </p>
                  <p>
                    2. Veuillez conserver votre mot de passe en lieu sûr et ne le divulguez à
                    personne. Le personnel officiel ne vous le demandera jamais.
                  </p>
                </div>
              </section>
            )}

            {accountSubpage === 'gift_code' && (
              <section className="space-y-4">
                <div className="rounded-xl bg-white border border-[#EAECEF] px-3 py-2.5 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setAccountSubpage('menu')}
                    className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#111827] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                    aria-label="Retour"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-base sm:text-lg font-medium text-[#111827]">
                    Utiliser un code cadeau
                  </h2>
                  <div className="w-11" />
                </div>

                <div className="h-44 sm:h-52 rounded-2xl overflow-hidden border border-[#EAECEF] bg-[#111827] shadow-2xs">
                  <SafeImage
                    src={BRAND_IMAGES.brandShowcase}
                    alt="Code cadeau AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                </div>

                <p className="text-xs sm:text-sm text-[#4B5563] px-1">
                  Vous pouvez obtenir un code cadeau dans le groupe officiel
                </p>

                <a
                  href={TELEGRAM_GROUP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[60px] rounded-xl bg-white border border-[#EAECEF] px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F9FAFB] transition-colors shadow-2xs"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-full bg-[#0284C7] text-white flex items-center justify-center shrink-0">
                      <Send className="w-5 h-5 -ml-0.5" />
                    </div>
                    <span className="text-sm font-medium text-[#111827]">
                      Groupe AURELIA MOBILE
                    </span>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#9CA3AF] shrink-0" />
                </a>

                <form
                  onSubmit={handleRedeemGiftCode}
                  className="rounded-2xl bg-white border border-[#EAECEF] p-5 space-y-4 shadow-2xs"
                >
                  <div>
                    <label
                      htmlFor="gift-code-input"
                      className="block text-sm font-medium text-[#111827] mb-2.5"
                    >
                      <span className="text-[#DC2626] mr-1">*</span>
                      Code cadeau
                    </label>
                    <input
                      id="gift-code-input"
                      type="text"
                      value={giftCodeInput}
                      onChange={(e) => setGiftCodeInput(e.target.value.toUpperCase())}
                      placeholder="Saisissez le code cadeau"
                      autoCapitalize="characters"
                      autoComplete="off"
                      maxLength={32}
                      required
                      className="w-full min-h-[48px] px-4 rounded-lg bg-[#ECEEEF] border border-transparent focus:border-[#F5B800] focus:bg-white text-center text-sm font-mono-num tracking-wider text-[#111827] placeholder-[#6B7280] focus:outline-none transition-colors"
                    />
                  </div>

                  {giftCodeFeedback && (
                    <div
                      className={`p-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                        giftCodeFeedback.type === 'success'
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border border-red-200 text-red-900'
                      }`}
                    >
                      {giftCodeFeedback.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
                      ) : (
                        <AlertCircle className="w-4 h-4 shrink-0 text-red-700" />
                      )}
                      <span>{giftCodeFeedback.text}</span>
                    </div>
                  )}

                  <p className="text-[11px] text-[#6B7280] text-center">
                    Récompense aléatoire de {formatCFA(GIFT_CODE_MIN_CFA)} à{' '}
                    {formatCFA(GIFT_CODE_MAX_CFA)} · 1 seule utilisation par code et par compte.
                  </p>

                  <div className="pt-1 flex justify-center">
                    <button
                      type="submit"
                      disabled={redeemingGiftCode}
                      className="min-w-[200px] min-h-[46px] px-8 aurelia-gold-btn text-sm font-medium cursor-pointer disabled:opacity-50"
                    >
                      {redeemingGiftCode ? 'Validation...' : 'Confirmer'}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </main>
        )}

        {/* TAB 5: ADMIN */}
        {activeTab === 'admin' && isAdmin && (
          <main>
            <AdminPanel
              projects={projects}
              users={allUsers}
              transactions={allTransactions}
              investments={allInvestments}
              referrals={allReferrals}
              giftCodes={cloudGiftCodes}
              settings={settings}
              onSaveProject={handleAdminSaveProject}
              onResetOfficialVipCatalog={handleAdminSyncOfficialCatalog}
              onProcessTransaction={handleAdminProcessTransaction}
              onAdjustUserBalance={handleAdminAdjustBalance}
              onGiftProduct={handleAdminGiftProduct}
              onSaveGiftCode={handleAdminSaveGiftCode}
              onSaveSettings={handleAdminSaveSettings}
              isCloudConnected={isSupabaseConfigured || !!firebaseUser}
              onConnectGoogleCloud={isSupabaseConfigured ? undefined : handleGoogleSignIn}
              onRefreshAdmin={
                isSupabaseConfigured
                  ? () => refreshSupabaseState(userProfile, sbUser?.email)
                  : undefined
              }
            />
          </main>
        )}
      </div>

      {/* Bottom Sticky Navigation Bar */}
      <nav
        aria-label="Navigation principale"
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#EAECEF] shadow-[0_-2px_10px_rgba(0,0,0,0.04)]"
      >
        <div className="max-w-5xl mx-auto px-2 h-16 grid grid-cols-4 items-center">
          {[
            { id: 'home' as const, label: 'Accueil', icon: Home },
            { id: 'projects' as const, label: 'Produit', icon: Smartphone },
            { id: 'team' as const, label: 'Équipe', icon: Users },
            { id: 'account' as const, label: 'Moi', icon: User },
          ].map((item) => {
            const Icon = item.icon;
            const active =
              activeTab === item.id ||
              (item.id === 'home' && activeTab === 'checkin') ||
              (item.id === 'projects' && activeTab === 'investments') ||
              (item.id === 'account' && activeTab === 'admin');
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  if (item.id === 'account') setAccountSubpage('menu');
                  if (item.id === 'team') setShowTeamDetails(false);
                }}
                className={`relative h-full flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer ${
                  active ? 'text-[#D97706]' : 'text-[#9CA3AF] hover:text-[#F59E0B]'
                }`}
              >
                {active && (
                  <span className="absolute top-0 inset-x-6 h-[2.5px] rounded-b-full bg-[#F5B800]" />
                )}
                <Icon
                  className={`w-5 h-5 ${
                    active ? 'text-[#F5B800] stroke-[2.2]' : 'text-[#F5B800]/75 stroke-[1.75]'
                  }`}
                />
                <span
                  className={`text-xs tracking-tight truncate max-w-[90%] ${
                    active ? 'font-medium text-[#D97706]' : 'font-normal text-[#6B7280]'
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      <DepositModal
        isOpen={depositModalOpen}
        onClose={() => setDepositModalOpen(false)}
        userProfile={userProfile}
        settings={settings}
        onSubmitDeposit={handleDeposit}
        requireApprovalOnly={isSupabaseConfigured}
      />

      <WithdrawModal
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        userProfile={userProfile}
        settings={settings}
        onSubmitWithdraw={handleWithdraw}
        onConfigureWithdrawalAccount={() => {
          setActiveTab('account');
          setAccountSubpage('withdrawal_account');
        }}
      />

      <BuyVipModal
        isOpen={buyModalOpen}
        onClose={() => setBuyModalOpen(false)}
        project={selectedProject}
        projects={visibleProjects}
        onSelectProject={(proj) => setSelectedProject(proj)}
        userProfile={userProfile}
        allowMultipleSameVip={settings.allowMultipleSameVip !== false}
        activeOwnedCountForSelected={
          (selectedProject && projectOwnershipMap[selectedProject.id]?.activeCount) || 0
        }
        onConfirmInvest={handlePurchaseVip}
        onOpenDeposit={() => setDepositModalOpen(true)}
      />

      <SupportModal
        isOpen={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
      />

      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        userProfile={userProfile}
        settings={settings}
      />

      <InfoWelcomeModal
        isOpen={infoPopupOpen}
        onClose={() => setInfoPopupOpen(false)}
      />
    </div>
  );
}
