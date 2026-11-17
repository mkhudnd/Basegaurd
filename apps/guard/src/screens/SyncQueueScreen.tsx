import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AppHeader,
  COLORS,
  DeliveryStatus,
  EmptyStateCard,
  FONTS,
  formatTimestamp,
  InfoAlertBanner,
  SmartButton,
  StatusChip,
  SurfaceCard,
} from '../components';

export interface SyncQueueItem {
  id: string;
  recordType: 'incident' | 'occurrence';
  title: string;
  description: string;
  eventAt: string;
  createdAt: string;
  siteName: string;
  deliveryStatus: DeliveryStatus;
  serverRef?: string | null;
  receivedAt?: string | null;
  lastError?: string | null;
}

export interface SyncQueueScreenProps {
  items: SyncQueueItem[];
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncSummary?: string | null;
  onSyncAll: () => void | Promise<void>;
  onRetryItem: (itemId: string) => void | Promise<void>;
  onSelectItem: (item: SyncQueueItem) => void;
  onBack: () => void;
}

export const SyncQueueScreen: React.FC<SyncQueueScreenProps> = ({
  items,
  isOnline,
  isSyncing,
  lastSyncSummary,
  onSyncAll,
  onRetryItem,
  onSelectItem,
  onBack,
}) => {
  const pendingItems = items.filter((i) =>
    ['queued', 'sending', 'failed'].includes(i.deliveryStatus)
  );
  const failedCount = items.filter((i) => i.deliveryStatus === 'failed').length;
  const receivedCount = items.filter(
    (i) => !['queued', 'sending', 'failed'].includes(i.deliveryStatus)
  ).length;

  return (
    <View style={styles.root}>
      <AppHeader
        title="Offline Sync Queue"
        subtitle="Encrypted SQLite Outbox"
        isOnline={isOnline}
        pendingCount={pendingItems.length}
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <InfoAlertBanner
          tone={isOnline ? 'success' : 'offline'}
          title={
            isOnline
              ? 'Connection Available — Manual & Queued Sync Ready'
              : 'Offline — Records Stored in Local Encrypted Outbox'
          }
          body={
            isOnline
              ? 'Tap "Sync Pending Records" to transmit queued items to the Baseguard server and verify server receipts.'
              : 'Your reports remain safely stored in SQLCipher on this device. Retry synchronization once network connectivity returns.'
          }
        />

        {lastSyncSummary ? (
          <InfoAlertBanner
            tone="neutral"
            title="Latest Sync Result"
            body={lastSyncSummary}
          />
        ) : null}

        {/* 3-Column Outbox Metrics */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: COLORS.offline }]}>
              {pendingItems.length}
            </Text>
            <Text style={styles.statLabel}>Unsent</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: COLORS.danger }]}>
              {failedCount}
            </Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statNumber, { color: COLORS.success }]}>
              {receivedCount}
            </Text>
            <Text style={styles.statLabel}>Received</Text>
          </View>
        </View>

        <SmartButton
          label={
            isSyncing
              ? 'Synchronizing Outbox...'
              : `Sync Pending Records (${pendingItems.length})`
          }
          onPress={onSyncAll}
          loading={isSyncing}
          disabled={isSyncing || pendingItems.length === 0}
        />

        <Text style={styles.sectionTitle}>
          Pending & Failed Outbox ({pendingItems.length})
        </Text>

        {pendingItems.length === 0 ? (
          <EmptyStateCard
            title="No Unsent Records in Queue"
            description="All locally created records have received a confirmed server receipt."
          />
        ) : (
          pendingItems.map((item) => (
            <SurfaceCard key={item.id} style={styles.queueCard}>
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelectItem(item)}
              >
                <View style={styles.cardTopRow}>
                  <Text style={styles.localIdText}>
                    Local UUID: {item.id.slice(0, 13)}…
                  </Text>
                  <StatusChip status={item.deliveryStatus} />
                </View>

                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text numberOfLines={2} style={styles.itemDesc}>
                  {item.description}
                </Text>

                <Text style={styles.metaText}>
                  Event: {formatTimestamp(item.eventAt)} · Saved:{' '}
                  {formatTimestamp(item.createdAt)}
                </Text>

                {item.lastError ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorBoxText}>
                      Sync Error: {item.lastError}
                    </Text>
                  </View>
                ) : null}
              </Pressable>

              <View style={styles.cardActionRow}>
                <SmartButton
                  label={
                    item.deliveryStatus === 'sending'
                      ? 'Sending...'
                      : 'Retry Sync'
                  }
                  onPress={() => onRetryItem(item.id)}
                  variant="secondary"
                  disabled={isSyncing || item.deliveryStatus === 'sending'}
                  style={styles.retryBtn}
                />
              </View>
            </SurfaceCard>
          ))
        )}
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
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: FONTS.medium,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.navy,
    marginTop: 16,
    marginBottom: 10,
  },
  queueCard: {
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  localIdText: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  itemDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
  },
  metaText: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  errorBox: {
    marginTop: 10,
    backgroundColor: COLORS.dangerSoft,
    borderRadius: 8,
    padding: 10,
  },
  errorBoxText: {
    fontSize: 12,
    lineHeight: 17,
    color: COLORS.danger,
    fontFamily: FONTS.medium,
  },
  cardActionRow: {
    marginTop: 12,
  },
  retryBtn: {
    minHeight: 48,
  },
});