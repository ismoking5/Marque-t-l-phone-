import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  Calendar,
  CheckCircle2,
  CreditCard,
  Edit3,
  Eye,
  FileText,
  Gift,
  Layers,
  Mail,
  Minus,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Shield,
  Smartphone,
  UserCheck,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  BRAND_IMAGES,
  DEFAULT_ADMIN_PHONE,
  GIFT_CODE_MAX_CFA,
  GIFT_CODE_MIN_CFA,
  OFFICIAL_VIP_CATALOG,
  computeInvestmentMetrics,
  formatCFA,
  formatDateFr,
  getProjectDailyIncome,
} from '../data/catalog';
import type {
  GiftCodeItem,
  InvestmentItem,
  PlatformSettings,
  ProjectItem,
  ReferralItem,
  TransactionItem,
  UserProfile,
} from '../types';
import { SafeImage } from './Brand';

const PRESET_IMAGES = [
  { label: 'Gamme Flagship', url: BRAND_IMAGES.hero },
  { label: 'Titane Brossé', url: BRAND_IMAGES.titanium },
  { label: 'Édition Pliable', url: BRAND_IMAGES.foldable },
  { label: 'Céramique & Or', url: BRAND_IMAGES.ceramic },
];

function getTimestampMs(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'object' && val !== null && 'toMillis' in val) {
    const fn = (val as { toMillis?: () => number }).toMillis;
    if (typeof fn === 'function') return fn();
  }
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function AdminPanel({
  projects,
  users,
  transactions,
  investments,
  referrals,
  giftCodes = [],
  settings,
  onSaveProject,
  onResetOfficialVipCatalog,
  onProcessTransaction,
  onAdjustUserBalance,
  onGiftProduct,
  onSaveGiftCode,
  onSaveSettings,
  isCloudConnected = false,
  onConnectGoogleCloud,
  onRefreshAdmin,
}: {
  projects: ProjectItem[];
  users: UserProfile[];
  transactions: TransactionItem[];
  investments: InvestmentItem[];
  referrals: ReferralItem[];
  giftCodes?: GiftCodeItem[];
  settings: PlatformSettings;
  onSaveProject: (project: ProjectItem, isNew: boolean) => Promise<void>;
  onResetOfficialVipCatalog: () => Promise<void>;
  onProcessTransaction: (tx: TransactionItem, nextStatus: 'approved' | 'rejected') => Promise<void>;
  onAdjustUserBalance: (user: UserProfile, delta: number, reason: string) => Promise<void>;
  onGiftProduct: (
    user: UserProfile,
    project: ProjectItem,
    quantity: number,
    reason: string
  ) => Promise<void>;
  onSaveGiftCode?: (item: GiftCodeItem) => Promise<void>;
  onSaveSettings: (settings: PlatformSettings) => Promise<void>;
  isCloudConnected?: boolean;
  onConnectGoogleCloud?: () => Promise<void>;
  onRefreshAdmin?: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<
    'projects' | 'transactions' | 'investments' | 'referrals' | 'users' | 'gift_codes' | 'settings'
  >('projects');
  const [txFilter, setTxFilter] = useState<'all' | 'pending' | 'deposit' | 'withdrawal'>('all');
  const [userSearch, setUserSearch] = useState('');
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [isNewProject, setIsNewProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [newGiftCode, setNewGiftCode] = useState('');
  const [newGiftMaxUses, setNewGiftMaxUses] = useState('1000');

  // Credit / subtract balance modal state
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [creditOperation, setCreditOperation] = useState<'credit' | 'debit'>('credit');
  const [creditAmount, setCreditAmount] = useState('5000');
  const [creditReason, setCreditReason] = useState('Crédit ajouté par administration');
  const [creditError, setCreditError] = useState<string | null>(null);

  // Gift product modal state
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [giftTargetUid, setGiftTargetUid] = useState('');
  const [giftProjectId, setGiftProjectId] = useState('');
  const [giftQuantity, setGiftQuantity] = useState(1);
  const [giftReason, setGiftReason] = useState('Produit offert par administration');

  // Full user account detail modal state
  const [detailUserUid, setDetailUserUid] = useState<string | null>(null);
  const [detailTxFilter, setDetailTxFilter] = useState<
    'all' | 'deposit' | 'withdrawal' | 'investment' | 'payout' | 'credit'
  >('all');

  const [draftSettings, setDraftSettings] = useState<PlatformSettings>(settings);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const settingsFingerprint = JSON.stringify(settings);
  useEffect(() => {
    setDraftSettings(settings);
  }, [settingsFingerprint]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Full catalog including custom products & official fallback, active or paused
  const fullCatalog = useMemo(() => {
    const map = new Map<string, ProjectItem>();
    OFFICIAL_VIP_CATALOG.forEach((p) => map.set(p.id, p));
    projects.forEach((p) => map.set(p.id, p));
    return Array.from(map.values()).sort((a, b) => a.minInvestment - b.minInvestment);
  }, [projects]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      [
        u.displayName,
        u.phone,
        u.email,
        u.uid,
        u.referralCode,
        u.withdrawalAccount,
        u.withdrawalCountry,
        u.withdrawalHolder,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    );
  }, [users, userSearch]);

  const detailUser = useMemo(
    () => (detailUserUid ? users.find((u) => u.uid === detailUserUid) || null : null),
    [detailUserUid, users]
  );

  const detailUserData = useMemo(() => {
    if (!detailUser) return null;
    const now = Date.now();
    const userInvestments = investments
      .filter((i) => i.userId === detailUser.uid)
      .map((inv) => ({ inv, metrics: computeInvestmentMetrics(inv, now) }))
      .sort((a, b) => b.inv.purchasedAtMs - a.inv.purchasedAtMs);

    const activeDailyIncome = userInvestments
      .filter((item) => !item.metrics.isExpired && item.inv.status === 'active')
      .reduce((acc, item) => acc + item.metrics.dailyIncome, 0);

    const userTransactions = transactions
      .filter((t) => t.userId === detailUser.uid)
      .sort((a, b) => getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt));

    const filteredUserTransactions = userTransactions.filter((t) => {
      if (detailTxFilter === 'all') return true;
      if (detailTxFilter === 'credit') {
        return t.type === 'credit' || t.type === 'referral' || t.type === 'gift';
      }
      return t.type === detailTxFilter;
    });

    const totalDeposits = userTransactions
      .filter((t) => t.type === 'deposit' && (t.status === 'approved' || t.status === 'completed'))
      .reduce((acc, t) => acc + t.amount, 0);

    const totalWithdrawals = userTransactions
      .filter((t) => t.type === 'withdrawal' && t.status !== 'rejected')
      .reduce((acc, t) => acc + t.amount, 0);

    const userReferrals = referrals.filter((r) => r.referrerUid === detailUser.uid);

    const sponsor = detailUser.referredBy
      ? users.find(
          (u) => u.referralCode === detailUser.referredBy || u.uid === detailUser.referredBy
        ) || null
      : null;

    return {
      userInvestments,
      activeDailyIncome,
      userTransactions,
      filteredUserTransactions,
      totalDeposits,
      totalWithdrawals,
      userReferrals,
      sponsor,
    };
  }, [detailUser, detailTxFilter, investments, transactions, referrals, users]);

  const openCreditModal = (user: UserProfile, op: 'credit' | 'debit' = 'credit') => {
    setSelectedUser(user);
    setCreditOperation(op);
    setCreditAmount('5000');
    setCreditReason(
      op === 'debit'
        ? 'Ajustement / retrait par administration'
        : 'Crédit ajouté par administration'
    );
    setCreditError(null);
  };

  const openGiftModal = (opts?: { user?: UserProfile | null; project?: ProjectItem | null }) => {
    if (users.length === 0) {
      notify('Aucun utilisateur inscrit pour le moment.');
      return;
    }
    const target = opts?.user || users[0];
    const prod = opts?.project || fullCatalog[0];
    setGiftTargetUid(target?.uid || '');
    setGiftProjectId(prod?.id || '');
    setGiftQuantity(1);
    setGiftReason('Produit offert par administration');
    setGiftModalOpen(true);
  };

  const openNewProjectForm = () => {
    setIsNewProject(true);
    setEditingProject({
      id: `vip_${Date.now().toString().slice(-4)}`,
      title: `VIP ${projects.length + 1} · Aurelia Edition`,
      category: 'Smartphone Titane Premium',
      description:
        'Modèle haut de gamme sur 90 jours avec versement automatique du revenu quotidien.',
      location: "Afrique de l'Ouest",
      imageUrl: BRAND_IMAGES.titanium,
      returnRate: 900,
      durationDays: 90,
      minInvestment: 10000,
      dailyIncome: 1200,
      targetAmount: 30000000,
      raisedAmount: 0,
      investorsCount: 0,
      status: 'active',
      visibility: 'public',
    });
  };

  const handleSaveProjectSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setSaving(true);
    try {
      const daily = editingProject.dailyIncome || 400;
      const days = editingProject.durationDays || 90;
      const price = editingProject.minInvestment || 4000;
      const computedRate = Math.max(1, Math.round(((daily * days) / price) * 100));
      await onSaveProject(
        {
          ...editingProject,
          dailyIncome: daily,
          durationDays: days,
          returnRate: computedRate,
        },
        isNewProject
      );
      setEditingProject(null);
      notify(isNewProject ? 'Nouveau modèle enregistré.' : 'Modèle mis à jour.');
    } catch (err) {
      notify(err instanceof Error ? err.message : "Impossible d'enregistrer ce produit.");
    } finally {
      setSaving(false);
    }
  };

  const handleSyncCatalog = async () => {
    setSaving(true);
    try {
      await onResetOfficialVipCatalog();
      notify('Catalogue VIP 1 à VIP 5 synchronisé.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de la synchronisation du catalogue.');
    } finally {
      setSaving(false);
    }
  };

  const handleProcessTx = async (tx: TransactionItem, nextStatus: 'approved' | 'rejected') => {
    setSaving(true);
    try {
      await onProcessTransaction(tx, nextStatus);
      notify(nextStatus === 'approved' ? 'Transaction approuvée.' : 'Transaction rejetée.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors du traitement de la transaction.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettingsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSettingsError(null);
    setSaving(true);
    try {
      await onSaveSettings(draftSettings);
      notify('Tous les paramètres ont été enregistrés.');
    } catch (err) {
      setSettingsError(
        err instanceof Error ? err.message : "Impossible d'enregistrer les paramètres."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCreditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setCreditError(null);
    const parsedAmt = Math.round(Number(creditAmount) || 0);
    if (!Number.isFinite(parsedAmt) || parsedAmt <= 0) {
      setCreditError('Veuillez saisir un montant strictement supérieur à 0 F CFA.');
      return;
    }
    const signedDelta = creditOperation === 'debit' ? -parsedAmt : parsedAmt;
    setSaving(true);
    try {
      await onAdjustUserBalance(selectedUser, signedDelta, creditReason);
      notify(
        `${creditOperation === 'debit' ? '-' : '+'}${formatCFA(parsedAmt)} appliqué à ${selectedUser.displayName}.`
      );
      setSelectedUser(null);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Impossible de modifier le solde de cet utilisateur.';
      setCreditError(msg);
      notify(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleGiftSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const targetUser = users.find((u) => u.uid === giftTargetUid);
    const targetProject = fullCatalog.find((p) => p.id === giftProjectId);
    if (!targetUser || !targetProject) return;
    setSaving(true);
    try {
      await onGiftProduct(targetUser, targetProject, giftQuantity, giftReason);
      notify(
        `${giftQuantity > 1 ? `${giftQuantity}x ` : ''}${targetProject.title} offert à ${targetUser.displayName}.`
      );
      setGiftModalOpen(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Impossible d'offrir le produit.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateGiftCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!onSaveGiftCode) return;
    const cleanedCode = newGiftCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (cleanedCode.length < 3) {
      notify('Veuillez saisir un code cadeau d’au moins 3 caractères (lettres ou chiffres).');
      return;
    }
    setSaving(true);
    try {
      await onSaveGiftCode({
        code: cleanedCode,
        minAmount: GIFT_CODE_MIN_CFA,
        maxAmount: GIFT_CODE_MAX_CFA,
        maxUses: Math.max(1, Math.round(Number(newGiftMaxUses) || 1000)),
        usesCount: 0,
        isActive: true,
      });
      setNewGiftCode('');
      notify(`Code cadeau ${cleanedCode} créé (gain aléatoire ${GIFT_CODE_MIN_CFA} à ${GIFT_CODE_MAX_CFA} F CFA).`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Erreur lors de la création du code cadeau.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGiftCode = async (item: GiftCodeItem) => {
    if (!onSaveGiftCode) return;
    setSaving(true);
    try {
      await onSaveGiftCode({
        ...item,
        isActive: !item.isActive,
      });
      notify(
        item.isActive
          ? `Code cadeau ${item.code} désactivé.`
          : `Code cadeau ${item.code} réactivé.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Impossible de modifier ce code cadeau.');
    } finally {
      setSaving(false);
    }
  };

  const selectedGiftProject = fullCatalog.find((p) => p.id === giftProjectId) || fullCatalog[0];
  const selectedGiftUser = users.find((u) => u.uid === giftTargetUid) || null;
  const giftUnitDaily = selectedGiftProject ? getProjectDailyIncome(selectedGiftProject) : 0;
  const giftTotalDaily = giftUnitDaily * Math.max(1, giftQuantity);
  const giftDuration = selectedGiftProject?.durationDays || 90;

  const pendingCount = transactions.filter((t) => t.status === 'pending').length;
  const activeContractsCount = investments.filter((i) => i.status === 'active').length;
  const filteredTransactions = transactions.filter((t) => {
    if (txFilter === 'pending') return t.status === 'pending';
    if (txFilter === 'deposit') return t.type === 'deposit';
    if (txFilter === 'withdrawal') return t.type === 'withdrawal';
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-[#0F172A] p-5 text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center text-[#F5C533]">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold font-display">
                Administration AURELIA MOBILE
              </h2>
              <p className="text-xs text-slate-300">
                Synchronisation temps réel : Produits, Cadeaux VIP, Transactions, Contrats &amp;
                Utilisateurs
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <div className="bg-white/10 px-3 py-2 rounded-xl">
              <span className="block text-slate-300">Produits</span>
              <strong className="text-base font-mono-num text-[#F5C533]">{projects.length}</strong>
            </div>
            <div className="bg-white/10 px-3 py-2 rounded-xl">
              <span className="block text-slate-300">Contrats VIP</span>
              <strong className="text-base font-mono-num text-[#F5C533]">
                {activeContractsCount}
              </strong>
            </div>
            <div className="bg-white/10 px-3 py-2 rounded-xl">
              <span className="block text-slate-300">Utilisateurs</span>
              <strong className="text-base font-mono-num text-[#F5C533]">{users.length}</strong>
            </div>
            <div className="bg-white/10 px-3 py-2 rounded-xl">
              <span className="block text-slate-300">En attente</span>
              <strong className="text-base font-mono-num text-[#F5C533]">{pendingCount}</strong>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="p-3.5 rounded-2xl bg-slate-100 border border-[#0F172A]/25 text-[#0F172A] text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#0F766E]" />
          <span>{toast}</span>
        </div>
      )}

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { id: 'projects' as const, label: `Produits (${projects.length})`, icon: Smartphone },
          {
            id: 'transactions' as const,
            label: `Transactions (${transactions.length})`,
            icon: FileText,
          },
          {
            id: 'investments' as const,
            label: `Contrats VIP (${investments.length})`,
            icon: Layers,
          },
          { id: 'referrals' as const, label: `Équipes (${referrals.length})`, icon: Users },
          { id: 'users' as const, label: `Utilisateurs (${users.length})`, icon: Users },
          { id: 'gift_codes' as const, label: `Codes cadeaux (${giftCodes.length})`, icon: Gift },
          { id: 'settings' as const, label: 'Paramètres', icon: Settings },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                active
                  ? 'bg-[#0F172A] text-[#F5C533]'
                  : 'bg-white text-[#334155] border border-[#D8DDE6] hover:bg-[#F8FAFC]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'projects' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-extrabold text-[#0F172A]">
              Catalogue Smartphones VIP (Cycle 90 jours)
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openGiftModal()}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Gift className="w-4 h-4" />
                Offrir un produit
              </button>
              <button
                type="button"
                onClick={handleSyncCatalog}
                disabled={saving}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white hover:bg-[#F8FAFC] text-[#0F172A] border border-[#CBD5E1] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Synchroniser VIP 1 à 5
              </button>
              <button
                type="button"
                onClick={openNewProjectForm}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Nouveau modèle
              </button>
            </div>
          </div>

          {editingProject && (
            <form
              onSubmit={handleSaveProjectSubmit}
              className="p-5 rounded-3xl bg-white border border-[#0F172A] shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#E2E5EC] pb-3">
                <h4 className="text-sm font-extrabold text-[#0F172A]">
                  {isNewProject ? 'Ajouter un modèle' : `Modifier : ${editingProject.title}`}
                </h4>
                <button
                  type="button"
                  onClick={() => setEditingProject(null)}
                  className="text-xs font-bold text-[#475569] hover:underline cursor-pointer min-h-[36px]"
                >
                  Annuler
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Nom du téléphone / palier
                  </label>
                  <input
                    type="text"
                    value={editingProject.title}
                    onChange={(e) =>
                      setEditingProject({ ...editingProject, title: e.target.value })
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Série / Finition
                  </label>
                  <input
                    type="text"
                    value={editingProject.category}
                    onChange={(e) =>
                      setEditingProject({ ...editingProject, category: e.target.value })
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-bold bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Prix d&apos;achat (F CFA)
                  </label>
                  <input
                    type="number"
                    min={500}
                    step={500}
                    value={editingProject.minInvestment}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        minInvestment: Number(e.target.value),
                      })
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Revenu quotidien (F CFA / jour)
                  </label>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={editingProject.dailyIncome}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        dailyIncome: Number(e.target.value),
                      })
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Durée (jours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    value={editingProject.durationDays}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        durationDays: Number(e.target.value),
                      })
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Statut
                  </label>
                  <select
                    value={editingProject.status}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        status: e.target.value as 'active' | 'paused',
                      })
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-bold bg-white"
                  >
                    <option value="active">Actif (Disponible)</option>
                    <option value="paused">En pause (Bientôt disponible)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">
                  Image du modèle
                </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {PRESET_IMAGES.map((img) => (
                    <button
                      key={img.label}
                      type="button"
                      onClick={() => setEditingProject({ ...editingProject, imageUrl: img.url })}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold border cursor-pointer ${
                        editingProject.imageUrl === img.url
                          ? 'bg-[#0F172A] text-white border-[#0F172A]'
                          : 'bg-[#F3F4F6] text-[#0F172A] border-[#CBD5E1]'
                      }`}
                    >
                      {img.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={editingProject.imageUrl}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, imageUrl: e.target.value })
                  }
                  className="w-full h-10 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  value={editingProject.description}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, description: e.target.value })
                  }
                  className="w-full p-3.5 rounded-xl border border-[#CBD5E1] text-xs"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full min-h-[44px] rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4 text-[#F5C533]" />
                {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((p) => {
              const daily = getProjectDailyIncome(p);
              return (
                <div
                  key={p.id}
                  className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex gap-3.5 items-start"
                >
                  <SafeImage
                    src={p.imageUrl}
                    alt={p.title}
                    className="w-20 h-20 rounded-xl object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#0F766E] truncate">
                        {p.category}
                      </span>
                      <span className="text-xs font-mono-num font-semibold text-[#0F172A]">
                        {p.status === 'active' ? 'Actif' : 'En pause'}
                      </span>
                    </div>
                    <h4 className="text-base font-extrabold text-[#0F172A] truncate">{p.title}</h4>
                    <p className="text-xs text-[#334155] mt-0.5">
                      Prix :{' '}
                      <strong className="font-mono-num text-[#9A6B00]">
                        {formatCFA(p.minInvestment)}
                      </strong>
                    </p>
                    <p className="text-xs text-[#0F766E] font-bold mt-0.5">
                      Revenu : <span className="font-mono-num">{formatCFA(daily)} / jour</span> ·{' '}
                      {p.durationDays}j
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => {
                          setIsNewProject(false);
                          setEditingProject({ ...p, dailyIncome: daily });
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => openGiftModal({ project: p })}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        Offrir ce produit
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-extrabold text-[#0F172A]">
              Suivi et validation des transactions
            </h3>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {[
                { id: 'all' as const, label: 'Toutes' },
                { id: 'pending' as const, label: `En attente (${pendingCount})` },
                { id: 'deposit' as const, label: 'Dépôts' },
                { id: 'withdrawal' as const, label: 'Retraits' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setTxFilter(f.id)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    txFilter === f.id
                      ? 'bg-[#0F172A] text-[#F5C533]'
                      : 'bg-white text-[#334155] border border-[#D8DDE6] hover:bg-[#F8FAFC]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white border border-[#E2E5EC] text-center text-xs text-[#475569]">
              Aucune transaction dans cette catégorie.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-extrabold text-[#0F172A]">{tx.userName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-bold text-[#0F766E] uppercase">{tx.type}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#475569]">{tx.method}</span>
                    </div>
                    <p className="text-xs text-[#334155] mt-0.5">
                      Compte : <span className="font-mono-num">{tx.phoneOrAccount}</span> · Réf :{' '}
                      {tx.reference}
                    </p>
                    {Boolean(tx.createdAt) && (
                      <p className="text-[11px] text-[#475569] mt-0.5">
                        {formatDateFr(tx.createdAt)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="block text-sm font-mono-num font-extrabold text-[#0F172A]">
                        {formatCFA(tx.amount)}
                      </span>
                      <span className="text-[11px] font-semibold text-[#9A6B00]">
                        Statut : {tx.status}
                      </span>
                    </div>

                    {tx.status === 'pending' && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleProcessTx(tx, 'approved')}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#F5C533]" />
                          Approuver
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void handleProcessTx(tx, 'rejected')}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Rejeter
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'investments' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-extrabold text-[#0F172A]">
              Contrats VIP souscrits ({investments.length})
            </h3>
            <button
              type="button"
              onClick={() => openGiftModal()}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
            >
              <Gift className="w-4 h-4" />
              Offrir un produit à un membre
            </button>
          </div>
          {investments.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white border border-[#E2E5EC] text-center text-xs text-[#475569]">
              Aucun contrat VIP enregistré.
            </div>
          ) : (
            <div className="space-y-2.5">
              {investments.map((inv) => {
                const metrics = computeInvestmentMetrics(inv);
                const isGifted = inv.id.startsWith('vipgift_');
                return (
                  <div
                    key={inv.id}
                    className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <span className="font-extrabold text-[#0F172A]">{inv.userName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-extrabold text-[#0F766E]">{inv.projectTitle}</span>
                        <span className="text-[#475569]">({inv.projectCategory})</span>
                        {isGifted && (
                          <span className="px-2 py-0.5 rounded-md bg-[#0F172A] text-[#F5C533] text-[10px] font-extrabold">
                            Offert par Admin
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#334155] mt-0.5 font-mono-num">
                        Capital : <strong>{formatCFA(inv.amount)}</strong> · Revenu :{' '}
                        <strong className="text-[#0F766E]">{formatCFA(metrics.dailyIncome)}/j</strong>{' '}
                        · Cycle : {metrics.elapsedDays}/{metrics.durationDays}j ({metrics.daysRemaining}
                        j restants)
                      </p>
                      {Boolean(inv.createdAt) && (
                        <p className="text-[11px] text-[#475569] mt-0.5">
                          Attribué le {formatDateFr(inv.createdAt)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="block text-sm font-mono-num font-extrabold text-[#0F766E]">
                        +{formatCFA(metrics.totalEarnedSoFar)} cumulés
                      </span>
                      <span
                        className={`text-[11px] font-bold ${
                          metrics.isExpired ? 'text-[#9A6B00]' : 'text-[#0F766E]'
                        }`}
                      >
                        Statut : {metrics.displayStatus}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'referrals' && (
        <div className="space-y-3">
          <h3 className="text-base font-extrabold text-[#0F172A]">
            Équipes &amp; Parrainages ({referrals.length})
          </h3>
          {referrals.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white border border-[#E2E5EC] text-center text-xs text-[#475569]">
              Aucun parrainage enregistré.
            </div>
          ) : (
            <div className="space-y-2.5">
              {referrals.map((ref) => {
                const sponsor = users.find((u) => u.uid === ref.referrerUid);
                return (
                  <div
                    key={ref.id}
                    className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-extrabold text-[#0F172A]">
                          Filleul : {ref.referredName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#0F766E] font-bold">
                          Parrain : {sponsor?.displayName || ref.referrerUid}
                        </span>
                      </div>
                      {Boolean(ref.createdAt) && (
                        <p className="text-[11px] text-[#475569] mt-0.5">
                          Inscrit le {formatDateFr(ref.createdAt)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="block text-sm font-mono-num font-extrabold text-[#0F766E]">
                        +{formatCFA(ref.commissionEarned || 0)}
                      </span>
                      <span className="text-[11px] text-[#475569]">Statut : {ref.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-extrabold text-[#0F172A]">
              Comptes membres inscrits ({filteredUsers.length}
              {userSearch.trim() ? ` / ${users.length}` : ''})
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {onRefreshAdmin && (
                <button
                  type="button"
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onRefreshAdmin();
                      notify('Liste des utilisateurs actualisée.');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#CBD5E1] text-[#0F172A] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
                  Actualiser
                </button>
              )}
              <button
                type="button"
                onClick={() => openGiftModal()}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
              >
                <Gift className="w-4 h-4" />
                Offrir un produit
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-[#475569] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Rechercher un utilisateur (nom, téléphone, email, code parrainage, UID...)"
              className="w-full h-11 pl-10 pr-4 rounded-2xl bg-white border border-[#CBD5E1] text-xs font-medium text-[#0F172A] focus:outline-none focus:border-[#0F172A]"
            />
          </div>

          {!isCloudConnected && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs font-extrabold text-amber-950">
                  Base cloud non connectée sur ce déploiement
                </p>
                <p className="text-[11px] text-amber-900 leading-relaxed">
                  Les comptes créés ici restent stockés uniquement sur cet appareil. Pour voir tous
                  les inscrits dans Supabase, ajoutez <strong>VITE_SUPABASE_URL</strong> et{' '}
                  <strong>VITE_SUPABASE_PUBLISHABLE_KEY</strong> dans Vercel → Settings → Environment
                  Variables puis relancez un déploiement (<strong>Redeploy</strong>).
                </p>
              </div>
              {onConnectGoogleCloud && (
                <button
                  type="button"
                  onClick={() => void onConnectGoogleCloud()}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] text-xs font-extrabold whitespace-nowrap cursor-pointer"
                >
                  Synchroniser
                </button>
              )}
            </div>
          )}

          {filteredUsers.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white border border-[#E2E5EC] text-center text-xs text-[#475569]">
              Aucun compte utilisateur trouvé pour cette recherche.
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredUsers.map((u) => {
                const userActiveInvCount = investments.filter(
                  (i) => i.userId === u.uid && i.status === 'active'
                ).length;
                return (
                  <div
                    key={u.uid}
                    className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-extrabold text-[#0F172A]">
                          {u.displayName}
                        </span>
                        <span className="text-xs text-[#475569]">· {u.email}</span>
                        {u.role === 'admin' && (
                          <span className="text-xs font-bold text-[#9A6B00]">
                            · Administrateur
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#334155] mt-0.5 font-mono-num">
                        Solde : <strong className="text-[#0F766E]">{formatCFA(u.balance)}</strong>{' '}
                        · Achats : {formatCFA(u.totalInvested)} · Gains : +
                        {formatCFA(u.totalEarned)} · VIP actifs : <strong>{userActiveInvCount}</strong>
                      </p>
                      <p className="text-[11px] text-[#475569] mt-0.5">
                        Tél : <span className="font-mono-num">{u.phone || 'Non renseigné'}</span> ·
                        Code : <span className="font-mono-num font-bold">{u.referralCode}</span>
                        {u.withdrawalAccount
                          ? ` · Retrait (${u.withdrawalCountry || 'Pays non défini'}) : ${u.withdrawalMethod} (${u.withdrawalAccount})`
                          : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailTxFilter('all');
                          setDetailUserUid(u.uid);
                        }}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#F5C533]" />
                        Détails du compte
                      </button>
                      <button
                        type="button"
                        onClick={() => openGiftModal({ user: u })}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Gift className="w-3.5 h-3.5" />
                        Offrir un produit
                      </button>
                      <button
                        type="button"
                        onClick={() => openCreditModal(u, 'credit')}
                        className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Wallet className="w-3.5 h-3.5 text-[#0F172A]" />
                        Créditer / Soustraire
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <form
          onSubmit={handleSaveSettingsSubmit}
          className="p-5 rounded-3xl bg-white border border-[#E2E5EC] space-y-4"
        >
          <h3 className="text-base font-extrabold text-[#0F172A]">
            Paramètres généraux de la plateforme
          </h3>

          {settingsError && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-700 mt-0.5" />
              <span>{settingsError}</span>
            </div>
          )}

          <div className="p-4 rounded-2xl bg-[#F3F4F6] border border-[#E2E5EC] flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-extrabold text-[#0F172A]">
                Autoriser plusieurs exemplaires actifs d&apos;un même produit VIP
              </p>
              <p className="text-[11px] text-[#475569]">
                Permet aux utilisateurs d&apos;acheter plusieurs fois le même modèle VIP
                simultanément.
              </p>
            </div>
            <input
              type="checkbox"
              checked={draftSettings.allowMultipleSameVip !== false}
              onChange={(e) =>
                setDraftSettings({ ...draftSettings, allowMultipleSameVip: e.target.checked })
              }
              className="w-5 h-5 accent-[#0F172A] rounded cursor-pointer shrink-0"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Commission de parrainage (%)
              </label>
              <input
                type="number"
                min={0}
                max={50}
                step={1}
                value={draftSettings.referralRate}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, referralRate: Number(e.target.value) })
                }
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Dépôt minimum (F CFA)
              </label>
              <input
                type="number"
                min={500}
                step={1}
                value={draftSettings.minDeposit}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, minDeposit: Number(e.target.value) })
                }
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Retrait minimum (F CFA)
              </label>
              <input
                type="number"
                min={500}
                step={1}
                value={draftSettings.minWithdrawal}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, minWithdrawal: Number(e.target.value) })
                }
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Administrateur unique (verrouillé)
              </label>
              <input
                type="text"
                readOnly
                value={DEFAULT_ADMIN_PHONE}
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] text-xs font-mono-num font-bold text-[#0F172A] cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Téléphone / WhatsApp Service client
              </label>
              <input
                type="text"
                minLength={3}
                maxLength={50}
                value={draftSettings.supportPhone ?? ''}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, supportPhone: e.target.value })
                }
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Email Service client
              </label>
              <input
                type="email"
                minLength={3}
                maxLength={120}
                value={draftSettings.supportEmail ?? ''}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, supportEmail: e.target.value })
                }
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1">
              Annonce d&apos;information
            </label>
            <input
              type="text"
              minLength={2}
              maxLength={300}
              value={draftSettings.announcement ?? ''}
              onChange={(e) =>
                setDraftSettings({ ...draftSettings, announcement: e.target.value })
              }
              className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs"
              required
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white font-bold text-xs flex items-center gap-2 cursor-pointer"
          >
            <Save className="w-4 h-4 text-[#F5C533]" />
            {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
          </button>
        </form>
      )}

      {activeTab === 'gift_codes' && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateGiftCode}
            className="p-5 rounded-3xl bg-white border border-[#E2E5EC] space-y-4 shadow-2xs"
          >
            <div>
              <h3 className="text-base font-extrabold text-[#0F172A] flex items-center gap-2">
                <Gift className="w-5 h-5 text-[#9A6B00]" />
                Créer un code cadeau Telegram ({GIFT_CODE_MIN_CFA} à {GIFT_CODE_MAX_CFA} F CFA aléatoires)
              </h3>
              <p className="text-xs text-[#475569] mt-0.5">
                Chaque membre qui saisit ce code dans son onglet Moi reçoit un montant aléatoire
                entre {GIFT_CODE_MIN_CFA} F CFA et {GIFT_CODE_MAX_CFA} F CFA (1 seule fois par compte,
                sans double crédit).
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">
                  Code cadeau (majuscules/chiffres)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newGiftCode}
                    onChange={(e) => setNewGiftCode(e.target.value.toUpperCase())}
                    placeholder="Ex : AURELIA77"
                    maxLength={32}
                    className="flex-1 h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold uppercase"
                    required
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setNewGiftCode(
                        `AM${Math.random().toString(36).slice(2, 8).toUpperCase()}`
                      )
                    }
                    className="h-11 px-3 rounded-xl bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold cursor-pointer shrink-0"
                  >
                    Générer
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1">
                  Nombre maximal d&apos;utilisations
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={newGiftMaxUses}
                  onChange={(e) => setNewGiftMaxUses(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={saving || !onSaveGiftCode}
                className="h-11 px-5 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {saving ? 'Création...' : 'Créer le code'}
              </button>
            </div>
          </form>

          <div className="p-5 rounded-3xl bg-white border border-[#E2E5EC] space-y-3 shadow-2xs">
            <h4 className="text-sm font-extrabold text-[#0F172A]">
              Codes cadeaux enregistrés ({giftCodes.length})
            </h4>
            {giftCodes.length === 0 ? (
              <p className="text-xs text-[#64748B]">
                Aucun code cadeau trouvé. Créez un code ci-dessus pour le partager sur Telegram.
              </p>
            ) : (
              <div className="divide-y divide-[#F1F5F9]">
                {giftCodes.map((item) => (
                  <div
                    key={item.code}
                    className="py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono-num font-extrabold text-[#0F172A]">
                          {item.code}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.isActive
                              ? 'bg-emerald-100 text-[#0F766E]'
                              : 'bg-slate-200 text-[#475569]'
                          }`}
                        >
                          {item.isActive ? 'Actif' : 'Désactivé'}
                        </span>
                      </div>
                      <p className="text-xs text-[#475569] mt-0.5">
                        Gain aléatoire : {item.minAmount} à {item.maxAmount} F CFA · Utilisations :{' '}
                        <span className="font-mono-num font-bold text-[#0F172A]">
                          {item.usesCount} / {item.maxUses}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(item.code);
                          notify(`Code ${item.code} copié !`);
                        }}
                        className="min-h-[38px] px-3 rounded-lg bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-bold cursor-pointer"
                      >
                        Copier
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleGiftCode(item)}
                        disabled={saving}
                        className="min-h-[38px] px-3 rounded-lg bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold cursor-pointer"
                      >
                        {item.isActive ? 'Désactiver' : 'Activer'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: FULL USER ACCOUNT DETAILS */}
      {detailUser && detailUserData && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Détails du compte ${detailUser.displayName}`}
        >
          <div className="bg-[#F3F4F6] w-full max-w-3xl max-h-[92vh] rounded-t-3xl sm:rounded-3xl border border-[#CBD5E1] shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-[#0F172A] text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-extrabold font-display truncate">
                    {detailUser.displayName}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${
                      detailUser.role === 'admin'
                        ? 'bg-[#F5C533] text-[#0F172A]'
                        : 'bg-white/15 text-white'
                    }`}
                  >
                    {detailUser.role === 'admin' ? 'Administrateur' : 'Membre'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-mono-num truncate mt-0.5">
                  UID : {detailUser.uid}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailUserUid(null)}
                className="w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer shrink-0"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
              {/* Quick Actions */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openGiftModal({ user: detailUser })}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-extrabold flex items-center gap-1.5 cursor-pointer"
                >
                  <Gift className="w-4 h-4" />
                  Offrir un produit à ce membre
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = detailUser;
                    setDetailUserUid(null);
                    openCreditModal(target, 'credit');
                  }}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Wallet className="w-4 h-4 text-[#F5C533]" />
                  Créditer / Soustraire le solde
                </button>
              </div>

              {/* Financial Overview Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="p-3.5 rounded-2xl bg-white border border-[#E2E5EC]">
                  <span className="text-[11px] font-semibold text-[#475569] block">
                    Solde disponible
                  </span>
                  <strong className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F766E]">
                    {formatCFA(detailUser.balance)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#E2E5EC]">
                  <span className="text-[11px] font-semibold text-[#475569] block">
                    Total investi / Produits
                  </span>
                  <strong className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F172A]">
                    {formatCFA(detailUser.totalInvested)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#E2E5EC]">
                  <span className="text-[11px] font-semibold text-[#475569] block">
                    Gains totaux reçus
                  </span>
                  <strong className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F766E]">
                    +{formatCFA(detailUser.totalEarned)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#E2E5EC]">
                  <span className="text-[11px] font-semibold text-[#475569] block">
                    Revenu quotidien actif
                  </span>
                  <strong className="text-sm sm:text-base font-mono-num font-extrabold text-[#9A6B00]">
                    {formatCFA(detailUserData.activeDailyIncome)} / j
                  </strong>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#E2E5EC]">
                  <span className="text-[11px] font-semibold text-[#475569] block">
                    Dépôts approuvés
                  </span>
                  <strong className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F172A]">
                    {formatCFA(detailUserData.totalDeposits)}
                  </strong>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#E2E5EC]">
                  <span className="text-[11px] font-semibold text-[#475569] block">
                    Retraits demandés/payés
                  </span>
                  <strong className="text-sm sm:text-base font-mono-num font-extrabold text-[#0F172A]">
                    {formatCFA(detailUserData.totalWithdrawals)}
                  </strong>
                </div>
              </div>

              {/* Identity & Withdrawal Info */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-2xl bg-white border border-[#E2E5EC] space-y-2">
                  <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wide flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-[#0F766E]" />
                    Identité &amp; Profil
                  </h4>
                  <div className="space-y-1.5 text-xs text-[#334155]">
                    <p className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-[#475569] shrink-0" />
                      <span>
                        Téléphone :{' '}
                        <strong className="font-mono-num text-[#0F172A]">
                          {detailUser.phone || 'Non renseigné'}
                        </strong>
                      </span>
                    </p>
                    <p className="flex items-center gap-2 break-all">
                      <Mail className="w-3.5 h-3.5 text-[#475569] shrink-0" />
                      <span>
                        Email : <strong className="text-[#0F172A]">{detailUser.email}</strong>
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-[#475569] shrink-0" />
                      <span>
                        Inscription :{' '}
                        <strong className="text-[#0F172A]">
                          {detailUser.createdAt ? formatDateFr(detailUser.createdAt) : 'N/D'}
                        </strong>
                      </span>
                    </p>
                    <p className="flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-[#475569] shrink-0" />
                      <span>
                        Dernière activité :{' '}
                        <strong className="text-[#0F172A]">
                          {detailUser.updatedAt ? formatDateFr(detailUser.updatedAt) : 'N/D'}
                        </strong>
                      </span>
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white border border-[#E2E5EC] space-y-2">
                  <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wide flex items-center gap-1.5">
                    <CreditCard className="w-4 h-4 text-[#9A6B00]" />
                    Compte de Retrait Mobile Money
                  </h4>
                  {detailUser.withdrawalAccount ? (
                    <div className="space-y-1.5 text-xs text-[#334155]">
                      <p>
                        Pays :{' '}
                        <strong className="text-[#0F172A]">
                          {detailUser.withdrawalCountry || 'Non défini'}
                        </strong>
                      </p>
                      <p>
                        Opérateur / Méthode :{' '}
                        <strong className="text-[#0F172A]">
                          {detailUser.withdrawalMethod || 'Non défini'}
                        </strong>
                      </p>
                      <p>
                        Numéro / Compte :{' '}
                        <strong className="font-mono-num text-[#0F172A]">
                          {detailUser.withdrawalAccount}
                        </strong>
                      </p>
                      <p>
                        Titulaire :{' '}
                        <strong className="text-[#0F172A]">
                          {detailUser.withdrawalHolder || detailUser.displayName}
                        </strong>
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-[#64748B]">
                      Aucun compte de retrait configuré par cet utilisateur pour le moment.
                    </p>
                  )}
                </div>
              </div>

              {/* Referral & Team Details */}
              <div className="p-4 rounded-2xl bg-white border border-[#E2E5EC] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wide flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-[#0F766E]" />
                    Parrainage &amp; Équipe ({detailUserData.userReferrals.length} filleul
                    {detailUserData.userReferrals.length > 1 ? 's' : ''})
                  </h4>
                  <span className="text-xs font-mono-num font-bold text-[#9A6B00]">
                    Bonus : +{formatCFA(detailUser.referralBonus || 0)}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#334155]">
                  <p>
                    Code d&apos;invitation :{' '}
                    <strong className="font-mono-num text-[#0F172A]">
                      {detailUser.referralCode}
                    </strong>
                  </p>
                  <p>
                    Parrainé par :{' '}
                    <strong className="text-[#0F172A]">
                      {detailUserData.sponsor
                        ? `${detailUserData.sponsor.displayName} (${detailUserData.sponsor.referralCode})`
                        : detailUser.referredBy || 'Aucun parrain'}
                    </strong>
                  </p>
                </div>
                {detailUserData.userReferrals.length > 0 && (
                  <div className="divide-y divide-[#F1F5F9] border-t border-[#F1F5F9] pt-2 max-h-40 overflow-y-auto">
                    {detailUserData.userReferrals.map((ref) => (
                      <div
                        key={ref.id}
                        className="py-1.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <span className="font-bold text-[#0F172A]">{ref.referredName}</span>
                          <span className="text-[#475569] ml-2">
                            Niveau {ref.level || 1} · {ref.status}
                          </span>
                        </div>
                        <span className="font-mono-num font-bold text-[#0F766E]">
                          +{formatCFA(ref.commissionEarned || 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* User VIP Products / Contracts */}
              <div className="p-4 rounded-2xl bg-white border border-[#E2E5EC] space-y-2.5">
                <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wide flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-[#0F172A]" />
                  Produits VIP détenus ({detailUserData.userInvestments.length})
                </h4>
                {detailUserData.userInvestments.length === 0 ? (
                  <p className="text-xs text-[#64748B]">
                    Ce membre ne possède aucun produit VIP pour le moment.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {detailUserData.userInvestments.map(({ inv, metrics }) => {
                      const isGifted = inv.id.startsWith('vipgift_');
                      return (
                        <div
                          key={inv.id}
                          className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-2"
                        >
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-extrabold text-[#0F172A]">
                                {inv.projectTitle}
                              </span>
                              {isGifted && (
                                <span className="px-1.5 py-0.5 rounded bg-[#0F172A] text-[#F5C533] text-[10px] font-extrabold">
                                  Offert
                                </span>
                              )}
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  metrics.isExpired
                                    ? 'bg-amber-100 text-[#9A6B00]'
                                    : 'bg-emerald-100 text-[#0F766E]'
                                }`}
                              >
                                {metrics.displayStatus}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#334155] font-mono-num mt-0.5">
                              Valeur : {formatCFA(inv.amount)} · Revenu :{' '}
                              {formatCFA(metrics.dailyIncome)}/j · Cycle : {metrics.elapsedDays}/
                              {metrics.durationDays}j
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="block text-xs font-mono-num font-extrabold text-[#0F766E]">
                              +{formatCFA(metrics.totalEarnedSoFar)}
                            </span>
                            {Boolean(inv.createdAt) && (
                              <span className="text-[10px] text-[#64748B]">
                                {formatDateFr(inv.createdAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* User Transactions History */}
              <div className="p-4 rounded-2xl bg-white border border-[#E2E5EC] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-extrabold text-[#0F172A] uppercase tracking-wide flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-[#0F172A]" />
                    Historique des transactions ({detailUserData.userTransactions.length})
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { id: 'all' as const, label: 'Toutes' },
                      { id: 'deposit' as const, label: 'Dépôts' },
                      { id: 'withdrawal' as const, label: 'Retraits' },
                      { id: 'investment' as const, label: 'Achats' },
                      { id: 'payout' as const, label: 'Gains' },
                      { id: 'credit' as const, label: 'Crédits & Cadeaux' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setDetailTxFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${
                          detailTxFilter === f.id
                            ? 'bg-[#0F172A] text-[#F5C533]'
                            : 'bg-[#F3F4F6] text-[#334155]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {detailUserData.filteredUserTransactions.length === 0 ? (
                  <p className="text-xs text-[#64748B]">
                    Aucune transaction dans cette catégorie.
                  </p>
                ) : (
                  <div className="divide-y divide-[#F1F5F9] max-h-64 overflow-y-auto">
                    {detailUserData.filteredUserTransactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#0F172A]">
                            <span className="uppercase text-[#0F766E] mr-1.5">{tx.type}</span>
                            {tx.reference}
                          </p>
                          <p className="text-[11px] text-[#475569]">
                            {tx.method}
                            {tx.phoneOrAccount ? ` · ${tx.phoneOrAccount}` : ''}
                            {tx.createdAt ? ` · ${formatDateFr(tx.createdAt)}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right">
                            <span className="block text-xs font-mono-num font-extrabold text-[#0F172A]">
                              {formatCFA(tx.amount)}
                            </span>
                            <span className="text-[10px] font-semibold text-[#9A6B00]">
                              {tx.status}
                            </span>
                          </div>
                          {tx.status === 'pending' && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onProcessTransaction(tx, 'approved')}
                                className="px-2 py-1 rounded-lg bg-[#0F172A] text-[#F5C533] text-[10px] font-bold cursor-pointer"
                              >
                                Approuver
                              </button>
                              <button
                                type="button"
                                onClick={() => onProcessTransaction(tx, 'rejected')}
                                className="px-2 py-1 rounded-lg bg-red-600 text-white text-[10px] font-bold cursor-pointer"
                              >
                                Rejeter
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GIFT ANY PRODUCT TO A USER */}
      {giftModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Offrir un produit à un utilisateur"
        >
          <form
            onSubmit={handleGiftSubmit}
            className="bg-white w-full max-w-lg max-h-[92vh] rounded-t-3xl sm:rounded-3xl border border-[#CBD5E1] shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="bg-[#0F172A] text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#F5C533] text-[#0F172A] flex items-center justify-center">
                  <Gift className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold font-display">Offrir un produit VIP</h3>
                  <p className="text-[11px] text-slate-300">
                    Attribution gratuite sans débit du solde utilisateur
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGiftModalOpen(false)}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#0F172A] mb-1.5">
                  Membre bénéficiaire
                </label>
                <select
                  value={giftTargetUid}
                  onChange={(e) => setGiftTargetUid(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-bold bg-white text-[#0F172A]"
                  required
                >
                  {users.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.displayName} {u.phone ? `(${u.phone})` : ''} · Solde {formatCFA(u.balance)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0F172A] mb-1.5">
                  Produit à offrir (tous les modèles du catalogue)
                </label>
                <select
                  value={giftProjectId}
                  onChange={(e) => setGiftProjectId(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-bold bg-white text-[#0F172A]"
                  required
                >
                  {fullCatalog.map((p) => {
                    const daily = getProjectDailyIncome(p);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.title} · {formatCFA(p.minInvestment)} ({formatCFA(daily)}/j ·{' '}
                        {p.durationDays}j){p.status === 'paused' ? ' [En pause]' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedGiftProject && (
                <div className="p-3 rounded-2xl bg-[#F8FAFC] border border-[#E2E5EC] flex items-center gap-3">
                  <SafeImage
                    src={selectedGiftProject.imageUrl}
                    alt={selectedGiftProject.title}
                    className="w-16 h-16 rounded-xl object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-[#0F172A] truncate">
                      {selectedGiftProject.title}
                    </p>
                    <p className="text-[11px] text-[#475569] truncate">
                      {selectedGiftProject.category}
                    </p>
                    <p className="text-xs font-mono-num font-bold text-[#0F766E] mt-0.5">
                      +{formatCFA(giftUnitDaily)} / jour · {giftDuration} jours
                    </p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#0F172A] mb-1.5">
                    Quantité
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={giftQuantity}
                    onChange={(e) =>
                      setGiftQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                    }
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#0F172A] mb-1.5">
                    Motif / Libellé du cadeau
                  </label>
                  <input
                    type="text"
                    value={giftReason}
                    onChange={(e) => setGiftReason(e.target.value)}
                    placeholder="Ex : Bonus fidélité, Récompense équipe..."
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs"
                    required
                  />
                </div>
              </div>

              {selectedGiftProject && selectedGiftUser && (
                <div className="p-3.5 rounded-2xl bg-[#0F172A] text-white text-xs space-y-1">
                  <p className="font-extrabold text-[#F5C533] flex items-center gap-1.5">
                    <Award className="w-4 h-4" />
                    Récapitulatif de l&apos;attribution gratuite
                  </p>
                  <p className="text-slate-200 leading-relaxed">
                    <strong>{selectedGiftUser.displayName}</strong> recevra immédiatement{' '}
                    <strong>
                      {giftQuantity}x {selectedGiftProject.title}
                    </strong>{' '}
                    sans aucun débit sur son solde, générant{' '}
                    <strong className="font-mono-num text-[#F5C533]">
                      +{formatCFA(giftTotalDaily)} / jour
                    </strong>{' '}
                    pendant <strong>{giftDuration} jours</strong> (soit{' '}
                    <strong className="font-mono-num">
                      {formatCFA(giftTotalDaily * giftDuration)}
                    </strong>{' '}
                    de gains potentiels).
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setGiftModalOpen(false)}
                  className="min-h-[44px] px-4 rounded-xl bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedGiftUser || !selectedGiftProject}
                  className="flex-1 min-h-[44px] px-5 rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Gift className="w-4 h-4" />
                  {saving ? 'Attribution...' : "Confirmer l'offre du produit"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: CREDIT OR SUBTRACT USER BALANCE */}
      {selectedUser && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Modifier le solde de ${selectedUser.displayName}`}
        >
          <form
            onSubmit={handleCreditSubmit}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-[#CBD5E1] shadow-2xl overflow-hidden"
          >
            <div className="bg-[#0F172A] text-white px-5 py-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#F5C533] text-[#0F172A] flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-extrabold font-display truncate">
                    Créditer ou soustraire
                  </h3>
                  <p className="text-[11px] text-slate-300 truncate">
                    {selectedUser.displayName} · {selectedUser.phone || selectedUser.email}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white cursor-pointer shrink-0"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {creditError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{creditError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setCreditOperation('credit');
                    if (creditReason === 'Ajustement / retrait par administration') {
                      setCreditReason('Crédit ajouté par administration');
                    }
                    setCreditError(null);
                  }}
                  className={`min-h-[44px] px-3 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    creditOperation === 'credit'
                      ? 'bg-[#0F766E] border-[#0F766E] text-white'
                      : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#0F172A]'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  Créditer (+)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreditOperation('debit');
                    if (creditReason === 'Crédit ajouté par administration') {
                      setCreditReason('Ajustement / retrait par administration');
                    }
                    setCreditError(null);
                  }}
                  className={`min-h-[44px] px-3 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                    creditOperation === 'debit'
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-[#F8FAFC] border-[#CBD5E1] text-[#0F172A]'
                  }`}
                >
                  <Minus className="w-4 h-4" />
                  Soustraire (-)
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0F172A] mb-1.5">
                  Montant (F CFA)
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  placeholder="Ex : 5000"
                  className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-sm font-mono-num font-bold text-[#0F172A]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#0F172A] mb-1.5">
                  Libellé / Motif
                </label>
                <input
                  type="text"
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs text-[#0F172A]"
                  required
                />
              </div>

              {(() => {
                const parsedAmt = Math.max(0, Math.round(Number(creditAmount) || 0));
                const signed = creditOperation === 'debit' ? -parsedAmt : parsedAmt;
                const estimatedNext = Math.max(0, Math.round(selectedUser.balance + signed));
                return (
                  <div className="p-3.5 rounded-2xl bg-[#F8FAFC] border border-[#E2E5EC] text-xs space-y-1">
                    <div className="flex items-center justify-between text-[#475569]">
                      <span>Solde actuel</span>
                      <span className="font-mono-num font-bold text-[#0F172A]">
                        {formatCFA(selectedUser.balance)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#475569]">
                      <span>Opération</span>
                      <span
                        className={`font-mono-num font-extrabold ${
                          creditOperation === 'debit' ? 'text-red-600' : 'text-[#0F766E]'
                        }`}
                      >
                        {creditOperation === 'debit' ? '-' : '+'}
                        {formatCFA(parsedAmt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-[#E2E5EC]">
                      <span className="font-bold text-[#0F172A]">Nouveau solde estimé</span>
                      <span className="font-mono-num font-extrabold text-[#0F172A]">
                        {formatCFA(estimatedNext)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="min-h-[44px] px-4 rounded-xl bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`flex-1 min-h-[44px] px-5 rounded-xl text-white text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 ${
                    creditOperation === 'debit'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-[#0F172A] hover:bg-[#1E293B]'
                  }`}
                >
                  <Wallet className="w-4 h-4 text-[#F5C533]" />
                  {saving
                    ? 'Application...'
                    : creditOperation === 'debit'
                    ? 'Confirmer la soustraction'
                    : 'Confirmer le crédit'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
