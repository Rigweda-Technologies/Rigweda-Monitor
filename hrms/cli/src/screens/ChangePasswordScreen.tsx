import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { postApiWithToken } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useResetScrollOnFocus } from '../utils/useResetScrollOnFocus';

type Step = 'send' | 'verify' | 'update';

function ChangePasswordScreen() {
  const navigation = useNavigation<any>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const { session } = useAuth();
  const token = session?.token || '';
  const safeAreaInsets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('send');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  useResetScrollOnFocus(scrollViewRef);

  const handleSendOtp = async () => {
    setSubmitting(true);
    setError('');
    const res = await postApiWithToken<any>('/users/change-password/send-otp', {}, token);
    setSubmitting(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to send OTP.');
      return;
    }
    setStep('verify');
  };

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setSubmitting(true);
    setError('');
    const res = await postApiWithToken<any>('/users/change-password/verify-otp', { otp }, token);
    setSubmitting(false);
    if (!res?.success) {
      setError(res?.message || 'OTP verification failed.');
      return;
    }
    setStep('update');
  };

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError('');
    const res = await postApiWithToken<any>(
      '/users/change-password/update',
      { password, confirmPassword },
      token
    );
    setSubmitting(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to update password.');
      return;
    }
    navigation.goBack();
  };

  return (
    <LinearGradient
      colors={['#f3f5f9', '#f3f5f9', '#eef1f6']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(safeAreaInsets.top, 16) },
        ]}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.headerButton}>
            <MaterialCommunityIcons name="chevron-left" size={22} color="#0f172a" />
          </Pressable>
          <Text style={styles.headerTitle}>Change Password</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.card}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {step === 'send' && (
            <>
              <Text style={styles.helperText}>Send OTP to your registered email.</Text>
              <Pressable style={styles.primaryButton} onPress={handleSendOtp} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Send OTP</Text>}
              </Pressable>
            </>
          )}

          {step === 'verify' && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Enter OTP"
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, ''))}
              />
              <Pressable style={styles.primaryButton} onPress={handleVerifyOtp} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Verify OTP</Text>}
              </Pressable>
            </>
          )}

          {step === 'update' && (
            <>
              <TextInput
                style={styles.input}
                placeholder="New Password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm Password"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <Pressable style={styles.primaryButton} onPress={handleUpdatePassword} disabled={submitting}>
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Update Password</Text>}
              </Pressable>
            </>
          )}
        </View>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 120, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  helperText: { fontSize: 12, color: '#64748b' },
  errorText: { fontSize: 12, color: '#dc2626' },
  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
  },
  primaryButton: {
    height: 44,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
});

export default ChangePasswordScreen;
