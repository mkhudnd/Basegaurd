-- Baseguard SmartOps — guard presence is independent from an active shift.
-- On break does not end duty. Only authorized, active guards may change presence.
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS presence_status text NOT NULL DEFAULT 'on_duty';
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS presence_updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.shifts
  ADD CONSTRAINT smartops_presence_status_valid CHECK (presence_status IN ('on_duty', 'on_break'));

CREATE OR REPLACE FUNCTION public.set_duty_presence(p_shift_id uuid, p_presence_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
 v_actor uuid := (SELECT auth.uid());
 v_shift public.shifts%rowtype;
BEGIN
 IF v_actor IS NULL OR p_shift_id IS NULL OR p_presence_status IS NULL
    OR p_presence_status NOT IN ('on_duty','on_break') THEN
   RAISE EXCEPTION 'Invalid duty status request' USING errcode='22023';
 END IF;
 SELECT * INTO v_shift FROM public.shifts WHERE id=p_shift_id FOR UPDATE;
 IF NOT FOUND OR v_shift.guard_id<>v_actor OR v_shift.status<>'active'
    OR v_shift.started_at>now() OR (v_shift.ended_at IS NOT NULL AND v_shift.ended_at<=now())
    OR NOT private.has_site_access(v_shift.site_id, ARRAY['guard']::public.smartops_role[]) THEN
   RAISE EXCEPTION 'Not authorized to change this active shift' USING errcode='42501';
 END IF;
 IF v_shift.presence_status IS DISTINCT FROM p_presence_status THEN
   UPDATE public.shifts
     SET presence_status=p_presence_status, presence_updated_at=now()
     WHERE id=p_shift_id;
   INSERT INTO public.audit_events(actor_id,site_id,action,entity_ref)
     VALUES(v_actor,v_shift.site_id,
        CASE WHEN p_presence_status='on_break' THEN 'duty.break_started' ELSE 'duty.break_ended' END,
        p_shift_id);
 END IF;
 RETURN (SELECT jsonb_build_object('shift_id',id,'presence_status',presence_status,'presence_updated_at',presence_updated_at)
         FROM public.shifts WHERE id=p_shift_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_duty_presence(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_duty_presence(uuid,text) TO authenticated;
