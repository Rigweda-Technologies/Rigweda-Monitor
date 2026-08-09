import { useEffect, useRef } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from '@react-native-community/blur';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { ActivityIndicator, Animated, Image, StatusBar, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import LoginScreen from './src/screens/LoginScreen';
import EmployeeDashboardScreen from './src/screens/EmployeeDashboardScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import LeavesScreen from './src/screens/LeavesScreen';
import TimesheetsScreen from './src/screens/TimesheetsScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import ChangePasswordScreen from './src/screens/ChangePasswordScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import { setUnauthorizedHandler } from './src/services/api';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { setupFirebaseMessaging } from './src/services/fcm';

const patchResponseForStatusZero = () => {
  if (typeof globalThis === 'undefined' || !globalThis.Response) {
    return;
  }
  const NativeResponse = globalThis.Response as typeof Response & { __patchedForZero?: boolean };
  type ResponseBody = ConstructorParameters<typeof Response>[0];
  if (NativeResponse.__patchedForZero) return;

  const WrappedResponse = function (
    body?: ResponseBody,
    init: ResponseInit = {}
  ) {
    const normalizedInit = { ...init };
    if (normalizedInit.status === 0) {
      normalizedInit.status = 200;
    }
    return new NativeResponse(body, normalizedInit);
  } as unknown as typeof Response;

  WrappedResponse.prototype = NativeResponse.prototype;
  Object.setPrototypeOf(WrappedResponse, NativeResponse);
  (WrappedResponse as typeof Response & { __patchedForZero?: boolean }).__patchedForZero = true;
  globalThis.Response = WrappedResponse;
};

patchResponseForStatusZero();

export type RootStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  EmployeeTabs: undefined;
  Notifications: undefined;
  ChangePassword: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

const TAB_BAR_BACKGROUND = ['rgb(255, 255, 255)', 'rgb(255, 255, 255)'];
const TAB_BAR_ACTIVE_ICON = '#fffdfd';
const TAB_BAR_INACTIVE_ICON = '#4379b6a6';
const TAB_BAR_ACTIVE_GRADIENT = ['#5b7cfa', '#5b7cfa'];

function TabBarBackground() {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 0,
        overflow: 'hidden',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        backgroundColor: 'rgba(255,255,255,0.08)',
        shadowColor: '#c6d4ea',
        shadowOpacity: 0.22,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: -6 },
        elevation: 14,
      }}
    >
      <View style={styles.tabBarShadowPlate} />
      <BlurView
        style={StyleSheet.absoluteFillObject}
        blurType="light"
        blurAmount={18}
        reducedTransparencyFallbackColor="rgba(255,255,255,0.86)"
      />
      <LinearGradient colors={TAB_BAR_BACKGROUND} style={styles.tabBarSurface}>
        <View style={styles.tabBarGloss} pointerEvents="none" />
      </LinearGradient>
    </View>
  );
}

type TabIconProps = {
  focused: boolean;
  icon: string;
  activeIcon?: string;
};

function EmployeeTabs() {
  const insets = useSafeAreaInsets();
  const { session, refreshPermissions } = useAuth();
  const profile = session?.profile || session?.loginData || null;
  const permissions = session?.permissions || [];
  const permissionSignature = permissions.join('|');
  const profileImage = profile?.profileImage || profile?.profilePhoto || null;
  const initials =
    ((profile?.firstName?.[0] || '') + (profile?.lastName?.[0] || '') ||
      profile?.email?.[0] ||
      'U')
      .toUpperCase();
  const hasAnyPermission = (...codes: string[]) => codes.some((code) => permissions.includes(code));
  const canViewAttendanceTab = hasAnyPermission('ATTENDANCE_VIEW_SELF', 'TIMESHEET_VIEW_SELF');
  const canViewLeavesTab = hasAnyPermission('LEAVE_VIEW_SELF', 'LEAVE_VIEW_ALL', 'LEAVE_APPLY');
  const canViewTimesheetsTab = hasAnyPermission(
    'TIMESHEET_VIEW_SELF',
    'TIMESHEET_VIEW_ALL',
    'TIMESHEET_CHECKIN_SELF',
    'TIMESHEET_CHECKOUT_SELF'
  );

  useEffect(() => {
    if (!session?.token) {
      return undefined;
    }

    refreshPermissions();
    const timer = setInterval(() => {
      refreshPermissions();
    }, 30000);

    return () => clearInterval(timer);
  }, [session?.token, refreshPermissions]);

  return (
    <LinearGradient colors={['#dbeafe', '#eef2ff', '#e0f2fe']} style={{ flex: 1 }}>
      <Tabs.Navigator
        key={`tabs:${session?.token || 'guest'}:${permissionSignature}`}
        initialRouteName="Dashboard"
        backBehavior="history"
        detachInactiveScreens={false}
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          lazy: false,
          freezeOnBlur: false,
          animation: 'fade',
          tabBarBackground: () => <TabBarBackground />,
          tabBarStyle: {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 78 + Math.max(insets.bottom, 0),
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            elevation: 0,
            shadowOpacity: 0,
            paddingTop: 10,
            paddingBottom: Math.max(insets.bottom, 10),
            paddingHorizontal: 0,
          },
          tabBarItemStyle: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            paddingVertical: 4,
          },
        }}
      >
        {canViewAttendanceTab ? (
          <Tabs.Screen
            name="Attendance"
            component={AttendanceScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon
                  focused={focused}
                  icon="clipboard-check-outline"
                  activeIcon="clipboard-check"
                />
              ),
            }}
          />
        ) : null}
        {canViewLeavesTab ? (
          <Tabs.Screen
            name="Leaves"
            component={LeavesScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon
                  focused={focused}
                  icon="calendar-remove-outline"
                  activeIcon="calendar-remove"
                />
              ),
            }}
          />
        ) : null}
        <Tabs.Screen
          name="Dashboard"
          component={EmployeeDashboardScreen}
          initialParams={{ initialTab: 'overview' }}
          options={{
            tabBarIcon: ({ focused }) => (
              <TabIcon
                focused={focused}
                icon="view-dashboard-outline"
                activeIcon="view-dashboard"
              />
            ),
          }}
        />
        {canViewTimesheetsTab ? (
          <Tabs.Screen
            name="Timesheets"
            component={TimesheetsScreen}
            options={{
              tabBarIcon: ({ focused }) => (
                <TabIcon
                  focused={focused}
                  icon="clipboard-text-outline"
                  activeIcon="clipboard-text"
                />
              ),
            }}
          />
        ) : null}
        <Tabs.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarIcon: ({ focused }) => (
              <ProfileTabIcon
                focused={focused}
                image={profileImage}
                initials={String(initials).toUpperCase()}
              />
            ),
          }}
        />
      </Tabs.Navigator>
    </LinearGradient>
  );
}

function TabIcon({ focused, icon, activeIcon }: TabIconProps) {
  const activeScale = useRef(new Animated.Value(focused ? 1 : 0.92)).current;
  const inactiveOpacity = useRef(new Animated.Value(focused ? 0 : 1)).current;
  const inactiveScale = useRef(new Animated.Value(focused ? 0.92 : 1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(activeScale, {
        toValue: focused ? 1 : 0.92,
        useNativeDriver: true,
        friction: 7,
        tension: 100,
      }),
      Animated.timing(inactiveOpacity, {
        toValue: focused ? 0 : 1,
        duration: 170,
        useNativeDriver: true,
      }),
      Animated.timing(inactiveScale, {
        toValue: focused ? 0.92 : 1,
        duration: 170,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focused, activeScale, inactiveOpacity, inactiveScale]);

  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={`tab${focused ? ', active' : ''}`}
      accessibilityHint="Tap to switch sections"
      style={styles.tabIconWrapper}
    >
      {focused ? (
        <Animated.View style={{ transform: [{ scale: activeScale }] }}>
          <View style={styles.activeIconBubble}>
            <LinearGradient colors={TAB_BAR_ACTIVE_GRADIENT} style={styles.activeIconBubbleInner}>
              <MaterialCommunityIcons
                name={(activeIcon || icon) as any}
                size={22}
                color={TAB_BAR_ACTIVE_ICON}
              />
            </LinearGradient>
          </View>
        </Animated.View>
      ) : (
        <Animated.View
          style={{
            opacity: inactiveOpacity,
            transform: [{ scale: inactiveScale }],
          }}
        >
          <View style={styles.inactiveIconBubble}>
            <LinearGradient colors={['rgba(255,255,255,0.92)', 'rgba(248,250,252,0.96)']} style={styles.inactiveIconBubbleInner}>
              <MaterialCommunityIcons
                name={icon as any}
                size={24}
                color={TAB_BAR_INACTIVE_ICON}
              />
            </LinearGradient>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function ProfileTabIcon({
  focused,
  image,
  initials,
}: {
  focused: boolean;
  image?: string | null;
  initials: string;
}) {
  const profileScale = useRef(new Animated.Value(focused ? 1 : 0.96)).current;

  useEffect(() => {
    Animated.spring(profileScale, {
      toValue: focused ? 1 : 0.96,
      useNativeDriver: true,
      friction: 7,
      tension: 90,
    }).start();
  }, [focused, profileScale]);

  return (
    <View style={styles.profileTabWrapper}>
      <Animated.View style={{ transform: [{ scale: profileScale }] }}>
        <View style={[styles.profileBubble, focused && styles.profileBubbleActive]}>
          <LinearGradient
            colors={
              focused
                ? ['rgba(219,234,254,0.96)', 'rgba(239,246,255,0.98)']
                : ['rgba(255,255,255,0.92)', 'rgba(248,250,252,0.96)']
            }
            style={styles.profileBubbleInner}
          >
            {image ? (
              <Image
                source={{ uri: image }}
                style={[
                  styles.profileAvatar,
                  focused && styles.profileAvatarActive,
                ]}
              />
            ) : (
              <Text style={[styles.profileInitials, focused && styles.profileInitialsActive]}>{initials}</Text>
            )}
          </LinearGradient>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBarShadowPlate: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  tabBarSurface: {
    flex: 1,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
  },
  tabBarGloss: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 10,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
    opacity: 0.7,
  },
  tabIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    alignSelf: 'center',
  },
  activeIconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    shadowColor: '#60a5fa',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  activeIconBubbleInner: {
    flex: 1,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  inactiveIconBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.16)',
    shadowColor: '#d6deeb',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  inactiveIconBubbleInner: {
    flex: 1,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileTabWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 56,
    alignSelf: 'center',
  },
  profileBubble: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
    shadowColor: '#d6deeb',
    shadowOpacity: 0.14,
    shadowRadius: 6,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  profileBubbleActive: {
    backgroundColor: 'rgba(219,234,254,0.88)',
    shadowColor: '#60a5fa',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  profileBubbleInner: {
    flex: 1,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  profileAvatarActive: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  profileInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e2e8f0',
  },
  profileInitialsActive: {
    color: '#2563eb',
  },
});

function AppNavigator() {
  const { session, logout, setSessionExpiredMessage, authReady } = useAuth();

  useEffect(() => {
    const handler = () => {
      setSessionExpiredMessage('Your session has expired. Please log in again.');
      logout();
    };
    setUnauthorizedHandler(handler);
    return () => setUnauthorizedHandler(null);
  }, [logout, setSessionExpiredMessage]);

  useEffect(() => {
    if (!session?.token) return;

    let unsubscribeMessaging: (() => void) | undefined;

    void setupFirebaseMessaging(session.token)
      .then((unsubscribe) => {
        unsubscribeMessaging = unsubscribe;
      })
      .catch((error) => {
        console.log('FCM setup failed:', error);
      });

    return () => {
      if (unsubscribeMessaging) {
        unsubscribeMessaging();
      }
    };
  }, [session?.token]);

  if (!authReady) {
    return (
      <View style={appStyles.bootSplash}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <NavigationContainer key={session?.token ? `session:${session.token}` : 'session:guest'}>
      <Stack.Navigator
        key={
          session?.token
            ? `stack:${session.token}:${(session.permissions || []).join('|')}`
            : 'stack:guest'
        }
        screenOptions={{ headerShown: false }}
      >
        {session ? (
          <>
            <Stack.Screen name="EmployeeTabs" component={EmployeeTabs} />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{
                headerShown: false,
                presentation: 'card',
                animation: 'slide_from_right',
                contentStyle: { backgroundColor: '#f3f5f9' },
              }}
            />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const appStyles = StyleSheet.create({
  bootSplash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
});

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
