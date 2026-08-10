import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import LinearGradient from 'react-native-linear-gradient';
import { getApiWithToken, postApiWithoutToken } from '../services/api';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';

const isEmployeeRole = (role: any) => {
  const slug = String(role?.slug || '').toLowerCase();
  const name = String(role?.name || '').toLowerCase();
  return slug === 'employee' || name === 'employee';
};

function LoginScreen() {
  const navigation = useNavigation<any>();
  const {
    setSession,
    sessionExpiredMessage,
    clearSessionExpiredMessage,
    setLoginSuccessMessage,
    logoutSuccessMessage,
    clearLogoutSuccessMessage,
  } = useAuth();
  const safeAreaInsets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (sessionExpiredMessage) {
      setNotice(sessionExpiredMessage);
      clearSessionExpiredMessage();
    }
  }, [sessionExpiredMessage, clearSessionExpiredMessage]);

  useEffect(() => {
    if (logoutSuccessMessage) {
      setNotice(logoutSuccessMessage);
      clearLogoutSuccessMessage();
    }
  }, [logoutSuccessMessage, clearLogoutSuccessMessage]);

  const handleLogin = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password;
    setError('');

    if (!trimmedEmail || !trimmedPassword) {
      setError('Email and password are required.');
      return;
    }

    try {
      setSubmitting(true);
      const { json, token } = await postApiWithoutToken<any>('/users/login', {
        email: trimmedEmail,
        password: trimmedPassword,
      });

      if (!json?.success) {
        setError(json?.message || 'Login failed.');
        return;
      }

      if (json?.data?.mustChangePassword) {
        setError('Please change your password on the web portal first.');
        return;
      }

      if (!token) {
        setError('Login token missing. Please contact admin.');
        return;
      }

      const roles = json?.data?.roles || [];
      const activeRole = json?.data?.activeRole || roles[0] || null;
      const hasEmployeeRole =
        isEmployeeRole(activeRole) || roles.some((role: any) => isEmployeeRole(role));

      if (!hasEmployeeRole) {
        setError('Only employee access is supported in this app.');
        return;
      }

      const [profileRes, permissionRes] = await Promise.all([
        getApiWithToken<any>('/users/me/profile', token),
        getApiWithToken<any>('/users/me/permissions', token),
      ]);

      const profile = profileRes?.success ? profileRes.data : null;
      const permissions = permissionRes?.success ? permissionRes.data || [] : [];

      setSession({
        token,
        loginData: {
          ...json.data,
          activeRole,
        },
        profile,
        permissions,
      });
      setLoginSuccessMessage('Login successful. Welcome back.');
      // Navigation will switch via session state in AppNavigator.
    } catch {
      setError('Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <LinearGradient
      colors={['#0c63f9', '#214fc6', '#b0cce0']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(safeAreaInsets.top, 12) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.layout, isWide && styles.layoutWide]}>
          {isWide && (
            <View style={styles.leftPanel}>
              <Text style={styles.leftEyebrow}>UPANAYA HRMS PLATFORM</Text>

              <Text style={styles.leftTitle}>
                Human resources,{'\n'}reimagined for real operations
              </Text>

              <View style={styles.featureRow}>
                <View style={styles.featureCard}>
                  <MaterialCommunityIcons name="clock-outline" size={18} color="#fff" />
                  <Text style={styles.featureTitle}>Attendance Engine</Text>
                  <Text style={styles.featureText}>Real-time</Text>
                </View>

                <View style={styles.featureCard}>
                  <MaterialCommunityIcons name="shield-check-outline" size={18} color="#fff" />
                  <Text style={styles.featureTitle}>Access Governance</Text>
                  <Text style={styles.featureText}>Role-based</Text>
                </View>
              </View>
            </View>
          )}

          <View style={[styles.cardWrap, isWide && styles.cardWrapWide]}>
            <View style={styles.cardShell}>
              <View style={styles.cardShadowPlate} />
              <LinearGradient
                colors={['#ffffff', '#fefeff', '#fcfdff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <View style={styles.cardTopGloss} pointerEvents="none" />
              <Text style={styles.cardEyebrow}>WELCOME BACK</Text>

              <Text style={styles.cardTitle}>Sign in to Rigweda HRMS</Text>

              <Text style={styles.cardSubtitle}>
                Manage attendance, leaves, approvals, and people operations in one place.
              </Text>

              {notice ? <View style={styles.noticeBox}><Text style={styles.noticeText}>{notice}</Text></View> : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.form}>
                <View style={styles.inputShell}>
                  <TextInput
                    style={styles.input}
                    placeholder="Work email"
                    placeholderTextColor="#9aa4b2"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    keyboardType="email-address"
                    autoComplete="username"
                    importantForAutofill="auto"
                    textContentType="username"
                    disableFullscreenUI={true}
                    showSoftInputOnFocus={true}
                  />
                </View>

                <View style={styles.passwordWrap}>
                <View style={styles.inputShell}>
                  <TextInput
                    style={[styles.input, styles.passwordInput]}
                    placeholder="Password"
                    placeholderTextColor="#9aa4b2"
                    selectionColor="#000000"
                    cursorColor="#000000"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    spellCheck={false}
                    autoComplete="current-password"
                    importantForAutofill="auto"
                    textContentType="password"
                    disableFullscreenUI={true}
                    showSoftInputOnFocus={true}
                  />
                </View>
                  <Pressable
                    onPress={() => setShowPassword((current) => !current)}
                    style={styles.eyeButton}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <MaterialCommunityIcons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color="#64748b"
                    />
                  </Pressable>
                </View>

                <Pressable
                  onPress={() => navigation.navigate('ForgotPassword')}
                  style={styles.forgotPressable}
                >
                  <Text style={styles.forgot}>Forgot password?</Text>
                </Pressable>

                <Pressable
                  style={[styles.primaryButton, submitting && styles.buttonDisabled]}
                  onPress={handleLogin}
                  disabled={submitting}
                >
                  <LinearGradient
                    colors={['#5a7bea', '#456bde', '#3559cc']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 0, y: 1 }}
                    style={styles.primaryButtonInner}
                  >
                    <View style={styles.buttonContent}>
                      {submitting ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <MaterialCommunityIcons name="login" size={16} color="#fff" />
                      )}
                      <Text style={styles.primaryButtonText}>
                        {submitting ? 'Signing in...' : 'Login'}
                      </Text>
                    </View>
                  </LinearGradient>
                </Pressable>

                <Pressable style={styles.secondaryButton} disabled>
                  <View style={styles.secondaryButtonInner}>
                    <View style={styles.buttonContent}>
                      <MaterialCommunityIcons name="camera-outline" size={16} color="#1e293b" />
                      <Text style={styles.secondaryButtonText}>Login with Selfie</Text>
                    </View>
                  </View>
                </Pressable>
              </View>

              <View style={styles.miniCardsWrap}>
                <View style={styles.miniCards}>
                  <View style={styles.miniCard}>
                    <LinearGradient colors={['#ffffff', '#fefeff', '#f8fafc']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.miniCardInner}>
                      <MaterialCommunityIcons name="account-group-outline" size={18} color="#2563eb" />
                      <Text style={styles.miniCardTitle}>Employees</Text>
                    </LinearGradient>
                  </View>

                  <View style={styles.miniCard}>
                    <LinearGradient colors={['#ffffff', '#fefeff', '#f8fafc']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.miniCardInner}>
                      <MaterialCommunityIcons name="calendar-check-outline" size={18} color="#2563eb" />
                      <Text style={styles.miniCardTitle}>Attendance</Text>
                    </LinearGradient>
                  </View>

                  <View style={styles.miniCard}>
                    <LinearGradient colors={['#ffffff', '#fefeff', '#f8fafc']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.miniCardInner}>
                      <MaterialCommunityIcons name="shield-check-outline" size={18} color="#2563eb" />
                      <Text style={styles.miniCardTitle}>Secure</Text>
                    </LinearGradient>
                  </View>
                </View>
              </View>
              </LinearGradient>
            </View>
          </View>
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 24,
  },
  layout: {
    flex: 1,
    paddingHorizontal: 16,
  },
  layoutWide: {
    flexDirection: 'row',
    gap: 24,
    paddingHorizontal: 24,
  },
  leftPanel: {
    flex: 1,
    justifyContent: 'center',
  },
  leftEyebrow: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  leftTitle: {
    marginTop: 16,
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 40,
  },
  featureRow: {
    flexDirection: 'row',
    marginTop: 30,
    gap: 16,
  },
  featureCard: {
    flex: 1,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  featureTitle: {
    color: '#fff',
    marginTop: 6,
    fontWeight: '600',
  },
  featureText: {
    color: '#e2e8f0',
    fontSize: 12,
  },
  cardWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  cardWrapWide: {
    width: 420,
  },
  cardShell: {
    position: 'relative',
  },
  cardShadowPlate: {
    position: 'absolute',
    top: 16,
    left: 10,
    right: 10,
    bottom: -10,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#163a91',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 14,
  },
  card: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#0f2c7f',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 10,
  },
  cardTopGloss: {
    position: 'absolute',
    top: 0,
    left: 18,
    right: 18,
    height: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    opacity: 0.55,
  },
  cardEyebrow: {
    color: '#2563eb',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
    color: '#0f172a',
  },
  cardSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748b',
  },
  form: {
    marginTop: 16,
    gap: 12,
  },
  noticeBox: {
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#fef3c7',
  },
  noticeText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 12,
  },
  inputShell: {
    borderRadius: 15,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe4f0',
    shadowColor: '#ffffff',
    shadowOffset: { width: -3, height: -3 },
    shadowOpacity: 0.95,
    shadowRadius: 5,
    elevation: 1,
  },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#edf2f7',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    color: '#0f172a',
    shadowColor: '#b9c6d8',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  passwordWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 44,
    color: '#000000',
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    height: 30,
    width: 30,
    borderRadius: 15,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#c2cfdf',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 1,
  },
  forgot: {
    textAlign: 'right',
    color: '#2563eb',
    fontSize: 12,
  },
  forgotPressable: {
    alignSelf: 'flex-end',
  },
  primaryButton: {
    backgroundColor: '#456bde',
    borderRadius: 14,
    shadowColor: '#2a4da8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.26,
    shadowRadius: 10,
    elevation: 6,
  },
  primaryButtonInner: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cbd5f5',
    backgroundColor: '#f8fafc',
    shadowColor: '#ffffff',
    shadowOffset: { width: -3, height: -3 },
    shadowOpacity: 0.95,
    shadowRadius: 5,
    elevation: 1,
  },
  secondaryButtonInner: {
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#edf2f7',
    shadowColor: '#c8d2e1',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 6,
  },
  secondaryButtonText: {
    fontWeight: '600',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniCards: {
    flexDirection: 'row',
    gap: 8,
  },
  miniCardsWrap: {
    marginTop: 20,
    paddingHorizontal: 2,
  },
  miniCard: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    shadowColor: '#c8d2e1',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 7,
    elevation: 3,
  },
  miniCardInner: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  miniCardTitle: {
    fontSize: 11,
    marginTop: 4,
    color: '#64748b',
  },
});

export default LoginScreen;
