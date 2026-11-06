-- Allow RLS policies to call is_admin() for public catalog requests.
-- The SECURITY DEFINER function only returns whether auth.uid() is an active admin.
begin;

grant execute on function public.is_admin() to anon, authenticated;

commit;
