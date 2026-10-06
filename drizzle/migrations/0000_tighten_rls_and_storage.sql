DROP POLICY IF EXISTS "Public delete nba rules" ON public.nba_rules;
DROP POLICY IF EXISTS "Public insert nba rules" ON public.nba_rules;
DROP POLICY IF EXISTS "Public read nba rules" ON public.nba_rules;
DROP POLICY IF EXISTS "Public update nba rules" ON public.nba_rules;
CREATE POLICY "Approved users read nba rules" ON public.nba_rules FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Admins write nba rules" ON public.nba_rules FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Public delete datasets registry" ON public.customer_datasets;
DROP POLICY IF EXISTS "Public insert datasets registry" ON public.customer_datasets;
DROP POLICY IF EXISTS "Public read datasets registry" ON public.customer_datasets;
DROP POLICY IF EXISTS "Public update datasets registry" ON public.customer_datasets;
CREATE POLICY "Approved users read datasets registry" ON public.customer_datasets FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));
CREATE POLICY "Admins write datasets registry" ON public.customer_datasets FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Anyone authenticated reads settings" ON public.app_settings;
CREATE POLICY "Approved users read settings" ON public.app_settings FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()) OR public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Public read datasets" ON storage.objects;
DROP POLICY IF EXISTS "Public upload datasets" ON storage.objects;
DROP POLICY IF EXISTS "Public update datasets" ON storage.objects;
DROP POLICY IF EXISTS "Public delete datasets" ON storage.objects;
DROP POLICY IF EXISTS "Branding publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public read branding" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public read model artefacts" ON storage.objects;

CREATE POLICY "Approved users read datasets files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'datasets' AND public.is_active_user(auth.uid()));
CREATE POLICY "Admins upload datasets files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'datasets' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins update datasets files" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'datasets' AND public.has_role(auth.uid(),'admin')) WITH CHECK (bucket_id = 'datasets' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete datasets files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'datasets' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins list branding files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'branding' AND public.has_role(auth.uid(),'admin'));
CREATE POLICY "Users list own avatar files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Admins list model artefacts" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'model-artefacts' AND public.has_role(auth.uid(),'admin'));