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

export interface SubmissionRecordSummary {
  id: string;
  recordType: 'incident' | 'occurrence';
  categoryLabel: string;
  severity?: IncidentSeverity;
  description: string;
  eventAt: string;
  createdAt: string;
  siteName: string;
  deliveryStatus: DeliveryStatus;
  serverRef?: string | null;
  receivedAt?: string | null;
  lastError?: string | null;
}

export interface SubmissionStatusScreenProps {
  record: SubmissionRecordSummary;
  isOnline: boolean;
  isSyncing?: boolean;
  onSyncNow?: () => void | Promise<void>;
  onOpenSyncQueue: () => void;
  onOpenDetails: () => void;
  onBackToToday: () => void;
}

export const SubmissionStatusScreen: React.FC<SubmissionStatusScreenProps> = ({
  record,
  isOnline,
  isSyncing = false,
  onSyncNow,
  onOpenSyncQueue,
  onOpenDetails,
  onBackToToday,
}) => {
  const isServerReceived =
    record.deliveryStatus === 'received' ||
    record.deliveryStatus === 'acknowledged' ||
    record.deliveryStatus === 'in_progress' ||
    record.deliveryStatus === 'resolved' ||
    record.deliveryStatus === 'closed';

  const isFailed = record.deliveryStatus === 'failed';

  return (
    <View style={styles.root}>
      <AppHeader
        title="Submission Status"
        subtitle={
          record.recordType === 'incident'
            ? 'Incident Report'
            : 'Occurrence Book Entry'
        }
        isOnline={isOnline}
        onBack={onBackToToday}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {isServerReceived ? (
          <InfoAlertBanner
            tone="success"
            title="Confirmed Server Receipt"
            body="This report has been received by the Baseguard server. Note: Server receipt does not mean a supervisor has acknowledged it yet."
          />
        ) : isFailed ? (
          <InfoAlertBanner
            tone="danger"
            title="Sync Failed — Safely Stored on Device"
            body={
              record.lastError ||
              'The server could not be reached or rejected the upload. Your report remains safely saved in the local SQLite outbox.'
            }
          />
        ) : (
          <InfoAlertBanner
            tone="offline"
            title="Saved Locally / Pending Sync"
            body="This report is saved in your phone's encrypted SQLite outbox. It has NOT been delivered to the server or any supervisor yet."
          />
        )}

        <SurfaceCard>
          <View style={styles.topRow}>
            <View style={styles.flex1}>
              <Text style={styles.overline}>
                {isServerReceived && record.serverRef
                  ? 'SERVER REFERENCE'
                  : 'LOCAL OUTBOX UUID'}
              </Text>
              <Text style={styles.refValue}>
                {isServerReceived && record.serverRef
                  ? record.serverRef
                  : record.id}
              </Text>
            </View>
            <StatusChip status={record.deliveryStatus} />
          </View>

          {record.severity ? (
            <View style={styles.badgeRow}>
              <SeverityBadge severity={record.severity} />
            </View>
          ) : null}

          <View style={styles.divider} />

          <Text style={styles.categoryHeading}>{record.categoryLabel}</Text>
          <Text numberOfLines={4} style={styles.descriptionPreview}>
            {record.description}
          </Text>

          <View style={styles.metaBox}>
            <Text style={styles.metaLine}>Site: {record.siteName}</Text>
            <Text style={styles.metaLine}>
              Event Time: {formatTimestamp(record.eventAt)}
            </Text>
            <Text style={styles.metaLine}>
              Saved Locally: {formatTimestamp(record.createdAt)}
            </Text>
            <Text style={styles.metaLine}>
              Server Received:{' '}
              {isServerReceived && record.receivedAt
                ? formatTimestamp(record.receivedAt)
                : 'Not yet received by server'}
            </Text>
          </View>
        </SurfaceCard>

        {!isServerReceived && onSyncNow ? (
          <SmartButton
            label={isSyncing ? 'Syncing with Server...' : 'Attempt Sync Now'}
            onPress={onSyncNow}
            loading={isSyncing}
            disabled={isSyncing}
          />
        ) : null}

        <SmartButton
          label="View Sync Queue"
          onPress={onOpenSyncQueue}
          variant={isServerReceived ? 'primary' : 'secondary'}
        />

        <SmartButton
          label="Open Full Record Details"
          onPress={onOpenDetails}
          variant="secondary"
        />

        <SmartButton
          label="Back to Today's Duty"
          onPress={onBackToToday}
          variant="ghost"
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
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  overline: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.4,
  },
  refValue: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4,
  },
  badgeRow: {
    marginTop: 10,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 14,
  },
  categoryHeading: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  descriptionPreview: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  metaBox: {
    marginTop: 14,
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  metaLine: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
  },
});
