drop policy if exists "anonymous_select_rule_templates" on public.rule_templates;
drop policy if exists "anonymous_insert_rule_templates" on public.rule_templates;
drop policy if exists "anonymous_update_rule_templates" on public.rule_templates;
drop policy if exists "anonymous_delete_rule_templates" on public.rule_templates;

create policy "anonymous_select_rule_templates" on public.rule_templates
for select using (true);

create policy "anonymous_insert_rule_templates" on public.rule_templates
for insert with check (true);

create policy "anonymous_update_rule_templates" on public.rule_templates
for update using (true) with check (true);

create policy "anonymous_delete_rule_templates" on public.rule_templates
for delete using (true);
