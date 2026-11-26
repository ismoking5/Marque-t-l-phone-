-- Patch idempotent : Codes de parrainage aléatoires à 6 chiffres indépendants du numéro de téléphone (AM-XXXXXX)
-- À exécuter dans Supabase Dashboard > SQL Editor

CREATE OR REPLACE FUNCTION public.generate_opaque_referral_code(p_avoid_digits text DEFAULT '')
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_clean_avoid text := regexp_replace(COALESCE(p_avoid_digits, ''), '\D', '', 'g');
  v_num integer;
  v_candidate text;
  v_tries integer := 0;
BEGIN
  LOOP
    v_tries := v_tries + 1;
    v_num := 100000 + floor(random() * 900000)::integer;
    v_candidate := lpad(v_num::text, 6, '0');
    IF v_clean_avoid = '' OR position(v_candidate IN v_clean_avoid) = 0 OR v_tries >= 20 THEN
      RETURN 'AM-' || v_candidate;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_opaque_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me public.profiles%ROWTYPE;
  v_phone_digits text;
  v_legacy_code text;
  v_new_code text;
  v_attempts integer := 0;
BEGIN
  SELECT * INTO v_me
  FROM public.profiles
  WHERE auth_uid = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil utilisateur introuvable.';
  END IF;

  v_phone_digits := regexp_replace(COALESCE(NULLIF(v_me.phone, ''), v_me.uid), '\D', '', 'g');
  v_legacy_code := CASE
    WHEN v_phone_digits <> '' THEN 'AM-' || lpad(right(v_phone_digits, 6), 6, '0')
    ELSE ''
  END;

  IF upper(v_me.referral_code) <> upper(v_legacy_code)
     AND v_me.referral_code !~ '^AM-[A-Z]{6}$' THEN
    RETURN v_me.referral_code;
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_new_code := public.generate_opaque_referral_code(v_phone_digits);
    EXIT WHEN upper(v_new_code) <> upper(v_legacy_code)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE upper(referral_code) = upper(v_new_code)
      );
    IF v_attempts >= 30 THEN
      RAISE EXCEPTION 'Impossible de générer un code de parrainage unique.';
    END IF;
  END LOOP;

  PERFORM set_config('app.allow_financial_write', '1', true);

  UPDATE public.profiles
  SET referral_code = v_new_code,
      updated_at = now()
  WHERE uid = v_me.uid;

  UPDATE public.profiles
  SET referred_by = v_new_code,
      updated_at = now()
  WHERE upper(referred_by) = upper(v_me.referral_code);

  RETURN v_new_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_opaque_referral_code() TO authenticated;

-- Migration immédiate des codes dérivés du téléphone (ex: AM-409899 -> AM-839204 aléatoire)
DO $$
DECLARE
  r record;
  v_phone_digits text;
  v_legacy_code text;
  v_new_code text;
  v_attempts integer;
BEGIN
  PERFORM set_config('app.allow_financial_write', '1', true);
  FOR r IN
    SELECT uid, phone, referral_code
    FROM public.profiles
  LOOP
    v_phone_digits := regexp_replace(COALESCE(NULLIF(r.phone, ''), r.uid), '\D', '', 'g');
    v_legacy_code := CASE
      WHEN v_phone_digits <> '' THEN 'AM-' || lpad(right(v_phone_digits, 6), 6, '0')
      ELSE ''
    END;

    IF (v_legacy_code <> '' AND upper(r.referral_code) = upper(v_legacy_code))
       OR r.referral_code ~ '^AM-[A-Z]{6}$' THEN
      v_attempts := 0;
      LOOP
        v_attempts := v_attempts + 1;
        v_new_code := public.generate_opaque_referral_code(v_phone_digits);
        EXIT WHEN upper(v_new_code) <> upper(v_legacy_code)
          AND NOT EXISTS (
            SELECT 1 FROM public.profiles WHERE upper(referral_code) = upper(v_new_code)
          );
        EXIT WHEN v_attempts >= 30;
      END LOOP;

      UPDATE public.profiles
      SET referral_code = v_new_code,
          updated_at = now()
      WHERE uid = r.uid;

      UPDATE public.profiles
      SET referred_by = v_new_code,
          updated_at = now()
      WHERE upper(referred_by) = upper(r.referral_code);
    END IF;
  END LOOP;
END;
$$;
