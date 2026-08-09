import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { postApiWithoutToken } from '../services/api';

type Step = 'email' | 'otp' | 'password';

function ForgotPasswordScreen() {
  const navigation = useNavigation<any>();
  const safeAreaInsets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('email');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSendOtp = async () => {
    if (!email) return;
    setError('');
    setSubmitting(true);
    const { json } = await postApiWithoutToken<any>('/users/forgot-password/send-otp', {
      email: email.trim().toLowerCase(),
    });
    setSubmitting(false);
    if (!json?.success) {
      setError(json?.message || 'Unable to send OTP.');
      return;
    }
    setStep('otp');
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) return;
    setError('');
    setSubmitting(true);
    const { json } = await postApiWithoutToken<any>('/users/forgot-password/verify-otp', {
      email: email.trim().toLowerCase(),
      otp,
    });
    setSubmitting(false);
    if (!json?.success) {
      setError(json?.message || 'OTP verification failed.');
      return;
    }
    setStep('password');
  };

  const handleResetPassword = async () => {
    if (!password || !confirmPassword) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setSubmitting(true);
    const { json } = await postApiWithoutToken<any>('/users/forgot-password/reset-password', {
      email: email.trim().toLowerCase(),
      password,
      confirmPassword,
    });
    setSubmitting(false);
    if (!json?.success) {
      setError(json?.message || 'Unable to reset password.');
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  };

  return (
    <LinearGradient
      colors={['#3f5ed7', '#214fc6', '#b0cce0']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(safeAreaInsets.top, 16) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.eyebrow}>PASSWORD RECOVERY</Text>
          <Text style={styles.title}>Forgot password</Text>
          <Text style={styles.subtitle}>
            {step === 'email' && 'Enter your registered email to receive OTP.'}
            {step === 'otp' && 'Enter the 6-digit OTP sent to your email.'}
            {step === 'password' && 'Set your new password.'}
          </Text>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {step === 'email' && (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Work email"
                placeholderTextColor="#94a3b8"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              <Pressable
                style={[styles.primaryButton, submitting && styles.buttonDisabled]}
                onPress={handleSendOtp}
                disabled={submitting}
              >
                <Text style={styles.primaryButtonText}>
                  {submitting ? 'Sending OTP...' : 'Send OTP'}
                </Text>
              </Pressable>
            </View>
          )}

          {step === 'otp' && (
            <View style={styles.form}>
              <TextInput
                style={[styles.input, styles.otpInput]}
                placeholder="Enter 6-digit OTP"
                placeholderTextColor="#94a3b8"
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, ''))}
              />
              <Pressable
                style={[styles.primaryButton, submitting && styles.buttonDisabled]}
                onPress={handleVerifyOtp}
                disabled={submitting}
              >
                <Text style={styles.primaryButtonText}>
                  {submitting ? 'Verifying OTP...' : 'Verify OTP'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, submitting && styles.buttonDisabled]}
                onPress={() => setStep('email')}
                disabled={submitting}
              >
                <Text style={styles.secondaryButtonText}>Change Email</Text>
              </Pressable>
            </View>
          )}

          {step === 'password' && (
            <View style={styles.form}>
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="New password"
                placeholderTextColor="#94a3b8"
                selectionColor="#000000"
                cursorColor="#000000"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TextInput
                style={[styles.input, styles.passwordInput]}
                placeholder="Confirm new password"
                placeholderTextColor="#94a3b8"
                selectionColor="#000000"
                cursorColor="#000000"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <Pressable
                style={[styles.primaryButton, submitting && styles.buttonDisabled]}
                onPress={handleResetPassword}
                disabled={submitting}
              >
                <Text style={styles.primaryButtonText}>
                  {submitting ? 'Updating Password...' : 'Update Password'}
                </Text>
              </Pressable>
            </View>
          )}

          <Pressable onPress={() => navigation.navigate('Login')} style={styles.backLink}>
            <Text style={styles.backText}>
              Back to <Text style={styles.backLinkText}>Login</Text>
            </Text>
          </Pressable>
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
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: '#2563eb',
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
    color: '#0f172a',
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    color: '#64748b',
  },
  form: {
    marginTop: 20,
    gap: 12,
  },
  errorText: {
    marginTop: 12,
    color: '#dc2626',
    fontSize: 12,
  },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  otpInput: {
    letterSpacing: 5,
  },
  passwordInput: {
    color: '#000000',
  },
  primaryButton: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  secondaryButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  backLink: {
    marginTop: 20,
    alignItems: 'center',
  },
  backText: {
    fontSize: 13,
    color: '#64748b',
  },
  backLinkText: {
    color: '#2563eb',
    fontWeight: '600',
  },
});

export default ForgotPasswordScreen;
