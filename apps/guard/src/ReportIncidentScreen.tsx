import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { EmergencyEscalationBanner, ScreenHeader } from './components';

/**
 * Exact Stitch Tailwind Config Tokens from report_incident/code.html
 */
const STITCH = {
  primary: '#075638',
  primaryHover: '#113F36',
  primarySoft: '#E7F2EE',
  navy: '#152836',
  background: '#F6F8F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF2F4',
  surfaceContainer: '#E1F0FB',
  surfaceDim: '#CDDCE7',
  text: '#17252D',
  textMuted: '#556771',
  border: '#D9E2E6',
  danger: '#B43732',
  dangerSoft: '#FCEAE7',
  offline: '#73549B',
  offlineSoft: '#F0EAF8',
  warning: '#9D620A',
  warningSoft: '#FFF3D6',
  success: '#1B7C55',
  focus: '#246FA8',
  white: '#FFFFFF',
} as const;

const FONTS = {
  regular: Platform.select({ android: 'NotoSans-Regular', default: 'System' }),
  semibold: Platform.select({ android: 'NotoSans-SemiBold', default: 'System' }),
  bold: Platform.select({ android: 'NotoSans-Bold', default: 'System' }),
  mono: Platform.select({ android: 'monospace', default: 'Courier' }),
} as const;

export type IncidentCategoryValue =
  | 'trespass'
  | 'equipment'
  | 'theft'
  | 'fire'
  | 'violence'
  | 'medical'
  | 'other';

export type IncidentSeverityValue = 'low' | 'medium' | 'high' | 'critical';

interface StitchIncidentTypeRow {
  uiKey: string;
  schemaCategory: IncidentCategoryValue;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

/**
 * Exact 5 rows from Stitch HTML + right-side Material icons,
 * mapped cleanly to supabase/schema.sql CHECK constraint values.
 */
const STITCH_INCIDENT_TYPES: StitchIncidentTypeRow[] = [
  {
    uiKey: 'breach',
    schemaCategory: 'trespass',
    label: 'Breach / Intrusion',
    icon: 'sensor-occupied',
  },
  {
    uiKey: 'property_damage',
    schemaCategory: 'equipment',
    label: 'Property Damage / Tamper',
    icon: 'lock-reset',
  },
  {
    uiKey: 'theft',
    schemaCategory: 'theft',
    label: 'Theft / Loss',
    icon: 'inventory',
  },
  {
    uiKey: 'fire_hazard',
    schemaCategory: 'fire',
    label: 'Fire / Safety Hazard',
    icon: 'local-fire-department',
  },
  {
    uiKey: 'suspicious_person',
    schemaCategory: 'other',
    label: 'Suspicious Person / Vehicle',
    icon: 'directions-car',
  },
];

interface StitchImmediateActionRow {
  id: string;
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
}

const STITCH_ACTIONS_CHECKLIST: StitchImmediateActionRow[] = [
  {
    id: 'padlock',
    label: 'Padlock checked & re-secured',
    icon: 'lock',
  },
  {
    id: 'radio_partner',
    label: 'Guard partner notified via radio',
    icon: 'record-voice-over',
  },
  {
    id: 'perimeter',
    label: 'Perimeter swept & clear',
    icon: 'fence',
  },
];

export interface IncidentFormSubmitPayload {
  category: IncidentCategoryValue;
  incidentTypeLabel?: string;
  severity: IncidentSeverityValue;
  eventAt: string;
  description: string;
  actionsTaken?: string;
  witnesses?: string;
}

export interface ReportIncidentScreenProps {
  siteName?: string;
  shiftContext?: {
    siteName?: string;
    startedAt?: string;
  } | null;
  shiftStartedAt?: string;
  isOnline?: boolean;
  pendingCount?: number;
  initialEventAt?: string;
  isSubmitting?: boolean;
  storageError?: string | null;
  errorMessage?: string | null;
  onSubmitIncident?: (
    payload: IncidentFormSubmitPayload
  ) => void | Promise<void>;
  onSubmit?: (payload: IncidentFormSubmitPayload) => void | Promise<void>;
  onCancel?: () => void;
  onBack?: () => void;
  onOpenSyncQueue?: () => void;
}

function formatCatClock(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} CAT`;
}

function resolveEventIsoFromInput(
  rawInput: string,
  baseDate: Date
): { valid: boolean; iso?: string; ms?: number } {
  const trimmed = rawInput.trim().replace(/\s*CAT$/i, '').trim();

  // Case 1: "HH:mm" (Stitch format e.g. "13:10 CAT")
  const shortTimeMatch = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (shortTimeMatch) {
    const hours = Number(shortTimeMatch[1]);
    const minutes = Number(shortTimeMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      const candidate = new Date(baseDate);
      candidate.setHours(hours, minutes, 0, 0);
      return {
        valid: true,
        iso: candidate.toISOString(),
        ms: candidate.getTime(),
      };
    }
    return { valid: false };
  }

  // Case 2: Full ISO or "YYYY-MM-DD HH:mm"
  const normalized = trimmed.includes('T')
    ? trimmed
    : trimmed.replace(' ', 'T');
  const parsedMs = Date.parse(normalized);
  if (!Number.isNaN(parsedMs)) {
    return {
      valid: true,
      iso: new Date(parsedMs).toISOString(),
      ms: parsedMs,
    };
  }

  return { valid: false };
}

export const ReportIncidentScreen: React.FC<ReportIncidentScreenProps> = ({
  siteName,
  shiftContext,
  shiftStartedAt,
  isOnline = false,
  pendingCount = 0,
  initialEventAt,
  isSubmitting = false,
  storageError = null,
  errorMessage = null,
  onSubmitIncident,
  onSubmit,
  onCancel,
  onBack,
  onOpenSyncQueue,
}) => {
  const resolvedSiteName =
    siteName || shiftContext?.siteName || 'Training Site Alpha (Fictional)';
  const resolvedShiftStart = shiftStartedAt || shiftContext?.startedAt;
  const resolvedError = storageError || errorMessage;

  const [baseDate] = useState<Date>(() =>
    initialEventAt ? new Date(initialEventAt) : new Date()
  );
  const [selectedUiKey, setSelectedUiKey] = useState<string>('breach');
  const [severity, setSeverity] = useState<IncidentSeverityValue>('high');
  const [eventTimeText, setEventTimeText] = useState<string>(() =>
    formatCatClock(initialEventAt ? new Date(initialEventAt) : new Date())
  );
  const [clockFlash, setClockFlash] = useState<boolean>(false);

  const [narrative, setNarrative] = useState<string>('');
  const [checkedActions, setCheckedActions] = useState<Record<string, boolean>>({
    padlock: true,
    radio_partner: true,
    perimeter: false,
  });
  const [witnessField, setWitnessField] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitLock, setSubmitLock] = useState<boolean>(false);

  const narrativeLen = narrative.trim().length;
  const isNarrativeValid = narrativeLen >= 20;

  const severityIndicatorMeta = useMemo(() => {
    if (severity === 'high' || severity === 'critical') {
      return {
        label: 'High Escalation',
        bg: STITCH.dangerSoft,
        fg: STITCH.danger,
      };
    }
    if (severity === 'medium') {
      return {
        label: 'Medium Priority',
        bg: STITCH.warningSoft,
        fg: STITCH.warning,
      };
    }
    return {
      label: 'Low Advisory',
      bg: STITCH.surfaceMuted,
      fg: STITCH.textMuted,
    };
  }, [severity]);

  const handleBackOrCancel = () => {
    const fn = onCancel || onBack;
    if (!fn) return;
    fn();
  };

  const handleConfirmDiscard = () => {
    if (narrative.trim().length === 0 && witnessField.trim().length === 0) {
      handleBackOrCancel();
      return;
    }
    Alert.alert(
      'Discard this local draft?',
      'Unsaved field notes will be deleted.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Discard Draft',
          style: 'destructive',
          onPress: () => {
            setNarrative('');
            setWitnessField('');
            handleBackOrCancel();
          },
        },
      ]
    );
  };

  const handleRefreshClock = () => {
    const now = new Date();
    setEventTimeText(formatCatClock(now));
    if (fieldErrors.eventAt) {
      setFieldErrors((prev) => ({ ...prev, eventAt: '' }));
    }
    setClockFlash(true);
    setTimeout(() => setClockFlash(false), 600);
  };

  const toggleChecklist = (id: string) => {
    setCheckedActions((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSavePress = async () => {
    if (isSubmitting || submitLock) return;

    const nextErrors: Record<string, string> = {};
    const chosenType = STITCH_INCIDENT_TYPES.find(
      (t) => t.uiKey === selectedUiKey
    );

    if (!chosenType) {
      nextErrors.category = 'Select an incident type.';
    }

    if (narrativeLen < 20) {
      nextErrors.description =
        'Baseguard Standard: minimum 20 characters of objective record required.';
    } else if (narrativeLen > 3000) {
      nextErrors.description = 'Narrative must not exceed 3000 characters.';
    }

    const parsedTime = resolveEventIsoFromInput(eventTimeText, baseDate);
    if (!parsedTime.valid || !parsedTime.iso || !parsedTime.ms) {
      nextErrors.eventAt =
        'Enter a valid time (e.g. 13:10 CAT or YYYY-MM-DD HH:mm).';
    } else {
      const nowMs = Date.now();
      if (parsedTime.ms > nowMs + 5 * 60 * 1000) {
        nextErrors.eventAt =
          'Incident time cannot be more than 5 minutes in the future.';
      } else if (parsedTime.ms < nowMs - 7 * 24 * 60 * 60 * 1000) {
        nextErrors.eventAt = 'Incident time must be within the last 7 days.';
      } else if (resolvedShiftStart) {
        const shiftStartMs = Date.parse(resolvedShiftStart);
        if (!Number.isNaN(shiftStartMs) && parsedTime.ms < shiftStartMs) {
          nextErrors.eventAt =
            'Incident time cannot be earlier than shift start.';
        }
      }
    }

    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !chosenType || !parsedTime.iso) {
      return;
    }

    const selectedActionLabels = STITCH_ACTIONS_CHECKLIST.filter(
      (a) => checkedActions[a.id]
    ).map((a) => a.label);

    const witnessClean = witnessField.trim();
    const combinedActions = [
      selectedActionLabels.join('; '),
      witnessClean ? `Witnesses: ${witnessClean}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const payload: IncidentFormSubmitPayload = {
      category: chosenType.schemaCategory,
      incidentTypeLabel: chosenType.label,
      severity,
      eventAt: parsedTime.iso,
      description: narrative.trim(),
      actionsTaken: combinedActions || undefined,
      witnesses: witnessClean || undefined,
    };

    const submitCallback = onSubmitIncident || onSubmit;
    if (!submitCallback) return;

    setSubmitLock(true);
    try {
      await submitCallback(payload);
    } finally {
      setSubmitLock(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader
        title="Report Incident"
        subtitle={resolvedSiteName}
        onBack={handleConfirmDiscard}
        rightAction={<Pressable
          accessibilityRole="button"
          accessibilityLabel={isOnline ? `${pendingCount} queued reports, online` : `${pendingCount} queued reports, offline`}
          disabled={!onOpenSyncQueue}
          onPress={onOpenSyncQueue}
          style={styles.headerQueueButton}
        >
          <MaterialIcons name={isOnline ? 'cloud-done' : 'cloud-off'} size={21} color={STITCH.white}/>
          {pendingCount>0?<View style={styles.headerQueueBadge}><Text style={styles.headerQueueBadgeText}>{pendingCount}</Text></View>:null}
        </Pressable>}
      />

      {/* MAIN SCROLLABLE FORM */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Operational Context Bar */}
        <View style={styles.contextBarCard}>
          <View style={styles.contextBarLeft}>
            <View style={styles.domainIconWrap}>
              <MaterialIcons
                name="domain"
                size={20}
                color={STITCH.textMuted}
              />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.contextOverline}>FACILITY CONTEXT</Text>
              <Text numberOfLines={1} style={styles.contextSiteTitle}>
                {resolvedSiteName}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.contextRightPill,
              isOnline ? styles.onlineSoftBg : styles.offlineSoftBg,
            ]}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: isOnline ? STITCH.success : STITCH.offline },
              ]}
            />
            <Text
              style={[
                styles.contextRightPillText,
                { color: isOnline ? STITCH.success : STITCH.offline },
              ]}
            >
              {isOnline ? 'Online (Outbox Ready)' : 'Offline (Queued Locally)'}
            </Text>
          </View>
        </View>

        {/* 2. Emergency reporting reminder; this form does not dispatch assistance. */}
        <EmergencyEscalationBanner />

        {resolvedError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{resolvedError}</Text>
          </View>
        ) : null}

        {/* 3. Incident Classification & Severity Card */}
        <View style={styles.surfaceCard}>
          {/* Incident Type */}
          <View>
            <View style={styles.sectionTitleRow}>
              <View style={styles.labelWithIcon}>
                <MaterialIcons
                  name="category"
                  size={18}
                  color={STITCH.primary}
                />
                <Text style={styles.sectionLabelText}>Incident Type</Text>
              </View>
              <Text style={styles.requiredTag}>*Required</Text>
            </View>

            <View style={styles.typeRadioGroup}>
              {STITCH_INCIDENT_TYPES.map((item) => {
                const checked = selectedUiKey === item.uiKey;
                return (
                  <Pressable
                    key={item.uiKey}
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    onPress={() => setSelectedUiKey(item.uiKey)}
                    style={[
                      styles.typeRadioRow,
                      checked && styles.typeRadioRowChecked,
                    ]}
                  >
                    <View
                      style={[
                        styles.radioOuterCircle,
                        checked && styles.radioOuterCircleChecked,
                      ]}
                    >
                      {checked ? (
                        <View style={styles.radioInnerDot} />
                      ) : null}
                    </View>

                    <Text
                      style={[
                        styles.typeRadioLabel,
                        checked && styles.typeRadioLabelChecked,
                      ]}
                    >
                      {item.label}
                    </Text>

                    <MaterialIcons
                      name={item.icon}
                      size={20}
                      color={checked ? STITCH.primary : STITCH.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
            {fieldErrors.category ? (
              <Text style={styles.validationErrorText}>
                {fieldErrors.category}
              </Text>
            ) : null}
          </View>

          {/* Severity Level Selector (3-Column Stitch Layout) */}
          <View style={styles.severityBlock}>
            <View style={styles.sectionTitleRow}>
              <View style={styles.labelWithIcon}>
                <MaterialIcons
                  name="priority-high"
                  size={18}
                  color={STITCH.primary}
                />
                <Text style={styles.sectionLabelText}>Severity Level</Text>
              </View>

              <View
                style={[
                  styles.severityIndicatorPill,
                  { backgroundColor: severityIndicatorMeta.bg },
                ]}
              >
                <Text
                  style={[
                    styles.severityIndicatorText,
                    { color: severityIndicatorMeta.fg },
                  ]}
                >
                  {severityIndicatorMeta.label}
                </Text>
              </View>
            </View>

            <View style={styles.severityGrid3}>
              {/* High */}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: severity === 'high' }}
                onPress={() => setSeverity('high')}
                style={[
                  styles.severityCell,
                  severity === 'high'
                    ? { backgroundColor: STITCH.danger }
                    : { backgroundColor: STITCH.dangerSoft },
                ]}
              >
                <Text
                  style={[
                    styles.severityCellTitle,
                    {
                      color:
                        severity === 'high' ? STITCH.white : STITCH.danger,
                    },
                  ]}
                >
                  High
                </Text>
                <Text
                  style={[
                    styles.severityCellSub,
                    {
                      color:
                        severity === 'high' ? STITCH.white : STITCH.danger,
                    },
                  ]}
                >
                  Danger
                </Text>
              </Pressable>

              {/* Medium */}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: severity === 'medium' }}
                onPress={() => setSeverity('medium')}
                style={[
                  styles.severityCell,
                  severity === 'medium'
                    ? { backgroundColor: STITCH.warning }
                    : { backgroundColor: STITCH.warningSoft },
                ]}
              >
                <Text
                  style={[
                    styles.severityCellTitle,
                    {
                      color:
                        severity === 'medium' ? STITCH.white : STITCH.warning,
                    },
                  ]}
                >
                  Medium
                </Text>
                <Text
                  style={[
                    styles.severityCellSub,
                    {
                      color:
                        severity === 'medium' ? STITCH.white : STITCH.warning,
                    },
                  ]}
                >
                  Warning
                </Text>
              </Pressable>

              {/* Low */}
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: severity === 'low' }}
                onPress={() => setSeverity('low')}
                style={[
                  styles.severityCell,
                  severity === 'low'
                    ? { backgroundColor: '#4E6170' }
                    : { backgroundColor: STITCH.surfaceMuted },
                ]}
              >
                <Text
                  style={[
                    styles.severityCellTitle,
                    {
                      color:
                        severity === 'low' ? STITCH.white : STITCH.textMuted,
                    },
                  ]}
                >
                  Low
                </Text>
                <Text
                  style={[
                    styles.severityCellSub,
                    {
                      color:
                        severity === 'low' ? STITCH.white : STITCH.textMuted,
                    },
                  ]}
                >
                  Advisory
                </Text>
              </Pressable>
            </View>
          </View>
        </View>

        {/* 4. Event Timestamp & Time Adjustment */}
        <View style={styles.surfaceCard}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.labelWithIcon}>
              <MaterialIcons
                name="schedule"
                size={18}
                color={STITCH.primary}
              />
              <Text style={styles.sectionLabelText}>Time of Incident</Text>
            </View>
            <View style={styles.autoRecordedPill}>
              <Text style={styles.autoRecordedPillText}>Auto-recorded</Text>
            </View>
          </View>

          <View style={styles.timeRow}>
            <View
              style={[
                styles.timeInputContainer,
                clockFlash && { backgroundColor: STITCH.primarySoft },
              ]}
            >
              <TextInput
                accessibilityLabel="Editable event time"
                value={eventTimeText}
                onChangeText={(txt) => {
                  setEventTimeText(txt);
                  if (fieldErrors.eventAt) {
                    setFieldErrors((prev) => ({ ...prev, eventAt: '' }));
                  }
                }}
                style={styles.timeInputField}
                placeholder="13:10 CAT"
                placeholderTextColor={STITCH.textMuted}
              />
              <MaterialIcons name="edit" size={20} color={STITCH.textMuted} />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reset to device clock"
              onPress={handleRefreshClock}
              style={({ pressed }) => [
                styles.syncButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons name="update" size={18} color={STITCH.text} />
              <Text style={styles.syncButtonText}>Sync</Text>
            </Pressable>
          </View>

          {fieldErrors.eventAt ? (
            <Text style={styles.validationErrorText}>
              {fieldErrors.eventAt}
            </Text>
          ) : null}

          <Text style={styles.captionNote}>
            Device logged {eventTimeText}. Edit if entering retroactively
            following containment.
          </Text>
        </View>

        {/* 5. Factual Occurrence Narrative */}
        <View style={styles.surfaceCard}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.labelWithIcon}>
              <MaterialIcons
                name="description"
                size={18}
                color={STITCH.primary}
              />
              <Text style={styles.sectionLabelText}>
                Factual Occurrence Narrative
              </Text>
            </View>
            <Text
              style={[
                styles.charCounter,
                isNarrativeValid && styles.charCounterSuccess,
              ]}
            >
              {narrativeLen} / 20 min
            </Text>
          </View>

          <View style={styles.textareaContainer}>
            <TextInput
              accessibilityLabel="Factual Occurrence Narrative"
              value={narrative}
              onChangeText={(txt) => {
                setNarrative(txt);
                if (fieldErrors.description) {
                  setFieldErrors((prev) => ({ ...prev, description: '' }));
                }
              }}
              multiline
              textAlignVertical="top"
              placeholder="Describe exact observations factually. Avoid speculation. Include physical details, point of origin, and sequence of events..."
              placeholderTextColor={STITCH.textMuted}
              style={styles.textareaInput}
            />

            {isNarrativeValid ? (
              <View style={styles.validNarrativeBadge}>
                <MaterialIcons name="check" size={14} color={STITCH.white} />
                <Text style={styles.validNarrativeBadgeText}>
                  Valid Narrative
                </Text>
              </View>
            ) : null}
          </View>

          {fieldErrors.description ? (
            <Text style={styles.validationErrorText}>
              {fieldErrors.description}
            </Text>
          ) : null}

          <View style={styles.infoNoteRow}>
            <MaterialIcons name="info" size={16} color={STITCH.warning} />
            <Text style={styles.captionNote}>
              Baseguard Standard: minimum 20 characters of objective record
              required.
            </Text>
          </View>
        </View>

        {/* 6. Immediate Actions Taken Checklist */}
        <View style={styles.surfaceCard}>
          <View style={[styles.labelWithIcon, { marginBottom: 12 }]}>
            <MaterialIcons
              name="fact-check"
              size={18}
              color={STITCH.primary}
            />
            <Text style={styles.sectionLabelText}>Immediate Actions Taken</Text>
          </View>

          <View style={styles.typeRadioGroup}>
            {STITCH_ACTIONS_CHECKLIST.map((item) => {
              const checked = Boolean(checkedActions[item.id]);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  onPress={() => toggleChecklist(item.id)}
                  style={[
                    styles.typeRadioRow,
                    checked && styles.typeRadioRowChecked,
                  ]}
                >
                  <View
                    style={[
                      styles.checkboxSquare,
                      checked && styles.checkboxSquareChecked,
                    ]}
                  >
                    {checked ? (
                      <MaterialIcons
                        name="check"
                        size={15}
                        color={STITCH.white}
                      />
                    ) : null}
                  </View>

                  <Text style={styles.typeRadioLabel}>{item.label}</Text>

                  <MaterialIcons
                    name={item.icon}
                    size={20}
                    color={checked ? STITCH.primary : STITCH.textMuted}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 7. Witnesses / Persons Present */}
        <View style={styles.surfaceCard}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.labelWithIcon}>
              <MaterialIcons name="group" size={18} color={STITCH.primary} />
              <Text style={styles.sectionLabelText}>
                Witnesses / Persons Present
              </Text>
            </View>
            <Text style={styles.optionalTag}>Optional</Text>
          </View>

          <TextInput
            accessibilityLabel="Witnesses or persons present"
            value={witnessField}
            onChangeText={setWitnessField}
            placeholder="e.g., Gate Guard 02, Delivery Driver (Fleet A)"
            placeholderTextColor={STITCH.textMuted}
            style={styles.singleLineInput}
          />

          <Text style={[styles.captionNote, { marginTop: 8 }]}>
            Compliance restriction: Do NOT record national ID, biometric data,
            or resident phone numbers in this field.
          </Text>
        </View>

        {/* 8. Evidence Capture Card */}
        <View style={styles.surfaceCard}>
          <View style={[styles.labelWithIcon, { marginBottom: 10 }]}>
            <MaterialIcons
              name="photo-camera"
              size={18}
              color={STITCH.primary}
            />
            <Text style={styles.sectionLabelText}>Evidence Capture</Text>
          </View>

          <View style={styles.cameraDisabledBox}>
            <View style={styles.noPhotoCircle}>
              <MaterialIcons
                name="no-photography"
                size={24}
                color={STITCH.textMuted}
              />
            </View>
            <Text style={styles.cameraInactiveHeading}>
              Camera Module Inactive
            </Text>
            <Text style={styles.cameraInactiveBody}>
              Photographic evidence attachment temporarily{' '}
              <Text style={styles.urgentBoldRed}>DISABLED</Text> pending
              Baseguard corporate camera policy approval.
            </Text>
          </View>
        </View>

        {/* 9. Reference Code & Sync Advisory */}
        <View style={styles.referenceAdvisoryCard}>
          <MaterialIcons name="cloud-off" size={22} color={STITCH.offline} />
          <View style={styles.flex1}>
            <Text style={styles.referenceAdvisoryTitle}>
              Local Temporary Reference
            </Text>
            <Text style={styles.referenceAdvisoryBody}>
              Unsynced incidents receive a durable local outbox UUID ({' '}
              <Text style={styles.referenceMono}>Pending Sync</Text> ). Official
              permanent reference is issued only upon confirmed server receipt.
            </Text>
          </View>
        </View>

        {/* 10. Sticky-Style Bottom Action Card */}
        <View style={styles.bottomActionsCard}>
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || submitLock}
            onPress={handleSavePress}
            style={({ pressed }) => [
              styles.savePrimaryBtn,
              (isSubmitting || submitLock) && styles.disabledBtn,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons name="save" size={20} color={STITCH.white} />
            <Text style={styles.savePrimaryBtnText}>
              {isSubmitting || submitLock
                ? 'Saving to SQLite Outbox...'
                : 'Save Incident on Phone (Queued)'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || submitLock}
            onPress={handleConfirmDiscard}
            style={({ pressed }) => [
              styles.discardGhostBtn,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons name="delete" size={18} color={STITCH.textMuted} />
            <Text style={styles.discardGhostBtnText}>Discard Draft</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: STITCH.background,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  headerQueueButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerQueueBadge: {
    position: 'absolute',
    right: 2,
    top: 5,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: STITCH.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerQueueBadgeText: {
    color: STITCH.white,
    fontFamily: FONTS.bold,
    fontSize: 9,
    lineHeight: 12,
  },
  offlineSoftBg: {
    backgroundColor: STITCH.offlineSoft,
  },
  onlineSoftBg: {
    backgroundColor: STITCH.primarySoft,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
    gap: 16,
  },
  contextBarCard: {
    backgroundColor: STITCH.surface,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    elevation: 1,
  },
  contextBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  domainIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: STITCH.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextOverline: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.regular,
    color: STITCH.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  contextSiteTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: STITCH.text,
  },
  contextRightPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  contextRightPillText: {
    fontSize: 11,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  urgentCard: {
    backgroundColor: STITCH.dangerSoft,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  urgentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urgentHeading: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: STITCH.danger,
    letterSpacing: 0.4,
  },
  urgentParagraph: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FONTS.regular,
    color: STITCH.text,
  },
  urgentBoldRed: {
    color: STITCH.danger,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  urgentRowsWrap: {
    marginTop: 4,
    gap: 6,
  },
  urgentInnerRow: {
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  urgentInnerLabel: {
    fontSize: 12,
    color: STITCH.textMuted,
    fontFamily: FONTS.regular,
  },
  urgentInnerValueRed: {
    fontSize: 12,
    color: STITCH.danger,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  urgentInnerValueDark: {
    fontSize: 12,
    color: STITCH.text,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: STITCH.dangerSoft,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: STITCH.danger,
  },
  errorBannerText: {
    color: STITCH.danger,
    fontSize: 13,
    fontFamily: FONTS.semibold,
  },
  surfaceCard: {
    backgroundColor: STITCH.surface,
    borderRadius: 12,
    padding: 18,
    elevation: 1,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  labelWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabelText: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
    color: STITCH.text,
  },
  requiredTag: {
    fontSize: 12,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
    color: STITCH.danger,
  },
  optionalTag: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: STITCH.textMuted,
  },
  typeRadioGroup: {
    gap: 6,
  },
  typeRadioRow: {
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: STITCH.surfaceMuted,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  typeRadioRowChecked: {
    backgroundColor: STITCH.primarySoft,
  },
  radioOuterCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: STITCH.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: STITCH.surface,
  },
  radioOuterCircleChecked: {
    borderColor: STITCH.primary,
  },
  radioInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: STITCH.primary,
  },
  typeRadioLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: STITCH.text,
    fontFamily: FONTS.regular,
  },
  typeRadioLabelChecked: {
    color: STITCH.primary,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  severityBlock: {
    marginTop: 20,
  },
  severityIndicatorPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  severityIndicatorText: {
    fontSize: 12,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  severityGrid3: {
    flexDirection: 'row',
    gap: 6,
  },
  severityCell: {
    flex: 1,
    minHeight: 54,
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityCellTitle: {
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  severityCellSub: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONTS.regular,
    opacity: 0.92,
  },
  autoRecordedPill: {
    backgroundColor: STITCH.surfaceMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  autoRecordedPillText: {
    fontSize: 12,
    color: STITCH.textMuted,
    fontFamily: FONTS.regular,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  timeInputContainer: {
    flex: 1,
    minHeight: 52,
    backgroundColor: STITCH.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeInputField: {
    flex: 1,
    fontSize: 16,
    color: STITCH.text,
    fontFamily: FONTS.regular,
  },
  syncButton: {
    minHeight: 52,
    paddingHorizontal: 14,
    backgroundColor: STITCH.surfaceContainer,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  syncButtonText: {
    fontSize: 14,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
    color: STITCH.text,
  },
  captionNote: {
    fontSize: 12,
    lineHeight: 17,
    color: STITCH.textMuted,
    fontFamily: FONTS.regular,
    flex: 1,
  },
  charCounter: {
    fontSize: 12,
    color: STITCH.textMuted,
    fontFamily: FONTS.regular,
  },
  charCounterSuccess: {
    color: STITCH.success,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  textareaContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  textareaInput: {
    minHeight: 116,
    backgroundColor: STITCH.surfaceMuted,
    borderRadius: 8,
    padding: 12,
    paddingBottom: 34,
    fontSize: 15,
    lineHeight: 22,
    color: STITCH.text,
    fontFamily: FONTS.regular,
  },
  validNarrativeBadge: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    backgroundColor: STITCH.success,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  validNarrativeBadgeText: {
    fontSize: 11,
    color: STITCH.white,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  infoNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  checkboxSquare: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: STITCH.textMuted,
    backgroundColor: STITCH.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSquareChecked: {
    backgroundColor: STITCH.primary,
    borderColor: STITCH.primary,
  },
  singleLineInput: {
    minHeight: 52,
    backgroundColor: STITCH.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    color: STITCH.text,
    fontFamily: FONTS.regular,
  },
  cameraDisabledBox: {
    backgroundColor: STITCH.surfaceMuted,
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
  },
  noPhotoCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: STITCH.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  cameraInactiveHeading: {
    fontSize: 14,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
    color: STITCH.text,
    marginBottom: 4,
  },
  cameraInactiveBody: {
    fontSize: 12,
    lineHeight: 18,
    color: STITCH.textMuted,
    textAlign: 'center',
    maxWidth: 280,
    fontFamily: FONTS.regular,
  },
  referenceAdvisoryCard: {
    backgroundColor: STITCH.offlineSoft,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  referenceAdvisoryTitle: {
    fontSize: 14,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
    color: STITCH.offline,
    marginBottom: 2,
  },
  referenceAdvisoryBody: {
    fontSize: 12,
    lineHeight: 17,
    color: STITCH.text,
    fontFamily: FONTS.regular,
  },
  referenceMono: {
    fontFamily: FONTS.mono,
    fontWeight: '700',
    color: STITCH.offline,
  },
  bottomActionsCard: {
    backgroundColor: STITCH.surface,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    elevation: 3,
  },
  savePrimaryBtn: {
    minHeight: 52,
    backgroundColor: STITCH.primary,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  savePrimaryBtnText: {
    color: STITCH.white,
    fontSize: 14,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  discardGhostBtn: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  discardGhostBtnText: {
    color: STITCH.text,
    fontSize: 14,
    fontFamily: FONTS.semibold,
    fontWeight: '600',
  },
  validationErrorText: {
    marginTop: 6,
    fontSize: 12,
    color: STITCH.danger,
    fontFamily: FONTS.semibold,
  },
  disabledBtn: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
});

export default ReportIncidentScreen;
