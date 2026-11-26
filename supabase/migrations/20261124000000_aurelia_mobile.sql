-- AURELIA MOBILE — Schema PostgreSQL + RLS + Fonctions atomiques pour Supabase
-- Projet : fhiyxlrlyudymhmlbykd
-- IMPORTANT : Dans Supabase Dashboard > Authentication > Providers > Email,
-- désactivez "Confirm email" pour permettre l'inscription directe par numéro de téléphone.

-- 1. Fonction helper administrateur unique (+226 77409899 ou email admin)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(COALESCE(auth.jwt() ->> 'email', '')) IN (
    '22677409899@aureliamobile.africa',
    'ismailasawadogo10@gmail.com'
  );
$$;

-- 2. Table des profils utilisateurs
CREATE TABLE IF NOT EXISTS public.profiles (
  uid text PRIMARY KEY,
  auth_uid uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  withdrawal_country text NOT NULL DEFAULT 'Burkina Faso',
  withdrawal_method text NOT NULL DEFAULT 'Orange Money Burkina',
  withdrawal_account text NOT NULL DEFAULT '',
  withdrawal_holder text NOT NULL DEFAULT '',
  balance bigint NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_invested bigint NOT NULL DEFAULT 0 CHECK (total_invested >= 0),
  total_earned bigint NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  referral_code text UNIQUE NOT NULL,
  referred_by text NOT NULL DEFAULT '',
  referral_bonus bigint NOT NULL DEFAULT 0 CHECK (referral_bonus >= 0),
  referral_count integer NOT NULL DEFAULT 0 CHECK (referral_count >= 0),
  registration_bonus_claimed boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registration_bonus_claimed boolean NOT NULL DEFAULT false;

-- Protection des champs financiers et du rôle contre toute modification directe côté client
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

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_fields();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = auth_uid OR public.is_admin());

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

-- Attribution atomique du bonus d'inscription (500 F CFA uniquement sur nouvelle inscription, zéro double crédit)
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

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_update_own_or_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = auth_uid OR public.is_admin())
  WITH CHECK (auth.uid() = auth_uid OR public.is_admin());

-- 3. Table du catalogue produits VIP
CREATE TABLE IF NOT EXISTS public.projects (
  id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  description text NOT NULL,
  location text NOT NULL,
  image_url text NOT NULL,
  return_rate integer NOT NULL CHECK (return_rate >= 1),
  duration_days integer NOT NULL DEFAULT 90 CHECK (duration_days >= 1 AND duration_days <= 3650),
  min_investment bigint NOT NULL CHECK (min_investment >= 500),
  daily_income bigint NOT NULL CHECK (daily_income >= 50),
  target_amount bigint NOT NULL DEFAULT 20000000,
  raised_amount bigint NOT NULL DEFAULT 0,
  investors_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_select_public_or_admin" ON public.projects;
CREATE POLICY "projects_select_public_or_admin"
  ON public.projects FOR SELECT
  TO anon, authenticated
  USING (visibility = 'public' OR public.is_admin());

DROP POLICY IF EXISTS "projects_admin_all" ON public.projects;
CREATE POLICY "projects_admin_all"
  ON public.projects FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.projects (
  id, title, category, description, location, image_url,
  return_rate, duration_days, min_investment, daily_income,
  target_amount, raised_amount, investors_count, status, visibility
) VALUES
  (
    'vip_1',
    'VIP 1 · Aurelia S1 Compact',
    'Titane Brossé · 256 Go',
    'Smartphone compact de haute précision doté d’un châssis en titane brossé, écran OLED LTPO 120 Hz et optique saphir. Génère 400 F CFA chaque jour pendant 90 jours.',
    'Distribution Ouagadougou & Bobo-Dioulasso',
    'preset:titanium',
    900, 90, 4000, 400, 20000000, 8400000, 310, 'active', 'public'
  ),
  (
    'vip_2',
    'VIP 2 · Aurelia X2 Pro',
    'Verre Saphir · 512 Go',
    'Flagship photographie équipé d’un triple module téléobjectif périscopique, verre saphir anti-rayures et charge rapide 100 W. Génère 1 000 F CFA chaque jour pendant 90 jours.',
    'Showrooms Abidjan & Dakar',
    'preset:hero',
    1500, 90, 6000, 1000, 30000000, 14400000, 245, 'active', 'public'
  ),
  (
    'vip_3',
    'VIP 3 · Aurelia Fold V',
    'Édition Pliable OLED · 1 To',
    'Terminal pliable ultra-fin à charnière aérospatiale en titane et double dalle AMOLED HDR10+ pour dirigeants. Génère 2 500 F CFA chaque jour pendant 90 jours.',
    'Ouagadougou, Abidjan & Lomé',
    'preset:foldable',
    1500, 90, 15000, 2500, 45000000, 22500000, 180, 'active', 'public'
  ),
  (
    'vip_4',
    'VIP 4 · Aurelia Ultra Céramique',
    'Céramique & Or · 1 To',
    'Fleuron technologique sculpté en céramique noire micro-polie, processeur gravé 3 nm et sécurité biométrique matérielle. Génère 8 000 F CFA chaque jour pendant 90 jours.',
    'Hub Commercial Afrique de l’Ouest',
    'preset:ceramic',
    1200, 90, 60000, 8000, 80000000, 38400000, 96, 'active', 'public'
  ),
  (
    'vip_5',
    'VIP 5 · Aurelia Sovereign',
    'Titane Grade 5 · 2 To',
    'Série manufacture limitée assemblée en titane Grade 5 avec connectivité satellite mondiale et conciergerie privée. Génère 10 000 F CFA chaque jour pendant 90 jours.',
    'Réseau Flagship International & Export',
    'preset:hero',
    900, 90, 100000, 10000, 150000000, 65000000, 65, 'active', 'public'
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Table des contrats VIP
CREATE TABLE IF NOT EXISTS public.investments (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
  user_name text NOT NULL,
  project_id text NOT NULL,
  project_title text NOT NULL,
  project_category text NOT NULL,
  amount bigint NOT NULL CHECK (amount >= 500),
  daily_income bigint NOT NULL CHECK (daily_income >= 50),
  return_rate integer NOT NULL DEFAULT 900,
  expected_profit bigint NOT NULL,
  duration_days integer NOT NULL DEFAULT 90,
  days_credited integer NOT NULL DEFAULT 0,
  total_earned_so_far bigint NOT NULL DEFAULT 0,
  purchased_at_ms bigint NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "investments_select_own_or_admin" ON public.investments;
CREATE POLICY "investments_select_own_or_admin"
  ON public.investments FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.uid = user_id AND p.auth_uid = auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "investments_admin_all" ON public.investments;
CREATE POLICY "investments_admin_all"
  ON public.investments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 5. Table des transactions
CREATE TABLE IF NOT EXISTS public.transactions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
  user_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'investment', 'payout', 'credit', 'referral', 'gift')),
  amount bigint NOT NULL CHECK (amount > 0),
  method text NOT NULL,
  phone_or_account text NOT NULL,
  reference text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select_own_or_admin" ON public.transactions;
CREATE POLICY "transactions_select_own_or_admin"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.uid = user_id AND p.auth_uid = auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "transactions_admin_all" ON public.transactions;
CREATE POLICY "transactions_admin_all"
  ON public.transactions FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 6. Table des parrainages (équipe 3 niveaux)
CREATE TABLE IF NOT EXISTS public.referrals (
  id text PRIMARY KEY,
  referrer_uid text NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
  referred_uid text NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
  referred_name text NOT NULL,
  level integer NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  commission_earned bigint NOT NULL DEFAULT 0 CHECK (commission_earned >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'rewarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referrer_uid, referred_uid)
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referrals_select_own_or_admin" ON public.referrals;
CREATE POLICY "referrals_select_own_or_admin"
  ON public.referrals FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.uid = referrer_uid AND p.auth_uid = auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "referrals_admin_all" ON public.referrals;
CREATE POLICY "referrals_admin_all"
  ON public.referrals FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 7. Table des paramètres globaux
CREATE TABLE IF NOT EXISTS public.settings (
  id text PRIMARY KEY,
  referral_rate integer NOT NULL DEFAULT 30 CHECK (referral_rate BETWEEN 0 AND 50),
  min_deposit bigint NOT NULL DEFAULT 4000 CHECK (min_deposit >= 500),
  min_withdrawal bigint NOT NULL DEFAULT 1000 CHECK (min_withdrawal >= 500),
  support_phone text NOT NULL DEFAULT '+226 70 00 88 99',
  support_email text NOT NULL DEFAULT 'support@aureliamobile.africa',
  admin_phone text NOT NULL DEFAULT '+226 77409899',
  announcement text NOT NULL DEFAULT 'Programme Gamme VIP AURELIA MOBILE : 5 téléphones haut de gamme dès 4 000 F CFA avec revenus quotidiens automatiques pendant 90 jours.',
  allow_multiple_same_vip boolean NOT NULL DEFAULT true,
  visibility text NOT NULL DEFAULT 'public',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_select_public_or_admin" ON public.settings;
CREATE POLICY "settings_select_public_or_admin"
  ON public.settings FOR SELECT
  TO anon, authenticated
  USING (visibility = 'public' OR public.is_admin());

DROP POLICY IF EXISTS "settings_admin_all" ON public.settings;
CREATE POLICY "settings_admin_all"
  ON public.settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

INSERT INTO public.settings (
  id, referral_rate, min_deposit, min_withdrawal,
  support_phone, support_email, admin_phone, announcement, allow_multiple_same_vip, visibility
) VALUES (
  'global', 30, 4000, 1000,
  '+226 70 00 88 99', 'support@aureliamobile.africa', '+226 77409899',
  'Programme Gamme VIP AURELIA MOBILE : 5 téléphones haut de gamme dès 4 000 F CFA avec revenus quotidiens automatiques pendant 90 jours.',
  true, 'public'
)
ON CONFLICT (id) DO NOTHING;

-- 8. RPC : Rattachement automatique à l'équipe de parrainage sur 3 niveaux lors de l'inscription
CREATE OR REPLACE FUNCTION public.register_referral_tree(p_invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_cursor text;
  v_sponsor public.profiles%ROWTYPE;
  v_lvl integer := 1;
  v_visited text[] := ARRAY[]::text[];
  v_clean_code text;
BEGIN
  v_clean_code := upper(trim(COALESCE(p_invite_code, '')));
  IF v_clean_code = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid();
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);
  v_visited := array_append(v_visited, v_me.uid);
  v_cursor := v_clean_code;

  WHILE v_lvl <= 3 AND COALESCE(v_cursor, '') <> '' LOOP
    SELECT * INTO v_sponsor
    FROM public.profiles
    WHERE upper(referral_code) = upper(v_cursor) OR uid = v_cursor
    LIMIT 1;

    EXIT WHEN NOT FOUND;
    EXIT WHEN v_sponsor.uid = ANY(v_visited);
    v_visited := array_append(v_visited, v_sponsor.uid);

    IF v_lvl = 1 THEN
      UPDATE public.profiles
      SET referred_by = v_sponsor.referral_code, updated_at = now()
      WHERE uid = v_me.uid AND referred_by = '';
    END IF;

    INSERT INTO public.referrals (
      id, referrer_uid, referred_uid, referred_name, level, commission_earned, status
    ) VALUES (
      'ref_' || left(v_sponsor.uid, 14) || '_' || left(v_me.uid, 14),
      v_sponsor.uid,
      v_me.uid,
      COALESCE(NULLIF(v_me.phone, ''), v_me.display_name),
      v_lvl,
      0,
      'active'
    )
    ON CONFLICT (referrer_uid, referred_uid) DO NOTHING;

    UPDATE public.profiles
    SET referral_count = (SELECT count(*) FROM public.referrals WHERE referrer_uid = v_sponsor.uid),
        updated_at = now()
    WHERE uid = v_sponsor.uid;

    v_cursor := v_sponsor.referred_by;
    v_lvl := v_lvl + 1;
  END LOOP;
END;
$$;

-- 9. RPC : Demande de dépôt
CREATE OR REPLACE FUNCTION public.create_deposit(
  p_amount bigint,
  p_method text,
  p_phone_or_account text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_min_deposit bigint;
  v_tx_id text;
  v_ref text;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable.';
  END IF;

  SELECT COALESCE(min_deposit, 4000) INTO v_min_deposit FROM public.settings WHERE id = 'global';
  IF p_amount < v_min_deposit THEN
    RAISE EXCEPTION 'Montant inférieur au dépôt minimum.';
  END IF;

  v_tx_id := 'tx_dep_' || floor(extract(epoch FROM now()) * 1000)::bigint::text || '_' || left(v_me.uid, 6);
  v_ref := 'DEP-' || right(floor(extract(epoch FROM now()) * 1000)::bigint::text, 6);

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id, v_me.uid, v_me.display_name, 'deposit', p_amount,
    left(trim(p_method), 60), left(trim(p_phone_or_account), 80), v_ref, 'pending'
  );

  RETURN v_tx_id;
END;
$$;

-- 10. RPC : Demande de retrait atomique
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_amount bigint,
  p_method text,
  p_account text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_min_wd bigint;
  v_tx_id text;
  v_ref text;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable.';
  END IF;

  SELECT COALESCE(min_withdrawal, 1000) INTO v_min_wd FROM public.settings WHERE id = 'global';
  IF p_amount < v_min_wd THEN
    RAISE EXCEPTION 'Le retrait minimum est de % F CFA.', v_min_wd;
  END IF;
  IF v_me.balance < p_amount THEN
    RAISE EXCEPTION 'Solde insuffisant pour ce retrait.';
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET balance = balance - p_amount, updated_at = now()
  WHERE uid = v_me.uid;

  v_tx_id := 'tx_wd_' || floor(extract(epoch FROM now()) * 1000)::bigint::text || '_' || left(v_me.uid, 6);
  v_ref := 'WDR-' || right(floor(extract(epoch FROM now()) * 1000)::bigint::text, 6);

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id, v_me.uid, v_me.display_name, 'withdrawal', p_amount,
    left(trim(p_method), 60), left(trim(p_account), 80), v_ref, 'pending'
  );

  RETURN v_tx_id;
END;
$$;

-- 11. RPC : Achat de produit VIP + commissions 3 niveaux (30%, 2%, 1%)
CREATE OR REPLACE FUNCTION public.purchase_vip_product(
  p_project_id text,
  p_quantity integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_proj public.projects%ROWTYPE;
  v_allow_multi boolean := true;
  v_existing_active integer := 0;
  v_qty integer;
  v_total_cost bigint;
  v_now_ms bigint;
  v_i integer;
  v_inv_id text;
  v_tx_id text;
  v_cursor text;
  v_sponsor public.profiles%ROWTYPE;
  v_rates numeric[] := ARRAY[0.30, 0.02, 0.01];
  v_lvl integer := 1;
  v_bonus bigint;
  v_visited text[] := ARRAY[]::text[];
BEGIN
  v_qty := GREATEST(1, LEAST(20, COALESCE(p_quantity, 1)));
  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil introuvable.';
  END IF;

  SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND OR v_proj.status <> 'active' THEN
    RAISE EXCEPTION 'Ce produit VIP est indisponible.';
  END IF;

  SELECT COALESCE(allow_multiple_same_vip, true) INTO v_allow_multi FROM public.settings WHERE id = 'global';
  IF NOT v_allow_multi THEN
    SELECT count(*) INTO v_existing_active
    FROM public.investments
    WHERE user_id = v_me.uid AND project_id = v_proj.id AND status = 'active';
    IF v_existing_active > 0 OR v_qty > 1 THEN
      RAISE EXCEPTION 'Vous possédez déjà un contrat actif pour ce modèle VIP.';
    END IF;
  END IF;

  v_total_cost := v_proj.min_investment * v_qty;
  IF v_me.balance < v_total_cost THEN
    RAISE EXCEPTION 'Solde insuffisant. Veuillez effectuer une recharge.';
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET balance = balance - v_total_cost,
      total_invested = total_invested + v_total_cost,
      updated_at = now()
  WHERE uid = v_me.uid;

  v_now_ms := floor(extract(epoch FROM now()) * 1000)::bigint;

  FOR v_i IN 0..(v_qty - 1) LOOP
    v_inv_id := 'vipinv_' || v_now_ms::text || '_' || v_i::text || '_' || left(v_me.uid, 6);
    INSERT INTO public.investments (
      id, user_id, user_name, project_id, project_title, project_category,
      amount, daily_income, return_rate, expected_profit, duration_days,
      days_credited, total_earned_so_far, purchased_at_ms, status
    ) VALUES (
      v_inv_id, v_me.uid, v_me.display_name, v_proj.id, v_proj.title, v_proj.category,
      v_proj.min_investment, v_proj.daily_income, v_proj.return_rate,
      v_proj.daily_income * v_proj.duration_days, v_proj.duration_days,
      0, 0, v_now_ms, 'active'
    );
  END LOOP;

  v_tx_id := 'tx_vip_' || v_now_ms::text || '_' || left(v_me.uid, 6);
  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id, v_me.uid, v_me.display_name, 'investment', v_total_cost,
    'Activation Produit VIP', COALESCE(NULLIF(v_me.phone, ''), v_me.email),
    left((CASE WHEN v_qty > 1 THEN v_qty::text || 'x ' ELSE '' END) || v_proj.title || ' · ' || (v_proj.daily_income * v_qty)::text || ' F/j', 100),
    'completed'
  );

  -- Distribution des commissions sur 3 niveaux (30%, 2%, 1%)
  v_cursor := v_me.referred_by;
  v_visited := array_append(v_visited, v_me.uid);

  WHILE v_lvl <= 3 AND COALESCE(v_cursor, '') <> '' LOOP
    SELECT * INTO v_sponsor
    FROM public.profiles
    WHERE upper(referral_code) = upper(v_cursor) OR uid = v_cursor
    LIMIT 1
    FOR UPDATE;

    EXIT WHEN NOT FOUND;
    EXIT WHEN v_sponsor.uid = ANY(v_visited);
    v_visited := array_append(v_visited, v_sponsor.uid);

    v_bonus := round(v_total_cost * v_rates[v_lvl])::bigint;
    IF v_bonus > 0 THEN
      UPDATE public.profiles
      SET balance = balance + v_bonus,
          referral_bonus = referral_bonus + v_bonus,
          updated_at = now()
      WHERE uid = v_sponsor.uid;

      INSERT INTO public.transactions (
        id, user_id, user_name, type, amount, method, phone_or_account, reference, status
      ) VALUES (
        'tx_ref_' || v_now_ms::text || '_l' || v_lvl::text || '_' || left(v_sponsor.uid, 6),
        v_sponsor.uid,
        v_sponsor.display_name,
        'referral',
        v_bonus,
        'Cashback Équipe Niveau ' || v_lvl::text,
        COALESCE(NULLIF(v_me.phone, ''), v_me.display_name),
        left('Commission ' || round(v_rates[v_lvl] * 100)::text || '% sur ' || v_proj.title, 100),
        'completed'
      );

      INSERT INTO public.referrals (
        id, referrer_uid, referred_uid, referred_name, level, commission_earned, status
      ) VALUES (
        'ref_' || left(v_sponsor.uid, 12) || '_' || left(v_me.uid, 12),
        v_sponsor.uid,
        v_me.uid,
        COALESCE(NULLIF(v_me.phone, ''), v_me.display_name),
        v_lvl,
        v_bonus,
        'rewarded'
      )
      ON CONFLICT (referrer_uid, referred_uid) DO UPDATE
      SET commission_earned = public.referrals.commission_earned + EXCLUDED.commission_earned,
          status = 'rewarded',
          updated_at = now();
    END IF;

    v_cursor := v_sponsor.referred_by;
    v_lvl := v_lvl + 1;
  END LOOP;
END;
$$;

-- 12. RPC : Synchronisation automatique des gains quotidiens 24h
CREATE OR REPLACE FUNCTION public.sync_daily_payouts()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_inv public.investments%ROWTYPE;
  v_now_ms bigint;
  v_elapsed integer;
  v_pending_days integer;
  v_pending_amt bigint;
  v_total_credited bigint := 0;
  v_new_status text;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_now_ms := floor(extract(epoch FROM now()) * 1000)::bigint;
  PERFORM set_config('app.allow_financial_write', '1', true);

  FOR v_inv IN
    SELECT * FROM public.investments
    WHERE user_id = v_me.uid AND status = 'active'
    FOR UPDATE
  LOOP
    v_elapsed := LEAST(
      v_inv.duration_days,
      GREATEST(0, floor((v_now_ms - v_inv.purchased_at_ms)::numeric / 86400000)::integer)
    );
    v_pending_days := GREATEST(0, v_elapsed - v_inv.days_credited);

    IF v_pending_days > 0 OR v_elapsed >= v_inv.duration_days THEN
      v_pending_amt := v_pending_days * v_inv.daily_income;
      v_total_credited := v_total_credited + v_pending_amt;
      v_new_status := CASE WHEN v_elapsed >= v_inv.duration_days THEN 'expired' ELSE 'active' END;

      UPDATE public.investments
      SET days_credited = v_elapsed,
          total_earned_so_far = v_elapsed * v_inv.daily_income,
          status = v_new_status,
          updated_at = now()
      WHERE id = v_inv.id;

      IF v_pending_amt > 0 THEN
        INSERT INTO public.transactions (
          id, user_id, user_name, type, amount, method, phone_or_account, reference, status
        ) VALUES (
          'tx_vipday_' || right(v_inv.id, 10) || '_d' || v_elapsed::text || '_' || right(v_now_ms::text, 4),
          v_me.uid, v_me.display_name, 'payout', v_pending_amt,
          'Revenu quotidien 24h', COALESCE(NULLIF(v_me.phone, ''), v_me.email),
          left(v_inv.project_title || ' · Jour ' || v_elapsed::text || '/' || v_inv.duration_days::text, 100),
          'completed'
        )
        ON CONFLICT (id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  IF v_total_credited > 0 THEN
    UPDATE public.profiles
    SET balance = balance + v_total_credited,
        total_earned = total_earned + v_total_credited,
        updated_at = now()
    WHERE uid = v_me.uid;
  END IF;

  RETURN v_total_credited;
END;
$$;

-- 13. RPC Admin : Traiter une transaction (approuver/rejeter)
CREATE OR REPLACE FUNCTION public.admin_process_transaction(
  p_tx_id text,
  p_next_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx public.transactions%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès administrateur requis.';
  END IF;
  IF p_next_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Statut invalide.';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND OR v_tx.status <> 'pending' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.transactions
  SET status = p_next_status, updated_at = now()
  WHERE id = p_tx_id;

  IF p_next_status = 'approved' AND v_tx.type = 'deposit' THEN
    UPDATE public.profiles
    SET balance = balance + v_tx.amount, updated_at = now()
    WHERE uid = v_tx.user_id;
  ELSIF p_next_status = 'rejected' AND v_tx.type = 'withdrawal' THEN
    UPDATE public.profiles
    SET balance = balance + v_tx.amount, updated_at = now()
    WHERE uid = v_tx.user_id;
  END IF;
END;
$$;

-- 14. RPC Admin : Ajuster le solde d'un utilisateur
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
  p_target_uid text,
  p_delta bigint,
  p_reason text DEFAULT 'Crédit ajouté par administration'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_now_ms bigint;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès administrateur requis.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE uid = p_target_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur introuvable.';
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET balance = GREATEST(0, balance + p_delta), updated_at = now()
  WHERE uid = p_target_uid;

  v_now_ms := floor(extract(epoch FROM now()) * 1000)::bigint;
  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    'tx_adm_' || v_now_ms::text || '_' || left(v_target.uid, 6),
    v_target.uid,
    v_target.display_name,
    'credit',
    GREATEST(1, abs(p_delta)),
    'Administration',
    COALESCE(NULLIF(v_target.referral_code, ''), v_target.email),
    left(COALESCE(NULLIF(trim(p_reason), ''), 'Crédit ajouté par administration'), 100),
    'completed'
  );
END;
$$;

-- 15. RPC Admin : Offrir un produit VIP à un utilisateur
CREATE OR REPLACE FUNCTION public.admin_gift_product(
  p_target_uid text,
  p_project_id text,
  p_quantity integer DEFAULT 1,
  p_reason text DEFAULT 'Produit offert par administration'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.profiles%ROWTYPE;
  v_proj public.projects%ROWTYPE;
  v_qty integer;
  v_total_value bigint;
  v_now_ms bigint;
  v_i integer;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Accès administrateur requis.';
  END IF;

  v_qty := GREATEST(1, LEAST(20, COALESCE(p_quantity, 1)));
  SELECT * INTO v_target FROM public.profiles WHERE uid = p_target_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Utilisateur introuvable.';
  END IF;

  SELECT * INTO v_proj FROM public.projects WHERE id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produit introuvable.';
  END IF;

  v_total_value := v_proj.min_investment * v_qty;
  v_now_ms := floor(extract(epoch FROM now()) * 1000)::bigint;
  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET total_invested = total_invested + v_total_value, updated_at = now()
  WHERE uid = v_target.uid;

  FOR v_i IN 0..(v_qty - 1) LOOP
    INSERT INTO public.investments (
      id, user_id, user_name, project_id, project_title, project_category,
      amount, daily_income, return_rate, expected_profit, duration_days,
      days_credited, total_earned_so_far, purchased_at_ms, status
    ) VALUES (
      'vipgift_' || v_now_ms::text || '_' || v_i::text || '_' || left(v_target.uid, 6),
      v_target.uid, v_target.display_name, v_proj.id, v_proj.title, v_proj.category,
      v_proj.min_investment, v_proj.daily_income, v_proj.return_rate,
      v_proj.daily_income * v_proj.duration_days, v_proj.duration_days,
      0, 0, v_now_ms, 'active'
    );
  END LOOP;

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    'tx_gift_' || v_now_ms::text || '_' || left(v_target.uid, 6),
    v_target.uid,
    v_target.display_name,
    'gift',
    GREATEST(1, v_total_value),
    'Cadeau Administrateur',
    COALESCE(NULLIF(v_target.referral_code, ''), NULLIF(v_target.phone, ''), v_target.email),
    left(COALESCE(NULLIF(trim(p_reason), ''), 'Produit offert') || ' · ' || (CASE WHEN v_qty > 1 THEN v_qty::text || 'x ' ELSE '' END) || v_proj.title, 100),
    'completed'
  );
END;
$$;

-- Droits d'exécution des fonctions RPC pour les utilisateurs authentifiés
GRANT EXECUTE ON FUNCTION public.register_referral_tree(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_deposit(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(bigint, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_vip_product(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_daily_payouts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_process_transaction(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gift_product(text, text, integer, text) TO authenticated;

-- 16. Pointage quotidien 30 F CFA / 24h & Codes cadeaux 10-100 F CFA aléatoires (sans double crédit)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_checkin_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkin_total bigint NOT NULL DEFAULT 0;

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

INSERT INTO public.gift_codes (code, min_amount, max_amount, max_uses, is_active)
VALUES
  ('AURELIA2026', 10, 100, 5000, true),
  ('AURELIAGIFT', 10, 100, 5000, true),
  ('VIPBONUS', 10, 100, 5000, true)
ON CONFLICT (code) DO NOTHING;

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
  v_tx_id text;
  v_inserted_id text;
  v_remaining interval;
  v_hours integer;
  v_mins integer;
BEGIN
  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable.';
  END IF;

  IF v_me.last_checkin_at IS NOT NULL AND v_me.last_checkin_at > (v_now - interval '24 hours') THEN
    v_remaining := (v_me.last_checkin_at + interval '24 hours') - v_now;
    v_hours := GREATEST(0, floor(extract(epoch FROM v_remaining) / 3600)::integer);
    v_mins := GREATEST(0, floor((extract(epoch FROM v_remaining)::bigint % 3600) / 60)::integer);
    RAISE EXCEPTION 'Bonus quotidien déjà réclamé. Revenez dans %h %m.', v_hours, v_mins;
  END IF;

  v_next_day := COALESCE(v_me.checkin_days, 0) + 1;
  v_tx_id := 'tx_checkin_' || v_me.uid || '_d' || v_next_day::text;

  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id, v_me.uid, v_me.display_name, 'credit', 30, 'Pointage quotidien 24h',
    COALESCE(NULLIF(v_me.phone, ''), v_me.email),
    'Bonus de connexion quotidien (Jour ' || v_next_day::text || ')',
    'completed'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_id;

  IF v_inserted_id IS NULL THEN
    RAISE EXCEPTION 'Pointage déjà enregistré pour ce cycle de 24 heures.';
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

  SELECT * INTO v_me FROM public.profiles WHERE auth_uid = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable.';
  END IF;

  SELECT * INTO v_gift FROM public.gift_codes WHERE code = v_code FOR UPDATE;
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
    SELECT 1 FROM public.gift_code_redemptions WHERE code = v_code AND user_id = v_me.uid
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

  UPDATE public.gift_codes SET uses_count = uses_count + 1 WHERE code = v_code;

  v_tx_id := 'tx_code_' || left(v_me.uid, 20) || '_' || left(md5(v_code), 12);
  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id, v_me.uid, v_me.display_name, 'credit', v_amount, 'Code cadeau',
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
  UPDATE public.profiles SET balance = balance + v_amount, updated_at = now() WHERE uid = v_me.uid;

  RETURN jsonb_build_object('code', v_code, 'amount', v_amount);
END;
$$;

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
