/**
 * How a promised day reads on screen, and whether it has been missed. Null when
 * no date was set, which is most farmers.
 *
 * Shared by the Farm Visits list and the farmer's own screen so a follow-up
 * reads the same in both places — an agent who saw "Overdue by 3 days" in the
 * list should not have to translate a bare date on the farmer.
 *
 * Both dates are flattened to midnight before comparing: the stored value is an
 * instant, so a visit due today would otherwise count as overdue from the
 * moment that instant passed — usually first thing in the morning, before the
 * agronomist had any chance to go.
 */
export function dueLabel(date?: string | null): { label: string; overdue: boolean } | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((day.getTime() - midnight.getTime()) / 86400000);

  /**
   * The calendar date is always spelled out, even when a relative word would
   * do. "Overdue by 3 days" alone leaves the agent counting backwards to work
   * out which day was missed, and "today" gives them nothing to check a written
   * note or a farmer's own recollection against.
   */
  const on = day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  if (days === 0) return { label: `Today · ${on}`, overdue: false };
  if (days === 1) return { label: `Tomorrow · ${on}`, overdue: false };
  if (days < 0) {
    return {
      label: `Overdue by ${-days} day${days === -1 ? '' : 's'} · ${on}`,
      overdue: true,
    };
  }
  return { label: `In ${days} days · ${on}`, overdue: false };
}
