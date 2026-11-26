-- Patch idempotent : Bonus d'inscription 500 F CFA sur chaque nouvelle inscription uniquement (sans double crédit)
-- À exécuter dans Supabase Dashboard > SQL Editor

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registration_bonus_claimed boolean NOT NULL DEFAULT false;

-- Marquer les comptes déjà existants avant ce patch afin d'éviter tout crédit rétroactif ou double crédit
DO $$
BEGIN
  PERFORM set_config('app.allow_financial_write', '1', true);
  UPDATE public.profiles
  SET registration_bonus_claimed = true
  WHERE registration_bonus_claimed = false;
END $$;

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.allow_financial_write', true) = '1' OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.uid IS DISTINCT FROM OLD.uid
     OR NEW.auth_uid IS DISTINCT FROM OLD.auth_uid
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.balance IS DISTINCT FROM OLD.balance
     OR NEW.total_invested IS DISTINCT FROM OLD.total_invested
     OR NEW.total_earned IS DISTINCT FROM OLD.total_earned
     OR NEW.referral_bonus IS DISTINCT FROM OLD.referral_bonus
     OR NEW.referral_count IS DISTINCT FROM OLD.referral_count
     OR NEW.registration_bonus_claimed IS DISTINCT FROM OLD.registration_bonus_claimed
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'Modification directe des champs protégés interdite.';
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = auth_uid
    AND balance = 0
    AND total_invested = 0
    AND total_earned = 0
    AND referral_bonus = 0
    AND COALESCE(registration_bonus_claimed, false) = false
    AND (role = 'user' OR public.is_admin())
  );

CREATE OR REPLACE FUNCTION public.apply_registration_bonus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_signup_mode text := '';
  v_tx_id text;
  v_inserted_id text;
BEGIN
  IF NEW.role <> 'user' OR lower(COALESCE(NEW.email, '')) IN (
    '22677409899@aureliamobile.africa',
    'ismailasawadogo10@gmail.com'
  ) THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.registration_bonus_claimed, false) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(u.raw_user_meta_data ->> 'signup_mode', '')
  INTO v_signup_mode
  FROM auth.users u
  WHERE u.id = NEW.auth_uid;

  IF v_signup_mode <> 'register' THEN
    RETURN NEW;
  END IF;

  v_tx_id := 'tx_reg_bonus_' || NEW.uid;

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id,
    NEW.uid,
    NEW.display_name,
    'credit',
    500,
    'Bonus d''inscription',
    COALESCE(NULLIF(NEW.phone, ''), NEW.email),
    'Bonus de bienvenue (nouvelle inscription)',
    'completed'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NOT NULL THEN
    PERFORM set_config('app.allow_financial_write', '1', true);
    UPDATE public.profiles
    SET balance = balance + 500,
        registration_bonus_claimed = true,
        updated_at = now()
    WHERE uid = NEW.uid
      AND registration_bonus_claimed = false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_registration_bonus ON public.profiles;
CREATE TRIGGER trg_apply_registration_bonus
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_registration_bonus();
