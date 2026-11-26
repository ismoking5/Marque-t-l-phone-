-- Patch idempotent : Pointage quotidien (30 F CFA / 24h sans double crédit) + Codes cadeaux (10 à 100 F CFA aléatoires sans double crédit)
-- À exécuter dans Supabase Dashboard > SQL Editor

-- 1. Colonnes de pointage quotidien sur profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_checkin_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkin_total bigint NOT NULL DEFAULT 0;

-- 2. Protection des champs sensibles (empêcher toute manipulation directe côté client)
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
     OR NEW.last_checkin_at IS DISTINCT FROM OLD.last_checkin_at
     OR NEW.checkin_days IS DISTINCT FROM OLD.checkin_days
     OR NEW.checkin_total IS DISTINCT FROM OLD.checkin_total
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code
     OR NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'Modification directe des champs protégés interdite.';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Tables pour les codes cadeaux et leur utilisation unique par compte
CREATE TABLE IF NOT EXISTS public.gift_codes (
  code text PRIMARY KEY,
  min_amount integer NOT NULL DEFAULT 10,
  max_amount integer NOT NULL DEFAULT 100,
  max_uses integer NOT NULL DEFAULT 5000,
  uses_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gift_code_redemptions (
  id text PRIMARY KEY,
  code text NOT NULL REFERENCES public.gift_codes(code) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
  amount integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, user_id)
);

ALTER TABLE public.gift_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gift_code_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gift_codes_admin_all" ON public.gift_codes;
CREATE POLICY "gift_codes_admin_all"
  ON public.gift_codes FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "gift_redemptions_select_own_or_admin" ON public.gift_code_redemptions;
CREATE POLICY "gift_redemptions_select_own_or_admin"
  ON public.gift_code_redemptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.uid = user_id AND p.auth_uid = auth.uid())
    OR public.is_admin()
  );

-- Codes officiels initiaux (10 à 100 F CFA aléatoires, 1 seule utilisation par compte)
INSERT INTO public.gift_codes (code, min_amount, max_amount, max_uses, is_active)
VALUES
  ('AURELIA2026', 10, 100, 5000, true),
  ('AURELIAGIFT', 10, 100, 5000, true),
  ('VIPBONUS', 10, 100, 5000, true)
ON CONFLICT (code) DO NOTHING;

-- 4. RPC atomique : Pointage quotidien 30 F CFA renouvelé chaque jour à 00h00 UTC (aucun double crédit possible)
CREATE OR REPLACE FUNCTION public.claim_daily_checkin()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_next_day integer;
  v_now timestamptz := now();
  v_today date := (v_now AT TIME ZONE 'UTC')::date;
  v_last_day date;
  v_tx_id text;
  v_inserted_id text;
  v_remaining interval;
  v_hours integer;
  v_mins integer;
BEGIN
  SELECT * INTO v_me
  FROM public.profiles
  WHERE auth_uid = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable.';
  END IF;

  IF v_me.last_checkin_at IS NOT NULL THEN
    v_last_day := (v_me.last_checkin_at AT TIME ZONE 'UTC')::date;
    IF v_last_day >= v_today THEN
      v_remaining := (((v_today + 1)::timestamp) AT TIME ZONE 'UTC') - v_now;
      v_hours := GREATEST(0, floor(extract(epoch FROM v_remaining) / 3600)::integer);
      v_mins := GREATEST(0, floor((extract(epoch FROM v_remaining)::bigint % 3600) / 60)::integer);
      RAISE EXCEPTION 'Pointage déjà effectué aujourd''hui. Renouvellement à 00h00 (dans %h %m).', v_hours, v_mins;
    END IF;
  END IF;

  v_next_day := COALESCE(v_me.checkin_days, 0) + 1;
  v_tx_id := 'tx_checkin_' || v_me.uid || '_' || to_char(v_today, 'YYYYMMDD');

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id,
    v_me.uid,
    v_me.display_name,
    'credit',
    30,
    'Pointage quotidien',
    COALESCE(NULLIF(v_me.phone, ''), v_me.email),
    'Bonus de connexion quotidien (Jour ' || v_next_day::text || ')',
    'completed'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RAISE EXCEPTION 'Pointage déjà enregistré pour aujourd''hui. Renouvellement à 00h00.';
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET balance = balance + 30,
      last_checkin_at = v_now,
      checkin_days = v_next_day,
      checkin_total = COALESCE(checkin_total, 0) + 30,
      updated_at = v_now
  WHERE uid = v_me.uid;

  RETURN jsonb_build_object(
    'amount', 30,
    'checkin_days', v_next_day,
    'checkin_total', COALESCE(v_me.checkin_total, 0) + 30,
    'last_checkin_at', v_now
  );
END;
$$;

-- 5. RPC atomique : Utiliser un code cadeau (10 à 100 F CFA aléatoire, aucun double crédit)
CREATE OR REPLACE FUNCTION public.redeem_gift_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_me public.profiles%ROWTYPE;
  v_gift public.gift_codes%ROWTYPE;
  v_min integer;
  v_max integer;
  v_amount integer;
  v_red_id text;
  v_tx_id text;
  v_tx_inserted_id text;
BEGIN
  v_code := upper(regexp_replace(trim(COALESCE(p_code, '')), '[^A-Za-z0-9_-]', '', 'g'));
  IF length(v_code) < 3 THEN
    RAISE EXCEPTION 'Veuillez saisir un code cadeau valide.';
  END IF;

  SELECT * INTO v_me
  FROM public.profiles
  WHERE auth_uid = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable.';
  END IF;

  SELECT * INTO v_gift
  FROM public.gift_codes
  WHERE code = v_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Code cadeau invalide ou inexistant.';
  END IF;

  IF NOT v_gift.is_active THEN
    RAISE EXCEPTION 'Ce code cadeau n''est plus actif.';
  END IF;

  IF v_gift.uses_count >= v_gift.max_uses THEN
    RAISE EXCEPTION 'Ce code cadeau a atteint le nombre maximal d''utilisations.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.gift_code_redemptions
    WHERE code = v_code AND user_id = v_me.uid
  ) THEN
    RAISE EXCEPTION 'Vous avez déjà utilisé ce code cadeau. Aucun double crédit autorisé.';
  END IF;

  v_min := GREATEST(10, LEAST(100, COALESCE(v_gift.min_amount, 10)));
  v_max := GREATEST(v_min, LEAST(100, COALESCE(v_gift.max_amount, 100)));
  v_amount := v_min + floor(random() * (v_max - v_min + 1))::integer;

  INSERT INTO public.gift_code_redemptions (id, code, user_id, amount)
  VALUES ('gcr_' || v_code || '_' || v_me.uid, v_code, v_me.uid, v_amount)
  ON CONFLICT (code, user_id) DO NOTHING
  RETURNING id INTO v_red_id;

  IF v_red_id IS NULL THEN
    RAISE EXCEPTION 'Vous avez déjà utilisé ce code cadeau. Aucun double crédit autorisé.';
  END IF;

  UPDATE public.gift_codes
  SET uses_count = uses_count + 1
  WHERE code = v_code;

  v_tx_id := 'tx_code_' || left(v_me.uid, 20) || '_' || left(md5(v_code), 12);

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id,
    v_me.uid,
    v_me.display_name,
    'credit',
    v_amount,
    'Code cadeau',
    COALESCE(NULLIF(v_me.phone, ''), v_me.email),
    left('Code cadeau ' || v_code || ' (+' || v_amount::text || ' F CFA)', 100),
    'completed'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_tx_inserted_id;

  IF v_tx_inserted_id IS NULL THEN
    RAISE EXCEPTION 'Ce code cadeau a déjà été crédité sur votre compte.';
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET balance = balance + v_amount,
      updated_at = now()
  WHERE uid = v_me.uid;

  RETURN jsonb_build_object(
    'code', v_code,
    'amount', v_amount
  );
END;
$$;

-- 6. RPC Admin : Créer / modifier un code cadeau
CREATE OR REPLACE FUNCTION public.admin_upsert_gift_code(
  p_code text,
  p_min_amount integer DEFAULT 10,
  p_max_amount integer DEFAULT 100,
  p_max_uses integer DEFAULT 1000,
  p_is_active boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_min integer;
  v_max integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès administrateur requis.';
  END IF;

  v_code := upper(regexp_replace(trim(COALESCE(p_code, '')), '[^A-Za-z0-9_-]', '', 'g'));
  IF length(v_code) < 3 OR length(v_code) > 32 THEN
    RAISE EXCEPTION 'Le code cadeau doit contenir entre 3 et 32 caractères alphanumériques.';
  END IF;

  v_min := GREATEST(10, LEAST(100, COALESCE(p_min_amount, 10)));
  v_max := GREATEST(v_min, LEAST(100, COALESCE(p_max_amount, 100)));

  INSERT INTO public.gift_codes (code, min_amount, max_amount, max_uses, is_active)
  VALUES (v_code, v_min, v_max, GREATEST(1, COALESCE(p_max_uses, 1000)), COALESCE(p_is_active, true))
  ON CONFLICT (code) DO UPDATE
  SET min_amount = EXCLUDED.min_amount,
      max_amount = EXCLUDED.max_amount,
      max_uses = EXCLUDED.max_uses,
      is_active = EXCLUDED.is_active;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_daily_checkin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_gift_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_gift_code(text, integer, integer, integer, boolean) TO authenticated;
