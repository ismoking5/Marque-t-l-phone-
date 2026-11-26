import { FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Lock,
  Smartphone,
} from 'lucide-react';
import {
  COUNTRY_OPTIONS,
  REGISTRATION_BONUS_CFA,
  formatCFA,
  isEligibleCountry,
  validateEligiblePhone,
} from '../data/catalog';
import type { CountryOption, PhoneAuthPayload } from '../types';

const SAVED_LOGIN_STORAGE_KEY = 'aurelia_mobile_saved_login_v1';

interface AuthScreenProps {
  initialInvitationCode?: string;
  onSubmitPhoneAuth: (payload: PhoneAuthPayload) => Promise<void>;
  onGoogleAuth?: () => Promise<void>;
}

export function AuthScreen({
  initialInvitationCode = '',
  onSubmitPhoneAuth,
  onGoogleAuth,
}: AuthScreenProps) {
  const defaultCountry =
    COUNTRY_OPTIONS.find((c) => c.dialCode === '+226') || COUNTRY_OPTIONS[0];

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [loginCountry, setLoginCountry] = useState<CountryOption>(defaultCountry);
  const [registerCountry, setRegisterCountry] = useState<CountryOption>(defaultCountry);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState(initialInvitationCode || '');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_LOGIN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          dialCode?: string;
          phone?: string;
        };
        if (parsed.phone) setPhone(parsed.phone);
        if (parsed.dialCode) {
          const found = COUNTRY_OPTIONS.find((c) => c.dialCode === parsed.dialCode);
          if (found) {
            setLoginCountry(found);
            setRegisterCountry(found);
          }
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (initialInvitationCode) setInvitationCode(initialInvitationCode);
  }, [initialInvitationCode]);

  const activeCountry = mode === 'login' ? loginCountry : registerCountry;

  const handleSelectCountry = (item: CountryOption) => {
    if (mode === 'login') {
      setLoginCountry(item);
    } else {
      setRegisterCountry(item);
    }
    setCountryModalOpen(false);
    setErrorMsg(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!activeCountry || !isEligibleCountry(activeCountry.country, activeCountry.dialCode)) {
      setErrorMsg(
        "Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, la Côte d'Ivoire, le Sénégal et le Togo sont autorisés."
      );
      return;
    }

    const phoneValidation = validateEligiblePhone(
      activeCountry.dialCode,
      phone,
      activeCountry.country
    );
    if (phoneValidation.ok === false) {
      setErrorMsg(phoneValidation.error);
      return;
    }
    const cleanedPhone = phoneValidation.cleanDigits;

    if (password.length < 6) {
      setErrorMsg('Veuillez saisir un mot de passe (minimum 6 caractères).');
      return;
    }
    if (mode === 'register' && password !== confirmPassword) {
      setErrorMsg('Les deux mots de passe ne correspondent pas.');
      return;
    }

    setSubmitting(true);
    try {
      localStorage.setItem(
        SAVED_LOGIN_STORAGE_KEY,
        JSON.stringify({
          dialCode: activeCountry.dialCode,
          phone: cleanedPhone,
          remember: true,
        })
      );

      await onSubmitPhoneAuth({
        mode,
        country: activeCountry.country,
        dialCode: activeCountry.dialCode,
        phone: cleanedPhone,
        password,
        invitationCode: invitationCode.trim(),
        rememberPassword: true,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Une erreur est survenue. Veuillez réessayer.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#D97706] via-[#F59E0B] via-[34%] to-white text-[#111827] flex flex-col items-center justify-between px-5 pt-10 pb-10">
      <div className="w-full max-w-[390px] flex-1 flex flex-col">
        {/* Hero Brand Wordmark */}
        <div className="pt-10 pb-12 sm:pt-14 sm:pb-14 flex flex-col items-center justify-center text-center select-none">
          <h1 className="font-display font-black tracking-[0.06em] text-4xl sm:text-5xl text-white drop-shadow-[0_2px_10px_rgba(120,53,15,0.25)]">
            AURELIA
          </h1>
          <span className="mt-1 text-xs font-bold tracking-[0.38em] text-white/90 uppercase">
            MOBILE
          </span>
        </div>

        {/* Form Area */}
        <div className="w-full mt-auto mb-auto">
          {errorMsg && (
            <div className="mb-3.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2 shadow-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {/* Phone Field with inline Country Selector Trigger */}
            <div className="w-full h-12 rounded-lg border border-[#D1D5DB] bg-white/95 focus-within:border-[#D97706] focus-within:ring-2 focus-within:ring-[#D97706]/20 flex items-center px-3 gap-2 shadow-2xs transition-colors">
              <button
                type="button"
                onClick={() => setCountryModalOpen(true)}
                className="flex items-center gap-1.5 pr-2 py-1 text-[#111827] hover:opacity-80 transition-opacity cursor-pointer shrink-0"
                aria-label="Sélectionner votre pays"
              >
                <Smartphone className="w-5 h-5 text-[#D97706] shrink-0" />
                <span className="text-sm sm:text-base font-medium font-mono-num text-[#1F2937]">
                  {activeCountry.dialCode}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[#6B7280]" />
              </button>

              <input
                type="tel"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Entrez le numéro de tél"
                className="flex-1 min-w-0 h-full bg-transparent text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
                required
              />
            </div>

            {/* Password Field */}
            <div className="w-full h-12 rounded-lg border border-[#D1D5DB] bg-white/95 focus-within:border-[#D97706] focus-within:ring-2 focus-within:ring-[#D97706]/20 flex items-center px-3 gap-2.5 shadow-2xs transition-colors">
              <Lock className="w-5 h-5 text-[#D97706] shrink-0" />
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Entrez le mot de passe"
                className="flex-1 min-w-0 h-full bg-transparent text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
                required
              />
            </div>

            {/* Extra Register Fields */}
            {mode === 'register' && (
              <>
                <div className="w-full h-12 rounded-lg border border-[#D1D5DB] bg-white/95 focus-within:border-[#D97706] focus-within:ring-2 focus-within:ring-[#D97706]/20 flex items-center px-3 gap-2.5 shadow-2xs transition-colors">
                  <Lock className="w-5 h-5 text-[#D97706] shrink-0" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Saisissez de nouveau le mot de passe"
                    className="flex-1 min-w-0 h-full bg-transparent text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
                    required
                  />
                </div>

                <div className="w-full h-12 rounded-lg border border-[#D1D5DB] bg-white/95 focus-within:border-[#D97706] focus-within:ring-2 focus-within:ring-[#D97706]/20 flex items-center px-3 gap-2.5 shadow-2xs transition-colors">
                  <Code2 className="w-5 h-5 text-[#D97706] shrink-0" />
                  <input
                    type="text"
                    value={invitationCode}
                    onChange={(e) => setInvitationCode(e.target.value)}
                    placeholder="Entrez le code d'invitation"
                    className="flex-1 min-w-0 h-full bg-transparent text-sm font-mono-num text-[#111827] placeholder:text-[#9CA3AF] placeholder:font-sans focus:outline-none"
                  />
                </div>

                <p className="text-[11px] font-medium text-[#B45309] text-center pt-0.5">
                  Bonus d&apos;inscription :{' '}
                  <strong className="font-mono-num">{formatCFA(REGISTRATION_BONUS_CFA)}</strong>{' '}
                  offerts sur chaque nouvelle inscription
                </p>
              </>
            )}

            {/* Submit Pill Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] rounded-full bg-[#D97706] hover:bg-[#B45309] active:scale-[0.99] text-white font-semibold text-base shadow-md transition-all flex items-center justify-center cursor-pointer disabled:opacity-55"
              >
                {submitting
                  ? 'Chargement...'
                  : mode === 'login'
                  ? 'Se connecter'
                  : "S'inscrire"}
              </button>
            </div>

            {/* Switch Auth Mode Link */}
            <div className="pt-3 text-center">
              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMsg(null);
                  }}
                  className="min-h-[40px] px-3 text-sm font-medium text-[#D97706] hover:text-[#B45309] underline underline-offset-4 cursor-pointer"
                >
                  Aller à l&apos;inscription &gt;
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                  }}
                  className="min-h-[40px] px-3 text-sm font-medium text-[#D97706] hover:text-[#B45309] underline underline-offset-4 cursor-pointer"
                >
                  Aller à la connexion &gt;
                </button>
              )}
            </div>
          </form>

          {onGoogleAuth && (
            <div className="mt-6 pt-4 border-t border-[#E5E7EB]">
              <button
                type="button"
                onClick={onGoogleAuth}
                className="w-full min-h-[44px] px-4 rounded-full bg-white hover:bg-[#F9FAFB] border border-[#D1D5DB] text-[#111827] text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span className="w-4 h-4 rounded-full bg-[#D97706] text-white text-[10px] font-bold flex items-center justify-center">
                  G
                </span>
                <span>Synchronisation Cloud Google</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Country Selector Bottom Sheet */}
      {countryModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
          onClick={() => setCountryModalOpen(false)}
        >
          <div
            className="w-full max-w-[440px] bg-white rounded-t-3xl sm:rounded-3xl p-5 pb-7 shadow-2xl max-h-[82vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full bg-[#D1D5DB] mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setCountryModalOpen(false)}
                className="min-w-[40px] min-h-[40px] -ml-2 rounded-lg flex items-center justify-center text-[#111827] hover:bg-[#F3F4F6] cursor-pointer"
                aria-label="Fermer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-base font-bold text-[#111827]">
                Sélectionnez votre pays
              </h2>
              <div className="w-10" />
            </div>

            <div className="space-y-2.5">
              {COUNTRY_OPTIONS.map((item) => {
                const selected = item.dialCode === activeCountry.dialCode;
                return (
                  <button
                    key={`${item.dialCode}_${item.country}`}
                    type="button"
                    onClick={() => handleSelectCountry(item)}
                    className={`w-full min-h-[52px] px-4 rounded-xl flex items-center justify-between text-left transition-colors cursor-pointer ${
                      selected
                        ? 'bg-white border-2 border-[#D97706] shadow-2xs'
                        : 'bg-[#F8F9FA] border border-transparent hover:bg-[#F1F3F5]'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium font-mono-num text-[#D97706] min-w-[42px]">
                        {item.dialCode}
                      </span>
                      <span className="text-sm sm:text-[15px] font-medium text-[#111827]">
                        {item.country}
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#9CA3AF] shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
