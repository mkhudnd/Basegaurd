import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  AppHeader,
  COLORS,
  DeliveryStatus,
  FONTS,
  formatTimestamp,
  IncidentSeverity,
  InfoAlertBanner,
  SeverityBadge,
  SmartButton,
  StatusChip,
  SurfaceCard,
} from '../components';

export interface IncidentUpdateEntry {
  id: string;
  updateType: 'acknowledged' | 'progress' | 'resolved' | 'closed';
  note: string;
  createdAt: string;
  authorName?: string;
}

export interface IncidentDetailRecord {
  id: string;
  categoryLabel: string;
  severity: IncidentSeverity;
  description: string;
  actionsTaken?: string | null;
  siteName: string;
  eventAt: string;
  createdAt: string;
  deliveryStatus: DeliveryStatus;
  /** Populated ONLY after confirmed server receipt */
  serverRef?: string | null;
  receivedAt?: string | null;
  /** True ONLY if real server status/updates were queried */
  acknowledgmentVerifiedFromServer?: boolean;
  acknowledgedAt?: string | null;
  closedAt?: string | null;
  updates?: IncidentUpdateEntry[];
  lastError?: string | null;
}

export interface IncidentDetailsScreenProps {
  incident: IncidentDetailRecord | null;
  isOnline: boolean;
  isSyncing?: boolean;
  onRetrySync?: (incidentId: string) => void | Promise<void>;
  onRefreshServerState?: (incidentId: string) => void | Promise<void>;
  onBack: () => void;
}

export const IncidentDetailsScreen: React.FC<IncidentDetailsScreenProps> = ({
  incident,
  isOnline,
  isSyncing = false,
  onRetrySync,
  onRefreshServerState,
  onBack,
}) => {
  if (!incident) {
    return (
      <View style={styles.root}>
        <AppHeader
          title="Incident Details"
          isOnline={isOnline}
          onBack={onBack}
        />
        <View style={styles.scrollContent}>
          <InfoAlertBanner
            tone="warning"
            title="Incident Record Unavailable"
            body="The selected incident could not be found."
          />
          <SmartButton label="Back to Incident History" onPress={onBack} />
        </View>
      </View>
    );
  }

  const isLocalOnly = ['queued', 'sending', 'failed'].includes(
    incident.deliveryStatus
  );

  const supervisorAckDisplay = (): string => {
    if (isLocalOnly) {
      return 'Not yet delivered to server';
    }
    if (!incident.acknowledgmentVerifiedFromServer) {
      return 'Acknowledgment status unavailable (awaiting server check)';
    }
    if (incident.acknowledgedAt) {
      return formatTimestamp(incident.acknowledgedAt);
    }
    return 'Received by server — Awaiting supervisor review';
  };

  return (
    <View style={styles.root}>
      <AppHeader
        title="Incident Details"
        subtitle={
          !isLocalOnly && incident.serverRef
            ? incident.serverRef
            : `Local ID: ${incident.id.slice(0, 14)}…`
        }
        isOnline={isOnline}
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isLocalOnly ? (
          <InfoAlertBanner
            tone={incident.deliveryStatus === 'failed' ? 'danger' : 'offline'}
            title="Not Yet Delivered to Server"
            body={
              incident.lastError
                ? `Last sync error: ${incident.lastError}`
                : 'This record exists only in your local encrypted SQLite outbox. Supervisors cannot view or acknowledge it until synchronization succeeds.'
            }
          />
        ) : null}

        <SurfaceCard>
          <View style={styles.badgeRow}>
            <StatusChip status={incident.deliveryStatus} />
            <SeverityBadge severity={incident.severity} />
          </View>

          <Text style={styles.incidentHeading}>{incident.categoryLabel}</Text>
          <Text style={styles.narrativeBody}>{incident.description}</Text>

          {incident.actionsTaken ? (
            <View style={styles.actionsBox}>
              <Text style={styles.actionsTitle}>
                Immediate Actions Taken by Guard
              </Text>
              <Text style={styles.actionsBody}>{incident.actionsTaken}</Text>
            </View>
          ) : null}

          <View style={styles.divider} />

          <Text style={styles.sectionSubhead}>
            Audit & Delivery Verification
          </Text>
          <View style={styles.auditGrid}>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Assigned Site: </Text>
              {incident.siteName}
            </Text>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Local Outbox UUID: </Text>
              {incident.id}
            </Text>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Server Reference: </Text>
              {!isLocalOnly && incident.serverRef
                ? incident.serverRef
                : 'Assigned after server receipt'}
            </Text>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Event Occurred At: </Text>
              {formatTimestamp(incident.eventAt)}
            </Text>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Saved Locally At: </Text>
              {formatTimestamp(incident.createdAt)}
            </Text>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Server Received At: </Text>
              {!isLocalOnly && incident.receivedAt
                ? formatTimestamp(incident.receivedAt)
                : 'Pending Sync'}
            </Text>
            <Text style={styles.auditRow}>
              <Text style={styles.auditKey}>Supervisor Acknowledgment: </Text>
              {supervisorAckDisplay()}
            </Text>
          </View>
        </SurfaceCard>

        {/* Supervisor Follow-up Timeline */}
        <SurfaceCard>
          <Text style={styles.sectionSubhead}>Supervisor Review Timeline</Text>
          {isLocalOnly ? (
            <Text style={styles.mutedNote}>
              Timeline unavailable until this incident is received by the server.
            </Text>
          ) : !incident.acknowledgmentVerifiedFromServer ? (
            <Text style={styles.mutedNote}>
              Acknowledgment status unavailable. Refresh from server when online
              to check for supervisor updates.
            </Text>
          ) : incident.updates && incident.updates.length > 0 ? (
            <View style={styles.timelineList}>
              {incident.updates.map((u) => (
                <View key={u.id} style={styles.timelineStep}>
                  <Text style={styles.timelineStepTitle}>
                    {u.updateType.toUpperCase()} · {formatTimestamp(u.createdAt)}
                  </Text>
                  <Text style={styles.timelineStepNote}>{u.note}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.mutedNote}>
              No supervisor review actions recorded on the server yet.
            </Text>
          )}
        </SurfaceCard>

        {isLocalOnly && onRetrySync ? (
          <SmartButton
            label={isSyncing ? 'Syncing...' : 'Sync This Incident Now'}
            onPress={() => onRetrySync(incident.id)}
            loading={isSyncing}
            disabled={isSyncing}
          />
        ) : null}

        {!isLocalOnly && onRefreshServerState ? (
          <SmartButton
            label="Refresh Supervisor Acknowledgment Status"
            onPress={() => onRefreshServerState(incident.id)}
            variant="secondary"
            disabled={!isOnline || isSyncing}
          />
        ) : null}

        <SmartButton
          label="Back to Incident History"
          onPress={onBack}
          variant="secondary"
        />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  incidentHeading: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  narrativeBody: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  actionsBox: {
    marginTop: 14,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 10,
    padding: 12,
  },
  actionsTitle: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.navy,
    marginBottom: 4,
  },
  actionsBody: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  sectionSubhead: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.navy,
    marginBottom: 10,
  },
  auditGrid: {
    gap: 6,
  },
  auditRow: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.text,
    fontFamily: FONTS.regular,
  },
  auditKey: {
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  mutedNote: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
  },
  timelineList: {
    borderLeftWidth: 2,
    borderLeftColor: COLORS.primary,
    paddingLeft: 12,
    gap: 10,
  },
  timelineStep: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 8,
    padding: 10,
  },
  timelineStepTitle: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 3,
  },
  timelineStepNote: {
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.text,
    fontFamily: FONTS.regular,
  },
});
