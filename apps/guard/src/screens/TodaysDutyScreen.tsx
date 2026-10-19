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
  BottomNavBar,
  COLORS,
  DeliveryStatus,
  EmergencyEscalationBanner,
  EmptyStateCard,
  FONTS,
  formatTimestamp,
  GuardTabKey,
  InfoAlertBanner,
  SmartButton,
  StatusChip,
  SurfaceCard,
} from '../components';

export interface VerifiedShiftContext {
  shiftId: string;
  siteId: string;
  siteCode?: string;
  siteName: string;
  guardName: string;
  startedAt: string;
  endedAt?: string | null;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
}

export interface ActivitySummaryItem {
  id: string;
  recordType: 'incident' | 'occurrence';
  title: string;
  description: string;
  eventAt: string;
  siteName: string;
  deliveryStatus: DeliveryStatus;
  serverRef?: string | null;
}

export interface TodaysDutyScreenProps {
  shiftContext: VerifiedShiftContext | null;
  isCachedDuty?: boolean;
  dutyError?: string | null;
  notice?: string | null;
  isLoadingShift?: boolean;
  isOnline: boolean;
  pendingSyncCount: number;
  failedSyncCount?: number;
  recentActivity: ActivitySummaryItem[];
  activeTab?: GuardTabKey;
  onSelectTab: (tab: GuardTabKey) => void;
  onReportIncident: () => void;
  onNewOccurrence: () => void;
  onOpenMyIncidents: () => void;
  onOpenSyncQueue: () => void;
  onSelectActivityItem: (item: ActivitySummaryItem) => void;
  onRefreshShift?: () => void;
  onSignOut?: () => void;
}

export const TodaysDutyScreen: React.FC<TodaysDutyScreenProps> = ({
  shiftContext,
  isCachedDuty = false,
  dutyError = null,
  notice = null,
  isLoadingShift = false,
  isOnline,
  pendingSyncCount,
  failedSyncCount = 0,
  recentActivity,
  activeTab = 'today',
  onSelectTab,
  onReportIncident,
  onNewOccurrence,
  onOpenMyIncidents,
  onOpenSyncQueue,
  onSelectActivityItem,
  onRefreshShift,
  onSignOut,
}) => {
  const totalUnsent = pendingSyncCount + failedSyncCount;

  return (
    <View style={styles.root}>
      <AppHeader
        title="Today's Duty"
        subtitle={
          shiftContext
            ? `${shiftContext.guardName} · ${shiftContext.siteName}`
            : 'Baseguard SmartOps'
        }
        isOnline={isOnline}
        pendingCount={totalUnsent}
        onPressSyncBadge={onOpenSyncQueue}
        onSignOut={onSignOut}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Verified Duty / Shift Assignment Card */}
        {shiftContext ? (
          <SurfaceCard>
            <View style={styles.shiftHeaderRow}>
              <View style={styles.flex1}>
                <Text style={styles.overlineLabel}>ASSIGNED DUTY POST</Text>
                <Text style={styles.siteTitle}>{shiftContext.siteName}</Text>
                <Text style={styles.shiftMeta}>
                  Shift Started: {formatTimestamp(shiftContext.startedAt)}
                </Text>
              </View>
              <View
                style={[
                  styles.shiftStateBadge,
                  shiftContext.status === 'active'
                    ? styles.shiftActiveBadge
                    : styles.shiftInactiveBadge,
                ]}
              >
                <Text
                  style={[
                    styles.shiftStateText,
                    shiftContext.status === 'active'
                      ? styles.shiftActiveText
                      : styles.shiftInactiveText,
                  ]}
                >
                  {isCachedDuty
                    ? 'Previously Verified'
                    : shiftContext.status === 'active'
                    ? 'Active Shift'
                    : shiftContext.status.toUpperCase()}
                </Text>
              </View>
            </View>
          </SurfaceCard>
        ) : (
          <SurfaceCard style={styles.noShiftCard}>
            <Text style={styles.noShiftTitle}>
              {isLoadingShift
                ? 'Loading Verified Shift Assignment...'
                : 'No Active Shift Assignment Found'}
            </Text>
            <Text style={styles.noShiftBody}>
              You must have a server-verified active shift assignment for an
              authorized site before submitting occurrence or incident records.
            </Text>
            {onRefreshShift ? (
              <SmartButton
                label="Refresh Shift Status"
                onPress={onRefreshShift}
                variant="secondary"
              />
            ) : null}
          </SurfaceCard>
        )}

        {shiftContext && isCachedDuty ? (
          <InfoAlertBanner tone="offline" title="Offline Duty Context"
            body="This assignment was verified earlier. Site and shift permissions will be checked again by the server when this report syncs." />
        ) : null}
        {dutyError ? <InfoAlertBanner tone="warning" title="Duty Refresh Unavailable" body={dutyError} /> : null}
        {notice ? <InfoAlertBanner tone="warning" title="Action Needs Attention" body={notice} /> : null}

        {/* Honest Outbox Status Banner */}
        {totalUnsent > 0 ? (
          <InfoAlertBanner
            tone={failedSyncCount > 0 ? 'danger' : 'offline'}
            title={
              failedSyncCount > 0
                ? `${failedSyncCount} Failed · ${pendingSyncCount} Pending Sync`
                : `${pendingSyncCount} Report(s) Awaiting Sync`
            }
            body="Locally saved reports remain in your encrypted phone outbox and have NOT reached a supervisor until synchronized."
            actionLabel="Open Sync Queue"
            onActionPress={onOpenSyncQueue}
          />
        ) : (
          <InfoAlertBanner
            tone="success"
            title="Local Outbox Clear"
            body="No unsent reports are waiting in the local queue on this device."
          />
        )}

        {/* Quick Actions 2x2 Grid */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickGrid}>
          <Pressable
            accessibilityRole="button"
            disabled={!shiftContext}
            onPress={onReportIncident}
            style={({ pressed }) => [
              styles.quickCard,
              !shiftContext && styles.quickCardDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.quickIcon}>⚠️</Text>
            <Text numberOfLines={1} style={styles.quickTitle}>
              Report Incident
            </Text>
            <Text numberOfLines={2} style={styles.quickSubtitle}>
              Log security breach, damage, or hazard
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={!shiftContext}
            onPress={onNewOccurrence}
            style={({ pressed }) => [
              styles.quickCard,
              !shiftContext && styles.quickCardDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.quickIcon}>📖</Text>
            <Text numberOfLines={1} style={styles.quickTitle}>
              New OB Entry
            </Text>
            <Text numberOfLines={2} style={styles.quickSubtitle}>
              Record routine post activity
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onOpenMyIncidents}
            style={({ pressed }) => [
              styles.quickCard,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.quickIcon}>📋</Text>
            <Text numberOfLines={1} style={styles.quickTitle}>
              My Incidents
            </Text>
            <Text numberOfLines={2} style={styles.quickSubtitle}>
              Review local & server-received reports
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onOpenSyncQueue}
            style={({ pressed }) => [
              styles.quickCard,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.quickIcon}>🔄</Text>
            <Text numberOfLines={1} style={styles.quickTitle}>
              Sync Queue
            </Text>
            <Text numberOfLines={2} style={styles.quickSubtitle}>
              {totalUnsent > 0
                ? `${totalUnsent} unsynced record(s)`
                : 'Outbox & delivery status'}
            </Text>
          </Pressable>
        </View>

        {/* Recent Activity */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {recentActivity.length === 0 ? (
          <EmptyStateCard
            title="No Shift Activity Yet"
            description="Incidents and Occurrence Book entries logged during your shift will appear here."
          />
        ) : (
          recentActivity.slice(0, 5).map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              onPress={() => onSelectActivityItem(item)}
              style={({ pressed }) => [
                styles.activityCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.activityTopRow}>
                <Text style={styles.activityRef}>
                  {item.serverRef
                    ? item.serverRef
                    : `Local ID: ${item.id.slice(0, 12)}…`}
                </Text>
                <StatusChip status={item.deliveryStatus} />
              </View>
              <Text style={styles.activityTitle}>{item.title}</Text>
              <Text numberOfLines={2} style={styles.activityDesc}>
                {item.description}
              </Text>
              <Text style={styles.activityMeta}>
                Event: {formatTimestamp(item.eventAt)} · {item.siteName}
              </Text>
            </Pressable>
          ))
        )}

        {/* Mandatory Emergency Procedure Reminder */}
        <EmergencyEscalationBanner />
      </ScrollView>

      <BottomNavBar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        unsyncedCount={totalUnsent}
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
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  shiftHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  overlineLabel: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  siteTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: 4,
  },
  shiftMeta: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  shiftStateBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  shiftActiveBadge: {
    backgroundColor: COLORS.successSoft,
  },
  shiftInactiveBadge: {
    backgroundColor: COLORS.warningSoft,
  },
  shiftStateText: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  shiftActiveText: {
    color: COLORS.success,
  },
  shiftInactiveText: {
    color: COLORS.warning,
  },
  noShiftCard: {
    borderColor: COLORS.warning,
    backgroundColor: COLORS.warningSoft,
  },
  noShiftTitle: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.warning,
    marginBottom: 6,
  },
  noShiftBody: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.text,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.navy,
    marginTop: 6,
    marginBottom: 10,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  quickCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 108,
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    justifyContent: 'space-between',
  },
  quickCardDisabled: {
    opacity: 0.45,
  },
  quickIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  quickTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.primary,
  },
  quickSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginTop: 3,
  },
  activityCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  activityTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  activityRef: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: FONTS.medium,
    flex: 1,
  },
  activityTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  activityDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
  },
  activityMeta: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 8,
  },
  pressed: {
    opacity: 0.84,
  },
});
