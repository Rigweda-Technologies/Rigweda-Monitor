import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import { getApiWithToken, postApiWithToken, putApiWithToken } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useResetScrollOnFocus } from '../utils/useResetScrollOnFocus';

type Entry = { date: string; hours: number; notes?: string };

const toDateInput = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekStart = (value: Date) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
};

const buildWeekDates = (weekStart: Date) => {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
};

const weekRangeLabel = (weekDates: Date[]) => {
  if (!weekDates.length) return '';
  const start = weekDates[0];
  const end = weekDates[6];
  const startMonth = start.toLocaleString('en-US', { month: 'short' });
  const endMonth = end.toLocaleString('en-US', { month: 'short' });
  return `${start.getDate()} ${startMonth} - ${end.getDate()} ${endMonth}`;
};

const weekdayLabel = (value: Date) => value.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();
const dayMonthLabel = (value: Date) =>
  `${value.getDate()} ${value.toLocaleString('en-US', { month: 'short' })}`;

const FONT_REGULAR = Platform.select({ android: 'sans-serif', ios: 'System', default: 'sans-serif' });
const FONT_MEDIUM = Platform.select({ android: 'sans-serif-medium', ios: 'System', default: 'sans-serif' });
const FONT_BOLD = Platform.select({ android: 'sans-serif', ios: 'System', default: 'sans-serif' });

function TimesheetsScreen() {
  const { session } = useAuth();
  const scrollViewRef = useRef<ScrollView | null>(null);
  const token = session?.token || '';
  const safeAreaInsets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const [timesheetId, setTimesheetId] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  useResetScrollOnFocus(scrollViewRef);

  const weekStartKey = useMemo(() => toDateInput(weekStart), [weekStart]);
  const weekDates = useMemo(() => buildWeekDates(weekStart), [weekStart]);
  const totalHours = useMemo(
    () => entries.reduce((sum, row) => sum + (Number(row.hours) || 0), 0),
    [entries]
  );
  const hasAnyEntry = useMemo(
    () => entries.some((row) => (Number(row.hours) || 0) > 0 || (row.notes || '').trim().length > 0),
    [entries]
  );

  const loadTimesheet = useCallback(async () => {
    setLoading(true);
    const res = await getApiWithToken<any>(`/timesheets/weekly/my?weekStart=${weekStartKey}`, token);
    setLoading(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to load timesheet.');
      setEntries(
        weekDates.map((d) => ({ date: toDateInput(d), hours: 0, notes: '' }))
      );
      return;
    }
    const data = res?.data;
    if (data?._id) {
      setTimesheetId(data._id);
      const mapped = weekDates.map((d) => {
        const key = toDateInput(d);
        const existing = (data.entries || []).find((e: any) => toDateInput(new Date(e.date)) === key);
        return {
          date: key,
          hours: Number(existing?.hours || 0),
          notes: existing?.notes || '',
        };
      });
      setEntries(mapped);
    } else {
      setTimesheetId(null);
      setEntries(
        weekDates.map((d) => ({ date: toDateInput(d), hours: 0, notes: '' }))
      );
    }
  }, [token, weekDates, weekStartKey]);

  useEffect(() => {
    if (token) loadTimesheet();
  }, [token, loadTimesheet]);

  const updateEntry = (index: number, patch: Partial<Entry>) => {
    setEntries((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  };

  const saveTimesheet = async (submit: boolean) => {
    setSaving(true);
    setError('');
    const payload = {
      weekStart: weekStartKey,
      entries: entries.map((e) => ({ ...e, hours: Number(e.hours) || 0 })),
    };
    let res: any;
    if (timesheetId) {
      res = submit
        ? await postApiWithToken<any>(`/timesheets/weekly/${timesheetId}/submit`, payload, token)
        : await putApiWithToken<any>(`/timesheets/weekly/${timesheetId}`, payload, token);
    } else {
      const createRes = await postApiWithToken<any>('/timesheets/weekly', payload, token);
      if (!createRes?.success) {
        setSaving(false);
        setError(createRes?.message || 'Unable to create timesheet.');
        return;
      }
      const newId = createRes?.data?._id;
      setTimesheetId(newId || null);
      res = submit
        ? await postApiWithToken<any>(`/timesheets/weekly/${newId}/submit`, payload, token)
        : createRes;
    }
    setSaving(false);
    if (!res?.success) {
      setError(res?.message || 'Unable to save timesheet.');
      return;
    }
    loadTimesheet();
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
        <LinearGradient
          colors={['#ffffff', '#f7f9fd']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.topCard}
        >
          <View style={styles.topCardHeader}>
            <View>
              <Text style={styles.kicker} allowFontScaling={false}>WEEKLY TIMESHEET</Text>
              <Text style={styles.bigTitle} allowFontScaling={false}>Log your week cleanly</Text>
              <Text style={styles.rangeText} allowFontScaling={false}>{weekRangeLabel(weekDates)}</Text>
            </View>
            <View style={styles.iconBadge}>
              <MaterialCommunityIcons name="calendar-clock-outline" size={26} color="#3a6bdb" />
            </View>
          </View>

          <LinearGradient
            colors={['#f7f9fc', '#f1f5fb']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.weekSwitchRow}
          >
            <Pressable
              style={styles.switchBtn}
              onPress={() => {
                const prev = new Date(weekStart);
                prev.setDate(prev.getDate() - 7);
                setWeekStart(getWeekStart(prev));
              }}
            >
              <Text style={styles.switchBtnText} allowFontScaling={false}>{'<'}</Text>
            </Pressable>
            <View style={styles.weekCenter}>
              <Text style={styles.weekLabel} allowFontScaling={false}>WEEK STARTING</Text>
              <Text style={styles.weekValue} allowFontScaling={false}>{weekStartKey}</Text>
            </View>
            <Pressable
              style={styles.switchBtn}
              onPress={() => {
                const next = new Date(weekStart);
                next.setDate(next.getDate() + 7);
                setWeekStart(getWeekStart(next));
              }}
            >
              <Text style={styles.switchBtnText} allowFontScaling={false}>{'>'}</Text>
            </Pressable>
          </LinearGradient>

          <View style={styles.summaryRow}>
            <LinearGradient colors={['#f8faff', '#f4f7fd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.summaryCard}>
              <Text style={styles.summaryLabel} allowFontScaling={false}>Total Hours</Text>
              <Text style={styles.summaryValue} allowFontScaling={false}>{totalHours.toFixed(1)}h</Text>
            </LinearGradient>
            <LinearGradient colors={['#f8faff', '#f4f7fd']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.summaryCard}>
              <Text style={styles.summaryLabel} allowFontScaling={false}>Status</Text>
              <Text style={styles.summaryValue} allowFontScaling={false}>{hasAnyEntry ? 'In Progress' : 'New Week'}</Text>
            </LinearGradient>
          </View>
        </LinearGradient>

        <LinearGradient
          colors={['#ffffff', '#f7f9fd']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.entriesCard}
        >
          <Text style={styles.entriesTitle} allowFontScaling={false}>Daily Entries</Text>
          <Text style={styles.entriesSubtitle} allowFontScaling={false}>Fill hours and a short work summary for each day.</Text>
          {error ? <Text style={styles.errorText} allowFontScaling={false}>{error}</Text> : null}

          {loading ? (
            <ActivityIndicator color="#2563eb" style={styles.loadingIndicator} />
          ) : (
            entries.map((entry, idx) => (
              <LinearGradient key={entry.date} colors={['#ffffff', '#fbfcfe']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.dayCard}>
                <View style={styles.dayRowTop}>
                  <View>
                    <Text style={styles.dayName} allowFontScaling={false}>{weekdayLabel(weekDates[idx])}</Text>
                    <Text style={styles.dayDate} allowFontScaling={false}>{dayMonthLabel(weekDates[idx])}</Text>
                  </View>
                  <View style={styles.hoursWrap}>
                    <Text style={styles.hoursLabel} allowFontScaling={false}>Hours</Text>
                    <TextInput
                      style={styles.hoursInput}
                      keyboardType="decimal-pad"
                      allowFontScaling={false}
                      value={String(entry.hours)}
                      onChangeText={(value) => updateEntry(idx, { hours: Number(value) || 0 })}
                    />
                  </View>
                </View>
                <TextInput
                  style={styles.notesInput}
                  placeholder="What did you work on today?"
                  placeholderTextColor="#94a3b8"
                  allowFontScaling={false}
                  value={entry.notes || ''}
                  onChangeText={(value) => updateEntry(idx, { notes: value })}
                />
              </LinearGradient>
            ))
          )}

          <View style={styles.actionRow}>
            <Pressable
              style={[styles.secondaryButton, saving ? styles.disabledButton : null]}
              onPress={() => saveTimesheet(false)}
              disabled={saving}
            >
              <LinearGradient colors={['#f5f7fb', '#edf2f8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.secondaryButtonInner}>
                {saving ? <ActivityIndicator /> : <Text style={styles.secondaryText} allowFontScaling={false}>Save Draft</Text>}
              </LinearGradient>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, saving ? styles.disabledButton : null]}
              onPress={() => saveTimesheet(true)}
              disabled={saving}
            >
              <LinearGradient colors={['#5a7bea', '#456bde', '#3559cc']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.primaryButtonInner}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText} allowFontScaling={false}>Submit</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </LinearGradient>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 14, paddingBottom: 102, gap: 10 },
  topCard: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 4, height: 8 },
    elevation: 5,
  },
  topCardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  kicker: { fontSize: 10.5, letterSpacing: 1.8, color: '#8d98aa', fontFamily: FONT_MEDIUM },
  bigTitle: { marginTop: 6, fontSize: 19, color: '#0f172a', lineHeight: 23, fontFamily: FONT_BOLD, fontWeight: '700' },
  rangeText: { marginTop: 4, fontSize: 13.5, color: '#6f7d91', fontFamily: FONT_REGULAR, fontWeight: '400' },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#eef4ff',
    borderWidth: 1,
    borderColor: '#d7e4fd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekSwitchRow: {
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#d0d9e8',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  switchBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dde3ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchBtnText: { fontSize: 17, lineHeight: 20, color: '#334155', fontFamily: FONT_BOLD, fontWeight: '700' },
  weekCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  weekLabel: { fontSize: 12, letterSpacing: 1.7, color: '#a0a9b8', fontFamily: FONT_MEDIUM },
  weekValue: { fontSize: 15.5, color: '#0f172a', marginTop: 2, fontFamily: FONT_BOLD, fontWeight: '700' },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryCard: {
    flex: 1,
    borderRadius: 18,
    padding: 14,
    minHeight: 96,
    justifyContent: 'center',
    shadowColor: '#d0d9e8',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  summaryLabel: { fontSize: 13, color: '#5f6f84', fontFamily: FONT_REGULAR },
  summaryValue: { marginTop: 6, fontSize: 16, color: '#0f172a', lineHeight: 21, fontFamily: FONT_BOLD, fontWeight: '700' },
  entriesCard: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 10,
    shadowColor: '#c6d1e4',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 4, height: 8 },
    elevation: 4,
  },
  entriesTitle: { fontSize: 17, color: '#0f172a', fontFamily: FONT_BOLD, fontWeight: '700' },
  entriesSubtitle: { fontSize: 13.5, color: '#6e7e92', marginBottom: 2, lineHeight: 19, fontFamily: FONT_REGULAR },
  errorText: { fontSize: 12, color: '#dc2626', fontFamily: FONT_REGULAR },
  dayCard: {
    borderRadius: 18,
    padding: 12,
    gap: 10,
    shadowColor: '#d3dceb',
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  dayRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  dayName: { fontSize: 11.5, color: '#9aa5b7', letterSpacing: 1.8, fontFamily: FONT_MEDIUM },
  dayDate: { fontSize: 15, color: '#0f172a', lineHeight: 20, fontFamily: FONT_BOLD, fontWeight: '700' },
  hoursWrap: { alignItems: 'flex-end', gap: 5 },
  hoursLabel: { fontSize: 11.5, color: '#6a7689', fontFamily: FONT_REGULAR },
  hoursInput: {
    height: 48,
    minWidth: 104,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde3ee',
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#0f172a',
    textAlign: 'center',
    backgroundColor: '#ffffff',
    fontFamily: FONT_BOLD,
    fontWeight: '700',
  },
  notesInput: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dde3ee',
    paddingHorizontal: 14,
    fontSize: 13.5,
    color: '#0f172a',
    backgroundColor: '#ffffff',
    fontFamily: FONT_REGULAR,
  },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  secondaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#f5f7fb',
    shadowColor: '#c9d5e8',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 2, height: 4 },
    elevation: 2,
  },
  secondaryButtonInner: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 13.5, color: '#0f172a', fontFamily: FONT_MEDIUM },
  primaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#2f66dd',
    shadowColor: '#2a4da8',
    shadowOpacity: 0.26,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryButtonInner: {
    flex: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  primaryText: { fontSize: 13.5, color: '#fff', fontFamily: FONT_MEDIUM },
  disabledButton: { opacity: 0.65 },
  loadingIndicator: { marginVertical: 24 },
});

export default TimesheetsScreen;
