import React from 'react';
import {Ionicons} from '@expo/vector-icons';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';

/**
 * Baseguard SmartOps Canonical Design Tokens
 * Preserves exact brand identity from DESIGN.md & UI_DESIGN_HANDOFF.md
 */
export const COLORS = {
  primary: '#174E42',
  primaryHover: '#113F36',
  primarySoft: '#E7F2EE',
  navy: '#152836',
  background: '#F6F8F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F4',
  text: '#17252D',
  textMuted: '#556771',
  border: '#D9E2E6',
  danger: '#B43732',
  dangerSoft: '#FCEAE7',
  offline: '#73549B',
  offlineSoft: '#F0EAF8',
  success: '#1B7C55',
  successSoft: '#E7F2EE',
  warning: '#9D620A',
  warningSoft: '#FFF3D6',
  focus: '#246FA8',
  white: '#FFFFFF',
} as const;

export const FONTS = {
  regular: Platform.select({ android: 'NotoSans-Regular', default: 'System' }),
  medium: Platform.select({ android: 'NotoSans-SemiBold', default: 'System' }),
  bold: Platform.select({ android: 'NotoSans-Bold', default: 'System' }),
} as const;

export type DeliveryStatus =
  | 'queued'
  | 'sending'
  | 'failed'
  | 'received'
  | 'acknowledged'
  | 'in_progress'
  | 'resolved'
  | 'closed';

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type GuardTabKey = 'today' | 'ob' | 'incidents' | 'handover';

export const DELIVERY_META: Record<
  DeliveryStatus,
  { label: string; bg: string; fg: string; border: string }
> = {
  queued: {
    label: 'Saved Locally / Pending Sync',
    bg: COLORS.offlineSoft,
    fg: COLORS.offline,
    border: '#D6C6EB',
  },
  sending: {
    label: 'Syncing...',
    bg: COLORS.offlineSoft,
    fg: COLORS.offline,
    border: '#D6C6EB',
  },
  failed: {
    label: 'Sync Failed',
    bg: COLORS.dangerSoft,
    fg: COLORS.danger,
    border: '#F2B8B5',
  },
  received: {
    label: 'Received by Server',
    bg: COLORS.successSoft,
    fg: COLORS.success,
    border: '#B7DFC9',
  },
  acknowledged: {
    label: 'Acknowledged by Supervisor',
    bg: COLORS.primarySoft,
    fg: COLORS.primary,
    border: '#B7DFC9',
  },
  in_progress: {
    label: 'In Progress',
    bg: COLORS.warningSoft,
    fg: COLORS.warning,
    border: '#F5D69B',
  },
  resolved: {
    label: 'Resolved',
    bg: COLORS.primarySoft,
    fg: COLORS.primary,
    border: '#B7DFC9',
  },
  closed: {
    label: 'Closed',
    bg: COLORS.surfaceMuted,
    fg: COLORS.navy,
    border: COLORS.border,
  },
};

export const SEVERITY_META: Record<
  IncidentSeverity,
  { label: string; bg: string; fg: string }
> = {
  low: { label: 'Low', bg: COLORS.surfaceMuted, fg: COLORS.navy },
  medium: { label: 'Medium', bg: COLORS.warningSoft, fg: COLORS.warning },
  high: { label: 'High', bg: COLORS.dangerSoft, fg: COLORS.danger },
  critical: { label: 'Critical', bg: COLORS.danger, fg: COLORS.white },
};

export function formatTimestamp(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-ZW', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ============================================================================
 * 1. AppHeader
 * ========================================================================== */
export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  isOnline: boolean;
  pendingCount?: number;
  onBack?: () => void;
  onPressSyncBadge?: () => void;
  onSignOut?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  title,
  subtitle,
  isOnline,
  pendingCount = 0,
  onBack,
  onPressSyncBadge,
  onSignOut,
}) => {
  return (
    <View style={styles.headerContainer}>
      <View style={styles.headerTopRow}>
        <View style={styles.headerLeft}>
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              style={({ pressed }) => [
                styles.iconHitTarget,
                pressed && styles.pressedOpacity,
              ]}
            >
              <Text style={styles.backArrowText}>←</Text>
            </Pressable>
          ) : (
            <View style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>BG</Text>
            </View>
          )}
          <View style={styles.headerTitleBlock}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={styles.headerSubtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.headerRight}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isOnline ? 'Connection online' : 'Connection offline'
            }
            disabled={!onPressSyncBadge}
            onPress={onPressSyncBadge}
            style={[
              styles.connectivityPill,
              isOnline ? styles.connectivityOnline : styles.connectivityOffline,
            ]}
          >
            <View
              style={[
                styles.connectivityDot,
                { backgroundColor: isOnline ? COLORS.success : COLORS.offline },
              ]}
            />
            <Text
              style={[
                styles.connectivityText,
                { color: isOnline ? COLORS.success : COLORS.offline },
              ]}
            >
              {isOnline ? 'Online' : 'Offline'}
              {pendingCount > 0 ? ` · ${pendingCount}` : ''}
            </Text>
          </Pressable>

          {onSignOut ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              onPress={onSignOut}
              style={({ pressed }) => [
                styles.signOutButton,
                pressed && styles.pressedOpacity,
              ]}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
};

/* ============================================================================
 * 2. StatusChip & SeverityBadge
 * ========================================================================== */
export interface StatusChipProps {
  status: DeliveryStatus;
}

export const StatusChip: React.FC<StatusChipProps> = ({ status }) => {
  const meta = DELIVERY_META[status] ?? DELIVERY_META.queued;
  return (
    <View
      style={[
        styles.chip,
        { backgroundColor: meta.bg, borderColor: meta.border },
      ]}
    >
      <Text style={[styles.chipText, { color: meta.fg }]}>{meta.label}</Text>
    </View>
  );
};

export interface SeverityBadgeProps {
  severity: IncidentSeverity;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => {
  const meta = SEVERITY_META[severity] ?? SEVERITY_META.low;
  return (
    <View style={[styles.severityBadge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.severityBadgeText, { color: meta.fg }]}>
        {meta.label} Severity
      </Text>
    </View>
  );
};

/* ============================================================================
 * 3. EmergencyEscalationBanner
 * ========================================================================== */
export interface EmergencyBannerProps {
  message?: string;
}

export const EmergencyEscalationBanner: React.FC<EmergencyBannerProps> = ({
  message = 'Use approved emergency telephone/radio procedures. In-app submission does not dispatch assistance.',
}) => {
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.bannerBase,
        {
          backgroundColor: COLORS.dangerSoft,
          borderColor: COLORS.danger,
        },
      ]}
    >
      <Text style={[styles.bannerTitle, { color: COLORS.danger }]}>
        Emergency Escalation Reminder
      </Text>
      <Text style={[styles.bannerBody, { color: COLORS.text }]}>{message}</Text>
    </View>
  );
};

/* ============================================================================
 * 4. InfoAlertBanner
 * ========================================================================== */
export interface InfoAlertBannerProps {
  tone?: 'offline' | 'success' | 'warning' | 'danger' | 'neutral';
  title: string;
  body: string;
  actionLabel?: string;
  onActionPress?: () => void;
}

export const InfoAlertBanner: React.FC<InfoAlertBannerProps> = ({
  tone = 'neutral',
  title,
  body,
  actionLabel,
  onActionPress,
}) => {
  const palette = {
    offline: { bg: COLORS.offlineSoft, border: COLORS.offline, fg: COLORS.offline },
    success: { bg: COLORS.successSoft, border: COLORS.success, fg: COLORS.success },
    warning: { bg: COLORS.warningSoft, border: COLORS.warning, fg: COLORS.warning },
    danger: { bg: COLORS.dangerSoft, border: COLORS.danger, fg: COLORS.danger },
    neutral: { bg: COLORS.surfaceMuted, border: COLORS.border, fg: COLORS.navy },
  }[tone];

  return (
    <View
      style={[
        styles.bannerBase,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.bannerTitle, { color: palette.fg }]}>{title}</Text>
      <Text style={styles.bannerBody}>{body}</Text>
      {actionLabel && onActionPress ? (
        <Pressable
          accessibilityRole="button"
          onPress={onActionPress}
          style={({ pressed }) => [
            styles.bannerActionBtn,
            { borderColor: palette.fg },
            pressed && styles.pressedOpacity,
          ]}
        >
          <Text style={[styles.bannerActionText, { color: palette.fg }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

/* ============================================================================
 * 5. SurfaceCard
 * ========================================================================== */
export interface SurfaceCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

export const SurfaceCard: React.FC<SurfaceCardProps> = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

/* ============================================================================
 * 6. SmartButton (48px minimum touch target)
 * ========================================================================== */
export interface SmartButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export const SmartButton: React.FC<SmartButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
}) => {
  const isDisabled = disabled || loading;

  const containerVariantStyle: ViewStyle =
    variant === 'primary'
      ? { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
      : variant === 'secondary'
      ? { backgroundColor: COLORS.surface, borderColor: COLORS.primary }
      : variant === 'danger'
      ? { backgroundColor: COLORS.danger, borderColor: COLORS.danger }
      : { backgroundColor: 'transparent', borderColor: 'transparent' };

  const textVariantStyle: TextStyle =
    variant === 'primary' || variant === 'danger'
      ? { color: COLORS.white }
      : variant === 'secondary'
      ? { color: COLORS.primary }
      : { color: COLORS.textMuted };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buttonBase,
        containerVariantStyle,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.pressedOpacity,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={
            variant === 'primary' || variant === 'danger'
              ? COLORS.white
              : COLORS.primary
          }
        />
      ) : null}
      <Text style={[styles.buttonText, textVariantStyle]}>{label}</Text>
    </Pressable>
  );
};

/* ============================================================================
 * 7. FormField & PillSelector
 * ========================================================================== */
export interface FormFieldProps {
  label: string;
  required?: boolean;
  helperText?: string;
  errorText?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  maxLength?: number;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required,
  helperText,
  errorText,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  editable = true,
  maxLength,
}) => {
  return (
    <View style={styles.fieldContainer}>
      <View style={styles.fieldHeaderRow}>
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>
        {helperText ? (
          <Text style={styles.fieldHelper}>{helperText}</Text>
        ) : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.textMuted}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        maxLength={maxLength}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[
          styles.textInput,
          multiline && styles.textArea,
          !editable && styles.inputReadOnly,
          errorText ? styles.inputError : null,
        ]}
      />
      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
    </View>
  );
};

export interface OptionItem<T extends string> {
  value: T;
  label: string;
}

export interface OptionPillGroupProps<T extends string> {
  label: string;
  required?: boolean;
  options: OptionItem<T>[];
  selectedValue: T | '';
  onSelect: (value: T) => void;
  errorText?: string;
  columns?: 1 | 2;
}

export function OptionPillGroup<T extends string>({
  label,
  required,
  options,
  selectedValue,
  onSelect,
  errorText,
  columns = 2,
}: OptionPillGroupProps<T>) {
  return (
    <View style={styles.fieldContainer}>
      <View style={styles.fieldHeaderRow}>
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>
      </View>
      <View style={styles.pillGrid}>
        {options.map((opt) => {
          const selected = selectedValue === opt.value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onSelect(opt.value)}
              style={({ pressed }) => [
                styles.optionPill,
                columns === 1 ? styles.optionPillFull : styles.optionPillHalf,
                selected && styles.optionPillSelected,
                pressed && styles.pressedOpacity,
              ]}
            >
              <Text
                style={[
                  styles.optionPillText,
                  selected && styles.optionPillTextSelected,
                ]}
              >
                {opt.label}
              </Text>
              <Text
                style={[
                  styles.optionCheckMark,
                  selected && styles.optionPillTextSelected,
                ]}
              >
                {selected ? '●' : '○'}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
    </View>
  );
}

/* ============================================================================
 * 8. EmptyOrErrorState
 * ========================================================================== */
export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyStateCard: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
}) => (
  <SurfaceCard style={styles.emptyCard}>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyDescription}>{description}</Text>
    {actionLabel && onAction ? (
      <SmartButton
        label={actionLabel}
        onPress={onAction}
        variant="secondary"
        style={styles.emptyButton}
      />
    ) : null}
  </SurfaceCard>
);

/* ============================================================================
 * 9. BottomNavBar (4-Tab Guard Layout per NAVIGATION_MAP.md)
 * ========================================================================== */
export interface BottomNavBarProps {
  activeTab: GuardTabKey;
  onSelectTab: (tab: GuardTabKey) => void;
  unsyncedCount?: number;
}

const GUARD_TABS: { key: GuardTabKey; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; activeIcon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'today', label: 'Today', icon: 'home-outline', activeIcon: 'home' },
  { key: 'ob', label: 'Occurrence Book', icon: 'document-text-outline', activeIcon: 'document-text' },
  { key: 'incidents', label: 'Incidents', icon: 'shield-outline', activeIcon: 'shield' },
  { key: 'handover', label: 'Handover', icon: 'swap-horizontal-outline', activeIcon: 'swap-horizontal' },
];

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeTab,
  onSelectTab,
  unsyncedCount = 0,
}) => {
  return (
    <View style={styles.bottomNav}>
      {GUARD_TABS.map((tab) => {
        const isActive = activeTab === tab.key;
        const showBadge = tab.key === 'incidents' && unsyncedCount > 0;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            onPress={() => onSelectTab(tab.key)}
            style={({ pressed }) => [
              styles.bottomTabButton,
              isActive && styles.bottomTabActive,
              pressed && styles.pressedOpacity,
            ]}
          >
            <View style={styles.bottomTabIconRow}>
              <Ionicons name={isActive ? tab.activeIcon : tab.icon} size={22} color={isActive ? COLORS.primary : COLORS.textMuted}/>
              {showBadge ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{unsyncedCount}</Text>
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.bottomTabLabel,
                isActive && styles.bottomTabLabelActive,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  iconHitTarget: {
    minWidth: 48,
    minHeight: 48,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrowText: {
    fontSize: 20,
    fontFamily: FONTS.bold,
    color: COLORS.text,
  },
  brandBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadgeText: {
    color: COLORS.white,
    fontSize: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 17,
    lineHeight: 22,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
  },
  headerSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectivityPill: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectivityOnline: {
    backgroundColor: COLORS.successSoft,
  },
  connectivityOffline: {
    backgroundColor: COLORS.offlineSoft,
  },
  connectivityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  connectivityText: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  signOutButton: {
    minHeight: 40,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  signOutText: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  chipText: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  severityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  severityBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  bannerBase: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 14,
  },
  bannerTitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    marginBottom: 4,
  },
  bannerBody: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.text,
  },
  bannerActionBtn: {
    marginTop: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  bannerActionText: {
    fontSize: 13,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginBottom: 14,
  },
  buttonBase: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    textAlign: 'center',
  },
  pressedOpacity: {
    opacity: 0.82,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  fieldLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.medium,
    fontWeight: '600',
    color: COLORS.text,
  },
  requiredMark: {
    color: COLORS.danger,
  },
  fieldHelper: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontFamily: FONTS.regular,
  },
  textInput: {
    minHeight: 48,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.text,
    fontFamily: FONTS.regular,
  },
  textArea: {
    minHeight: 128,
    paddingTop: 12,
  },
  inputReadOnly: {
    backgroundColor: COLORS.surfaceMuted,
    color: COLORS.textMuted,
  },
  inputError: {
    borderColor: COLORS.danger,
  },
  errorText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.danger,
    fontFamily: FONTS.medium,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionPill: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionPillHalf: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  optionPillFull: {
    width: '100%',
  },
  optionPillSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  optionPillText: {
    fontSize: 14,
    lineHeight: 18,
    color: COLORS.text,
    fontFamily: FONTS.medium,
    fontWeight: '600',
    flex: 1,
    paddingRight: 6,
  },
  optionPillTextSelected: {
    color: COLORS.white,
  },
  optionCheckMark: {
    fontSize: 14,
    color: COLORS.textMuted,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  emptyButton: {
    marginTop: 14,
    alignSelf: 'stretch',
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  bottomTabButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  bottomTabActive: {
    backgroundColor: COLORS.primarySoft,
  },
  bottomTabIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomTabIcon: {
    fontSize: 18,
  },
  tabBadge: {
    marginLeft: 4,
    backgroundColor: COLORS.offline,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  bottomTabLabel: {
    fontSize: 11,
    lineHeight: 15,
    color: COLORS.textMuted,
    fontFamily: FONTS.medium,
    marginTop: 2,
  },
  bottomTabLabelActive: {
    color: COLORS.primary,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
});