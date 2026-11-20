-- XML e usuários fictícios. Cada asserção roda na mesma transação e é desfeita no fim.
begin;
create extension if not exists pgtap with schema extensions;
select plan(166);
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
('98100000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-a@example.com', now(), now()),
('98100000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-b@example.com', now(), now()),
('98100000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-c@example.com', now(), now()),
('98100000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inbox-d@example.com', now(), now());
insert into public.app_profiles (user_id, display_name, role, store, active, allowed_routes) values
('98100000-0000-4000-8000-00000000000a', '[TESTE] Financeiro caixa', 'financeiro', 'jc', true, '[]'),
('98100000-0000-4000-8000-00000000000b', '[TESTE] Catálogo caixa', 'financeiro', 'jc', true, '[]'),
('98100000-0000-4000-8000-00000000000c', '[TESTE] Vendas caixa', 'vendas', 'ja', true, '[]'),
('98100000-0000-4000-8000-00000000000d', '[TESTE] Admin caixa', 'admin', 'ja', true, '[]');
insert into public.app_user_permissions (user_id, permission_key, scope) values
('98100000-0000-4000-8000-00000000000a', 'contas_pagar.importar_xml', 'jc'),
('98100000-0000-4000-8000-00000000000a', 'contas_pagar.acessar', 'jc'),
('98100000-0000-4000-8000-00000000000b', 'contas_pagar.acessar', 'jc');
create temp table inbox_fixture (n integer primary key, chave text, xml_text text);
insert into inbox_fixture values
(1, '43261195000000000199550010000000011981000010', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000011981000010"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>1</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>0</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000011981000010</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(2, '43261195000000000199550010000000021981000018', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000021981000018"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>2</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>8</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000021981000018</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(3, '43261195000000000199550010000000031981000015', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000031981000015"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>3</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>5</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000031981000015</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(4, '43261195000000000199550010000000041981000012', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000041981000012"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>4</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>2</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000041981000012</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(5, '43261195000000000199550010000000051981000010', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000051981000010"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>5</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>0</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000051981000010</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(6, '43261195000000000199550010000000061981000017', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000061981000017"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>6</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>7</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000061981000017</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(7, '43261195000000000199550010000000071981000014', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000071981000014"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>7</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>4</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000071981000014</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(8, '43261195000000000199550010000000081981000011', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000081981000011"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>8</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>1</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000081981000011</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(9, '43261195000000000199550010000000091981000019', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>');
insert into inbox_fixture values
(10, '43261195000000000199550010000000101981000010', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000101981000010"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>10</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>0</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000101981000010</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(11, '43261195000000000199550010000000111981000017', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000111981000017"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>11</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>7</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000111981000017</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(12, '43261195000000000199550010000000121981000014', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000121981000014"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>12</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>4</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi><procEmi>1</procEmi></ide><emit><CNPJ>95000000000270</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><avulsa><CNPJ>95000000000199</CNPJ></avulsa><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000121981000014</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(13, '43261195000000000199550010000000131981000011', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000131981000011"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>13</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>1</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi><procEmi>2</procEmi></ide><emit><CPF>95000000001</CPF><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><avulsa><CNPJ>95000000000199</CNPJ></avulsa><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000131981000011</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>'),
(14, '43261195000000000199550010000000141981000019', '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000141981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>14</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000141981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>');
grant select on inbox_fixture to authenticated;


select has_table('public', 'payable_nfe_inbox', 'a caixa existe');

select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.payable_nfe_inbox'::regclass), 'caixa com RLS habilitada e forçada');

select ok((select relrowsecurity from pg_class where oid = 'private.nfe_group_companies'::regclass), 'empresas com RLS');

select is((select count(*)::int from private.nfe_group_companies), 4, 'exatamente quatro empresas do grupo');

select ok((not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('anon', 'private.nfe_group_companies', p))), 'anon não acessa as empresas diretamente');

select ok((not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('authenticated', 'private.nfe_group_companies', p))), 'authenticated não acessa as empresas diretamente');

select ok((not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('service_role', 'private.nfe_group_companies', p))), 'service_role não acessa as empresas diretamente');

select ok((has_table_privilege('authenticated','public.payable_nfe_inbox','SELECT')), 'authenticated tem leitura');

select ok((not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('anon', 'public.payable_nfe_inbox', p))), 'anon sem privilégios de escrita ou leitura indevida');

select ok((not exists (select 1 from unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('authenticated', 'public.payable_nfe_inbox', p))), 'authenticated sem privilégios de escrita ou leitura indevida');

select ok((not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege('service_role', 'public.payable_nfe_inbox', p))), 'service_role sem privilégios de escrita ou leitura indevida');

select ok((select qual like '%contas_pagar.importar_xml%' and qual like '%jc%' from pg_policies where schemaname='public' and tablename='payable_nfe_inbox' and policyname='payable_nfe_inbox_select_importer'), 'policy usa a permissão existente na JC');

select ok((not exists (select 1 from pg_policies where schemaname='public' and tablename='payable_nfe_inbox' and cmd <> 'SELECT')), 'nenhuma policy de escrita');

select ok((exists (select 1 from pg_index where indrelid='public.payable_nfe_inbox'::regclass and indisunique and pg_get_indexdef(indexrelid) like '%(nfe_key)%')), 'chave com índice único');

select ok((select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='private.payable_nfe_inbox_guarda()'::regprocedure), 'private.payable_nfe_inbox_guarda(): dono e execução protegidos');

select ok((not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='private.payable_nfe_inbox_guarda()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')), 'private.payable_nfe_inbox_guarda(): PUBLIC não executa');

select ok((not has_function_privilege('anon','private.payable_nfe_inbox_guarda()','EXECUTE')), 'private.payable_nfe_inbox_guarda(): privilégio de anon');

select ok((not has_function_privilege('authenticated','private.payable_nfe_inbox_guarda()','EXECUTE')), 'private.payable_nfe_inbox_guarda(): privilégio de authenticated');

select ok((not has_function_privilege('service_role','private.payable_nfe_inbox_guarda()','EXECUTE')), 'private.payable_nfe_inbox_guarda(): privilégio de service_role');

select ok((select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='private.nfe_inbox_ler_xml(text)'::regprocedure), 'private.nfe_inbox_ler_xml(text): dono e execução protegidos');

select ok((not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='private.nfe_inbox_ler_xml(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')), 'private.nfe_inbox_ler_xml(text): PUBLIC não executa');

select ok((not has_function_privilege('anon','private.nfe_inbox_ler_xml(text)','EXECUTE')), 'private.nfe_inbox_ler_xml(text): privilégio de anon');

select ok((not has_function_privilege('authenticated','private.nfe_inbox_ler_xml(text)','EXECUTE')), 'private.nfe_inbox_ler_xml(text): privilégio de authenticated');

select ok((not has_function_privilege('service_role','private.nfe_inbox_ler_xml(text)','EXECUTE')), 'private.nfe_inbox_ler_xml(text): privilégio de service_role');

select ok((select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='public.receive_nfe_inbox_xml(text,text)'::regprocedure), 'public.receive_nfe_inbox_xml(text,text): dono e execução protegidos');

select ok((not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.receive_nfe_inbox_xml(text,text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')), 'public.receive_nfe_inbox_xml(text,text): PUBLIC não executa');

select ok((not has_function_privilege('anon','public.receive_nfe_inbox_xml(text,text)','EXECUTE')), 'public.receive_nfe_inbox_xml(text,text): privilégio de anon');

select ok((has_function_privilege('authenticated','public.receive_nfe_inbox_xml(text,text)','EXECUTE')), 'public.receive_nfe_inbox_xml(text,text): privilégio de authenticated');

select ok((not has_function_privilege('service_role','public.receive_nfe_inbox_xml(text,text)','EXECUTE')), 'public.receive_nfe_inbox_xml(text,text): privilégio de service_role');

select ok((select prosecdef and proconfig @> array['search_path=""'] and pg_get_userbyid(proowner)='postgres' from pg_proc where oid='public.list_nfe_inbox(integer)'::regprocedure), 'public.list_nfe_inbox(integer): dono e execução protegidos');

select ok((not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a where p.oid='public.list_nfe_inbox(integer)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')), 'public.list_nfe_inbox(integer): PUBLIC não executa');

select ok((not has_function_privilege('anon','public.list_nfe_inbox(integer)','EXECUTE')), 'public.list_nfe_inbox(integer): privilégio de anon');

select ok((has_function_privilege('authenticated','public.list_nfe_inbox(integer)','EXECUTE')), 'public.list_nfe_inbox(integer): privilégio de authenticated');

select ok((not has_function_privilege('service_role','public.list_nfe_inbox(integer)','EXECUTE')), 'public.list_nfe_inbox(integer): privilégio de service_role');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"98100000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

select is((select public.receive_nfe_inbox_xml(xml_text,'nota.xml')->>'resultado' from inbox_fixture where n=1), 'entrou', 'nota válida entra');

select is((select xml_content from public.payable_nfe_inbox where nfe_key='43261195000000000199550010000000011981000010'), '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000011981000010"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>1</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>0</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000011981000010</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>', 'XML original idêntico ao enviado');

select is((select emitter_name from public.payable_nfe_inbox where nfe_key='43261195000000000199550010000000011981000010'), '[TESTE] Emitente & Filhos', 'entidades nos nomes são decodificadas');

select is((select public.receive_nfe_inbox_xml(xml_text,'copia.xml')->>'resultado' from inbox_fixture where n=1), 'ja_existia', 'repetição não duplica');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '<cStat>100</cStat>', '<cStat>150</cStat>'))->>'resultado'
  from inbox_fixture where n=1), 'ja_existia', 'autorização código 150 continua aceita');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '<cStat>100</cStat>', ''))->>'motivo'
  from inbox_fixture where n=9), 'nao_autorizada', 'protocolo sem código de autorização não entra');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'uma única linha');

select ok((select xml_attached_by = auth.uid() and xml_attached_at is not null
  from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=1)), 'entrada registra quem anexou e quando');

select is((select inbox_status from public.list_nfe_inbox()), 'esperando_conferencia', 'estado inicial derivado');

select ok((select not (to_jsonb(x) ? 'xml_content') and not (to_jsonb(x) ? 'inbox_xml_content') from public.list_nfe_inbox() x), 'listagem não devolve XML');

select is((select count(*)::int from public.payable_purchases where nfe_key in (select chave from inbox_fixture)), 0, 'receber não lança compra');

select is((select count(*)::int from public.payable_import_drafts where nfe_key in (select chave from inbox_fixture)), 0, 'receber não cria rascunho');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>95000000000270</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'destinatario_fora', 'recusa 1: destinatario_fora');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 1 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'sem_destinatario', 'recusa 2: sem_destinatario');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 2 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>65</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'modelo', 'recusa 3: modelo');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 3 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>2</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'homologacao', 'recusa 4: homologacao');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 4 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000010"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000010</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'chave_incoerente', 'recusa 5: chave_incoerente');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 5 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>10</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'chave_incoerente', 'recusa 6: chave_incoerente');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 6 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>110</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'nao_autorizada', 'recusa 7: nao_autorizada');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 7 não grava linha');

select is((public.receive_nfe_inbox_xml('<procEventoNFe><evento><infEvento><tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>','recusada.xml')->>'motivo'), 'evento', 'recusa 8: evento');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 8 não grava linha');

select is((public.receive_nfe_inbox_xml('<NFe>','recusada.xml')->>'motivo'), 'ilegivel', 'recusa 9: ilegivel');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 9 não grava linha');

select is((public.receive_nfe_inbox_xml('<!DOCTYPE NFe [<!ENTITY x "expansão">]><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'ilegivel', 'recusa 10: ilegivel');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 10 não grava linha');

select is((public.receive_nfe_inbox_xml('','recusada.xml')->>'motivo'), 'arquivo_vazio', 'recusa 11: arquivo_vazio');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 11 não grava linha');

select is((public.receive_nfe_inbox_xml(repeat('x',2000001),'recusada.xml')->>'motivo'), 'grande_demais', 'recusa 12: grande_demais');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 12 não grava linha');

select is((public.receive_nfe_inbox_xml('<outro/>','recusada.xml')->>'motivo'), 'nao_e_nfe', 'recusa 13: nao_e_nfe');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 13 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>NaN</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'ilegivel', 'recusa 14: ilegivel');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 14 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>sem data</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'ilegivel', 'recusa 15: ilegivel');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 15 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000091981000019</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'ilegivel', 'recusa 16: ilegivel');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 16 não grava linha');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000091981000019"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>9</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>9</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000081981000011</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','recusada.xml')->>'motivo'), 'chave_incoerente', 'recusa 17: chave_incoerente');

select is((select count(*)::int from public.payable_nfe_inbox), 1, 'recusa 17 não grava linha');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<det[^>]*>.*</det>', ''))->>'motivo'
  from inbox_fixture where n=9), 'ilegivel', 'nota sem itens não entra como XML completo');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<det[^>]*>.*</det>', ''))->>'mensagem'
  from inbox_fixture where n=9), 'A nota não traz os itens completos e não pode ser conferida.', 'nota sem itens explica que não pode ser conferida');

select is((select count(*)::int from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=9)), 0, 'nota sem itens não grava');

select is((select public.receive_nfe_inbox_xml(replace(regexp_replace(xml_text, '<det[^>]*>.*</det>', ''),
  '</nfeProc>', '<det><prod/></det></nfeProc>'))->>'motivo'
  from inbox_fixture where n=9), 'ilegivel', 'item fora de infNFe não completa a nota');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '</infNFe>', '<det nItem="2"/></infNFe>'))->>'motivo'
  from inbox_fixture where n=9), 'ilegivel', 'um item sem produto recusa a nota mesmo com outro item completo');

select is((select count(*)::int from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=9)), 0, 'itens incompletos não gravam');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '</infNFe>',
  E'<pag><detPag><tPag>90</tPag></detPag><detPag><tPag> \n90\t </tPag></detPag></pag></infNFe>'))->>'motivo'
  from inbox_fixture where n=9), 'sem_pagamento', 'todos os meios 90 recusam bonificação, inclusive com espaços');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '</infNFe>',
  '<pag><detPag><tPag>90</tPag></detPag></pag></infNFe>'))->>'mensagem'
  from inbox_fixture where n=9), 'Esta NF-e declara sem pagamento (bonificação, brinde ou remessa). Ela não gera conta a pagar.', 'sem pagamento explica por que não gera conta');

select is((select count(*)::int from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=9)), 0, 'sem pagamento não grava');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '</infNFe>',
  '<pag><detPag><tPag>90</tPag></detPag><detPag><tPag>15</tPag></detPag></pag></infNFe>'))->>'resultado'
  from inbox_fixture where n=1), 'ja_existia', 'meios mistos 90 e 15 continuam aceitos');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '</infNFe>',
  '<pag><detPag><tPag>90</tPag></detPag><detPag/></pag></infNFe>'))->>'resultado'
  from inbox_fixture where n=1), 'ja_existia', 'meio ausente junto de 90 não declara todos sem pagamento');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<chNFe>[^<]*</chNFe>', ''))->>'motivo'
  from inbox_fixture where n=9), 'chave_incoerente', 'protocolo sem chave é recusado');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<chNFe>[^<]*</chNFe>', '<chNFe/>'))->>'motivo'
  from inbox_fixture where n=9), 'chave_incoerente', 'protocolo com chave vazia é recusado');

select is((select count(*)::int from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=9)), 0, 'protocolo sem chave não grava');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<ide>.*</ide>', ''))->>'resultado'
  from inbox_fixture where n=9), 'recusada', 'ausência de ide continua recusada');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<emit>.*</emit>', ''))->>'resultado'
  from inbox_fixture where n=9), 'recusada', 'ausência de emit continua recusada');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<total>.*</total>', ''))->>'resultado'
  from inbox_fixture where n=9), 'recusada', 'ausência de total ICMSTot continua recusada');

select public.save_xml_import_draft('43261195000000000199550010000000011981000010',null,'[TESTE] Emitente','1','1','2026-11-20',10,'<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000011981000010"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>1</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>0</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000011981000010</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>','[]','[]');

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000011981000010'), 'conferencia_comecada', 'rascunho oficial aparece na caixa');

select ok((select inbox_draft_id = (select id from public.payable_import_drafts where nfe_key='43261195000000000199550010000000011981000010' and status='pendente') from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000011981000010'), 'rascunho certo devolvido');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'resultado' from inbox_fixture where n=2), 'entrou', 'outra nota entra');

reset role;
insert into public.payable_purchases (request_id, store, purchase_date, origin, document_type, payment_method, status, total_value, created_by, created_at, nfe_key, nfe_number, nfe_issued_at) values
(gen_random_uuid(),'jc','2026-11-20','xml','nfe','boleto','aberta',10,'98100000-0000-4000-8000-00000000000a',clock_timestamp()+interval '1 second','43261195000000000199550010000000021981000018','2','2026-11-20'),
(gen_random_uuid(),'jc','2026-11-20','xml','nfe','boleto','aberta',10,'98100000-0000-4000-8000-00000000000a',clock_timestamp()-interval '1 day','43261195000000000199550010000000031981000015','3','2026-11-20');
set local role authenticated;

select is((select public.receive_nfe_inbox_xml(xml_text)->>'resultado' from inbox_fixture where n=3), 'entrou', 'nota anteriormente lançada também entra na caixa');

select ok((select (public.receive_nfe_inbox_xml(xml_text)->>'ja_no_erp')::boolean from inbox_fixture where n=3), 'retorno informa compra preexistente');

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000021981000018'), 'lancada', 'compra posterior vira lançada');

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000031981000015'), 'ja_no_erp', 'compra anterior já estava no ERP');

select ok((select inbox_purchase_id is not null and inbox_purchase_status='aberta' from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000021981000018'), 'compra e estado aparecem na lista');

reset role;
insert into public.payable_nfe_inbox (nfe_key,recipient_cnpj,emitter_cnpj,nfe_number,nfe_series,emitter_name,issued_at,total_value,source,document_state,original_file_name)
values ('43261195000000000199550010000000041981000012','55800425000177','95000000000199','4','1','[TESTE] Resumo','2026-11-20T09:00:00-03:00',10,'sefaz','somente_resumo',null),
('43261195000000000199550010000000051981000010','55800425000177','95000000000199','5','1',null,null,null,'sefaz','ilegivel','resumo-original.xml');
set local role authenticated;

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000041981000012'), 'aguardando_xml', 'resumo espera XML');

select ok((select xml_attached_by is null and xml_attached_at is null from public.payable_nfe_inbox
  where nfe_key = (select chave from inbox_fixture where n=4)), 'resumo sem XML ainda não tem autoria de anexo');

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000051981000010'), 'ilegivel', 'ilegível aparece com estado próprio');

select is((select public.receive_nfe_inbox_xml(xml_text,'completo.xml')->>'resultado' from inbox_fixture where n=4), 'completou', 'XML completa o resumo');

select is((select public.receive_nfe_inbox_xml(xml_text,'outra-copia.xml')->>'resultado' from inbox_fixture where n=4), 'ja_existia', 'resumo completado não troca XML');

select is((select source from public.payable_nfe_inbox where nfe_key='43261195000000000199550010000000041981000012'), 'sefaz', 'origem do resumo preservada');

select ok((select emitter_name = '[TESTE] Resumo' and issued_at = '2026-11-20T09:00:00-03:00'::timestamptz
  and total_value = 10 and received_by is null and xml_attached_by = auth.uid() and xml_attached_at is not null
  and original_file_name = 'completo.xml' from public.payable_nfe_inbox
  where nfe_key = (select chave from inbox_fixture where n=4)), 'completar preserva preenchidos, preenche nome de arquivo nulo e registra o autor do anexo');

select is((select xml_content from public.payable_nfe_inbox where nfe_key='43261195000000000199550010000000041981000012'), '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261195000000000199550010000000041981000012"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>4</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>2</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CNPJ>95000000000199</CNPJ><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261195000000000199550010000000041981000012</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>', 'XML anexado idêntico');

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key='43261195000000000199550010000000041981000012'), 'esperando_conferencia', 'XML anexado permite conferência');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'resultado' from inbox_fixture where n=5), 'completou', 'ilegível sem XML também pode ser completado');

select ok((select emitter_name = '[TESTE] Emitente & Filhos' and issued_at = '2026-11-20T10:00:00-03:00'::timestamptz
  and total_value = 10 and xml_attached_by = auth.uid() and xml_attached_at is not null
  and original_file_name = 'resumo-original.xml' from public.payable_nfe_inbox
  where nfe_key = (select chave from inbox_fixture where n=5)),
  'completar ilegível preenche nulos e autoria, preservando nome de arquivo preenchido');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '2026-11-20T10:00:00-03:00', '2026-12-01T00:00:00-03:00'))->>'resultado'
  from inbox_fixture where n=6), 'entrou', 'mês diferente da chave continua aceito com protocolo');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<protNFe>.*</protNFe>', ''))->>'motivo'
  from inbox_fixture where n=9), 'sem_protocolo', 'nota sem autorização da SEFAZ é recusada');

select is((select public.receive_nfe_inbox_xml(regexp_replace(xml_text, '<protNFe>.*</protNFe>', ''))->>'mensagem'
  from inbox_fixture where n=9), 'O XML não traz a autorização da SEFAZ. Peça ao fornecedor o XML autorizado, com o protocolo.', 'recusa orienta pedir XML autorizado');

select is((select count(*)::int from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=9)), 0, 'sem protocolo não grava');

select is((public.receive_nfe_inbox_xml('<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe43261100095000000001550010000000071981000017"><ide><cUF>43</cUF><mod>55</mod><serie>1</serie><nNF>7</nNF><tpEmis>1</tpEmis><cNF>98100001</cNF><cDV>7</cDV><tpAmb>1</tpAmb><dhEmi>2026-11-20T10:00:00-03:00</dhEmi></ide><emit><CPF>95000000001</CPF><xNome>[TESTE] Emitente &amp; Filhos</xNome></emit><dest><CNPJ>55800425000177</CNPJ><xNome>[TESTE] Destinatário</xNome></dest><det nItem="1"><prod><cProd>TESTE</cProd><xProd>[TESTE] Item</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>10.00</vUnCom><vProd>10.00</vProd></prod></det><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>43261100095000000001550010000000071981000017</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>')->>'resultado'), 'entrou', 'emitente CPF usa 000 mais CPF na chave');

select is((public.receive_nfe_inbox_xml('<n:nfeProc xmlns:n="http://www.portalfiscal.inf.br/nfe"><n:NFe><n:infNFe Id="NFe43261195000000000199550010000000081981000011"><n:ide><n:cUF>43</n:cUF><n:mod>55</n:mod><n:serie>001</n:serie><n:nNF>8</n:nNF><n:tpEmis>1</n:tpEmis><n:cNF>98100001</n:cNF><n:cDV>1</n:cDV><n:tpAmb>1</n:tpAmb><n:dEmi>2026-11-20</n:dEmi></n:ide><n:emit><n:CNPJ>95000000000199</n:CNPJ><n:xNome>[TESTE] Emitente &amp; Filhos</n:xNome></n:emit><n:dest><n:CNPJ>55800425000177</n:CNPJ><n:xNome>[TESTE] Destinatário</n:xNome></n:dest><n:det nItem="1"><n:prod><n:cProd>TESTE</n:cProd><n:xProd>[TESTE] Item</n:xProd><n:uCom>UN</n:uCom><n:qCom>1</n:qCom><n:vUnCom>10.00</n:vUnCom><n:vProd>10.00</n:vProd></n:prod></n:det><n:total><n:ICMSTot><n:vNF>10.00</n:vNF></n:ICMSTot></n:total></n:infNFe></n:NFe><n:protNFe><n:infProt><n:chNFe>43261195000000000199550010000000081981000011</n:chNFe><n:cStat>100</n:cStat></n:infProt></n:protNFe></n:nfeProc>')->>'resultado'), 'entrou', 'prefixo de namespace e dEmi são aceitos');

select is((select nfe_series from public.payable_nfe_inbox where nfe_key='43261195000000000199550010000000081981000011'), '1', 'série sem zeros à esquerda');

select ok((select issued_at='2026-11-20T03:00:00Z'::timestamptz from public.payable_nfe_inbox where nfe_key='43261195000000000199550010000000081981000011'), 'dEmi vira meia-noite de São Paulo');

select is((select count(*)::int from public.list_nfe_inbox(0)),1,'limite zero vira um');

select is((select count(*)::int from public.list_nfe_inbox(-30)),1,'limite negativo vira um');

select ok((select inbox_status not in ('lancada','ja_no_erp') from public.list_nfe_inbox(1)), 'pendentes vêm antes das concluídas');

-- Regressões da rodada 2, sempre com documentos fictícios.
select is((public.receive_nfe_inbox_xml('<CompNfse><Nfse><infNFS/></Nfse></CompNfse>')->>'motivo'), 'nota_servico', 'NFS-e tem recusa própria');

select is((public.receive_nfe_inbox_xml('<CompNfse><Nfse><infNFS/></Nfse></CompNfse>')->>'mensagem'),
  'É uma nota de serviço (NFS-e). Ela entra numa fase futura, não por esta caixa.', 'NFS-e informa a fase futura');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'resultado' from inbox_fixture where n=12), 'entrou', 'avulsa procEmi 1 aceita a chave do órgão');

select is((select emitter_cnpj from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=12)),
  '95000000000270', 'avulsa guarda CNPJ do vendedor, não o do órgão');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'resultado' from inbox_fixture where n=13), 'entrou', 'avulsa procEmi 2 aceita produtor CPF');

select is((select emitter_cnpj from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=13)),
  '00095000000001', 'avulsa de produtor guarda 000 mais CPF do vendedor');

select is((select public.receive_nfe_inbox_xml(replace(xml_text, '<avulsa><CNPJ>95000000000199</CNPJ></avulsa>',
  '<avulsa><CNPJ>95000000000350</CNPJ></avulsa>'))->>'motivo' from inbox_fixture where n=12), 'chave_incoerente', 'avulsa recusa chave diferente do órgão');

select is((select public.receive_nfe_inbox_xml(replace(replace(xml_text, '</ide>', '<procEmi>0</procEmi></ide>'),
  '</emit>', '</emit><avulsa/>'))->>'resultado' from inbox_fixture where n=1), 'ja_existia', 'nota comum aceita avulsa vazia mantendo emitente na chave');

select is((select public.receive_nfe_inbox_xml(replace(replace(xml_text, '<emit><CNPJ>95000000000199</CNPJ>',
  '<emit><CNPJ>95000000000270</CNPJ>'), '</emit>', '</emit><avulsa/>'))->>'motivo' from inbox_fixture where n=9),
  'chave_incoerente', 'nota comum com avulsa vazia ainda exige o vendedor na chave');

select is((select public.receive_nfe_inbox_xml(chr(65279) || E' \r\n\t' || '<?xml version="1.0" encoding="UTF-8"?>' || xml_text)->>'resultado'
  from inbox_fixture where n=14), 'entrou', 'BOM e espaço antes da declaração XML não impedem a leitura');

select is((select xml_content from public.payable_nfe_inbox where nfe_key = (select chave from inbox_fixture where n=14)),
  (select chr(65279) || E' \r\n\t' || '<?xml version="1.0" encoding="UTF-8"?>' || xml_text from inbox_fixture where n=14), 'XML recebido é guardado inclusive com espaço inicial');

-- Um resumo sem XML continua bloqueado mesmo que exista rascunho pendente.
select public.save_xml_import_draft(chave, null, '[TESTE] Resumo', '9', '1', '2026-11-20', 10, xml_text, '[]', '[]')
  from inbox_fixture where n=9;
reset role;
insert into public.payable_nfe_inbox (nfe_key, recipient_cnpj, emitter_cnpj, nfe_number, nfe_series,
  emitter_name, issued_at, total_value, source, document_state, original_file_name)
select chave, case when n=10 then '58286372000106' else '55800425000177' end,
  case when n=11 then '95000000000270' else '95000000000199' end, n::text, '1',
  '[TESTE] Resumo protegido', '2026-11-20T09:00:00-03:00'::timestamptz,
  case when n=9 then 11 else 10 end, 'sefaz', 'somente_resumo', 'nome-do-resumo.xml'
from inbox_fixture where n in (9,10,11);
create temp table inbox_resumos_antes as
  select i.nfe_key, to_jsonb(i) as registro from public.payable_nfe_inbox i
  where i.nfe_key in (select chave from inbox_fixture where n in (9,10,11));
grant select on inbox_resumos_antes to authenticated;
update public.payable_purchases set status = 'cancelada' where nfe_key = (select chave from inbox_fixture where n=2);
set local role authenticated;

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key = (select chave from inbox_fixture where n=9)),
  'aguardando_xml', 'resumo com rascunho pendente espera XML antes de conferir');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'motivo' from inbox_fixture where n=9), 'diverge_do_resumo', 'valor diferente do resumo é recusado');

select is((select to_jsonb(i) from public.payable_nfe_inbox i where nfe_key = (select chave from inbox_fixture where n=9)),
  (select registro from inbox_resumos_antes where nfe_key = (select chave from inbox_fixture where n=9)), 'recusa por valor preserva a linha inteira');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'motivo' from inbox_fixture where n=10), 'diverge_do_resumo', 'destinatário diferente do resumo é recusado');

select is((select to_jsonb(i) from public.payable_nfe_inbox i where nfe_key = (select chave from inbox_fixture where n=10)),
  (select registro from inbox_resumos_antes where nfe_key = (select chave from inbox_fixture where n=10)), 'recusa por destinatário preserva a linha inteira');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'motivo' from inbox_fixture where n=11), 'diverge_do_resumo', 'vendedor diferente do resumo é recusado');

select is((select to_jsonb(i) from public.payable_nfe_inbox i where nfe_key = (select chave from inbox_fixture where n=11)),
  (select registro from inbox_resumos_antes where nfe_key = (select chave from inbox_fixture where n=11)), 'recusa por vendedor preserva a linha inteira');

select is((select inbox_status from public.list_nfe_inbox() where inbox_nfe_key = (select chave from inbox_fixture where n=2)),
  'conta_cancelada', 'compra cancelada não aparece como lançada');

select is((select inbox_purchase_status from public.list_nfe_inbox() where inbox_nfe_key = (select chave from inbox_fixture where n=2)),
  'cancelada', 'estado original da compra cancelada continua disponível');

reset role;

select throws_ok('delete from public.payable_nfe_inbox where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: delete from public.payable_nfe_inbox');

select throws_ok('update public.payable_nfe_inbox set xml_attached_by=''98100000-0000-4000-8000-00000000000d'' where nfe_key=''43261195000000000199550010000000011981000010''',
  'P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda recusa trocar autor do anexo');

select throws_ok('update public.payable_nfe_inbox set xml_attached_at=xml_attached_at+interval ''1 second'' where nfe_key=''43261195000000000199550010000000011981000010''',
  'P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda recusa trocar data do anexo');

select throws_ok('update public.payable_nfe_inbox set xml_content=''<trocado/>'' where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: update public.payable_nfe_inbox');

select throws_ok('update public.payable_nfe_inbox set source=''sefaz'' where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: update public.payable_nfe_inbox');

select throws_ok('update public.payable_nfe_inbox set received_at=clock_timestamp() where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: update public.payable_nfe_inbox');

select throws_ok('update public.payable_nfe_inbox set recipient_cnpj=''58286372000106'' where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: update public.payable_nfe_inbox');

select throws_ok('update public.payable_nfe_inbox set received_by=null where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: update public.payable_nfe_inbox');

select throws_ok('update public.payable_nfe_inbox set nfe_key=''43261195000000000199550010000000091981000019'' where nfe_key=''43261195000000000199550010000000011981000010''','P0001','O XML original da nota fica guardado e não pode ser apagado nem trocado.','guarda mesmo para postgres: update public.payable_nfe_inbox');

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"98100000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

select throws_ok('select public.list_nfe_inbox()','42501','Sem permissão para receber notas.','catálogo bloqueado na RPC');

select throws_ok('select public.receive_nfe_inbox_xml(''<NFe/>'')','42501','Sem permissão para receber notas.','catálogo bloqueado na RPC');

select is((select count(*)::int from public.payable_nfe_inbox),0,'catálogo não lê linhas');

reset role;

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"98100000-0000-4000-8000-00000000000c","role":"authenticated"}', true);

select throws_ok('select public.list_nfe_inbox()','42501','Sem permissão para receber notas.','vendas bloqueado na RPC');

select throws_ok('select public.receive_nfe_inbox_xml(''<NFe/>'')','42501','Sem permissão para receber notas.','vendas bloqueado na RPC');

select is((select count(*)::int from public.payable_nfe_inbox),0,'vendas não lê linhas');

reset role;

set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"98100000-0000-4000-8000-00000000000d","role":"authenticated"}', true);

select lives_ok('select public.list_nfe_inbox()', 'admin por papel lista sem concessão granular');

select is((select public.receive_nfe_inbox_xml(xml_text)->>'resultado' from inbox_fixture where n=1), 'ja_existia', 'admin por papel recebe sem concessão granular');

reset role; set local role anon;

select throws_ok('select public.list_nfe_inbox()','42501',null,'anon não executa RPC');

select throws_ok('select public.receive_nfe_inbox_xml(''<NFe/>'')','42501',null,'anon não executa RPC');

reset role;
select * from finish();
rollback;
