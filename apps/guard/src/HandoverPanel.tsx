import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {enqueueHandover} from './handover-outbox';
import {db, syncRecords, type Duty} from './offline';
import {supabase} from './api';
import {COLORS, FONTS, SmartButton, SurfaceCard} from './components';
import type {EndDutyStatus} from './end-duty-state';

type Incoming = {
  id: string;
  notes: string;
  equipment?: string;
  post?: string;
  outgoing_guard_id: string;
  accepted_by?: string;
  submitted_at: string;
  incident_ids?: string[];
  accepted_at: string | null;
};

type Props = {
  actor: string;
  duty: Duty | null;
  online: boolean;
  endDutyStatus: EndDutyStatus;
  onRequestEndDuty: () => void;
  onDelivered: () => Promise<void>;
};

const statusText: Record<EndDutyStatus, string> = {
  none: 'Prepare an outgoing handover using the dedicated End Duty screen.',
  queued: 'End Duty saved on this phone. Waiting for server receipt.',
  sending: 'End Duty is syncing. Server receipt is not yet confirmed.',
  failed: 'End Duty is saved on this phone, but synchronization failed. Review the sync queue.',
  received: 'The server received End Duty. This does not confirm incoming guard acceptance.',
  'legacy-handover': 'An older outgoing handover exists without an end-duty timestamp. Check the server shift status with a supervisor before proceeding.',
};

export function HandoverPanel({actor, duty, online, endDutyStatus, onRequestEndDuty, onDelivered}: Props) {
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [ops, setOps] = useState<{id: string; state: string; error: string | null}[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);

  const load = useCallback(async () => {
    const d = await db();
    setOps(await d.getAllAsync('SELECT id,state,error FROM handover_ops WHERE actor=? ORDER BY rowid DESC LIMIT 20', actor));
    const cached = await d.getFirstAsync<{payload: string}>('SELECT payload FROM incoming_cache WHERE actor=?', actor);
    const saved: unknown = cached ? JSON.parse(cached.payload) : [];
    setIncoming(Array.isArray(saved) ? saved as Incoming[] : []);
    if (online) {
      const response = await supabase.from('shift_handovers').select('*')
        .eq('incoming_guard_id', actor).order('submitted_at', {ascending: false}).limit(20);
      if (response.error) throw new Error(response.error.message);
      await d.runAsync('INSERT OR REPLACE INTO incoming_cache VALUES(?,?)', actor, JSON.stringify(response.data));
      setIncoming(response.data ?? []);
    }
  }, [actor, online]);

  useEffect(() => { void load().catch(e => setError(String(e))); }, [load]);

  async function acknowledge(receive: Incoming) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const d = await db();
      await enqueueHandover(d, actor, 'receive', receive.id, {p_id: receive.id});
      if (online) await syncRecords(actor);
      await onDelivered();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save handover acknowledgement.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function retry() {
    if (lock.current || !online) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await syncRecords(actor);
      await onDelivered();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to refresh handover status.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <View style={styles.content}>
    <SurfaceCard>
      <Text style={styles.heading}>Outgoing handover</Text>
      <Text style={styles.body}>{duty?.site_name ?? 'No active assignment'} · {duty?.post ?? 'No assigned post'}</Text>
      <Text accessibilityLiveRegion="polite" style={endDutyStatus === 'legacy-handover' ? styles.error : styles.body}>
        {statusText[endDutyStatus]}
      </Text>
      {duty ? <SmartButton variant="secondary"
        label={endDutyStatus === 'none' ? 'Open End Duty' : 'Review End Duty'}
        onPress={onRequestEndDuty}/> : null}
    </SurfaceCard>

    <Text style={styles.heading}>Incoming handovers</Text>
    {incoming.length === 0 ? <Text style={styles.body}>No incoming handovers available from the last refresh.</Text> : null}
    {incoming.map(h => <SurfaceCard key={h.id}>
      <Text style={styles.heading}>{h.post || 'Assigned post'} · {h.submitted_at}</Text>
      <Text style={styles.body}>Outgoing guard: {h.outgoing_guard_id}</Text>
      <Text style={styles.body}>{h.notes}</Text>
      <Text style={styles.body}>Equipment: {h.equipment || 'None recorded'}</Text>
      <Text style={styles.body}>Incident references: {h.incident_ids?.join(', ') || 'None'}</Text>
      {h.accepted_at ?
        <Text style={styles.body}>Received {h.accepted_at} · {h.accepted_by ?? actor}</Text> :
        <SmartButton label="Acknowledge receipt" disabled={busy} onPress={() => void acknowledge(h)}/>}
    </SurfaceCard>)}
    {ops.map(o => <Text key={o.id} style={styles.body}>
      {o.id.slice(0, 8)} · {o.state === 'received' ? 'Server received' : o.state}
      {o.error ? ' · ' + o.error : ''}
    </Text>)}
    <SmartButton label="Refresh and retry" disabled={!online || busy} onPress={() => void retry()}/>
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  content: {gap: 12},
  heading: {fontFamily: FONTS.bold, fontWeight: '700', fontSize: 17, color: COLORS.navy},
  body: {fontFamily: FONTS.regular, color: COLORS.text, lineHeight: 21},
  error: {color: COLORS.danger, lineHeight: 20},
});
