import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AppHeader,
  COLORS,
  EmergencyEscalationBanner,
  FONTS,
  FormField,
  IncidentSeverity,
  InfoAlertBanner,
  OptionItem,
  OptionPillGroup,
  SmartButton,
  SurfaceCard,
} from './components';
import {parseLocalDateTime} from './incident-domain';

/**
 * Exact PostgreSQL CHECK constraint values from supabase/schema.sql:
 * category in ('theft','trespass','violence','fire','medical','equipment','other')
 * severity in ('low','medium','high','critical')
 */
export type IncidentCategoryValue =
  | 'theft'
  | 'trespass'
  | 'violence'
  | 'fire'
  | 'medical'
  | 'equipment'
  | 'other';

export const INCIDENT_CATEGORY_OPTIONS: OptionItem<IncidentCategoryValue>[] = [
  { value: 'trespass', label: 'Breach / Trespass' },
  { value: 'theft', label: 'Theft / Loss' },
  { value: 'equipment', label: 'Property / Equipment' },
  { value: 'violence', label: 'Violence / Threat' },
  { value: 'fire', label: 'Fire / Safety Hazard' },
  { value: 'medical', label: 'Medical Incident' },
  { value: 'other', label: 'Other Incident' },
];

export const INCIDENT_SEVERITY_OPTIONS: OptionItem<IncidentSeverity>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export interface IncidentFormSubmitPayload {
  category: IncidentCategoryValue;
  severity: IncidentSeverity;
  eventAt: string;
  description: string;
  actionsTaken?: string;
}

export interface ReportIncidentScreenProps {
  siteName: string;
  shiftStartedAt?: string;
  isOnline: boolean;
  pendingCount?: number;
  initialEventAt?: string;
  isSubmitting?: boolean;
  storageError?: string | null;
  onSubmitIncident: (payload: IncidentFormSubmitPayload) => void | Promise<void>;
  onCancel: () => void;
}

export const ReportIncidentScreen: React.FC<ReportIncidentScreenProps> = ({
  siteName,
  shiftStartedAt,
  isOnline,
  pendingCount = 0,
  initialEventAt,
  isSubmitting = false,
  storageError = null,
  onSubmitIncident,
  onCancel,
}) => {
  const [category, setCategory] = useState<IncidentCategoryValue | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [eventAtInput, setEventAtInput] = useState<string>(
    initialEventAt || new Date().toISOString().slice(0, 16).replace('T', ' ')
  );
  const [description, setDescription] = useState('');
  const [actionsTaken, setActionsTaken] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitLock, setSubmitLock] = useState(false);

  const validateForm = (): {
    valid: boolean;
    parsedIso?: string;
  } => {
    const nextErrors: Record<string, string> = {};

    if (!category) {
      nextErrors.category = 'Select an incident category.';
    }
    if (!severity) {
      nextErrors.severity = 'Select a severity level.';
    }

    const trimmedDesc = description.trim();
    if (trimmedDesc.length < 20) {
      nextErrors.description =
        'Provide a factual narrative of at least 20 characters.';
    } else if (trimmedDesc.length > 3000) {
      nextErrors.description = 'Description must not exceed 3000 characters.';
    }

    const parsedIso = parseLocalDateTime(eventAtInput);
    const parsedMs = parsedIso ? Date.parse(parsedIso) : NaN;

    if (Number.isNaN(parsedMs)) {
      nextErrors.eventAt =
        'Enter a valid date and time (e.g. 2026-10-19 11:15).';
    } else {
      const nowMs = Date.now();
      const fiveMinFuture = nowMs + 5 * 60 * 1000;
      const sevenDaysPast = nowMs - 7 * 24 * 60 * 60 * 1000;

      if (parsedMs > fiveMinFuture) {
        nextErrors.eventAt =
          'Incident time cannot be more than 5 minutes in the future.';
      } else if (parsedMs < sevenDaysPast) {
        nextErrors.eventAt = 'Incident time must be within the last 7 days.';
      } else if (shiftStartedAt) {
        const shiftStartMs = Date.parse(shiftStartedAt);
        if (!Number.isNaN(shiftStartMs) && parsedMs < shiftStartMs) {
          nextErrors.eventAt =
            'Incident time cannot be earlier than your active shift start time.';
        }
      }
    }

    setErrors(nextErrors);
    return {
      valid: Object.keys(nextErrors).length === 0,
      parsedIso: parsedIso ?? undefined,
    };
  };

  const handlePressSave = async () => {
    if (isSubmitting || submitLock) return;
    const { valid, parsedIso } = validateForm();
    if (!valid || !category || !severity || !parsedIso) return;

    setSubmitLock(true);
    try {
      await onSubmitIncident({
        category,
        severity,
        eventAt: parsedIso,
        description: description.trim(),
        actionsTaken: actionsTaken.trim() ? actionsTaken.trim() : undefined,
      });
    } finally {
      setSubmitLock(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <AppHeader
        title="Report Incident"
        subtitle={siteName}
        isOnline={isOnline}
        pendingCount={pendingCount}
        onBack={onCancel}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <EmergencyEscalationBanner />

        {storageError ? (
          <InfoAlertBanner
            tone="danger"
            title="Unable to Save Incident"
            body={storageError}
          />
        ) : null}

        <SurfaceCard>
          <View style={styles.siteContextRow}>
            <Text style={styles.siteContextLabel}>Assigned Site:</Text>
            <Text style={styles.siteContextValue}>{siteName}</Text>
          </View>

          <OptionPillGroup
            label="Incident Category"
            required
            options={INCIDENT_CATEGORY_OPTIONS}
            selectedValue={category}
            onSelect={(val) => {
              setCategory(val);
              if (errors.category) setErrors({ ...errors, category: '' });
            }}
            errorText={errors.category}
          />

          <OptionPillGroup
            label="Severity Level"
            required
            options={INCIDENT_SEVERITY_OPTIONS}
            selectedValue={severity}
            onSelect={(val) => {
              setSeverity(val);
              if (errors.severity) setErrors({ ...errors, severity: '' });
            }}
            errorText={errors.severity}
          />

          <FormField
            label="Time Incident Occurred"
            required
            helperText="YYYY-MM-DD HH:mm"
            value={eventAtInput}
            onChangeText={(txt) => {
              setEventAtInput(txt);
              if (errors.eventAt) setErrors({ ...errors, eventAt: '' });
            }}
            placeholder="2026-10-19 11:15"
            errorText={errors.eventAt}
          />

          <FormField
            label="What Happened? (Factual Narrative)"
            required
            helperText={`${description.trim().length}/3000 chars (min 20)`}
            value={description}
            onChangeText={(txt) => {
              setDescription(txt);
              if (errors.description) setErrors({ ...errors, description: '' });
            }}
            placeholder="Describe exactly what you observed, where on site it occurred, and any damage or persons involved without speculation."
            multiline
            maxLength={3000}
            errorText={errors.description}
          />

          <FormField
            label="Immediate Actions Taken"
            helperText="Optional"
            value={actionsTaken}
            onChangeText={setActionsTaken}
            placeholder="E.g. Secured gate, informed shift supervisor by telephone."
            multiline
            maxLength={1000}
          />
        </SurfaceCard>

        <View style={styles.actionStack}>
          <SmartButton
            label={
              isSubmitting || submitLock
                ? 'Saving to Encrypted Outbox...'
                : 'Save Incident Report'
            }
            onPress={handlePressSave}
            loading={isSubmitting || submitLock}
            disabled={isSubmitting || submitLock}
          />
          <SmartButton
            label="Cancel"
            onPress={onCancel}
            variant="ghost"
            disabled={isSubmitting || submitLock}
          />
        </View>

        <Text style={styles.outboxNote}>
          Saving stores this report in your phone's encrypted SQLite outbox
          first. It is only marked Received by Server after a confirmed server
          receipt.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  siteContextRow: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  siteContextLabel: {
    fontSize: 13,
    fontFamily: FONTS.medium,
    color: COLORS.textMuted,
  },
  siteContextValue: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
  },
  actionStack: {
    marginTop: 4,
    gap: 6,
  },
  outboxNote: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.textMuted,
    textAlign: 'center',
    fontFamily: FONTS.regular,
  },
});
