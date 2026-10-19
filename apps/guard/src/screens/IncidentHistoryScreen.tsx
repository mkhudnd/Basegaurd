import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AppHeader,
  BottomNavBar,
  COLORS,
  DeliveryStatus,
  EmptyStateCard,
  FONTS,
  formatTimestamp,
  GuardTabKey,
  IncidentSeverity,
  InfoAlertBanner,
  SeverityBadge,
  SmartButton,
  StatusChip,
} from '../components';

export interface IncidentListItem {
  id: string;
  categoryLabel: string;
  severity: IncidentSeverity;
  description: string;
  eventAt: string;
  createdAt: string;
  siteName: string;
  deliveryStatus: DeliveryStatus;
  /** Populated ONLY after confirmed server receipt (e.g., BG-INC-000042) */
  serverRef?: string | null;
  receivedAt?: string | null;
}

export type IncidentFilterKey = 'all' | 'unsynced' | 'received' | 'acknowledged';

export interface IncidentHistoryScreenProps {
  incidents: IncidentListItem[];
  canReport?: boolean;
  loadError?: string | null;
  isOnline: boolean;
  unsyncedCount: number;
  activeTab?: GuardTabKey;
  onSelectTab: (tab: GuardTabKey) => void;
  onSelectIncident: (incidentId: string) => void;
  onReportNewIncident: () => void;
  onOpenSyncQueue: () => void;
  onRefresh?: () => void;
}

const FILTERS: { key: IncidentFilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unsynced', label: 'Unsynced' },
  { key: 'received', label: 'Server Received' },
  { key: 'acknowledged', label: 'Acknowledged' },
];

export const IncidentHistoryScreen: React.FC<IncidentHistoryScreenProps> = ({
  incidents,
  canReport = true,
  loadError = null,
  isOnline,
  unsyncedCount,
  activeTab = 'incidents',
  onSelectTab,
  onSelectIncident,
  onReportNewIncident,
  onOpenSyncQueue,
}) => {
  const [filter, setFilter] = useState<IncidentFilterKey>('all');

  const filteredIncidents = incidents.filter((inc) => {
    if (filter === 'unsynced') {
      return ['queued', 'sending', 'failed'].includes(inc.deliveryStatus);
    }
    if (filter === 'received') {
      return inc.deliveryStatus === 'received';
    }
    if (filter === 'acknowledged') {
      return ['acknowledged', 'in_progress', 'resolved', 'closed'].includes(
        inc.deliveryStatus
      );
    }
    return true;
  });

  return (
    <View style={styles.root}>
      <AppHeader
        title="My Incidents"
        subtitle="Local Outbox & Server-Received Reports"
        isOnline={isOnline}
        pendingCount={unsyncedCount}
        onPressSyncBadge={onOpenSyncQueue}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loadError ? <InfoAlertBanner tone="warning" title="Server History Unavailable" body={loadError} /> : null}
        <View style={styles.topButtonRow}>
          <SmartButton
            label="+ Report New Incident"
            onPress={onReportNewIncident}
            disabled={!canReport}
            style={styles.flex1}
          />
          <SmartButton
            label={`Sync Queue (${unsyncedCount})`}
            onPress={onOpenSyncQueue}
            variant="secondary"
          />
        </View>

        {/* Horizontal Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(f.key)}
                style={[styles.filterPill, active && styles.filterPillActive]}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    active && styles.filterPillTextActive,
                  ]}
                >
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {filteredIncidents.length === 0 ? (
          <EmptyStateCard
            title="No Matching Incident Reports"
            description="No incident reports match the selected filter on this device."
            actionLabel={canReport ? 'Report an Incident' : undefined}
            onAction={canReport ? onReportNewIncident : undefined}
          />
        ) : (
          filteredIncidents.map((item) => {
            const hasServerReceipt =
              !['queued', 'sending', 'failed'].includes(item.deliveryStatus) &&
              Boolean(item.serverRef);

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onSelectIncident(item.id)}
                style={({ pressed }) => [
                  styles.incidentCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.refLabel}>
                    {hasServerReceipt
                      ? item.serverRef
                      : `Local UUID: ${item.id.slice(0, 12)}…`}
                  </Text>
                  <StatusChip status={item.deliveryStatus} />
                </View>

                <View style={styles.titleSeverityRow}>
                  <Text style={styles.categoryTitle}>{item.categoryLabel}</Text>
                  <SeverityBadge severity={item.severity} />
                </View>

                <Text numberOfLines={2} style={styles.narrativePreview}>
                  {item.description}
                </Text>

                <View style={styles.metaFooter}>
                  <Text style={styles.metaText}>
                    Event: {formatTimestamp(item.eventAt)}
                  </Text>
                  <Text style={styles.metaText}>
                    {item.createdAt ? `Saved: ${formatTimestamp(item.createdAt)}` : 'No local copy on this phone'}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <BottomNavBar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        unsyncedCount={unsyncedCount}
      />
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
  topButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  flex1: {
    flex: 1,
    minWidth: 180,
  },
  filterRow: {
    gap: 8,
    paddingBottom: 14,
  },
  filterPill: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterPillText: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  filterPillTextActive: {
    color: COLORS.white,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  incidentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  refLabel: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textMuted,
    flex: 1,
  },
  titleSeverityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  categoryTitle: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    flex: 1,
  },
  narrativePreview: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    marginBottom: 10,
  },
  metaFooter: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaText: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
  },
  pressed: {
    opacity: 0.85,
  },
});
