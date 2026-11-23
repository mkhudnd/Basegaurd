/**
 * Only a submitted handover with a valid end timestamp represents End Duty.
 * Older outgoing handovers may share the same kind/slot without an end timestamp.
 * Their actual shift status must be checked on the server.
 */
export type EndDutyStatus = 'none' | 'queued' | 'sending' | 'failed' | 'received' | 'legacy-handover';

type HandoverSnapshot = {
  kind: string;
  slot: string;
  state: string;
  payload: string;
};

export function getEndDutyStatus(
  operations: readonly HandoverSnapshot[],
  shiftId: string | null | undefined,
): EndDutyStatus {
  if (!shiftId) return 'none';
  const outgoing = operations.find(op => op.kind === 'submit' && op.slot === shiftId);
  if (!outgoing) return 'none';

  try {
    const payload: unknown = JSON.parse(outgoing.payload);
    if (!payload || typeof payload !== 'object' || !('p_ended_at' in payload)) {
      return 'legacy-handover';
    }
    const endedAt = payload.p_ended_at;
    if (typeof endedAt !== 'string' || !Number.isFinite(Date.parse(endedAt))) {
      return 'legacy-handover';
    }
  } catch {
    return 'legacy-handover';
  }

  switch (outgoing.state) {
    case 'received': return 'received';
    case 'failed': return 'failed';
    case 'sending': return 'sending';
    default: return 'queued';
  }
}
