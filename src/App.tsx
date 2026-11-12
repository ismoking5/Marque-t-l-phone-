import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Award,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  FileText,
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
  Volume2,
  Wallet,
} from 'lucide-react';
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
  DEFAULT_ADMIN_PHONE,
  DEFAULT_SETTINGS,
  OFFICIAL_VIP_CATALOG,
  OFFICIAL_VIP_IDS,
  SUPPORT_CHANNELS,
  clampStr,
  computeInvestmentMetrics,
  formatCFA,
  formatDateFr,
  getProjectDailyIncome,
  phonesMatch,
  sanitizeId,
} from './data/catalog';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  signInWithGooglePopup,
  signOutFirebase,
} from './firebase';
import type {
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
  ReferralModal,
  SupportModal,
  WithdrawModal,
} from './components/Modals';

const ACCOUNTS_KEY = 'aurelia_mobile_phone_accounts_v1';
const SESSION_KEY = 'aurelia_mobile_active_phone_session_v1';
const PROJECTS_KEY = 'aurelia_mobile_projects_v1';
const SETTINGS_KEY = 'aurelia_mobile_settings_v1';
const REF_UID_KEY = 'aurelia_mobile_ref_uid';

function loadAccounts(): Record<string, PhoneAccountRecord> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PhoneAccountRecord>) : {};
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

function loadLocalSettings(): PlatformSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<PlatformSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveLocalSettings(settings: PlatformSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
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
    'home' | 'projects' | 'investments' | 'team' | 'account' | 'admin'
  >('home');
  const [accountSubpage, setAccountSubpage] = useState<
    'menu' | 'history' | 'withdrawal_account' | 'password' | 'about' | 'support'
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

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  };

  const isAdmin = useMemo(() => {
    if (!firebaseUser && !phoneSessionKey) return false;
    return !!(
      userProfile?.role === 'admin' ||
      phonesMatch(userProfile?.phone, settings.adminPhone) ||
      firebaseUser?.email === ADMIN_EMAIL
    );
  }, [firebaseUser, phoneSessionKey, userProfile, settings.adminPhone]);

  const { allUsers, allTransactions, allInvestments, allReferrals } = useMemo(() => {
    const localList = Object.values(loadAccounts());

    const usersMap = new Map<string, UserProfile>();
    cloudUsers.forEach((u) => usersMap.set(u.uid, u));
    localList.forEach((acc) => {
      const adminFlag =
        acc.profile.role === 'admin' || phonesMatch(acc.profile.phone, settings.adminPhone);
      usersMap.set(acc.profile.uid, {
        ...acc.profile,
        role: adminFlag ? 'admin' : acc.profile.role,
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

    return {
      allUsers: Array.from(usersMap.values()),
      allTransactions: Array.from(txMap.values()),
      allInvestments: Array.from(invMap.values()),
      allReferrals: Array.from(refMap.values()),
    };
  }, [cloudUsers, cloudTransactions, cloudInvestments, cloudReferrals, localSyncTick, settings.adminPhone]);

  // Read URL referral params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    const code = params.get('code');
    if (ref) localStorage.setItem(REF_UID_KEY, sanitizeId(ref));
    if (code) setInitialInviteCode(sanitizeId(code));
    else if (ref) setInitialInviteCode(sanitizeId(ref));
  }, []);

  // Load local phone account when not using Firebase Auth
  useEffect(() => {
    if (firebaseUser || !phoneSessionKey) return;
    const accounts = loadAccounts();
    const record = accounts[phoneSessionKey];
    if (record) {
      const promoted =
        record.profile.role === 'admin' || phonesMatch(record.profile.phone, settings.adminPhone)
          ? { ...record.profile, role: 'admin' as const }
          : record.profile;
      setUserProfile(promoted);
      setInvestments(record.investments || []);
      setTransactions(record.transactions || []);
      setReferrals(record.referrals || []);
      setWdCountry(promoted.withdrawalCountry || 'Burkina Faso');
      setWdMethod(promoted.withdrawalMethod || 'Orange Money Burkina');
      setWdAccount(promoted.withdrawalAccount || promoted.phone || '');
      setWdHolder(promoted.withdrawalHolder || promoted.displayName || '');
    } else {
      setPhoneSessionKey(null);
      localStorage.removeItem(SESSION_KEY);
    }
  }, [firebaseUser, phoneSessionKey, settings.adminPhone, localSyncTick]);

  // Firebase Auth listener
  useEffect(() => {
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

  // Real-time Firestore listeners for public catalog, settings, and signed-in user's data
  useEffect(() => {
    if (!authReady) return;
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
            const data = { ...DEFAULT_SETTINGS, ...(snap.data() as PlatformSettings) };
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
              const isBootstrapAdmin = firebaseUser.email === ADMIN_EMAIL;
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

  // Admin cloud listeners
  useEffect(() => {
    if (!authReady || !firebaseUser || !isAdmin) return;
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
    return () => {
      u1();
      u2();
      u3();
      u4();
    };
  }, [authReady, firebaseUser, isAdmin]);

  // Automatic 24h daily VIP payout synchronization
  useEffect(() => {
    if (!userProfile || investments.length === 0 || payoutSyncingRef.current) return;
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
    const dialCode = payload.dialCode.trim();
    const cleanPhone = payload.phone.replace(/\s+/g, '').trim();
    const key = `${dialCode}_${cleanPhone}`;
    const fullPhone = `${dialCode} ${cleanPhone}`;
    const accounts = loadAccounts();
    const hasExistingAdmin = Object.values(accounts).some((a) => a.profile.role === 'admin');
    const matchesAdminPhone = phonesMatch(fullPhone, settings.adminPhone);
    const hasAdminInvite = payload.invitationCode.trim().toUpperCase() === 'ADMIN-AM';
    const shouldBeAdmin = matchesAdminPhone || hasAdminInvite || !hasExistingAdmin;
    const defaultMethod =
      COUNTRY_OPTIONS.find((c) => c.country === payload.country)?.methods[0] ||
      'Orange Money Burkina';

    if (payload.mode === 'register') {
      if (accounts[key]) {
        throw new Error('Ce numéro de téléphone est déjà inscrit. Veuillez vous connecter.');
      }
      const nowIso = new Date().toISOString();
      const uid = sanitizeId(`usr_${dialCode.replace(/\D/g, '')}_${cleanPhone.replace(/\D/g, '')}`);
      const referralCode = sanitizeId(
        `AM-${cleanPhone.replace(/\D/g, '').slice(-6).padStart(6, '0')}`
      );
      const referredBy = payload.invitationCode
        ? sanitizeId(payload.invitationCode)
        : localStorage.getItem(REF_UID_KEY) || '';

      const newProfile: UserProfile = {
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
        referredBy,
        referralBonus: 0,
        referralCount: 0,
        role: shouldBeAdmin ? 'admin' : 'user',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      if (!hasExistingAdmin && shouldBeAdmin) {
        const nextSettings = { ...settings, adminPhone: fullPhone };
        setSettings(nextSettings);
        saveLocalSettings(nextSettings);
      }

      if (referredBy) {
        const sponsor = Object.values(accounts).find(
          (a) => a.profile.referralCode === referredBy || a.profile.uid === referredBy
        );
        if (sponsor && sponsor.key !== key) {
          const refRecord: ReferralItem = {
            id: sanitizeId(`ref_${sponsor.profile.uid.slice(0, 14)}_${uid.slice(0, 14)}`),
            referrerUid: sponsor.profile.uid,
            referredUid: uid,
            referredName: cleanPhone,
            level: 1,
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
      }

      accounts[key] = {
        key,
        password: payload.password,
        profile: newProfile,
        investments: [],
        transactions: [],
        referrals: [],
      };
      saveAccounts(accounts);
      setLocalSyncTick((t) => t + 1);
      localStorage.setItem(SESSION_KEY, key);
      setPhoneSessionKey(key);
      setUserProfile(newProfile);
      setInvestments([]);
      setTransactions([]);
      setReferrals([]);
      setWdCountry(payload.country);
      setWdMethod(defaultMethod);
      setWdAccount(fullPhone);
      setWdHolder(fullPhone);
      setActiveTab('home');
      showToast('Inscription réussie ! Bienvenue sur AURELIA MOBILE.');
      return;
    }

    // Login mode
    const existing = accounts[key];
    if (existing) {
      if (existing.password !== payload.password) {
        throw new Error('Mot de passe incorrect. Veuillez vérifier votre saisie.');
      }
      const nextProfile: UserProfile =
        existing.profile.role === 'admin' || matchesAdminPhone || !hasExistingAdmin
          ? { ...existing.profile, role: 'admin' }
          : existing.profile;
      if (nextProfile.role !== existing.profile.role) {
        accounts[key] = { ...existing, profile: nextProfile };
        saveAccounts(accounts);
        setLocalSyncTick((t) => t + 1);
      }
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
      showToast('Connexion réussie.');
      return;
    }

    // Auto-create local profile on first sign-in (matches reference model behavior)
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
      role: shouldBeAdmin ? 'admin' : 'user',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if (!hasExistingAdmin && shouldBeAdmin) {
      const nextSettings = { ...settings, adminPhone: fullPhone };
      setSettings(nextSettings);
      saveLocalSettings(nextSettings);
    }
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
    showToast('Connexion réussie.');
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGooglePopup();
      showToast('Connexion Google réussie.');
    } catch {
      showToast('Connexion Google annulée ou indisponible.');
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem(SESSION_KEY);
    setPhoneSessionKey(null);
    if (firebaseUser) await signOutFirebase();
    setUserProfile(null);
    setInvestments([]);
    setTransactions([]);
    setReferrals([]);
    setActiveTab('home');
    setAccountSubpage('menu');
    showToast('Vous êtes déconnecté.');
  };

  const handleDeposit = async (
    amount: number,
    method: string,
    phoneOrAccount: string,
    instantCredit: boolean
  ) => {
    if (!userProfile) throw new Error('Veuillez vous connecter pour confirmer votre recharge.');
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
          const sponsor = Object.values(accounts).find(
            (a) =>
              a.profile.referralCode === currentRefCode || a.profile.uid === currentRefCode
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
    if (newPassword.length < 4) {
      setPasswordFeedback({
        type: 'error',
        text: 'Le nouveau mot de passe doit contenir au moins 4 caractères.',
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
    const nextBalance = Math.max(0, Math.round(targetUser.balance + delta));
    const txId = sanitizeId(`tx_cred_${Date.now()}_${targetUser.uid.slice(0, 6)}`);
    const nowIso = new Date().toISOString();

    const accounts = loadAccounts();
    const acc = Object.values(accounts).find((a) => a.profile.uid === targetUser.uid);
    if (acc) {
      const tx: TransactionItem = {
        id: txId,
        userId: sanitizeId(targetUser.uid),
        userName: clampStr(targetUser.displayName, 1, 100),
        type: 'credit',
        amount: Math.abs(Math.round(delta)),
        method: 'Crédit Administrateur',
        phoneOrAccount: targetUser.referralCode || targetUser.phone,
        reference: clampStr(reason || 'Crédit ajouté au compte', 2, 100),
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
        await updateDoc(doc(db, 'users', targetUser.uid), {
          balance: nextBalance,
          updatedAt: serverTimestamp(),
        });
        await setDoc(doc(db, 'transactions', txId), {
          id: txId,
          userId: sanitizeId(targetUser.uid),
          userName: clampStr(targetUser.displayName, 1, 100),
          type: 'credit',
          amount: Math.abs(Math.round(delta)),
          method: 'Crédit Administrateur',
          phoneOrAccount: targetUser.referralCode || targetUser.email,
          reference: clampStr(reason || 'Crédit ajouté au compte', 2, 100),
          status: 'completed',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      }
    }
  };

  const handleAdminSaveSettings = async (nextSettings: PlatformSettings) => {
    const cleaned: PlatformSettings = {
      id: 'global',
      referralRate: Math.max(0, Math.min(50, Number(nextSettings.referralRate))),
      minDeposit: Math.max(500, Number(nextSettings.minDeposit)),
      minWithdrawal: Math.max(500, Number(nextSettings.minWithdrawal)),
      supportPhone: clampStr(nextSettings.supportPhone, 3, 50),
      supportEmail: clampStr(nextSettings.supportEmail, 3, 120),
      adminPhone: clampStr(nextSettings.adminPhone || DEFAULT_ADMIN_PHONE, 3, 50),
      announcement: clampStr(nextSettings.announcement, 2, 300),
      allowMultipleSameVip: nextSettings.allowMultipleSameVip !== false,
      visibility: 'public',
      updatedAt: new Date().toISOString(),
    };
    setSettings(cleaned);
    saveLocalSettings(cleaned);

    if (!firebaseUser) return;
    try {
      const ref = doc(db, 'settings', 'global');
      const payload = { ...cleaned, updatedAt: serverTimestamp() };
      if ((await getDoc(ref)).exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
      }
    } catch (err) {
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
      return sortedTransactions.filter((t) => t.type === 'credit' || t.type === 'referral');
    }
    return sortedTransactions.filter((t) => t.type === historyFilter);
  }, [sortedTransactions, historyFilter]);

  const selectedCountryOption = useMemo(
    () => COUNTRY_OPTIONS.find((c) => c.country === wdCountry) || COUNTRY_OPTIONS[0],
    [wdCountry]
  );

  // Team levels breakdown
  const teamByLevel = useMemo(() => {
    const lvl1 = referrals.filter((r) => !r.level || r.level === 1);
    const lvl2 = referrals.filter((r) => r.level === 2);
    const lvl3 = referrals.filter((r) => r.level === 3);
    const sum = (list: ReferralItem[]) =>
      list.reduce((acc, item) => acc + Math.round(item.commissionEarned || 0), 0);
    return {
      1: lvl1,
      2: lvl2,
      3: lvl3,
      revenue: { 1: sum(lvl1), 2: sum(lvl2), 3: sum(lvl3) },
      totalRevenue: sum(referrals),
    };
  }, [referrals]);

  // Render Auth screen when logged out
  if (authReady && !(firebaseUser || phoneSessionKey)) {
    return (
      <>
        {toastMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] px-4 py-3 rounded-2xl bg-[#0F172A] text-white shadow-lg border border-[#F5C533]/40 flex items-center gap-2.5 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-[#F5C533] shrink-0" />
            <span>{toastMsg}</span>
          </div>
        )}
        <AuthScreen
          initialInvitationCode={initialInviteCode}
          onSubmitPhoneAuth={handlePhoneAuth}
          onGoogleAuth={handleGoogleSignIn}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-[#0F172A] pb-24">
      {toastMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] px-4 py-3 rounded-2xl bg-[#0F172A] text-white shadow-lg border border-[#F5C533]/40 flex items-center gap-2.5 text-xs font-bold">
          <CheckCircle2 className="w-4 h-4 text-[#F5C533] shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-3.5 sm:px-6 pt-3 sm:pt-5 space-y-5">
        <header className="flex items-center justify-between gap-3 bg-white border border-[#E2E5EC] rounded-2xl px-4 py-2.5 shadow-2xs">
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
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#0F172A] text-[#F5C533] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">Administration</span>
            </button>
          )}
        </header>

        {/* TAB 1: HOME */}
        {activeTab === 'home' && (
          <main className="space-y-3.5 sm:space-y-4">
            <section className="relative h-72 sm:h-88 md:h-96 rounded-2xl overflow-hidden border border-[#CBD5E1] shadow-sm bg-[#0F172A]">
              <SafeImage
                src={BRAND_IMAGES.hero}
                alt="Smartphones haut de gamme AURELIA MOBILE"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#020617]/95 via-[#0F172A]/55 to-black/25 flex flex-col justify-end items-center text-center p-5 sm:p-8">
                <p className="text-xs sm:text-sm font-bold tracking-wider uppercase text-[#F5C533]">
                  AURELIA MOBILE · Haute Technologie &amp; Titane
                </p>
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold font-display text-white mt-1 max-w-xl leading-tight">
                  L&apos;excellence du smartphone, le rendement au quotidien.
                </h1>
                <p className="text-xs sm:text-sm text-slate-200 mt-1.5 max-w-md">
                  Équipez notre réseau de distribution de téléphones haut de gamme et percevez vos
                  revenus quotidiens automatiquement.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs font-extrabold tracking-wide">
                  <span className="text-[#F5C533]">TITANE &amp; VERRE SAPHIR</span>
                  <span className="text-white/50" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-white font-mono-num">CYCLE 90 JOURS</span>
                </div>
              </div>
            </section>

            <section
              aria-label="Actions principales"
              className="rounded-2xl bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#0F172A] border border-[#334155] text-white shadow-xs overflow-hidden"
            >
              <div className="grid grid-cols-3 divide-x divide-white/15">
                <button
                  type="button"
                  onClick={() => setDepositModalOpen(true)}
                  className="min-h-[76px] py-4 px-2 flex flex-col items-center justify-center gap-2 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Wallet className="w-7 h-7 text-[#F5C533]" />
                  <span className="text-xs sm:text-sm font-bold text-white text-center leading-tight">
                    Recharger
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setWithdrawModalOpen(true)}
                  className="min-h-[76px] py-4 px-2 flex flex-col items-center justify-center gap-2 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <ArrowUpRight className="w-7 h-7 text-[#F5C533]" />
                  <span className="text-xs sm:text-sm font-bold text-white text-center leading-tight">
                    Retirer de l&apos;argent
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setSupportModalOpen(true)}
                  className="min-h-[76px] py-4 px-2 flex flex-col items-center justify-center gap-2 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Headphones className="w-7 h-7 text-[#F5C533]" />
                  <span className="text-xs sm:text-sm font-bold text-white text-center leading-tight">
                    Service client
                  </span>
                </button>
              </div>
            </section>

            <section
              aria-label="Annonces et activités récentes"
              className="rounded-xl bg-white border border-[#E2E5EC] px-3.5 py-2.5 flex items-center gap-3 shadow-2xs overflow-hidden"
            >
              <div className="w-7 h-7 rounded-lg bg-[#F5C533]/25 text-[#0F172A] flex items-center justify-center shrink-0">
                <Volume2 className="w-4 h-4 text-[#0F172A]" />
              </div>
              <div className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap scrollbar-none text-xs sm:text-sm font-medium text-[#0F172A]">
                {sortedTransactions.length > 0 ? (
                  <span>
                    <strong className="text-[#0F172A]">Activité récente :</strong>{' '}
                    {transactionTypeLabel(sortedTransactions[0].type)}{' '}
                    <span className="font-mono-num font-bold">
                      {formatCFA(sortedTransactions[0].amount)}
                    </span>{' '}
                    · <span>{settings.announcement}</span>
                  </span>
                ) : (
                  <span>
                    <strong className="text-[#0F172A]">Info AURELIA MOBILE :</strong>{' '}
                    {settings.announcement} ·{' '}
                    <span className="font-mono-num">
                      ******9899 Recharge 15 000 F CFA · ******4120 Revenu VIP +2 500 F CFA
                    </span>
                  </span>
                )}
              </div>
            </section>

            <section aria-label="Informations financières" className="grid grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-2xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A] shadow-xs flex flex-col">
                <div className="bg-[#020617] py-3 px-2 text-center border-b border-white/10">
                  <span className="text-sm sm:text-lg font-mono-num font-extrabold text-[#F5C533]">
                    {formatCFA(userProfile?.balance || 0)}
                  </span>
                </div>
                <div className="relative h-32 sm:h-40 w-full overflow-hidden">
                  <SafeImage
                    src={BRAND_IMAGES.titanium}
                    alt="Smartphone titane brossé AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#020617]/85 via-[#0F172A]/45 to-transparent flex items-end justify-center p-2.5">
                    <span className="text-[11px] sm:text-xs font-medium text-slate-200 text-center">
                      {activeInvestmentsCount > 0
                        ? `${activeInvestmentsCount} modèle(s) VIP actif(s)`
                        : 'Disponible immédiatement'}
                    </span>
                  </div>
                </div>
                <div className="bg-[#1E293B] py-3 px-2 text-center border-t border-white/10">
                  <span className="text-xs sm:text-sm font-bold text-white">Solde du compte</span>
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden border border-[#CBD5E1] bg-[#1E293B] shadow-xs flex flex-col">
                <div className="bg-[#0F172A] py-3 px-2 text-center border-b border-white/10">
                  <span className="text-sm sm:text-lg font-mono-num font-extrabold text-[#F5C533]">
                    {formatCFA(userProfile?.totalEarned || 0)}
                  </span>
                </div>
                <div className="relative h-32 sm:h-40 w-full overflow-hidden">
                  <SafeImage
                    src={BRAND_IMAGES.ceramic}
                    alt="Édition Céramique & Or AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#020617]/85 via-[#1E293B]/45 to-transparent flex items-end justify-center p-2.5">
                    <span className="text-[11px] sm:text-xs font-medium text-amber-100 text-center font-mono-num">
                      +{formatCFA(totalDailyIncome)} / jour
                    </span>
                  </div>
                </div>
                <div className="bg-[#334155] py-3 px-2 text-center border-t border-white/10">
                  <span className="text-xs sm:text-sm font-bold text-white">Revenus totaux</span>
                </div>
              </div>
            </section>
          </main>
        )}

        {/* TAB 2: PRODUCTS CATALOG */}
        {activeTab === 'projects' && (
          <main className="space-y-4">
            <section className="relative h-48 sm:h-56 rounded-2xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A] flex items-center justify-center px-4">
              <SafeImage
                src={BRAND_IMAGES.hero}
                alt="Gamme Smartphones VIP AURELIA MOBILE"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-[#0F172A]/45 to-black/60" />
              <div className="relative z-10 w-full max-w-md rounded-2xl bg-white/95 backdrop-blur-xs shadow-lg border border-[#E2E5EC] py-3.5 px-4 grid grid-cols-2 divide-x divide-[#E2E5EC]">
                <button
                  type="button"
                  onClick={() => setActiveTab('investments')}
                  className="min-h-[44px] flex flex-col items-center justify-center text-center px-2 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <span className="text-lg sm:text-xl font-mono-num font-extrabold text-[#0F172A]">
                    {activeInvestmentsCount}
                  </span>
                  <span className="text-xs sm:text-sm text-[#475569] font-medium mt-0.5">
                    Mon produit
                  </span>
                </button>
                <div className="flex flex-col items-center justify-center text-center px-2">
                  <span className="text-lg sm:text-xl font-mono-num font-extrabold text-[#0F172A]">
                    {formatCFA(userProfile?.totalEarned || 0)}
                  </span>
                  <span className="text-xs sm:text-sm text-[#475569] font-medium mt-0.5">
                    Mes revenus
                  </span>
                </div>
              </div>
            </section>

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
                    className="rounded-2xl bg-white border border-[#E2E5EC] p-4 sm:p-5 shadow-2xs hover:border-[#0F172A]/40 transition-colors"
                  >
                    <div className="flex gap-4 sm:gap-5 items-center">
                      <div className="w-24 h-28 sm:w-28 sm:h-32 rounded-xl overflow-hidden shrink-0 border border-[#E2E5EC] bg-[#F8FAFC]">
                        <SafeImage
                          src={project.imageUrl}
                          alt={project.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="min-w-0">
                            <h3 className="text-base sm:text-lg font-extrabold text-[#0F172A] font-display leading-tight truncate">
                              {project.title}
                            </h3>
                            <p className="text-[11px] font-medium text-[#475569] truncate">
                              {project.category}
                            </p>
                          </div>
                          {project.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProject(project);
                                setBuyModalOpen(true);
                              }}
                              className="min-h-[40px] px-4 py-1.5 rounded-full bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs sm:text-sm font-extrabold transition-colors cursor-pointer shrink-0 shadow-2xs"
                            >
                              Acheter
                            </button>
                          ) : (
                            <span className="px-3 py-1.5 text-xs font-semibold text-[#475569] shrink-0">
                              Bientôt disponible
                            </span>
                          )}
                        </div>

                        <div className="space-y-1 text-xs sm:text-sm text-[#334155]">
                          <p>
                            Prix:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F172A]">
                              {formatCFA(project.minInvestment)}
                            </strong>
                          </p>
                          <p>
                            Période de validité:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F172A]">
                              {duration}
                            </strong>{' '}
                            jours
                            {(isActiveOwned || isExpiredOwned) && (
                              <span className="text-xs text-[#0F766E] font-semibold">
                                {' '}
                                · {remainingDays}j restants (
                                {isExpiredOwned ? 'Expiré' : `Actif ×${ownership.activeCount}`})
                              </span>
                            )}
                          </p>
                          <p>
                            Revenu quotidien:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F766E]">
                              {formatCFA(daily)}
                            </strong>
                          </p>
                          <p>
                            Revenu total:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F172A]">
                              {formatCFA(totalReturn)}
                            </strong>
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          </main>
        )}

        {/* SUBVIEW: MY ACTIVE PRODUCTS */}
        {activeTab === 'investments' && (
          <main className="space-y-3.5 sm:space-y-4">
            <div className="rounded-xl bg-white border border-[#E2E5EC] px-4 py-3 flex items-center justify-between shadow-2xs">
              <button
                type="button"
                onClick={() => setActiveTab('account')}
                className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
                aria-label="Retour"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-sm sm:text-base font-extrabold text-[#0F172A] font-display">
                Mon produit
              </h2>
              <div className="w-11" />
            </div>

            <section className="relative h-48 sm:h-56 rounded-2xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A] flex flex-col justify-center">
              <SafeImage
                src={BRAND_IMAGES.hero}
                alt="Mon produit AURELIA MOBILE"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-[#0F172A]/40 to-black/45" />
              <div className="relative z-10 flex flex-col items-start gap-3">
                <div className="w-44 sm:w-52 rounded-r-full bg-white/95 backdrop-blur-xs shadow-md border-y border-r border-[#E2E5EC] py-2.5 px-4 text-center">
                  <span className="block text-base sm:text-lg font-mono-num font-extrabold text-[#0F172A] leading-tight">
                    {activeInvestmentsCount}
                  </span>
                  <span className="block text-xs text-[#475569] font-medium mt-0.5">
                    Mon produit
                  </span>
                </div>
                <div className="w-44 sm:w-52 rounded-r-full bg-white/95 backdrop-blur-xs shadow-md border-y border-r border-[#E2E5EC] py-2.5 px-4 text-center">
                  <span className="block text-base sm:text-lg font-mono-num font-extrabold text-[#0F172A] leading-tight">
                    {formatCFA(userProfile?.totalEarned || 0)}
                  </span>
                  <span className="block text-xs text-[#475569] font-medium mt-0.5">
                    Mes revenus
                  </span>
                </div>
              </div>
            </section>

            {enrichedInvestments.length === 0 ? (
              <section className="rounded-2xl bg-white border border-[#E2E5EC] py-16 px-6 text-center shadow-2xs space-y-3">
                <p className="text-xs sm:text-sm font-medium text-[#475569]">
                  Vous n&apos;avez pas encore de produit.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('projects')}
                  className="min-h-[44px] px-6 rounded-full bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-extrabold cursor-pointer"
                >
                  Découvrir la gamme VIP
                </button>
              </section>
            ) : (
              <section className="space-y-3">
                {enrichedInvestments.map(({ inv, metrics }) => {
                  const catalogItem =
                    visibleProjects.find((p) => p.id === inv.projectId) || visibleProjects[0];
                  return (
                    <article
                      key={inv.id}
                      className="rounded-2xl bg-white border border-[#E2E5EC] p-4 shadow-2xs flex items-center gap-3.5 sm:gap-5"
                    >
                      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-[#F8FAFC] border border-[#E2E5EC] shrink-0">
                        <SafeImage
                          src={catalogItem?.imageUrl || BRAND_IMAGES.hero}
                          alt={inv.projectTitle}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <h3 className="text-base sm:text-lg font-extrabold text-[#0F172A] font-display truncate">
                            {inv.projectTitle}
                          </h3>
                          <span
                            className={`text-xs font-extrabold shrink-0 ${
                              metrics.isExpired ? 'text-[#64748B]' : 'text-[#0F766E]'
                            }`}
                          >
                            {metrics.displayStatus}
                          </span>
                        </div>
                        <div className="space-y-1 text-xs sm:text-sm text-[#334155]">
                          <p>
                            Prix:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F172A]">
                              {formatCFA(inv.amount)}
                            </strong>
                          </p>
                          <p>
                            Revenu quotidien:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F766E]">
                              {formatCFA(metrics.dailyIncome)}
                            </strong>
                          </p>
                          <p>
                            Jours restants:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F172A]">
                              {metrics.daysRemaining} / {metrics.durationDays} jours
                            </strong>
                          </p>
                          <p>
                            Revenu cumulé:{' '}
                            <strong className="font-mono-num font-extrabold text-[#0F172A]">
                              {formatCFA(metrics.totalEarnedSoFar)}
                            </strong>
                          </p>
                        </div>
                        {metrics.isExpired && catalogItem && (
                          <div className="pt-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedProject(catalogItem);
                                setBuyModalOpen(true);
                              }}
                              className="min-h-[40px] px-4 py-1.5 rounded-full bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-extrabold cursor-pointer"
                            >
                              Acheter à nouveau (90 jours)
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

        {/* TAB 3: TEAM & REFERRALS */}
        {activeTab === 'team' && (
          <main className="space-y-4">
            {showTeamDetails ? (
              <section className="max-w-lg mx-auto space-y-2.5">
                <div className="bg-white border border-[#E2E5EC] rounded-xl px-3.5 py-2.5 flex items-center justify-between shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setShowTeamDetails(false)}
                    className="min-w-[44px] min-h-[44px] -ml-1 flex items-center justify-center text-[#0F172A] hover:text-[#1E293B] transition-colors cursor-pointer"
                    aria-label="Retour à la page Équipe"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] tracking-tight">
                    Mon équipe
                  </h2>
                  <div className="w-11" />
                </div>

                <div className="bg-white border border-[#E2E5EC] rounded-xl grid grid-cols-3 text-center shadow-2xs overflow-hidden">
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
                          active ? 'text-[#0F172A]' : 'text-[#475569] hover:text-[#0F172A]'
                        }`}
                      >
                        <span className="text-xs sm:text-sm font-mono-num font-bold text-[#0F172A]">
                          {rewardedCount}
                        </span>
                        <span className="text-[11px] sm:text-xs font-medium text-[#475569]">
                          Niveau {lvl} ({list.length})
                        </span>
                        {active && (
                          <span className="absolute bottom-0 inset-x-0 h-[2px] bg-[#0F172A]" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="bg-white border border-[#E2E5EC] rounded-xl divide-y divide-[#F1F5F9] shadow-2xs overflow-hidden">
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
                          <BrandEmblem sizeClass="w-10 h-10" shape="square" />
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-mono-num font-bold text-[#0F172A] leading-tight truncate">
                              {masked}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#64748B] mt-0.5 truncate">
                              {formatDateFr(ref.createdAt) || 'Membre actif'}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-mono-num font-extrabold text-[#0F172A]">
                            FCFA {Math.round(ref.commissionEarned || 0).toLocaleString('fr-FR')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="py-4 px-4 text-center">
                    <p className="text-xs text-[#64748B] font-normal">
                      Il ne reste plus de données
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <>
                <div className="rounded-xl bg-white border border-[#E2E5EC] py-2 px-4 flex items-center justify-center shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setShowTeamDetails(true)}
                    className="min-h-[40px] px-4 text-xs sm:text-sm font-bold text-[#0F172A] hover:text-[#1E293B] transition-colors cursor-pointer"
                  >
                    Détails de l&apos;équipe &gt;&gt;
                  </button>
                </div>

                {(() => {
                  const code = userProfile?.referralCode || 'AM-INVITE';
                  const link = userProfile
                    ? `${window.location.origin}/?ref=${userProfile.uid}&code=${userProfile.referralCode}`
                    : `${window.location.origin}/?ref=AM-INVITE`;
                  return (
                    <section className="rounded-2xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A] shadow-xs">
                      <div className="relative h-52 sm:h-60 w-full">
                        <SafeImage
                          src={BRAND_IMAGES.titanium}
                          alt="Programme Équipe & Parrainage AURELIA MOBILE"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-[#0F172A]/55 to-black/20 flex flex-col justify-end p-4 sm:p-5">
                          <div className="grid grid-cols-2 gap-3 items-end text-center">
                            <div className="space-y-1 px-1">
                              <p className="text-base sm:text-xl font-mono-num font-extrabold text-[#F5C533] tracking-wide truncate">
                                {code}
                              </p>
                              <p className="text-[11px] sm:text-xs font-semibold text-white/95">
                                Code d&apos;invitation
                              </p>
                            </div>
                            <div className="space-y-1 px-1 min-w-0">
                              <p className="text-xs sm:text-sm font-mono-num font-bold text-[#F5C533] truncate">
                                {link}
                              </p>
                              <p className="text-[11px] sm:text-xs font-semibold text-white/95">
                                Lien d&apos;invitation
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 divide-x divide-[#0F172A]/15 bg-[#F5C533] text-[#0F172A]">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(code);
                            showToast("Code d'invitation copié !");
                          }}
                          className="min-h-[44px] font-extrabold text-xs sm:text-sm hover:bg-[#EAB308] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>Copie</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(link);
                            showToast("Lien d'invitation copié !");
                          }}
                          className="min-h-[44px] font-extrabold text-xs sm:text-sm hover:bg-[#EAB308] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>Copie</span>
                        </button>
                      </div>
                    </section>
                  );
                })()}

                <section className="px-1">
                  <div className="rounded-2xl bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#0F172A] text-white py-3 px-5 shadow-xs border border-[#334155] grid grid-cols-2 divide-x divide-white/20 text-center">
                    <div>
                      <p className="text-base sm:text-lg font-mono-num font-extrabold text-[#F5C533]">
                        {referrals.length}
                      </p>
                      <p className="text-[11px] sm:text-xs text-slate-200 font-medium">
                        Utilisateurs valides
                      </p>
                    </div>
                    <div>
                      <p className="text-base sm:text-lg font-mono-num font-extrabold text-[#F5C533]">
                        {formatCFA(teamByLevel.totalRevenue)}
                      </p>
                      <p className="text-[11px] sm:text-xs text-slate-200 font-medium">
                        Revenus de l&apos;équipe
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl bg-white border border-[#E2E5EC] divide-y divide-[#F1F5F9] overflow-hidden shadow-2xs">
                  {[
                    {
                      level: 1 as const,
                      rate: '30%',
                      users: teamByLevel[1].length,
                      revenue: teamByLevel.revenue[1],
                      medalBg: 'bg-[#F5C533] text-[#0F172A] border-[#D4AF37]',
                      ribbonBg: 'bg-[#0F172A]',
                    },
                    {
                      level: 2 as const,
                      rate: '2%',
                      users: teamByLevel[2].length,
                      revenue: teamByLevel.revenue[2],
                      medalBg: 'bg-[#E2E8F0] text-[#0F172A] border-[#94A3B8]',
                      ribbonBg: 'bg-[#334155]',
                    },
                    {
                      level: 3 as const,
                      rate: '1%',
                      users: teamByLevel[3].length,
                      revenue: teamByLevel.revenue[3],
                      medalBg: 'bg-[#E2D4C0] text-[#451A03] border-[#B48A5A]',
                      ribbonBg: 'bg-[#64748B]',
                    },
                  ].map((row) => (
                    <button
                      key={row.level}
                      type="button"
                      onClick={() => {
                        setTeamLevelTab(row.level);
                        setShowTeamDetails(true);
                      }}
                      className="w-full p-4 sm:p-5 grid grid-cols-12 items-center text-center gap-2 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <div className="col-span-2 flex flex-col items-center justify-center">
                        <div className={`w-5 h-2.5 rounded-t-xs ${row.ribbonBg}`} />
                        <div
                          className={`w-9 h-9 rounded-full border-2 flex flex-col items-center justify-center shadow-2xs -mt-0.5 ${row.medalBg}`}
                        >
                          <Award className="w-3 h-3 opacity-80" />
                          <span className="text-xs font-mono-num font-extrabold leading-none">
                            {row.level}
                          </span>
                        </div>
                      </div>
                      <div className="col-span-4 space-y-0.5">
                        <p className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F172A]">
                          {row.rate}
                        </p>
                        <p className="text-[11px] sm:text-xs text-[#475569]">Taux de commission</p>
                      </div>
                      <div className="col-span-3 space-y-0.5">
                        <p className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F172A]">
                          {row.users}
                        </p>
                        <p className="text-[11px] sm:text-xs text-[#475569]">Utilisateur</p>
                      </div>
                      <div className="col-span-3 space-y-0.5">
                        <p className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F766E]">
                          {row.revenue}
                        </p>
                        <p className="text-[11px] sm:text-xs text-[#475569]">Revenu</p>
                      </div>
                    </button>
                  ))}
                </section>

                <section className="rounded-2xl bg-white border border-[#E2E5EC] p-5 space-y-3.5 text-xs sm:text-sm text-[#334155] leading-relaxed shadow-2xs">
                  <p>
                    Lorsque les amis que vous invitez s&apos;inscrivent et effectuent un
                    investissement, vous recevez instantanément un cashback de{' '}
                    <strong className="text-[#0F172A]">30 %</strong>.
                  </p>
                  <p>
                    Vous bénéficiez d&apos;un cashback de{' '}
                    <strong className="text-[#0F172A]">2 %</strong> lorsque les membres de votre
                    équipe de niveau 2 investissent.
                  </p>
                  <p>
                    Vous bénéficiez d&apos;un cashback de{' '}
                    <strong className="text-[#0F172A]">1 %</strong> lorsque les membres de votre
                    équipe de niveau 3 investissent.
                  </p>
                  <p>
                    Les récompenses en espèces seront créditées sur votre compte une fois que les
                    membres de votre équipe auront investi. Vous pouvez les retirer immédiatement.
                  </p>
                </section>
              </>
            )}
          </main>
        )}

        {/* TAB 4: ACCOUNT */}
        {activeTab === 'account' && (
          <main className="space-y-5">
            {accountSubpage === 'menu' && (
              <div className="space-y-3.5">
                <div className="rounded-2xl overflow-hidden border border-[#E2E5EC] bg-white shadow-2xs">
                  <div className="grid grid-cols-12 items-stretch">
                    <div className="col-span-3 bg-[#F8FAFC] flex items-center justify-center py-4 px-2 border-r border-[#E2E5EC]">
                      <BrandEmblem sizeClass="w-12 h-12" shape="circle" />
                    </div>
                    <div className="col-span-5 bg-[#0F172A] text-white flex flex-col items-center justify-center py-4 px-2.5 text-center border-r border-white/15">
                      <span className="text-xs sm:text-sm font-mono-num font-extrabold tracking-tight truncate max-w-full">
                        {userProfile?.withdrawalAccount &&
                        userProfile.withdrawalAccount.trim().length > 4
                          ? userProfile.withdrawalAccount
                          : userProfile?.phone || userProfile?.referralCode || '+226 77409899'}
                      </span>
                      <span className="text-[10px] sm:text-xs text-slate-300 truncate max-w-full mt-0.5">
                        {userProfile?.displayName || 'Membre AURELIA MOBILE'}
                      </span>
                    </div>
                    <div className="col-span-4 bg-[#1E293B] text-white flex flex-col items-center justify-center py-4 px-2 text-center">
                      <span className="text-xs sm:text-sm font-mono-num font-extrabold text-[#F5C533]">
                        {formatCFA(userProfile?.balance || 0)}
                      </span>
                      <span className="text-[10px] sm:text-xs text-slate-200 mt-0.5">
                        Solde disponible
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 divide-x divide-[#E2E5EC] border-t border-[#E2E5EC] bg-white">
                    <button
                      type="button"
                      onClick={() => setDepositModalOpen(true)}
                      className="min-h-[60px] py-3.5 px-2 flex flex-col items-center justify-center gap-1.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <CreditCard className="w-5 h-5 text-[#0F172A]" />
                      <span className="text-[11px] sm:text-xs font-bold text-[#0F172A]">
                        Recharger
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setWithdrawModalOpen(true)}
                      className="min-h-[60px] py-3.5 px-2 flex flex-col items-center justify-center gap-1.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <ArrowUpRight className="w-5 h-5 text-[#0F172A]" />
                      <span className="text-[11px] sm:text-xs font-bold text-[#0F172A]">
                        Retrait
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryFilter('all');
                        setAccountSubpage('history');
                      }}
                      className="min-h-[60px] py-3.5 px-2 flex flex-col items-center justify-center gap-1.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                    >
                      <FileText className="w-5 h-5 text-[#0F172A]" />
                      <span className="text-[11px] sm:text-xs font-bold text-[#0F172A]">
                        Dossiers de compte
                      </span>
                    </button>
                  </div>
                </div>

                <div className="relative h-28 sm:h-36 rounded-2xl overflow-hidden border border-[#CBD5E1] bg-[#0F172A]">
                  <SafeImage
                    src={BRAND_IMAGES.ceramic}
                    alt="Univers AURELIA MOBILE"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#020617]/90 via-[#0F172A]/55 to-black/30 flex flex-col justify-center px-5">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-[#F5C533]">
                      AURELIA MOBILE
                    </p>
                    <p className="text-sm sm:text-base font-extrabold font-display text-white mt-0.5">
                      « L&apos;excellence du smartphone, le rendement au quotidien. »
                    </p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-[#E2E5EC] divide-y divide-[#F1F5F9] overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setActiveTab('investments')}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-[#F5C533] text-[#0F172A] flex items-center justify-center shrink-0">
                        <Smartphone className="w-4 h-4 stroke-[2.5]" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Mon produit ({activeInvestmentsCount})
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryFilter('all');
                      setAccountSubpage('history');
                    }}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F172A] flex items-center justify-center shrink-0">
                        <History className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Historique des transactions
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryFilter('withdrawal');
                      setAccountSubpage('history');
                    }}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 text-[#9A6B00] flex items-center justify-center shrink-0">
                        <Wallet className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Registres des retraits
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setHistoryFilter('deposit');
                      setAccountSubpage('history');
                    }}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F172A] flex items-center justify-center shrink-0">
                        <ArrowDownLeft className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Historique des recharges
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountSubpage('withdrawal_account')}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F172A] flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Gestion des comptes de retrait
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPasswordFeedback(null);
                      setAccountSubpage('password');
                    }}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F172A] flex items-center justify-center shrink-0">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Modifier le mot de passe
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountSubpage('about')}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F172A] flex items-center justify-center shrink-0">
                        <Info className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        À propos de l&apos;application
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setAccountSubpage('support')}
                    className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-[#0F172A] flex items-center justify-center shrink-0">
                        <Headphones className="w-4 h-4" />
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Service client
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#475569] shrink-0" />
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('admin')}
                      className="w-full min-h-[56px] px-4 py-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-[#F8FAFC] transition-colors text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className="w-8 h-8 rounded-lg bg-[#0F172A] text-[#F5C533] flex items-center justify-center shrink-0">
                          <Shield className="w-4 h-4" />
                        </div>
                        <span className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                          Espace Administrateur
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#0F172A] shrink-0" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full min-h-[48px] rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-sm shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Se déconnecter</span>
                </button>
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
                                  isCredit
                                    ? 'bg-slate-100 text-[#0F766E]'
                                    : 'bg-amber-50 text-[#9A6B00]'
                                }`}
                              >
                                {isCredit ? (
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
                                  isCredit ? 'text-[#0F766E]' : 'text-[#9A6B00]'
                                }`}
                              >
                                {isCredit ? '+' : '-'}
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
                        .replace(/Burkina|Côte d’Ivoire|Côte d'Ivoire/gi, '')
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
              settings={settings}
              onSaveProject={handleAdminSaveProject}
              onResetOfficialVipCatalog={handleAdminSyncOfficialCatalog}
              onProcessTransaction={handleAdminProcessTransaction}
              onAdjustUserBalance={handleAdminAdjustBalance}
              onSaveSettings={handleAdminSaveSettings}
            />
          </main>
        )}
      </div>

      {/* Bottom Sticky Navigation Bar */}
      <nav
        aria-label="Navigation principale"
        className="fixed bottom-0 inset-x-0 z-40 bg-[#0B1120] text-white border-t border-[#1E293B]"
      >
        <div className="max-w-5xl mx-auto px-2 h-16 grid grid-cols-4 items-center">
          {[
            { id: 'home' as const, label: 'Accueil', icon: Home },
            { id: 'projects' as const, label: 'Produits', icon: Smartphone },
            { id: 'team' as const, label: 'Équipe', icon: Users },
            { id: 'account' as const, label: 'Mon compte', icon: User },
          ].map((item) => {
            const Icon = item.icon;
            const active =
              activeTab === item.id ||
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
                  active ? 'text-[#F5C533]' : 'text-slate-300 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-bold tracking-tight truncate max-w-[90%]">
                  {item.label}
                </span>
                {active && (
                  <span className="absolute bottom-0 inset-x-6 h-1 rounded-t-full bg-[#F5C533]" />
                )}
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
    </div>
  );
}
