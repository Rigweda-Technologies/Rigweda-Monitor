import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { getApiWithToken, postApiWithTokenAndAuth } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useResetScrollOnFocus } from '../utils/useResetScrollOnFocus';

function RoleSwitchScreen() {
  const navigation = useNavigation<any>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const { session, updateToken, updateProfile, updatePermissions } = useAuth();
  const token = session?.token || '';
  const roles = session?.loginData?.roles || session?.profile?.roles || [];
  const activeRole = session?.loginData?.activeRole || session?.profile?.activeRole || null;
  const safeAreaInsets = useSafeAreaInsets();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  useResetScrollOnFocus(scrollViewRef);

  const handleSwitch = async (roleId: string) => {
    if (!roleId) return;
    if (String(activeRole?._id) === String(roleId)) {
      setError('Role already active.');
      return;
    }
    setError('');
    setSwitching(true);
    const { json, token: newToken } = await postApiWithTokenAndAuth<any>(
      '/roles/switch',
      { roleId },
      token
    );
    setSwitching(false);
    if (!json?.success) {
      setError(json?.message || 'Unable to switch role.');
      return;
    }
    if (newToken) updateToken(newToken);

    const profileRes = await getApiWithToken<any>('/users/me/profile', newToken || token);
    if (profileRes?.success) updateProfile(profileRes.data || null);

    const permRes = await getApiWithToken<any>('/users/me/permissions', newToken || token);
    if (permRes?.success) updatePermissions(permRes.data || []);

    navigation.navigate('EmployeeTabs');
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
          <Text style={styles.headerTitle}>Switch Role</Text>
          <View style={styles.headerButton} />
        </View>

        <View style={styles.card}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {roles.length === 0 ? (
            <Text style={styles.helperText}>No roles available.</Text>
          ) : (
            roles.map((role: any) => {
              const isActive = String(activeRole?._id) === String(role._id);
              return (
                <Pressable
                  key={role._id}
                  style={[styles.roleRow, isActive && styles.roleActive]}
                  onPress={() => handleSwitch(role._id)}
                  disabled={switching}
                >
                  <Text style={styles.roleText}>
                    {role?.name || role?.slug || 'Role'}
                    {isActive ? ' (active)' : ''}
                  </Text>
                  {switching && isActive ? <ActivityIndicator size="small" /> : null}
                </Pressable>
              );
            })
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
    gap: 10,
  },
  helperText: { fontSize: 12, color: '#64748b' },
  errorText: { fontSize: 12, color: '#dc2626' },
  roleRow: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  roleActive: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  roleText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
});

export default RoleSwitchScreen;
