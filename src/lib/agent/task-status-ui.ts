/** Busy = агент реально работает (блокирует ввод / пульс / cancel). */
export function isAgentBusyStatus(status: string | null | undefined): boolean {
  return status === 'planning'
    || status === 'executing'
    || status === 'waiting_input'
    || status === 'synthesizing';
}
