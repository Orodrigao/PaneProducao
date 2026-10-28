-- Administrador ativo passa automaticamente na jornada PJ.
--
-- Decisão do Rodrigo em 28/10/2026, com a Elis afastada: "sou o adm e tudo
-- fica disponível para mim", valendo também para a Suélen. Até aqui a jornada
-- exigia concessão marcada até do administrador: sem `contas_receber.acessar`
-- a leitura recusava, a policy restritiva escondia os pedidos e a tela caía
-- na lista antiga sem dizer por quê.
--
-- A regra passa a ser a mesma do Contas a receber
-- (private.current_user_can_receivables): perfil ativo com papel admin, ou a
-- concessão explícita em '*' ou 'jc'. Como todas as portas da jornada
-- perguntam por esta função (leitura, revisão, liberação, acordo de cobrança,
-- devolução, inscrição, criação e as policies de leitura), o admin ativo
-- passa em todas de uma vez.
--
-- O que NÃO muda: conferir quantidades e registrar a saída continuam só com a
-- Expedição JC, porque private.pj_flow_expedition() também exige o papel
-- expedicao na loja jc; o lançamento pela Expedição idem. Admin inativo, e
-- qualquer outro papel sem a concessão, segue recusado.

create or replace function private.pj_flow_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_profiles p
    where p.user_id = auth.uid() and p.active
      and (p.role = 'admin'
        or exists (select 1 from public.app_user_permissions a
          where a.user_id = p.user_id
            and a.permission_key = p_key and a.scope in ('*', 'jc'))));
$$;
revoke all on function private.pj_flow_permission(text) from public, anon, authenticated;

-- A tela de usuários mostra esta descrição ao lado da caixa; ela não pode
-- continuar dizendo que ninguém recebe a liberação sem marcar.
update public.app_permissions
set description = 'Confirmar cobrança e NF externa antes da saída. Administrador ativo já tem; nos demais perfis, sem concessão automática.'
where key = 'pedidos_pj.liberar';
