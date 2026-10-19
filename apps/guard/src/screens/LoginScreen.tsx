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
  COLORS,
  FONTS,
  FormField,
  InfoAlertBanner,
  SmartButton,
  SurfaceCard,
} from '../components';

export interface LoginScreenProps {
  onSignIn: (credentials: { email: string; password: string }) => void | Promise<void>;
  isLoading?: boolean;
  errorMessage?: string | null;
  isOnline?: boolean;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onSignIn,
  isLoading = false,
  errorMessage = null,
  isOnline = true,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setLocalError('Enter both your authorized account email and password.');
      return;
    }
    setLocalError(null);
    onSignIn({ email: trimmedEmail, password });
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandSection}>
          <View style={styles.shieldLogo}>
            <Text style={styles.shieldLogoText}>BG</Text>
          </View>
          <Text style={styles.appTitle}>Baseguard SmartOps</Text>
          <Text style={styles.appSubtitle}>
            Field Security Operations & Occurrence Reporting
          </Text>
        </View>

        {!isOnline ? (
          <InfoAlertBanner
            tone="offline"
            title="Device Offline"
            body="Sign-in requires network connectivity to verify your account and active shift assignment."
          />
        ) : null}

        {errorMessage || localError ? (
          <InfoAlertBanner
            tone="danger"
            title="Sign-In Unable to Proceed"
            body={errorMessage || localError || ''}
          />
        ) : null}

        <SurfaceCard>
          <Text style={styles.cardHeading}>Officer Sign In</Text>
          <Text style={styles.cardSubheading}>
            Sign in with your provisioned Baseguard account credentials.
          </Text>

          <FormField
            label="Account Email"
            required
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!isLoading}
          />

          <FormField
            label="Password"
            required
            value={password}
            onChangeText={setPassword}
            placeholder="Enter password"
            secureTextEntry
            autoCapitalize="none"
            editable={!isLoading}
          />

          <SmartButton
            label={isLoading ? 'Verifying Credentials...' : 'Sign In to Duty'}
            onPress={handleSubmit}
            loading={isLoading}
            disabled={isLoading}
          />
        </SurfaceCard>

        <View style={styles.footerNotice}>
          <Text style={styles.footerNoticeText}>
            Authorized personnel only. Site access and shift permissions are
            enforced by server policy. Local unsynced records on this device are
            protected against accidental sign-out.
          </Text>
        </View>
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  brandSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  shieldLogo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  shieldLogoText: {
    color: COLORS.white,
    fontSize: 24,
    fontFamily: FONTS.bold,
    fontWeight: '700',
  },
  appTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.navy,
    textAlign: 'center',
  },
  appSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  cardHeading: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: FONTS.bold,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 4,
  },
  cardSubheading: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    marginBottom: 16,
  },
  footerNotice: {
    marginTop: 8,
    paddingHorizontal: 8,
  },
  footerNoticeText: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FONTS.regular,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
