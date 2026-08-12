-- Perfis `admin` não enxergavam as telas financeiras.
--
-- Auditoria live de 2026-08-12, depois da fase 0 do Financeiro: o
-- `allowed_routes` dos administradores é uma lista fixa, gravada quando cada
-- tela nasceu, e ela não recebeu `/contas-pagar` (agosto/2026) nem
-- `/financeiro` (hoje). Para o papel `admin`, `resolveAllowedRoutes` devolve
-- `allowed_routes` sem alterar — a permissão granular não acrescenta rota —
-- então o dono do negócio não abria a tela que ele mesmo aprovou.
--
-- Isto conserta o sintoma nas duas telas que já existem. A causa continua
-- aberta e registrada em docs/CURRENT_STATE.md: enquanto o `admin` depender
-- de uma lista fixa, toda tela nova vai nascer invisível para ele.
--
-- O acesso ao dado já era garantido: as funções e policies do financeiro e do
-- contas a pagar liberam o papel `admin` diretamente. Faltava só o caminho
-- até a tela.
--
-- A ordem da lista é preservada e as rotas novas entram no fim: a primeira
-- rota é a tela onde a pessoa cai ao entrar, e reordenar mudaria isso.

begin;

update public.app_profiles profile
set allowed_routes = profile.allowed_routes || coalesce(
  (
    select jsonb_agg(to_jsonb(missing.route))
    from unnest(array['/contas-pagar', '/financeiro']) as missing(route)
    where not (profile.allowed_routes ? missing.route)
  ),
  '[]'::jsonb
)
where profile.role = 'admin'
  and profile.active
  and jsonb_typeof(profile.allowed_routes) = 'array'
  and not (profile.allowed_routes ?& array['/contas-pagar', '/financeiro']);

commit;
