import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator, Image, ImageBackground, Keyboard, KeyboardAvoidingView,
  Platform, Pressable, StatusBar, StyleSheet, Text, TextInput, View,
  useWindowDimensions,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';

const COLORS = {
  green: '#174E42', navy: '#152836', surface: '#FFFFFF', muted: '#748498',
  bg: '#F6F8F9', outline: '#D7DFE6', error: '#A22D2D',
};

export type LoginScreenProps = {
  onSignIn: (email: string, password: string) => Promise<void>;
  onForgotPassword: (email: string) => void;
  error?: string;
  busy?: boolean;
};

export function LoginScreen({onSignIn, onForgotPassword, error, busy = false}: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keyboardShown, setKeyboardShown] = useState(false);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const {height: windowHeight, width, fontScale} = useWindowDimensions();

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Android is configured with softwareKeyboardLayoutMode: 'resize'. Use the actual
  // available height after status/navigation insets and keyboard changes, not a fixed
  // device model size. Never scroll the login screen.
  const height = layoutHeight || windowHeight;
  const keyboardLayout = keyboardShown || height < 425;
  const compact = height < 700 || fontScale > 1.15;
  const veryCompact = height < 575 || fontScale > 1.3;
  const hideFooter = height < 495 && !!error;
  const narrow = width < 375;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length > 0;

  const submit = () => { if (valid && !busy) void onSignIn(email.trim(), password); };

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      onLayout={event => {
        const measured = event.nativeEvent.layout.height;
        if (Math.abs(measured - layoutHeight) > 2) setLayoutHeight(measured);
      }}
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg}/>
      <View style={[styles.content, compact && styles.contentCompact, keyboardLayout && styles.contentKeyboard]}>
        {keyboardLayout ? (
          <Text style={styles.keyboardTitle}>Baseguard <Text style={styles.green}>SmartOps</Text></Text>
        ) : (
          <View style={[styles.header, compact && styles.headerCompact]}>
            <Image
              source={require('../../assets/brand-shield.png')}
              resizeMode="contain"
              style={[styles.shield, compact && styles.shieldCompact, veryCompact && styles.shieldSmall]}
              accessibilityLabel="Baseguard SmartOps shield"
            />
            <Text style={[styles.brand, compact && styles.brandCompact, narrow && styles.brandNarrow]} numberOfLines={1}>
              <Text style={styles.navy}>Baseguard</Text><Text style={styles.green}> SmartOps</Text>
            </Text>
            <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>Security Operations Platform</Text>
            {!veryCompact && <>
              <View style={[styles.smallBars, compact && styles.smallBarsCompact]}>
                <View style={styles.barMuted}/><View style={styles.barActive}/><View style={styles.barMuted}/>
              </View>
              <Text style={[styles.tagline, narrow && styles.taglineNarrow]}>PEOPLE · SITES · A SAFER TOMORROW</Text>
            </>}
          </View>
        )}

        <View style={[styles.card, compact && styles.cardCompact, keyboardLayout && styles.cardKeyboard]}>
          <Text style={[styles.label, compact && styles.labelCompact]}>Work email</Text>
          <View style={[styles.fieldRow, compact && styles.fieldCompact, keyboardLayout && styles.fieldKeyboard]}>
            <Ionicons name="mail-outline" size={20} color="#657287" />
            <TextInput
              value={email} onChangeText={setEmail} placeholder="name@company.com"
              placeholderTextColor="#91A0B2" style={styles.input}
              keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
              autoComplete="email" textContentType="username" accessibilityLabel="Work email"
              returnKeyType="next"
            />
          </View>
          <Text style={[styles.label, compact && styles.labelCompact]}>Password</Text>
          <View style={[styles.fieldRow, compact && styles.fieldCompact, keyboardLayout && styles.fieldKeyboard]}>
            <Ionicons name="lock-closed-outline" size={20} color="#657287" />
            <TextInput
              value={password} onChangeText={setPassword} placeholder="Enter your password"
              placeholderTextColor="#91A0B2" style={styles.input}
              secureTextEntry={!showPassword} autoCapitalize="none"
              autoComplete="current-password" textContentType="password"
              accessibilityLabel="Password" returnKeyType="go" onSubmitEditing={submit}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
              onPress={() => setShowPassword(value => !value)}
              hitSlop={8} style={styles.eye}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color="#526579" />
            </Pressable>
          </View>
          <View style={[styles.actionRow, compact && styles.actionRowCompact]}>
            {!keyboardLayout && <View style={styles.secureNote}>
              <Ionicons name="shield-checkmark-outline" size={17} color={COLORS.green}/>
              <Text style={styles.secureText}>Protected sign-in</Text>
            </View>}
            <Pressable onPress={() => onForgotPassword(email.trim())} accessibilityRole="button" hitSlop={9}>
              <Text style={styles.forgot}>Forgot password?</Text>
            </Pressable>
          </View>
          {!!error && <Text style={styles.error} accessibilityRole="alert" numberOfLines={keyboardLayout ? 2 : 3}>{error}</Text>}
          <Pressable
            accessibilityRole="button" accessibilityLabel="Sign in" disabled={!valid || busy}
            onPress={submit}
            style={[styles.signIn, compact && styles.signInCompact, (!valid || busy) && styles.disabled]}
          >
            {busy ? <ActivityIndicator color="white"/> : <>
              <Text style={styles.signInText}>Sign In</Text><Ionicons name="arrow-forward" size={21} color="white"/>
            </>}
          </Pressable>
          {!keyboardLayout && !(height < 500 && !!error) && <>
            <View style={[styles.divider, compact && styles.dividerCompact]}>
              <View style={styles.rule}/><Ionicons name="lock-closed" size={13} color={COLORS.navy}/>
              <Text style={styles.dividerText}>Authorized personnel only</Text><View style={styles.rule}/>
            </View>
            {!veryCompact && <Text style={styles.disclaimer}>Accounts are created by an authorized supervisor or administrator.</Text>}
            <Text style={styles.disclaimer}>Internet is required for first sign-in.</Text>
          </>}
        </View>

        {!keyboardLayout && !hideFooter && <View style={[styles.bottomArea, compact && styles.bottomCompact]}>
          {!veryCompact && <ImageBackground
            source={require('../../assets/login-landscape.png')}
            resizeMode="stretch"
            style={[styles.landscape, compact && styles.landscapeCompact]}
            accessible={false}
          />}
          <View style={[styles.footer, compact && styles.footerCompact]}>
            <View style={styles.help}>
              <Ionicons name="headset-outline" color={COLORS.green} size={compact ? 17 : 20}/>
              <Text style={[styles.helpLabel, compact && styles.helpLabelCompact]}>Need help?</Text>
            </View>
            <Text style={styles.helpCaption} numberOfLines={1}>Contact your supervisor or system administrator.</Text>
          </View>
        </View>}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: COLORS.bg},
  content: {flex: 1, paddingHorizontal: 19, paddingTop: 16, justifyContent: 'space-between'},
  contentCompact: {paddingTop: 7, paddingHorizontal: 15},
  contentKeyboard: {paddingTop: 5, paddingBottom: 7, justifyContent: 'center', gap: 8},
  header: {alignItems: 'center', marginBottom: 8},
  headerCompact: {marginBottom: 4},
  shield: {width: 92, height: 95, marginBottom: 2},
  shieldCompact: {width: 69, height: 73, marginBottom: 0},
  shieldSmall: {width: 52, height: 56},
  brand: {fontWeight: '800', fontSize: 27, letterSpacing: -0.7, textAlign: 'center'},
  brandCompact: {fontSize: 23}, brandNarrow: {fontSize: 21},
  navy: {color: COLORS.navy}, green: {color: COLORS.green},
  subtitle: {color: '#5D6C80', fontSize: 13, letterSpacing: 1.4, marginTop: 4, textAlign: 'center'},
  subtitleCompact: {fontSize: 11, marginTop: 1, letterSpacing: 1},
  smallBars: {flexDirection: 'row', gap: 7, marginTop: 12, marginBottom: 10},
  smallBarsCompact: {marginTop: 5, marginBottom: 5},
  barMuted: {width: 26, height: 3, borderRadius: 8, backgroundColor: '#CCD4DB'},
  barActive: {width: 33, height: 3, borderRadius: 8, backgroundColor: COLORS.green},
  tagline: {color: '#8190A2', fontSize: 9, letterSpacing: 1.6, textAlign: 'center'},
  taglineNarrow: {fontSize: 8, letterSpacing: 1},
  keyboardTitle: {fontSize: 19, color: COLORS.navy, textAlign: 'center', fontWeight: '800'},
  card: {
    backgroundColor: COLORS.surface, borderRadius: 17, paddingHorizontal: 18,
    paddingVertical: 18, shadowColor: COLORS.navy, shadowOpacity: 0.06,
    shadowRadius: 14, elevation: 2,
  },
  cardCompact: {paddingHorizontal: 15, paddingVertical: 11, borderRadius: 14},
  cardKeyboard: {paddingVertical: 9},
  label: {fontSize: 15, fontWeight: '700', color: COLORS.navy, marginBottom: 6, marginTop: 4},
  labelCompact: {fontSize: 14, marginBottom: 4, marginTop: 2},
  fieldRow: {
    height: 51, borderColor: COLORS.outline, borderWidth: 1, borderRadius: 11,
    backgroundColor: '#FAFBFC', flexDirection: 'row', alignItems: 'center',
    paddingLeft: 12, paddingRight: 5, marginBottom: 9,
  },
  fieldCompact: {height: 47, marginBottom: 7},
  fieldKeyboard: {height: 44, marginBottom: 4},
  input: {fontSize: 15, color: COLORS.navy, flex: 1, paddingHorizontal: 10, paddingVertical: 4, height: '100%'},
  eye: {width: 44, height: 44, alignItems: 'center', justifyContent: 'center'},
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, marginBottom: 13,
  },
  actionRowCompact: {marginBottom: 9},
  secureNote: {flexDirection: 'row', alignItems: 'center', gap: 5},
  secureText: {fontSize: 12, color: '#697B83'},
  forgot: {color: COLORS.green, fontSize: 13, fontWeight: '700'},
  signIn: {height: 53, borderRadius: 11, backgroundColor: COLORS.green,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12},
  signInCompact: {height: 48},
  disabled: {opacity: 0.55}, signInText: {fontSize: 16, color: '#FFFFFF', fontWeight: '700'},
  divider: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    marginTop: 15, marginBottom: 9},
  dividerCompact: {marginTop: 10, marginBottom: 6},
  rule: {height: 1, flex: 1, backgroundColor: '#DBE2E9'},
  dividerText: {color: COLORS.navy, fontSize: 11, fontWeight: '700'},
  disclaimer: {fontSize: 11, color: '#7C8A9C', textAlign: 'center', lineHeight: 16},
  error: {color: COLORS.error, fontSize: 13, marginBottom: 9},
  bottomArea: {height: 99, justifyContent: 'flex-end', marginHorizontal: -19},
  bottomCompact: {height: 55, marginHorizontal: -15},
  landscape: {position: 'absolute', left: 0, right: 0, bottom: 44, height: 80, opacity: 0.43},
  landscapeCompact: {height: 55, bottom: 39},
  footer: {paddingVertical: 9, alignItems: 'center', backgroundColor: '#F6F8F9E8', height: 57, justifyContent: 'center'},
  footerCompact: {paddingVertical: 3, height: 47},
  help: {flexDirection: 'row', gap: 6, alignItems: 'center'},
  helpLabel: {color: COLORS.navy, fontSize: 13, fontWeight: '700'},
  helpLabelCompact: {fontSize: 12},
  helpCaption: {color: '#7E8EA1', fontSize: 10, textAlign: 'center', marginTop: 2},
});
