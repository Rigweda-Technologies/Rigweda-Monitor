import { useCallback, useEffect, useState } from 'react';
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getApiWithToken, patchApiWithToken } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useResetScrollOnFocus } from '../utils/useResetScrollOnFocus';

function NotificationsScreen() {
  const navigation = useNavigation<any>();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const { session, refreshPermissions } = useAuth();
  const token = session?.token || '';
  const permissions = session?.permissions || [];
  const canViewNotifications = permissions.includes('NOTIFICATION_VIEW_SELF');
  const canManageNotifications = permissions.includes('NOTIFICATION_MANAGE_SELF');
  const safeAreaInsets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [permissionsReady, setPermissionsReady] = useState(false);

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    const res = await getApiWithToken<any>('/notifications/my?limit=20', token);
    setLoading(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to load notifications.');
      setNotifications([]);
      return;
    }
    setNotifications(res?.data?.items || []);
  }, [token]);

  const markAllRead = async () => {
    if (!canManageNotifications) {
      return;
    }
    await patchApiWithToken<any>('/notifications/read-all', {}, token);
    loadNotifications();
  };

  const markOneRead = async (id: string) => {
    if (!canManageNotifications) {
      return;
    }
    await patchApiWithToken<any>(`/notifications/${id}/read`, {}, token);
    setNotifications((prev) =>
      prev.map((n) => (n._id === id ? { ...n, isRead: true } : n))
    );
  };

  useEffect(() => {
    if (token && canViewNotifications) loadNotifications();
    if (!canViewNotifications) {
      setLoading(false);
      setNotifications([]);
    }
  }, [token, canViewNotifications, loadNotifications]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setPermissionsReady(false);
      refreshPermissions()
        .catch(() => undefined)
        .finally(() => {
          if (active) {
            setPermissionsReady(true);
          }
        });
      return () => {
        active = false;
      };
    }, [refreshPermissions])
  );

  useResetScrollOnFocus(scrollViewRef);

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
          <Text style={styles.headerTitle}>Notifications</Text>
          {permissionsReady && canManageNotifications ? (
            <Pressable onPress={markAllRead} style={styles.headerButton}>
              <MaterialCommunityIcons name="check-all" size={18} color="#0f172a" />
            </Pressable>
          ) : (
            <View style={styles.headerButton} />
          )}
        </View>

        <View style={styles.card}>
          {!permissionsReady ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={styles.helperText}>Checking permissions...</Text>
            </View>
          ) : !canViewNotifications ? (
            <Text style={styles.helperText}>You do not have permission to view notifications.</Text>
          ) : loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={styles.helperText}>Loading...</Text>
            </View>
          ) : (
            <>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {notifications.length === 0 ? (
                <Text style={styles.helperText}>No notifications</Text>
              ) : (
                notifications.map((item) => (
                  <Pressable
                    key={item._id}
                    style={[styles.noticeCard, item.isRead ? null : styles.noticeUnread]}
                    onPress={permissionsReady && canManageNotifications ? () => markOneRead(item._id) : undefined}
                    disabled={!permissionsReady || !canManageNotifications}
                  >
                    <Text style={styles.noticeTitle}>{item.title}</Text>
                    <Text style={styles.noticeText}>{item.message}</Text>
                    <Text style={styles.noticeMeta}>
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
                    </Text>
                  </Pressable>
                ))
              )}
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
    gap: 10,
  },
  center: { alignItems: 'center', gap: 8 },
  helperText: { fontSize: 12, color: '#64748b' },
  errorText: { fontSize: 12, color: '#dc2626' },
  noticeCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  noticeUnread: { backgroundColor: '#eef2ff', borderColor: '#c7d2fe' },
  noticeTitle: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  noticeText: { marginTop: 4, fontSize: 11, color: '#64748b' },
  noticeMeta: { marginTop: 6, fontSize: 10, color: '#94a3b8' },
});

export default NotificationsScreen;
