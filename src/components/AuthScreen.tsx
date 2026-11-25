import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import {
  COUNTRY_OPTIONS,
  isEligibleCountry,
  validateEligiblePhone,
} from '../data/catalog';
import type { CountryOption, PhoneAuthPayload } from '../types';
import { BrandLogo } from './Brand';

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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [loginCountry, setLoginCountry] = useState<CountryOption>(
    COUNTRY_OPTIONS.find((c) => c.dialCode === '+226') || COUNTRY_OPTIONS[0]
  );
  const [registerCountry, setRegisterCountry] = useState<CountryOption | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [invitationCode, setInvitationCode] = useState(initialInvitationCode || '');
  const [rememberPassword, setRememberPassword] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_LOGIN_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          dialCode?: string;
          phone?: string;
          remember?: boolean;
        };
        if (parsed.phone) setPhone(parsed.phone);
        if (typeof parsed.remember === 'boolean') setRememberPassword(parsed.remember);
        if (parsed.dialCode) {
          const found = COUNTRY_OPTIONS.find((c) => c.dialCode === parsed.dialCode);
          if (found) setLoginCountry(found);
        }
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (initialInvitationCode) setInvitationCode(initialInvitationCode);
  }, [initialInvitationCode]);

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

    const activeCountry = mode === 'login' ? loginCountry : registerCountry;
    if (!activeCountry || !isEligibleCountry(activeCountry.country, activeCountry.dialCode)) {
      setErrorMsg(
        'Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, le Sénégal et le Togo sont autorisés.'
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
      if (mode === 'login') {
        if (rememberPassword) {
          localStorage.setItem(
            SAVED_LOGIN_STORAGE_KEY,
            JSON.stringify({
              dialCode: activeCountry.dialCode,
              phone: cleanedPhone,
              remember: true,
            })
          );
        } else {
          localStorage.removeItem(SAVED_LOGIN_STORAGE_KEY);
        }
      } else {
        localStorage.setItem(
          SAVED_LOGIN_STORAGE_KEY,
          JSON.stringify({
            dialCode: activeCountry.dialCode,
            phone: cleanedPhone,
            remember: true,
          })
        );
      }

      await onSubmitPhoneAuth({
        mode,
        country: activeCountry.country,
        dialCode: activeCountry.dialCode,
        phone: cleanedPhone,
        password,
        invitationCode: invitationCode.trim(),
        rememberPassword,
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
    <div className="min-h-screen bg-[#F3F4F6] text-[#0F172A] flex flex-col items-center pt-4 pb-12 px-4">
      <div className="w-full max-w-[380px]">
        <div className="h-10 flex items-center">
          {mode === 'register' && (
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-[#0F172A] hover:text-[#1E293B] transition-colors cursor-pointer"
              aria-label="Retour à la connexion"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="mt-4 mb-8 flex items-center justify-center">
          <BrandLogo compact={false} />
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <button
            type="button"
            onClick={() => setCountryModalOpen(true)}
            className="w-full min-h-[44px] px-3.5 rounded-lg bg-[#0F172A] hover:bg-[#1E293B] border border-[#334155] text-left flex items-center gap-3 text-xs font-semibold text-white transition-colors cursor-pointer shadow-2xs"
          >
            {mode === 'login' ? (
              <>
                <span className="font-mono-num font-bold text-[#F5C533]">
                  {loginCountry.dialCode}
                </span>
                <span className="truncate text-white">{loginCountry.country}</span>
                <span className="ml-auto text-[#F5C533] font-mono-num">&gt;&gt;</span>
              </>
            ) : registerCountry ? (
              <>
                <span className="font-mono-num font-bold text-[#F5C533]">
                  {registerCountry.dialCode}
                </span>
                <span className="truncate text-white">{registerCountry.country}</span>
                <span className="ml-auto text-[#F5C533] font-mono-num">&gt;&gt;</span>
              </>
            ) : (
              <>
                <span className="text-slate-200">Sélectionner votre pays</span>
                <span className="ml-auto text-[#F5C533] font-mono-num">&gt;&gt;</span>
              </>
            )}
          </button>

          <div>
            <input
              type="tel"
              autoComplete="tel-national"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Numéro de téléphone"
              className="w-full h-11 px-3.5 rounded-lg border border-[#D8DDE6] bg-white text-xs sm:text-sm font-mono-num text-[#0F172A] placeholder:text-[#64748B] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]/20"
              required
            />
          </div>

          <div>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Veuillez saisir votre mot de passe"
              className="w-full h-11 px-3.5 rounded-lg border border-[#D8DDE6] bg-white text-xs sm:text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]/20"
              required
            />
          </div>

          {mode === 'register' && (
            <>
              <div>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirmer le mot de passe"
                  className="w-full h-11 px-3.5 rounded-lg border border-[#D8DDE6] bg-white text-xs sm:text-sm text-[#0F172A] placeholder:text-[#64748B] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]/20"
                  required
                />
              </div>
              <div>
                <input
                  type="text"
                  value={invitationCode}
                  onChange={(e) => setInvitationCode(e.target.value)}
                  placeholder="Code d'invitation (optionnel, ex: AM-409899)"
                  className="w-full h-11 px-3.5 rounded-lg border border-[#D8DDE6] bg-white text-xs sm:text-sm font-mono-num text-[#0F172A] placeholder:text-[#64748B] focus:outline-none focus:border-[#0F172A] focus:ring-1 focus:ring-[#0F172A]/20"
                />
              </div>
            </>
          )}

          {mode === 'login' && (
            <div className="pt-1 pb-1">
              <label className="inline-flex items-center gap-2.5 text-xs text-[#0F172A] cursor-pointer select-none min-h-[36px]">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(e) => setRememberPassword(e.target.checked)}
                  className="w-4 h-4 accent-[#0F172A] rounded-xs border-[#CBD5E1] cursor-pointer"
                />
                <span>Retenir le mot de passe</span>
              </label>
            </div>
          )}

          <div className="pt-1">
            <button
              type="submit"
              disabled={submitting}
              className={`w-full min-h-[44px] bg-[#0F172A] hover:bg-[#1E293B] border border-[#334155] text-[#F5C533] font-extrabold text-xs sm:text-sm shadow-2xs transition-colors flex items-center justify-center cursor-pointer disabled:opacity-50 ${
                mode === 'login' ? 'rounded-full' : 'rounded-lg'
              }`}
            >
              {submitting
                ? 'Chargement...'
                : mode === 'login'
                ? 'Connectez-vous maintenant'
                : 'Inscrivez-vous maintenant'}
            </button>
          </div>

          <div className="pt-2.5 text-center text-xs">
            {mode === 'login' ? (
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg(null);
                }}
                className="min-h-[40px] px-3 text-[#0F172A] hover:text-[#334155] underline font-bold cursor-pointer"
              >
                Créer un compte &gt;
              </button>
            ) : (
              <p className="text-[#475569]">
                Avez-vous déjà un compte ?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMsg(null);
                  }}
                  className="text-[#0F172A] hover:text-[#334155] underline font-bold cursor-pointer"
                >
                  Accéder à la connexion &gt;
                </button>
              </p>
            )}
          </div>
        </form>

        {onGoogleAuth && (
          <div className="mt-6 pt-5 border-t border-[#E2E5EC]">
            <button
              type="button"
              onClick={onGoogleAuth}
              className="w-full min-h-[44px] px-4 rounded-xl bg-white hover:bg-[#F8FAFC] border border-[#CBD5E1] text-[#0F172A] text-xs font-bold flex items-center justify-center gap-2.5 transition-colors cursor-pointer shadow-2xs"
            >
              <span className="w-4 h-4 rounded-full bg-[#0F172A] text-[#F5C533] text-[10px] font-extrabold flex items-center justify-center">
                G
              </span>
              <span>Synchronisation Cloud Google</span>
            </button>
          </div>
        )}
      </div>

      {countryModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
          onClick={() => setCountryModalOpen(false)}
        >
          <div
            className="w-full max-w-[360px] bg-white border border-[#E2E5EC] rounded-xl p-3.5 shadow-2xl flex flex-col gap-2 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-extrabold text-[#0F172A] px-1 pb-1">
              Choisissez votre pays
            </p>
            {COUNTRY_OPTIONS.map((item) => (
              <button
                key={`${item.dialCode}_${item.country}`}
                type="button"
                onClick={() => handleSelectCountry(item)}
                className="w-full min-h-[44px] px-3.5 rounded-lg bg-gradient-to-r from-[#0F172A] via-[#1E293B] to-[#020617] border border-[#334155] hover:opacity-95 text-white text-xs font-medium flex items-center justify-between transition-opacity cursor-pointer"
              >
                <span className="font-mono-num font-bold text-[#F5C533]">{item.dialCode}</span>
                <span className="font-semibold text-white">{item.country}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
