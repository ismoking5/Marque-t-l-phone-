import { FormEvent, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  FileText,
  Layers,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Shield,
  Smartphone,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  BRAND_IMAGES,
  computeInvestmentMetrics,
  formatCFA,
  formatDateFr,
  getProjectDailyIncome,
} from '../data/catalog';
import type {
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

export function AdminPanel({
  projects,
  users,
  transactions,
  investments,
  referrals,
  settings,
  onSaveProject,
  onResetOfficialVipCatalog,
  onProcessTransaction,
  onAdjustUserBalance,
  onSaveSettings,
}: {
  projects: ProjectItem[];
  users: UserProfile[];
  transactions: TransactionItem[];
  investments: InvestmentItem[];
  referrals: ReferralItem[];
  settings: PlatformSettings;
  onSaveProject: (project: ProjectItem, isNew: boolean) => Promise<void>;
  onResetOfficialVipCatalog: () => Promise<void>;
  onProcessTransaction: (tx: TransactionItem, nextStatus: 'approved' | 'rejected') => Promise<void>;
  onAdjustUserBalance: (user: UserProfile, delta: number, reason: string) => Promise<void>;
  onSaveSettings: (settings: PlatformSettings) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<
    'projects' | 'transactions' | 'investments' | 'referrals' | 'users' | 'settings'
  >('projects');
  const [txFilter, setTxFilter] = useState<'all' | 'pending' | 'deposit' | 'withdrawal'>('all');
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [isNewProject, setIsNewProject] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [creditAmount, setCreditAmount] = useState(5000);
  const [creditReason, setCreditReason] = useState('Crédit ajouté par administration');
  const [draftSettings, setDraftSettings] = useState<PlatformSettings>(settings);

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
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
    } finally {
      setSaving(false);
    }
  };

  const handleSyncCatalog = async () => {
    setSaving(true);
    try {
      await onResetOfficialVipCatalog();
      notify('Catalogue VIP 1 à VIP 5 synchronisé.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettingsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSaveSettings(draftSettings);
      notify('Paramètres enregistrés.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreditSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser || creditAmount === 0) return;
    setSaving(true);
    try {
      await onAdjustUserBalance(selectedUser, creditAmount, creditReason);
      notify(`Solde de ${selectedUser.displayName} mis à jour.`);
      setSelectedUser(null);
    } finally {
      setSaving(false);
    }
  };

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
                Synchronisation temps réel : Produits, Transactions, Contrats VIP, Équipes &amp;
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
            <div className="flex items-center gap-2">
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
                    <div className="flex items-center gap-2 mt-3">
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
                          onClick={() => onProcessTransaction(tx, 'approved')}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#F5C533]" />
                          Approuver
                        </button>
                        <button
                          type="button"
                          onClick={() => onProcessTransaction(tx, 'rejected')}
                          className="min-h-[40px] px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
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
          <h3 className="text-base font-extrabold text-[#0F172A]">
            Contrats VIP souscrits ({investments.length})
          </h3>
          {investments.length === 0 ? (
            <div className="p-8 rounded-2xl bg-white border border-[#E2E5EC] text-center text-xs text-[#475569]">
              Aucun contrat VIP enregistré.
            </div>
          ) : (
            <div className="space-y-2.5">
              {investments.map((inv) => {
                const metrics = computeInvestmentMetrics(inv);
                return (
                  <div
                    key={inv.id}
                    className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-extrabold text-[#0F172A]">{inv.userName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-extrabold text-[#0F766E]">{inv.projectTitle}</span>
                        <span className="text-[#475569]">({inv.projectCategory})</span>
                      </div>
                      <p className="text-xs text-[#334155] mt-0.5 font-mono-num">
                        Capital : <strong>{formatCFA(inv.amount)}</strong> · Revenu :{' '}
                        <strong className="text-[#0F766E]">{formatCFA(metrics.dailyIncome)}/j</strong>{' '}
                        · Cycle : {metrics.elapsedDays}/{metrics.durationDays}j ({metrics.daysRemaining}
                        j restants)
                      </p>
                      {Boolean(inv.createdAt) && (
                        <p className="text-[11px] text-[#475569] mt-0.5">
                          Souscrit le {formatDateFr(inv.createdAt)}
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
          <h3 className="text-base font-extrabold text-[#0F172A]">
            Comptes membres inscrits ({users.length})
          </h3>

          {selectedUser && (
            <form
              onSubmit={handleCreditSubmit}
              className="p-5 rounded-3xl bg-white border border-[#0F172A] shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-[#0F172A]">
                  Créditer / Ajuster : {selectedUser.displayName}
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="text-xs font-bold text-[#475569] cursor-pointer min-h-[36px]"
                >
                  Fermer
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Montant (F CFA)
                  </label>
                  <input
                    type="number"
                    step={500}
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(Number(e.target.value))}
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1">
                    Libellé / Motif
                  </label>
                  <input
                    type="text"
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs"
                    required
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 rounded-xl bg-[#0F172A] text-white text-xs font-bold cursor-pointer"
              >
                {saving ? 'Application...' : 'Confirmer le crédit / ajustement'}
              </button>
            </form>
          )}

          <div className="space-y-2.5">
            {users.map((u) => (
              <div
                key={u.uid}
                className="p-4 rounded-2xl bg-white border border-[#E2E5EC] flex flex-wrap items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-extrabold text-[#0F172A]">{u.displayName}</span>
                    <span className="text-xs text-[#475569]">· {u.email}</span>
                    {u.role === 'admin' && (
                      <span className="text-xs font-bold text-[#9A6B00]">· Administrateur</span>
                    )}
                  </div>
                  <p className="text-xs text-[#334155] mt-0.5 font-mono-num">
                    Solde : <strong className="text-[#0F766E]">{formatCFA(u.balance)}</strong> ·
                    Achats : {formatCFA(u.totalInvested)} · Gains : +{formatCFA(u.totalEarned)}
                  </p>
                  {u.withdrawalAccount && (
                    <p className="text-[11px] text-[#475569] mt-0.5">
                      Retrait ({u.withdrawalCountry || 'Pays non défini'}) : {u.withdrawalMethod} ·{' '}
                      <span className="font-mono-num">{u.withdrawalAccount}</span>
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedUser(u)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#F3F4F6] hover:bg-[#E2E5EC] text-[#0F172A] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Wallet className="w-3.5 h-3.5 text-[#0F172A]" />
                  Créditer le compte
                </button>
              </div>
            ))}
          </div>
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
                min={1}
                max={50}
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
                step={500}
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
                step={500}
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
                Numéro Administrateur principal
              </label>
              <input
                type="text"
                value={draftSettings.adminPhone || '+226 77409899'}
                onChange={(e) =>
                  setDraftSettings({ ...draftSettings, adminPhone: e.target.value })
                }
                className="w-full h-11 px-3.5 rounded-xl border border-[#CBD5E1] text-xs font-mono-num font-bold text-[#0F172A]"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1">
                Téléphone / WhatsApp Service client
              </label>
              <input
                type="text"
                value={draftSettings.supportPhone}
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
                value={draftSettings.supportEmail}
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
              value={draftSettings.announcement}
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
    </div>
  );
}
