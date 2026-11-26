-- Patch idempotent : Centre des missions (Parrainez 3 / 10 / 30 / 50 investisseurs niveau 1, sans double crédit)
-- À exécuter dans Supabase Dashboard > SQL Editor

CREATE TABLE IF NOT EXISTS public.mission_claims (
  id text PRIMARY KEY,
  mission_id text NOT NULL,
  user_id text NOT NULL REFERENCES public.profiles(uid) ON DELETE CASCADE,
  reward bigint NOT NULL CHECK (reward > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, user_id)
);

ALTER TABLE public.mission_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mission_claims_select_own_or_admin" ON public.mission_claims;
CREATE POLICY "mission_claims_select_own_or_admin"
  ON public.mission_claims FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.uid = user_id AND p.auth_uid = auth.uid())
    OR public.is_admin()
  );

CREATE OR REPLACE FUNCTION public.get_my_mission_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me_uid text;
  v_investors integer := 0;
  v_claimed text[] := ARRAY[]::text[];
BEGIN
  SELECT uid INTO v_me_uid
  FROM public.profiles
  WHERE auth_uid = auth.uid();

  IF v_me_uid IS NULL THEN
    RETURN jsonb_build_object('level1_investors', 0, 'claimed_missions', ARRAY[]::text[]);
  END IF;

  SELECT count(DISTINCT r.referred_uid)::integer
  INTO v_investors
  FROM public.referrals r
  LEFT JOIN public.profiles p ON p.uid = r.referred_uid
  WHERE r.referrer_uid = v_me_uid
    AND COALESCE(r.level, 1) = 1
    AND (
      COALESCE(p.total_invested, 0) > 0
      OR r.status = 'rewarded'
      OR COALESCE(r.commission_earned, 0) > 0
    );

  SELECT COALESCE(array_agg(mc.mission_id), ARRAY[]::text[])
  INTO v_claimed
  FROM public.mission_claims mc
  WHERE mc.user_id = v_me_uid;

  RETURN jsonb_build_object(
    'level1_investors', COALESCE(v_investors, 0),
    'claimed_missions', COALESCE(v_claimed, ARRAY[]::text[])
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_referral_mission(p_mission_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_mission text := trim(COALESCE(p_mission_id, ''));
  v_target integer;
  v_reward bigint;
  v_title text;
  v_investors integer := 0;
  v_claim_id text;
  v_inserted_claim text;
  v_tx_id text;
  v_inserted_tx text;
BEGIN
  IF v_mission = 'mission_ref_3' THEN
    v_target := 3; v_reward := 700; v_title := 'Parrainez 3 amis';
  ELSIF v_mission = 'mission_ref_10' THEN
    v_target := 10; v_reward := 2500; v_title := 'Parrainez 10 amis';
  ELSIF v_mission = 'mission_ref_30' THEN
    v_target := 30; v_reward := 7000; v_title := 'Parrainez 30 amis';
  ELSIF v_mission = 'mission_ref_50' THEN
    v_target := 50; v_reward := 15000; v_title := 'Parrainez 50 amis';
  ELSE
    RAISE EXCEPTION 'Mission inconnue.';
  END IF;

  SELECT * INTO v_me
  FROM public.profiles
  WHERE auth_uid = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable.';
  END IF;

  SELECT count(DISTINCT r.referred_uid)::integer
  INTO v_investors
  FROM public.referrals r
  LEFT JOIN public.profiles p ON p.uid = r.referred_uid
  WHERE r.referrer_uid = v_me.uid
    AND COALESCE(r.level, 1) = 1
    AND (
      COALESCE(p.total_invested, 0) > 0
      OR r.status = 'rewarded'
      OR COALESCE(r.commission_earned, 0) > 0
    );

  IF COALESCE(v_investors, 0) < v_target THEN
    RAISE EXCEPTION 'Mission non complétée (% / % investisseurs de niveau 1).', COALESCE(v_investors, 0), v_target;
  END IF;

  v_claim_id := 'mc_' || v_mission || '_' || v_me.uid;
  INSERT INTO public.mission_claims (id, mission_id, user_id, reward)
  VALUES (v_claim_id, v_mission, v_me.uid, v_reward)
  ON CONFLICT (mission_id, user_id) DO NOTHING
  RETURNING id INTO v_inserted_claim;

  IF v_inserted_claim IS NULL THEN
    RAISE EXCEPTION 'Vous avez déjà réclamé la récompense de cette mission. Aucun double crédit autorisé.';
  END IF;

  v_tx_id := 'tx_mission_' || left(v_me.uid, 20) || '_' || v_mission;
  INSERT INTO public.transactions (
    id, user_id, user_name, type, amount, method, phone_or_account, reference, status
  ) VALUES (
    v_tx_id,
    v_me.uid,
    v_me.display_name,
    'referral',
    v_reward,
    'Centre des missions',
    COALESCE(NULLIF(v_me.phone, ''), v_me.email),
    left(v_title || ' (' || v_target::text || ' investisseurs niv.1)', 100),
    'completed'
  )
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO v_inserted_tx;

  IF v_inserted_tx IS NULL THEN
    RAISE EXCEPTION 'Récompense de mission déjà créditée.';
  END IF;

  PERFORM set_config('app.allow_financial_write', '1', true);
  UPDATE public.profiles
  SET balance = balance + v_reward,
      updated_at = now()
  WHERE uid = v_me.uid;

  RETURN jsonb_build_object(
    'mission_id', v_mission,
    'reward', v_reward
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_mission_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_referral_mission(text) TO authenticated;
