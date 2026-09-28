'use client'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Props {
  /** Insumos que ficariam sem contagem se fechasse agora, já em ordem de nome. */
  pendingNames: string[]
  total: number
  /** O que acontece depois de fechar (prazo para reabrir); nulo quando não há o que dizer. */
  afterCloseNote: string | null
  flushing: boolean
  closing: boolean
  anySaving: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Confirmação de fechar. Em 26/09 a contagem foi fechada no meio (15 de 59),
// provavelmente achando que fechar era salvar: aqui fica escrito que os números
// já salvam sozinhos e, pelo nome, o que ainda falta contar.
export function InventoryCountClosePanel(props: Props) {
  const pending = props.pendingNames.length
  return (
    <div className="ps-card" style={{marginTop:16, marginBottom:20, padding:14}}>
      <div style={{fontSize:14, fontWeight:600}}>Fechar a contagem?</div>
      <div style={{fontSize:13, color:'var(--ink-soft)', marginTop:6}}>
        Os números já ficam salvos sozinhos enquanto você digita: não precisa fechar para salvar.
        Feche só quando terminar de contar tudo.
      </div>

      {pending > 0 ? (
        <div className="ps-warning" style={{marginTop:10, alignItems:'flex-start'}}>
          <AlertTriangle size={18}/>
          <div>
            <b>Ainda {pending === 1 ? 'falta 1 insumo' : `faltam ${pending} insumos`} de {props.total}:</b>
            <ul style={{margin:'6px 0 0', paddingLeft:18, maxHeight:180, overflowY:'auto', fontSize:13}}>
              {props.pendingNames.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}
            </ul>
          </div>
        </div>
      ) : (
        <div style={{display:'flex', alignItems:'center', gap:6, fontSize:13, marginTop:10}}>
          <CheckCircle2 size={16} color="var(--sage)"/> Todos os {props.total} insumos foram contados.
        </div>
      )}

      {props.afterCloseNote && (
        <div style={{fontSize:12, color:'var(--ink-soft)', marginTop:10}}>{props.afterCloseNote}</div>
      )}

      <div style={{display:'flex', justifyContent:'flex-end', gap:8, marginTop:12, flexWrap:'wrap'}}>
        <button className="ps-btn ghost sm" onClick={props.onCancel} disabled={props.closing || props.flushing}>
          {pending > 0 ? 'Continuar contando' : 'Cancelar'}
        </button>
        <button className="ps-btn sm" onClick={props.onConfirm} disabled={props.closing || props.anySaving}>
          {props.flushing ? 'Salvando pendências...' : props.closing ? 'Fechando...' : pending > 0 ? 'Fechar mesmo assim' : 'Fechar contagem'}
        </button>
      </div>
    </div>
  )
}
