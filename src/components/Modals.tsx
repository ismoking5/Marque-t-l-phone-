import { FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Layers,
  Send,
  Share2,
  Smartphone,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  BRAND_IMAGES,
  COUNTRY_OPTIONS,
  PAYMENT_CHANNELS,
  QUICK_DEPOSIT_AMOUNTS,
  SUPPORT_CHANNELS,
  formatCFA,
  getProjectDailyIncome,
} from '../data/catalog';
import type { PlatformSettings, ProjectItem, UserProfile } from '../types';
import { SafeImage } from './Brand';

export function DepositModal({
  isOpen,
  onClose,
  userProfile,
  settings,
  onSubmitDeposit,
  requireApprovalOnly = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  settings: PlatformSettings;
  onSubmitDeposit: (
    amount: number,
    method: string,
    phoneOrAccount: string,
    instantCredit: boolean
  ) => Promise<{ checkoutUrl?: string; message?: string } | void>;
  requireApprovalOnly?: boolean;
}) {
  const [amountInput, setAmountInput] = useState('5000');
  const [channel, setChannel] = useState(PAYMENT_CHANNELS[0].id);
  const [phoneInput, setPhoneInput] = useState(userProfile?.phone || '+226 ');
  const [instantCredit, setInstantCredit] = useState(!requireApprovalOnly);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile?.phone) setPhoneInput(userProfile.phone);
    setErrorMsg(null);
    setCheckoutUrl(null);
  }, [userProfile?.phone, isOpen]);

  if (!isOpen) return null;

  const numericAmount = Number(amountInput) || 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setCheckoutUrl(null);
    if (numericAmount < settings.minDeposit) {
      setErrorMsg(`Le montant minimum de recharge est de ${formatCFA(settings.minDeposit)}.`);
      return;
    }
    const accountRef =
      phoneInput.trim() || userProfile?.phone || userProfile?.email || 'Compte AURELIA MOBILE';
    try {
      setSubmitting(true);
      const result = await onSubmitDeposit(numericAmount, channel, accountRef, instantCredit);
      if (result && typeof result === 'object' && result.checkoutUrl) {
        setCheckoutUrl(result.checkoutUrl);
        if (window.self === window.top) {
          window.location.assign(result.checkoutUrl);
        }
        return;
      }
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la recharge.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-xs overflow-y-auto p-0 sm:p-4">
      <div className="w-full max-w-lg min-h-screen sm:min-h-0 bg-[#F3F4F6] sm:rounded-2xl shadow-2xl border border-[#D8DDE6] overflow-hidden">
        <div className="bg-white border-b border-[#E2E5EC] px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] font-display">
            Recharger
          </h3>
          <div className="w-11" />
        </div>

        <div className="relative h-40 sm:h-44 w-full overflow-hidden bg-[#0F172A]">
          <SafeImage
            src={BRAND_IMAGES.titanium}
            alt="Atelier smartphone AURELIA MOBILE"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-[#0F172A]/45 to-black/30" />
          <div className="absolute top-4 left-4 text-white">
            <p className="text-lg sm:text-xl font-mono-num font-extrabold text-white drop-shadow-xs">
              {formatCFA(userProfile?.balance || 0)}
            </p>
            <p className="text-xs font-bold text-[#F5C533] drop-shadow-xs">Solde du compte</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
                Montant de la recharge
              </span>
              <span className="text-[11px] font-medium text-[#475569]">
                (Minimum {formatCFA(settings.minDeposit)})
              </span>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {QUICK_DEPOSIT_AMOUNTS.map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setAmountInput(String(val))}
                  className={`min-w-[88px] min-h-[40px] py-1.5 px-3.5 rounded-lg border text-xs font-mono-num font-bold transition-all cursor-pointer ${
                    numericAmount === val
                      ? 'border-[#0F172A] bg-[#0F172A] text-[#F5C533]'
                      : 'border-[#D4AF37] bg-white text-[#9A6B00] hover:bg-[#FFFDF7]'
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>

            <div className="flex items-center bg-white rounded-lg border border-[#D8DDE6] h-11 px-3.5 focus-within:border-[#0F172A]">
              <span className="text-xs font-extrabold text-[#0F172A] pr-3 border-r border-[#E2E5EC] shrink-0">
                FCFA
              </span>
              <input
                type="number"
                min={settings.minDeposit}
                step={500}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Veuillez saisir le montant de la recharge"
                className="w-full pl-3 bg-transparent text-xs sm:text-sm font-mono-num font-semibold text-[#0F172A] placeholder:text-[#64748B] focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs sm:text-sm font-extrabold text-[#0F172A]">Canaux de paiement</p>
            <div className="space-y-2">
              {PAYMENT_CHANNELS.map((item) => {
                const active = channel === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setChannel(item.id)}
                    className={`w-full min-h-[44px] py-2.5 px-4 rounded-lg text-xs font-bold text-center transition-all cursor-pointer border ${
                      active
                        ? 'bg-[#0F172A] text-[#F5C533] border-[#0F172A] shadow-2xs'
                        : 'bg-white text-[#334155] border-[#D4AF37] hover:bg-[#FFFDF7]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="pt-1">
              <div className="flex items-center bg-white rounded-lg border border-[#D8DDE6] h-11 px-3.5 focus-within:border-[#0F172A]">
                <span className="text-[11px] font-bold text-[#475569] pr-3 border-r border-[#E2E5EC] shrink-0">
                  Tél. Mobile Money
                </span>
                <input
                  type="text"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+226 77 40 98 99"
                  className="w-full pl-3 bg-transparent text-xs font-mono-num font-semibold text-[#0F172A] focus:outline-none"
                  required
                />
              </div>
            </div>

            {!requireApprovalOnly && (
              <div className="flex items-center justify-between px-1 pt-1">
                <label className="flex items-center justify-between w-full cursor-pointer min-h-[36px]">
                  <span className="text-[11px] text-[#475569] font-medium">
                    Créditer immédiatement le solde après confirmation
                  </span>
                  <input
                    type="checkbox"
                    checked={instantCredit}
                    onChange={(e) => setInstantCredit(e.target.checked)}
                    className="w-4 h-4 accent-[#0F172A] rounded cursor-pointer"
                  />
                </label>
              </div>
            )}

            {checkoutUrl ? (
              <div className="pt-2 space-y-2.5">
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs font-medium">
                  Session de paiement prête pour <strong>{formatCFA(numericAmount)}</strong>. Cliquez
                  ci-dessous pour finaliser votre règlement sécurisé.
                </div>
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[46px] px-6 rounded-full bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Ouvrir la page de paiement ({formatCFA(numericAmount)})
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full min-h-[40px] rounded-full bg-white border border-[#CBD5E1] text-[#0F172A] text-xs font-bold cursor-pointer"
                >
                  Fermer cette fenêtre
                </button>
              </div>
            ) : (
              <div className="pt-2 flex flex-col items-center justify-center gap-2.5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto min-w-[240px] min-h-[46px] px-7 rounded-full bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-xs sm:text-sm shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  {submitting
                    ? 'Initialisation du paiement...'
                    : `Payer maintenant (${formatCFA(numericAmount)})`}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-1">
            <h4 className="text-xs sm:text-sm font-extrabold text-[#0F172A] px-1">
              Instructions de recharge
            </h4>
            <div className="rounded-xl bg-white border border-[#E2E5EC] p-4 space-y-2.5 text-xs text-[#475569] leading-relaxed shadow-2xs">
              <p>
                1. Le dépôt minimum est de {formatCFA(settings.minDeposit)} ; tout dépôt inférieur
                à ce montant ne sera pas crédité sur votre compte.
              </p>
              <p>
                2. Renseignez le montant et votre numéro Mobile Money, puis cliquez sur{' '}
                <strong>« Payer maintenant »</strong> pour accéder au guichet de paiement sécurisé.
              </p>
              <p>
                3. Validez le paiement sur votre téléphone Mobile Money pour finaliser votre
                recharge.
              </p>
              <p>
                4. Si votre dépôt n&apos;apparaît pas sur votre compte après la validation du
                transfert, veuillez contacter le service client pour obtenir de l&apos;aide.
              </p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WithdrawModal({
  isOpen,
  onClose,
  userProfile,
  settings,
  onSubmitWithdraw,
  onConfigureWithdrawalAccount,
}: {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  settings: PlatformSettings;
  onSubmitWithdraw: (amount: number, method: string, account: string) => Promise<void>;
  onConfigureWithdrawalAccount?: () => void;
}) {
  const [amountInput, setAmountInput] = useState('');
  const [method, setMethod] = useState(userProfile?.withdrawalMethod || 'Orange Money Burkina');
  const [account, setAccount] = useState(
    userProfile?.withdrawalAccount || userProfile?.phone || ''
  );
  const [showEditor, setShowEditor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (userProfile?.withdrawalMethod) setMethod(userProfile.withdrawalMethod);
    if (userProfile?.withdrawalAccount) setAccount(userProfile.withdrawalAccount);
    else if (userProfile?.phone) setAccount(userProfile.phone);
    setErrorMsg(null);
    setShowEditor(false);
  }, [userProfile?.withdrawalMethod, userProfile?.withdrawalAccount, userProfile?.phone, isOpen]);

  if (!isOpen) return null;

  const balance = userProfile?.balance || 0;
  const minWithdrawal = Math.max(500, settings.minWithdrawal || 1000);
  const numericAmount = Number(amountInput) || 0;
  const netReceived = numericAmount > 0 ? numericAmount * 0.85 : 0;
  const netFormatted =
    numericAmount > 0
      ? netReceived.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '0.00';

  const hasSavedAccount = !!(
    userProfile?.withdrawalAccount && userProfile.withdrawalAccount.trim().length >= 4
  );
  const countryMatch = COUNTRY_OPTIONS.find((c) => c.country === userProfile?.withdrawalCountry);
  const availableMethods = countryMatch
    ? countryMatch.methods
    : [
        "Orange Money Côte d'Ivoire",
        "MTN MoMo Côte d'Ivoire",
        'Orange Money Burkina',
        'Moov Money',
        'Wave',
        'MTN MoMo',
        'TMoney / Flooz',
      ];

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (numericAmount < minWithdrawal) {
      setErrorMsg(`Le montant minimum de retrait est de ${formatCFA(minWithdrawal)}.`);
      return;
    }
    if (numericAmount > balance) {
      setErrorMsg(`Solde insuffisant. Votre solde disponible est de ${formatCFA(balance)}.`);
      return;
    }
    if (account.trim().length < 4) {
      setErrorMsg('Veuillez sélectionner ou configurer votre compte de retrait.');
      setShowEditor(true);
      return;
    }
    try {
      setSubmitting(true);
      const methodLabel = `${method} (Net reçu 85% : ${formatCFA(Math.round(netReceived))})`;
      await onSubmitWithdraw(numericAmount, methodLabel, account.trim());
      setAmountInput('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors du retrait.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-xs overflow-y-auto p-0 sm:p-4">
      <div className="w-full max-w-lg min-h-screen sm:min-h-0 bg-white sm:rounded-2xl shadow-2xl border border-[#D8DDE6] overflow-hidden">
        <div className="bg-white border-b border-[#E2E5EC] px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] font-display">
            Retirer de l&apos;argent
          </h3>
          <div className="w-11" />
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-5">
          <div className="relative h-44 sm:h-48 w-full rounded-xl overflow-hidden bg-[#0F172A] border border-[#CBD5E1]">
            <SafeImage
              src={BRAND_IMAGES.foldable}
              alt="Smartphone pliable AURELIA MOBILE"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-[#0F172A]/25 to-black/50" />
            <div className="absolute top-4 left-4 text-white">
              <p className="text-lg sm:text-xl font-mono-num font-extrabold text-white drop-shadow-xs">
                FCFA {(balance || 0).toLocaleString('fr-FR')}
              </p>
              <p className="text-xs font-bold text-[#F5C533] drop-shadow-xs mt-0.5">
                Solde du compte
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowEditor((prev) => !prev)}
              className="w-full min-h-[52px] py-3 px-1 border-b border-[#E2E5EC] flex items-center justify-between gap-3 text-left hover:bg-[#F8FAFC] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <CreditCard className="w-6 h-6 text-[#0F172A] shrink-0 stroke-[2.2]" />
                {account && account.trim().length >= 4 ? (
                  <div className="min-w-0">
                    <span className="block text-xs sm:text-sm font-bold text-[#0F172A] truncate">
                      {method}
                    </span>
                    <span className="block text-[11px] font-mono-num text-[#475569] truncate">
                      {account}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs sm:text-sm font-semibold text-[#0F172A] truncate">
                    Veuillez sélectionner votre compte de retrait
                  </span>
                )}
              </div>
              <ChevronRight
                className={`w-4 h-4 text-[#475569] shrink-0 transition-transform ${
                  showEditor ? 'rotate-90' : ''
                }`}
              />
            </button>

            {showEditor && (
              <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E5EC] space-y-3">
                {hasSavedAccount && (
                  <div className="p-2.5 rounded-lg bg-white border border-[#CBD5E1] flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-[#0F172A]">Compte enregistré</p>
                      <p className="text-xs font-mono-num font-bold text-[#0F172A] truncate">
                        {userProfile?.withdrawalMethod} · {userProfile?.withdrawalAccount}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMethod(userProfile?.withdrawalMethod || 'Orange Money Burkina');
                        setAccount(userProfile?.withdrawalAccount || '');
                        setShowEditor(false);
                      }}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#0F172A] text-[#F5C533] text-xs font-bold shrink-0 cursor-pointer"
                    >
                      Utiliser
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-bold text-[#334155] mb-1">
                      Opérateur Mobile Money
                    </label>
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      className="w-full h-11 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs font-bold text-[#0F172A]"
                    >
                      {availableMethods.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#334155] mb-1">
                      Numéro de compte de retrait
                    </label>
                    <input
                      type="text"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder="Ex: 77409899"
                      className="w-full h-11 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs font-mono-num font-bold text-[#0F172A]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  {onConfigureWithdrawalAccount && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onConfigureWithdrawalAccount();
                      }}
                      className="text-xs font-bold text-[#0F172A] underline cursor-pointer min-h-[36px]"
                    >
                      Ouvrir Gestion des comptes de retrait
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowEditor(false)}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#0F172A] text-white text-xs font-bold cursor-pointer ml-auto"
                  >
                    Valider ce compte
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="block text-xs sm:text-sm font-extrabold text-[#0F172A]">
              Montant du retrait
            </label>
            <div className="flex items-center border-b border-[#E2E5EC] pb-2.5 focus-within:border-[#0F172A]">
              <span className="text-xs sm:text-sm font-bold text-[#0F172A] pr-3 shrink-0">
                FCFA
              </span>
              <input
                type="number"
                min={minWithdrawal}
                step={100}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Veuillez saisir le montant du retrait"
                className="w-full bg-transparent text-xs sm:text-sm font-mono-num font-semibold text-[#0F172A] placeholder:text-[#64748B] focus:outline-none"
                required
              />
            </div>
            <div className="flex items-center justify-between text-[11px] sm:text-xs text-[#334155] pt-0.5 font-medium">
              <span className="font-mono-num">Montant reçu: FCFA {netFormatted}</span>
              <span className="font-mono-num">Impôt: 15%</span>
            </div>
          </div>

          <div className="pt-3 flex justify-center">
            <button
              type="submit"
              disabled={submitting}
              className="min-w-[230px] min-h-[44px] px-8 rounded-full bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-xs sm:text-sm shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Traitement en cours...' : 'Confirmer le retrait'}
            </button>
          </div>

          <div className="space-y-2.5 pt-2">
            <h4 className="text-xs sm:text-sm font-extrabold text-[#0F172A]">
              Instructions de retrait
            </h4>
            <div className="space-y-2.5 text-xs text-[#475569] leading-relaxed">
              <p>1. Le montant minimum de retrait est de {formatCFA(minWithdrawal)}.</p>
              <p>2. Des frais de 15 % sont appliqués à tous les retraits.</p>
              <p>
                3. Vous pouvez effectuer un retrait à tout moment. Les fonds seront disponibles sous
                4 à 24 heures.
              </p>
              <p>
                4. Afin de protéger les intérêts de la plateforme et de ses membres, vous devez
                disposer d&apos;au moins un produit actif pour pouvoir effectuer des retraits.
              </p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export function BuyVipModal({
  isOpen,
  onClose,
  project,
  projects,
  onSelectProject,
  userProfile,
  allowMultipleSameVip = true,
  activeOwnedCountForSelected = 0,
  onConfirmInvest,
  onOpenDeposit,
}: {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectItem | null;
  projects: ProjectItem[];
  onSelectProject: (project: ProjectItem) => void;
  userProfile: UserProfile | null;
  allowMultipleSameVip?: boolean;
  activeOwnedCountForSelected?: number;
  onConfirmInvest: (project: ProjectItem, quantity: number) => Promise<void>;
  onOpenDeposit: () => void;
}) {
  const selected = project || projects[0] || null;
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setQuantity(1);
    setErrorMsg(null);
  }, [selected?.id, isOpen]);

  if (!isOpen || !selected) return null;

  const balance = userProfile?.balance || 0;
  const unitPrice = selected.minInvestment;
  const unitDaily = getProjectDailyIncome(selected);
  const durationDays = selected.durationDays || 90;
  const totalCost = unitPrice * quantity;
  const totalDaily = unitDaily * quantity;
  const totalReturn = totalDaily * durationDays;
  const insufficient = totalCost > balance;
  const blockedDuplicate = !allowMultipleSameVip && activeOwnedCountForSelected > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (blockedDuplicate) {
      setErrorMsg(
        `Vous possédez déjà un contrat ${selected.title} actif. Attendez son expiration (90 jours) pour le renouveler.`
      );
      return;
    }
    if (insufficient) {
      setErrorMsg('Votre solde disponible est insuffisant pour cet achat.');
      return;
    }
    try {
      setSubmitting(true);
      await onConfirmInvest(selected, quantity);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Erreur lors de l'activation du produit."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-[#D8DDE6] overflow-hidden">
        <div className="bg-[#0F172A] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#F5C533]">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display">Acheter un téléphone VIP</h3>
              <p className="text-xs text-slate-300">
                Solde disponible :{' '}
                <span className="font-mono-num font-bold text-[#F5C533]">
                  {formatCFA(balance)}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[84vh] overflow-y-auto">
          {projects.length > 1 && (
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5">
                Sélectionner le modèle (Durée : 90 jours)
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {projects
                  .filter((p) => p.status === 'active')
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectProject(item)}
                      className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap shrink-0 border transition-all cursor-pointer ${
                        item.id === selected.id
                          ? 'bg-[#0F172A] text-[#F5C533] border-[#0F172A]'
                          : 'bg-white text-[#0F172A] border-[#D8DDE6] hover:bg-[#F3F4F6]'
                      }`}
                    >
                      {item.title} · {formatCFA(item.minInvestment)}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="flex gap-3.5 p-3.5 rounded-2xl bg-[#F3F4F6] border border-[#E2E5EC]">
            <SafeImage
              src={selected.imageUrl}
              alt={selected.title}
              className="w-20 h-20 rounded-xl object-cover shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold text-[#0F172A] font-display">
                  {selected.title} — {selected.category}
                </span>
                {activeOwnedCountForSelected > 0 && (
                  <span className="text-xs font-bold text-[#0F766E]">
                    {activeOwnedCountForSelected} actif(s)
                  </span>
                )}
              </div>
              <p className="text-xs font-semibold text-[#475569]">
                Prix :{' '}
                <strong className="font-mono-num text-[#0F172A]">{formatCFA(unitPrice)}</strong>
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#0F766E]">
                <span>
                  Revenu : <strong className="font-mono-num">+{formatCFA(unitDaily)} / jour</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span className="flex items-center gap-1 text-[#334155]">
                  <Clock className="w-3.5 h-3.5 text-[#0F766E]" />
                  {durationDays} jours
                </span>
              </div>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {allowMultipleSameVip && (
            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#0F172A]" />
                Quantité à activer
              </label>
              <div className="grid grid-cols-5 gap-2">
                {[1, 2, 3, 5, 10].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuantity(q)}
                    className={`min-h-[44px] rounded-xl text-xs font-mono-num font-extrabold border transition-all cursor-pointer ${
                      quantity === q
                        ? 'bg-[#0F172A] text-[#F5C533] border-[#0F172A]'
                        : 'bg-white text-[#0F172A] border-[#D8DDE6] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    x{q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-[#0F172A] text-white p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Montant investi</span>
              <span className="font-mono-num font-bold text-white">{formatCFA(totalCost)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Revenu quotidien automatique</span>
              <span className="font-mono-num font-extrabold text-[#F5C533]">
                +{formatCFA(totalDaily)} / jour
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>Durée du contrat</span>
              <span className="font-mono-num font-semibold text-white">{durationDays} jours</span>
            </div>
            <div className="pt-2 border-t border-white/15 flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                Revenu cumulé sur {durationDays} jours
              </span>
              <span className="text-base font-mono-num font-extrabold text-[#F5C533]">
                {formatCFA(totalReturn)}
              </span>
            </div>
          </div>

          {insufficient ? (
            <div className="space-y-2.5">
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 font-medium">
                Il vous manque <strong className="font-mono-num">{formatCFA(totalCost - balance)}</strong>{' '}
                sur votre solde disponible pour cet achat.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDeposit();
                }}
                className="w-full min-h-[48px] rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-sm shadow-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <Wallet className="w-4 h-4" />
                Déposer {formatCFA(totalCost - balance)} maintenant
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={submitting || blockedDuplicate}
              className="w-full min-h-[48px] rounded-xl bg-[#F5C533] hover:bg-[#EAB308] text-[#0F172A] font-extrabold text-sm shadow-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              {submitting ? 'Activation en cours...' : `Confirmer l'achat (${formatCFA(totalCost)})`}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export function SupportModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-xs overflow-y-auto p-0 sm:p-4">
      <div className="w-full max-w-lg min-h-screen sm:min-h-0 bg-[#F3F4F6] sm:rounded-2xl shadow-2xl border border-[#D8DDE6] overflow-hidden">
        <div className="bg-white border-b border-[#E2E5EC] px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#0F172A] hover:bg-[#F1F5F9] transition-colors cursor-pointer"
            aria-label="Retour"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h3 className="text-sm sm:text-base font-extrabold text-[#0F172A] font-display">
            Service client
          </h3>
          <div className="w-11" />
        </div>

        <div className="relative h-44 sm:h-48 w-full overflow-hidden bg-[#0F172A]">
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

        <div className="p-4 space-y-3">
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
              1. Pour toute question, n&apos;hésitez pas à contacter notre service client en ligne.
              Nous serons ravis de vous aider.
            </p>
            <p>
              2. Veuillez conserver votre mot de passe en lieu sûr et ne le divulguez à personne. Le
              personnel officiel ne vous le demandera jamais.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReferralModal({
  isOpen,
  onClose,
  userProfile,
  settings,
}: {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  settings: PlatformSettings;
}) {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;

  const inviteUrl = userProfile
    ? `${window.location.origin}/?ref=${userProfile.uid}&code=${userProfile.referralCode}`
    : `${window.location.origin}/`;

  const copyInviteUrl = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-[#D8DDE6] overflow-hidden">
        <div className="bg-[#0F172A] px-6 py-4 flex items-center justify-between text-white">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-[#F5C533]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold font-display">Programme de Parrainage</h3>
              <p className="text-xs text-slate-300">
                Commission de parrainage :{' '}
                <strong className="text-[#F5C533]">{settings.referralRate}%</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="p-4 rounded-2xl bg-[#F3F4F6] border border-[#E2E5EC] text-center space-y-1">
            <p className="text-xs font-semibold text-[#475569]">Code d&apos;invitation personnel</p>
            <p className="text-2xl font-mono-num font-extrabold text-[#0F172A] tracking-wider">
              {userProfile?.referralCode || 'AM-INVITE'}
            </p>
            <p className="text-xs text-[#475569]">
              Invitez vos proches et grandissez ensemble avec AURELIA MOBILE.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#334155] mb-1.5">
              Votre lien de parrainage
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 h-11 px-3.5 rounded-xl border border-[#CBD5E1] bg-white text-xs font-mono-num text-[#0F172A]"
              />
              <button
                type="button"
                onClick={copyInviteUrl}
                className="min-h-[44px] px-4 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-white text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Copy className="w-4 h-4 text-[#F5C533]" />
                {copied ? 'Copié !' : 'Copier'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={async () => {
                if (navigator.share) {
                  try {
                    await navigator.share({
                      title: 'AURELIA MOBILE',
                      text: "Rejoignez AURELIA MOBILE (« L'excellence du smartphone, le rendement au quotidien ») via mon lien d'invitation :",
                      url: inviteUrl,
                    });
                  } catch {
                    // ignore share cancellation
                  }
                } else {
                  copyInviteUrl();
                }
              }}
              className="min-h-[48px] rounded-xl bg-[#1E293B] hover:bg-[#334155] text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Share2 className="w-4 h-4 text-[#F5C533]" />
              Partager le lien
            </button>

            <a
              href={`https://wa.me/?text=${encodeURIComponent(
                `Rejoignez AURELIA MOBILE (« L'excellence du smartphone, le rendement au quotidien ») et percevez vos revenus quotidiens : ${inviteUrl}`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[48px] rounded-xl bg-[#0F172A] hover:bg-[#1E293B] text-[#F5C533] font-bold text-xs flex items-center justify-center gap-2"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
