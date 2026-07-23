'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { getCurrentUserAsync, roleColor, type AppUser } from '@/lib/auth'
import {
  assignmentId,
  buildPermissionAssignments,
  formatRole,
  formatStore,
  groupPermissions,
  isPjOrderSingleCheckboxPermission,
  isSingleCheckboxPermissionChecked,
  loadAccessManagementData,
  permissionStoreScopes,
  replaceUserPermissions,
  togglePermissionAssignment,
  toggleSingleCheckboxPermission,
  type AccessManagementData,
  type AccessProfile,
  type PermissionScope,
} from '@/lib/adminPermissions'
import { SupabaseRestError } from '@/lib/supabaseRest'
import styles from './page.module.css'

export default function AdminUsuariosPage() {
  const router = useRouter()
  const [user, setUser] = useState<AppUser | null>(null)
  const [data, setData] = useState<AccessManagementData | null>(null)
  const [selected, setSelected] = useState<AccessProfile | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [schemaPending, setSchemaPending] = useState(false)

  useEffect(() => {
    let alive = true

    void (async () => {
      const current = await getCurrentUserAsync()
      if (!alive) return
      if (!current || current.role !== 'admin') {
        router.replace('/')
        return
      }

      setUser(current)
      try {
        const loaded = await loadAccessManagementData()
        if (alive) setData(loaded)
      } catch (error) {
        if (!alive) return
        setSchemaPending(error instanceof SupabaseRestError && (error.status === 404 || error.status === 400))
        setMessage('Não foi possível carregar a estrutura de permissões.')
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => { alive = false }
  }, [router])

  const profiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR')
    if (!data || !normalized) return data?.profiles ?? []
    return data.profiles.filter(profile =>
      profile.display_name.toLocaleLowerCase('pt-BR').includes(normalized)
      || formatRole(profile.role).toLocaleLowerCase('pt-BR').includes(normalized)
      || formatStore(profile.store).toLocaleLowerCase('pt-BR').includes(normalized),
    )
  }, [data, query])

  function openEditor(profile: AccessProfile) {
    setSelected(profile)
    setDraft(new Set((data?.assignments[profile.user_id] ?? []).map(assignmentId)))
    setMessage('')
  }

  function togglePermission(key: string, scope: PermissionScope = '*') {
    setDraft(current => togglePermissionAssignment(current, key, scope))
  }

  function togglePjOrderPermission(key: string) {
    setDraft(current => toggleSingleCheckboxPermission(current, key))
  }

  async function savePermissions() {
    if (!selected || !data) return
    setSaving(true)
    setMessage('')
    try {
      const assignments = buildPermissionAssignments(draft)
      await replaceUserPermissions(selected.user_id, assignments)
      setData(current => current ? {
        ...current,
        assignments: { ...current.assignments, [selected.user_id]: assignments },
      } : current)
      setMessage(`Permissões de ${selected.display_name} salvas com sucesso.`)
    } catch {
      setMessage('Não foi possível salvar. Nenhuma permissão operacional foi alterada.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="ps-loading"><div className="ps-spinner"/><p>Carregando...</p></div>
  }

  return (
    <div className="ps-canvas">
      <div className="ps-shell">
        <header className="ps-header">
          <div className="ps-wordmark">
            <div className="ps-mark">P</div>
            <div className="ps-brand"><b>Admin · Usuários</b><span>Permissões por pessoa</span></div>
          </div>
          {user && <div className="ps-userchip"><div className="ps-avatar" style={{ background: roleColor(user.role) }}>{user.displayName.charAt(0).toUpperCase()}</div><b>{user.displayName}</b></div>}
        </header>

        <main className="ps-scroll ps-pad">
          <div className="ps-banner honey">
            <ShieldCheck size={20} aria-hidden="true" />
            <span><b>Acesso individual.</b> No Romaneio e na Produção da Cozinha, cada ação pode valer para uma loja ou para todas.</span>
          </div>

          {schemaPending && (
            <section className="ps-card" style={{ marginTop: 16 }}>
              <h1 className="ps-page-title">Estrutura ainda não aplicada</h1>
              <p>A tela está pronta, mas a migration de permissões precisa ser aprovada e aplicada antes do teste com usuários reais.</p>
            </section>
          )}

          {!schemaPending && data && (
            <>
              <div className={styles.toolbar}>
                <input
                  className={styles.search}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={`Buscar entre ${data.profiles.length} usuários`}
                  aria-label="Buscar usuários"
                />
              </div>

              {selected && (
                <section className={`ps-card ${styles.editor}`}>
                  <div className={styles.editorHead}>
                    <div>
                      <h1 className="ps-page-title" style={{ marginTop: 0 }}>{selected.display_name}</h1>
                      <div className={styles.userMeta}>{formatRole(selected.role)} · {formatStore(selected.store)}</div>
                    </div>
                    <button className={styles.closeButton} onClick={() => setSelected(null)}>Fechar</button>
                  </div>

                  {groupPermissions(data.permissions).map(group => (
                    <div className={styles.permissionGroup} key={group.module}>
                      <h3>{group.module}</h3>
                      {group.permissions.map(permission => (
                        <div className={styles.permissionBlock} key={permission.key}>
                          <label className={styles.permission}>
                            <input
                              type="checkbox"
                              checked={isPjOrderSingleCheckboxPermission(permission.key)
                                ? isSingleCheckboxPermissionChecked(draft, permission.key)
                                : draft.has(`${permission.key}|*`)}
                              onChange={() => isPjOrderSingleCheckboxPermission(permission.key)
                                ? togglePjOrderPermission(permission.key)
                                : togglePermission(permission.key)}
                            />
                            <span className={styles.permissionText}>
                              <b>{permission.label}</b>
                              {permission.description && <small>{permission.description}</small>}
                            </span>
                          </label>
                          {permissionStoreScopes(permission.key).length > 0 && (
                            <div className={styles.scopeOptions} aria-label={`Lojas para ${permission.label}`}>
                              {permissionStoreScopes(permission.key).map(scope => (
                                <label key={scope}>
                                  <input
                                    type="checkbox"
                                    checked={draft.has(`${permission.key}|${scope}`)}
                                    onChange={() => togglePermission(permission.key, scope)}
                                  />
                                  {scope.toUpperCase()}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}

                  <button className={styles.saveButton} disabled={saving} onClick={() => void savePermissions()}>
                    {saving ? 'Salvando...' : 'Salvar permissões'}
                  </button>
                </section>
              )}

              {message && <p className={message.startsWith('Permissões') ? 'ps-banner honey' : styles.error}>{message}</p>}

              <section className={styles.userList} aria-label="Usuários cadastrados">
                {profiles.map(profile => {
                  const count = data.assignments[profile.user_id]?.length ?? 0
                  return (
                    <button
                      key={profile.user_id}
                      className={`${styles.userButton} ${selected?.user_id === profile.user_id ? styles.userButtonSelected : ''}`}
                      onClick={() => openEditor(profile)}
                    >
                      <span className={styles.userLine}>
                        <b>{profile.display_name}</b>
                        <span className={styles.badge}>{count} permissões</span>
                      </span>
                      <span className={styles.userMeta}>
                        {formatRole(profile.role)} · {formatStore(profile.store)} · {profile.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </button>
                  )
                })}
              </section>
            </>
          )}

          {!schemaPending && message && !data && <p className={styles.error}>{message}</p>}
        </main>
      </div>
    </div>
  )
}
