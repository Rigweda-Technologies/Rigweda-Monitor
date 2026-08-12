import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { AttendanceDay } from '../types/attendance';

type AttendanceTabProps = {
  matrixDays: Record<number, AttendanceDay>;
  daysInMonth: number;
  onRefresh: () => void;
  referenceDate: Date;
  dayNames: string[];
  formatTime: (value: string | Date) => string;
  employeeName: string;
  attendancePolicy?: {
    attendanceIpEnabled: boolean;
    attendanceSelfieRequired: boolean;
    attendanceMultiPunchEnabled: boolean;
    attendanceGeoFenceEnabled: boolean;
    attendanceGeoRadiusMeters: number;
  } | null;
  upcomingHolidays?: any[];
  holidaysLoading?: boolean;
};

const isPresentLikeStatus = (status?: string | null) =>
  status === 'present' ||
  status === 'half_day_present' ||
  status === 'full_day_present';

const getStatusMeta = (status?: string | null) => {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) {
    return {
      label: 'No record',
      icon: 'calendar-blank-outline',
      chip: styles.statusNeutral,
      chipText: styles.statusNeutralText,
    };
  }
  if (normalized === 'half_day_present') {
    return {
      label: 'Half day present',
      icon: 'check-circle',
      chip: styles.statusHalfDayPresent,
      chipText: styles.statusHalfDayPresentText,
    };
  }
  if (normalized === 'pending_checkout') {
    return {
      label: 'Pending checkout',
      icon: 'clock-outline',
      chip: styles.statusPending,
      chipText: styles.statusPendingText,
    };
  }
  if (isPresentLikeStatus(normalized)) {
    return {
      label: normalized.replace(/_/g, ' '),
      icon: 'check-circle',
      chip: styles.statusPresent,
      chipText: styles.statusPresentText,
    };
  }
  if (normalized === 'absent') {
    return {
      label: 'Absent',
      icon: 'close-circle',
      chip: styles.statusAbsent,
      chipText: styles.statusAbsentText,
    };
  }
  if (normalized.includes('leave')) {
    return {
      label: normalized.replace(/_/g, ' '),
      icon: 'beach',
      chip: styles.statusLeave,
      chipText: styles.statusLeaveText,
    };
  }
  if (normalized.includes('week')) {
    return {
      label: normalized.replace(/_/g, ' '),
      icon: 'calendar-week',
      chip: styles.statusWeekOff,
      chipText: styles.statusWeekOffText,
    };
  }
  if (normalized.includes('holiday')) {
    return {
      label: normalized.replace(/_/g, ' '),
      icon: 'party-popper',
      chip: styles.statusHoliday,
      chipText: styles.statusHolidayText,
    };
  }
  return {
    label: normalized.replace(/_/g, ' '),
    icon: 'information-outline',
    chip: styles.statusNeutral,
    chipText: styles.statusNeutralText,
  };
};

const formatHolidayDate = (value?: string) => {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const normalizeHolidayName = (value?: string) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\s*\/?\s*festivals?\b/gi, '').trim();
};

const getLegendItems = () => [
  { label: 'Present', tone: styles.legendPresent, dot: '#10b981' },
  { label: 'Pending', tone: styles.legendPending, dot: '#f59e0b' },
  { label: 'Absent', tone: styles.legendAbsent, dot: '#ef4444' },
  { label: 'Leave', tone: styles.legendLeave, dot: '#8b5cf6' },
  { label: 'Week off', tone: styles.legendWeekOff, dot: '#0ea5e9' },
  { label: 'Holiday', tone: styles.legendHoliday, dot: '#f59e0b' },
];

const AttendanceTab = ({
  matrixDays,
  daysInMonth,
  onRefresh,
  referenceDate,
  dayNames,
  formatTime,
  employeeName,
  attendancePolicy,
  upcomingHolidays = [],
  holidaysLoading = false,
}: AttendanceTabProps) => {

  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const monthDate = useMemo(
    () => new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1),
    [referenceDate]
  );

  const firstDayOffset = useMemo(() => monthDate.getDay(), [monthDate]);

  const monthCells = useMemo(() => {
    const cells: (number | null)[] = [];

    for (let idx = 0; idx < firstDayOffset + daysInMonth; idx++) {
      if (idx < firstDayOffset) {
        cells.push(null);
      } else {
        cells.push(idx - firstDayOffset + 1);
      }
    }

    while (cells.length % 7 !== 0) {
      cells.push(null);
    }

    return cells;
  }, [daysInMonth, firstDayOffset]);

  const monthLabel = useMemo(
    () =>
      monthDate.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      }),
    [monthDate]
  );

  const getAttendanceStyle = (day: number) => {
    const cell = matrixDays[day];

    if (!cell) return styles.calendarNeutral;

    if (cell.isWeekOff) return styles.calendarWeekOff;

    if (cell.holidayName) return styles.calendarHoliday;

    if (cell.isOnLeave) return styles.calendarLeave;

    if (cell.status === 'half_day_present') return styles.calendarHalfDay;
    if (isPresentLikeStatus(cell.status)) return styles.calendarPresent;
    if (cell.status === 'pending_checkout') return styles.calendarPending;

    if (cell.status === 'absent') return styles.calendarAbsent;

    return styles.calendarNeutral;
  };

  const handleSelectDay = (day: number) => {
    setSelectedDay((prev) => (prev === day ? null : day));
  };

  const closeDetailCard = () => {
    setSelectedDay(null);
  };

  return (
    <LinearGradient
      colors={['#ffffff', '#f4f7ff']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Attendance</Text>

        <Pressable style={styles.refreshButton} onPress={onRefresh}>
          <LinearGradient
            colors={['#5a7bea', '#456bde', '#3559cc']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.refreshButtonInner}
          >
            <MaterialCommunityIcons name="refresh" size={14} color="#ffffff" />
            <Text style={styles.refreshText}>Refresh</Text>
          </LinearGradient>
        </Pressable>
      </View>

      <Text style={styles.monthLabel}>{monthLabel}</Text>

      {/* Week names */}
      <View style={styles.weekRow}>
        {dayNames.map((day) => (
          <Text key={day} style={styles.weekText}>
            {day}
          </Text>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.grid}>
        {monthCells.map((day, idx) => {
          if (!day) {
            return <View key={`empty-${idx}`} style={styles.emptyCell} />;
          }

          return (
            <Pressable
              key={`day-${day}`}
              style={({ pressed }) => [
                styles.dayCell,
                getAttendanceStyle(day),
                day === selectedDay && styles.dayCellSelected,
                pressed && styles.dayCellPressed,
              ]}
              onPress={() => handleSelectDay(day)}
            >
              <Text style={[styles.dayText, day === selectedDay && styles.dayTextSelected]}>
                {day}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legendCard}>
        <View style={styles.legendHeader}>
          <Text style={styles.legendTitle}>Legend</Text>
          <Text style={styles.legendSubtitle}>Same color language as the web attendance grid</Text>
        </View>
        <View style={styles.legendGrid}>
          {getLegendItems().map((item) => (
            <View key={item.label} style={[styles.legendItem, item.tone]}>
              <Text style={[styles.legendDot, { color: item.dot }]}>●</Text>
              <Text style={styles.legendText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Modal visible={selectedDay !== null} transparent animationType="fade" onRequestClose={closeDetailCard}>
        <Pressable style={styles.detailModalBackdrop} onPress={closeDetailCard}>
          <Pressable style={styles.detailModalCard} onPress={(event) => event.stopPropagation()}>
            {selectedDay && (
              <>
                <View style={styles.detailTopBand}>
                  <View style={styles.detailDateBadge}>
                    <Text style={styles.detailDateDay}>{selectedDay}</Text>
                    <Text style={styles.detailDateMonth}>
                      {monthDate.toLocaleDateString(undefined, { month: 'short' })}
                    </Text>
                  </View>
                  <View style={styles.detailHeaderTextWrap}>
                    <Text style={styles.detailLabel}>{monthLabel}</Text>
                    <Text style={styles.detailTitle} numberOfLines={2}>{employeeName}</Text>
                  </View>
                  <Pressable style={styles.detailClose} onPress={closeDetailCard}>
                    <MaterialCommunityIcons name="close" size={16} color="#64748b" />
                  </Pressable>
                </View>
                <View style={styles.detailBody}>
                  {(() => {
                    const cell = matrixDays[selectedDay] || {};
                    const statusMeta = getStatusMeta(cell.status);
                    const hasCheckIn = Boolean(cell.checkInAt);
                    const hasCheckOut = Boolean(cell.checkOutAt);
                    
                    return (
                      <>
                        <View style={styles.statusRow}>
                          <View style={[styles.statusChip, statusMeta.chip]}>
                            <MaterialCommunityIcons name={statusMeta.icon as any} size={13} color="#0f172a" />
                            <Text style={[styles.statusChipText, statusMeta.chipText]}>
                              {statusMeta.label}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.detailRowCard}>
                          <View style={styles.detailRow}>
                            <View style={styles.detailKeyWrap}>
                              <MaterialCommunityIcons name="login" size={14} color="#64748b" />
                              <Text style={styles.detailKey}>Check-in</Text>
                            </View>
                            <Text style={styles.detailValue}>
                              {hasCheckIn ? formatTime(cell.checkInAt as string) : 'Not recorded'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.detailRowCard}>
                          <View style={styles.detailRow}>
                            <View style={styles.detailKeyWrap}>
                              <MaterialCommunityIcons name="logout" size={14} color="#64748b" />
                              <Text style={styles.detailKey}>Check-out</Text>
                            </View>
                            <Text style={styles.detailValue}>
                              {hasCheckOut ? formatTime(cell.checkOutAt as string) : 'Not recorded'}
                            </Text>
                          </View>
                        </View>
                        {cell.missedCheckout ? (
                          <View style={styles.detailRowCard}>
                            <View style={styles.detailRow}>
                              <View style={styles.detailKeyWrap}>
                                <MaterialCommunityIcons name="alert-circle-outline" size={14} color="#64748b" />
                                <Text style={styles.detailKey}>Note</Text>
                              </View>
                              <Text style={styles.detailValue}>Missed checkout</Text>
                            </View>
                          </View>
                        ) : null}
                        {cell.leaveType && (
                          <View style={styles.detailRowCard}>
                            <View style={styles.detailRow}>
                              <View style={styles.detailKeyWrap}>
                                <MaterialCommunityIcons name="beach" size={14} color="#64748b" />
                                <Text style={styles.detailKey}>Leave Type</Text>
                              </View>
                              <Text style={styles.detailValue}>{cell.leaveType}</Text>
                            </View>
                          </View>
                        )}
                        {cell.holidayName && (
                          <View style={styles.detailRowCard}>
                            <View style={styles.detailRow}>
                              <View style={styles.detailKeyWrap}>
                                <MaterialCommunityIcons name="party-popper" size={14} color="#64748b" />
                                <Text style={styles.detailKey}>Holiday</Text>
                              </View>
                              <Text style={styles.detailValue}>{normalizeHolidayName(cell.holidayName)}</Text>
                            </View>
                          </View>
                        )}
                        {typeof cell.lateByMinutes === 'number' && cell.lateByMinutes > 0 ? (
                          <View style={styles.detailRowCard}>
                            <View style={styles.detailRow}>
                              <View style={styles.detailKeyWrap}>
                                <MaterialCommunityIcons name="clock-alert-outline" size={14} color="#64748b" />
                                <Text style={styles.detailKey}>Late by</Text>
                              </View>
                              <Text style={styles.detailValue}>{cell.lateByMinutes} min</Text>
                            </View>
                          </View>
                        ) : null}
                        {attendancePolicy ? (
                          <View style={styles.policyCard}>
                            <View style={styles.policyHeader}>
                              <MaterialCommunityIcons name="shield-check-outline" size={15} color="#2563eb" />
                              <Text style={styles.policyTitle}>Policy details</Text>
                            </View>
                            <View style={styles.policyGrid}>
                              <View style={styles.policyRow}>
                                <Text style={styles.policyLabel}>IP lock</Text>
                                <Text style={styles.policyValue}>
                                  {attendancePolicy.attendanceIpEnabled ? 'Enabled' : 'Disabled'}
                                </Text>
                              </View>
                              <View style={styles.policyRow}>
                                <Text style={styles.policyLabel}>Selfie</Text>
                                <Text style={styles.policyValue}>
                                  {attendancePolicy.attendanceSelfieRequired ? 'Required' : 'Optional'}
                                </Text>
                              </View>
                              <View style={styles.policyRow}>
                                <Text style={styles.policyLabel}>Multi punch</Text>
                                <Text style={styles.policyValue}>
                                  {attendancePolicy.attendanceMultiPunchEnabled ? 'Allowed' : 'Single punch'}
                                </Text>
                              </View>
                              <View style={styles.policyRow}>
                                <Text style={styles.policyLabel}>Geo fence</Text>
                                <Text style={styles.policyValue}>
                                  {attendancePolicy.attendanceGeoFenceEnabled
                                    ? `${attendancePolicy.attendanceGeoRadiusMeters || 200}m`
                                    : 'Off'}
                                </Text>
                              </View>
                            </View>
                          </View>
                        ) : null}
                      </>
                    );
                  })()}
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.holidaysSection}>
        <View style={styles.holidaysHeader}>
          <Text style={styles.holidaysTitle}>Holiday List</Text>
          <MaterialCommunityIcons name="calendar-star" size={16} color="#2563eb" />
        </View>

        {holidaysLoading ? (
          <Text style={styles.holidaysEmptyText}>Loading holidays...</Text>
        ) : upcomingHolidays.length === 0 ? (
          <Text style={styles.holidaysEmptyText}>No holidays found.</Text>
        ) : (
          upcomingHolidays.map((holiday: any) => {
            const displayName = normalizeHolidayName(holiday?.name);
            if (!displayName) return null;

            return (
              <LinearGradient
                key={holiday?._id || `${holiday?.name || 'holiday'}-${holiday?.date || ''}`}
                colors={['#ffffff', '#f6f9ff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.holidayRow}
              >
                <View style={styles.holidayBadge}>
                  <MaterialCommunityIcons name="calendar-blank" size={14} color="#2563eb" />
                </View>
                <View style={styles.holidayInfo}>
                  <Text style={styles.holidayName}>{displayName}</Text>
                  <Text style={styles.holidayMeta}>{formatHolidayDate(holiday?.date)}</Text>
                </View>
              </LinearGradient>
            );
          })
        )}
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({

  container: {
    marginTop: 16,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#c2cee3',
    shadowOffset: { width: 5, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 16,
    elevation: 6,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1e293b',
  },

  monthLabel: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 13,
  },

  refreshButton: {
    borderRadius: 12,
    backgroundColor: '#456bde',
    shadowColor: '#2a4da8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 5,
  },

  refreshButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },

  refreshText: {
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '600',
  },

  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 4,
  },

  weekText: {
    width: '14%',
    textAlign: 'center',
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },

  emptyCell: {
    width: '13%',
    height: 48,
    backgroundColor: 'transparent',
  },

  dayCell: {
    width: '13%',
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#d4ddec',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 2,
  },

  dayText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  dayCellSelected: {
    shadowColor: '#2a4da8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 5,
    borderColor: '#2563eb',
    transform: [{ scale: 0.98 }],
  },
  dayCellPressed: {
    transform: [{ scale: 0.96 }],
  },
  dayTextSelected: {
    color: '#0f172a',
    fontWeight: '700',
  },

  /* LIGHT COLORS */

  calendarPresent: {
    backgroundColor: '#d1fae5',
    borderColor: '#10b981',
  },
  calendarHalfDay: {
    backgroundColor: '#fed7aa',
    borderColor: '#f59e0b',
  },
  calendarPending: {
    backgroundColor: '#fed7aa',
    borderColor: '#f59e0b',
  },
  calendarHoliday: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  calendarLeave: {
    backgroundColor: '#e0e7ff',
    borderColor: '#8b5cf6',
  },

  calendarWeekOff: {
    backgroundColor: '#e0f2fe',
    borderColor: '#0ea5e9',
  },

  calendarAbsent: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
  },

  calendarNeutral: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },

  detailCard: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    padding: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    gap: 10,
  },
  detailModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  detailModalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    padding: 14,
    shadowColor: '#97a8c5',
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 6, height: 10 },
    elevation: 10,
    gap: 10,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  detailHeaderTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  detailTopBand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    padding: 10,
    backgroundColor: '#f6f9ff',
  },
  detailDateBadge: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailDateDay: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1d4ed8',
    lineHeight: 18,
  },
  detailDateMonth: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1e3a8a',
    textTransform: 'uppercase',
  },
  detailLabel: {
    fontSize: 12,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 20,
  },
  detailClose: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4ff',
  },
  detailBody: {
    gap: 10,
  },
  statusRow: {
    marginBottom: 2,
  },
  statusChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  detailRowCard: {
    borderRadius: 10,
    backgroundColor: '#fbfcff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#d3dceb',
    shadowOffset: { width: 2, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 1,
  },
  detailKey: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  detailKeyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailValue: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  statusPresent: {
    backgroundColor: '#dcfce7',
    borderColor: '#86efac',
  },
  statusPresentText: {
    color: '#166534',
  },
  statusHalfDayPresent: {
    backgroundColor: '#fed7aa',
    borderColor: '#f59e0b',
  },
  statusHalfDayPresentText: {
    color: '#9a3412',
  },
  statusPending: {
    backgroundColor: '#fed7aa',
    borderColor: '#f59e0b',
  },
  statusPendingText: {
    color: '#9a3412',
  },
  statusAbsent: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
  },
  statusAbsentText: {
    color: '#b91c1c',
  },
  statusLeave: {
    backgroundColor: '#e0e7ff',
    borderColor: '#8b5cf6',
  },
  statusLeaveText: {
    color: '#6d28d9',
  },
  statusWeekOff: {
    backgroundColor: '#e0f2fe',
    borderColor: '#0ea5e9',
  },
  statusWeekOffText: {
    color: '#0369a1',
  },
  statusHoliday: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  statusHolidayText: {
    color: '#92400e',
  },
  statusNeutral: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  statusNeutralText: {
    color: '#334155',
  },
  legendCard: {
    marginTop: 16,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
    gap: 10,
  },
  legendHeader: {
    gap: 2,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  legendSubtitle: {
    fontSize: 11,
    color: '#64748b',
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    minWidth: 100,
  },
  legendDot: {
    fontSize: 12,
    fontWeight: 'bold',
    width: 14,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
    color: '#0f172a',
  },
  legendPresent: {
    backgroundColor: '#ecfdf5',
  },
  legendPending: {
    backgroundColor: '#fff7ed',
  },
  legendAbsent: {
    backgroundColor: '#fef2f2',
  },
  legendLeave: {
    backgroundColor: '#f5f3ff',
  },
  legendWeekOff: {
    backgroundColor: '#f0f9ff',
  },
  legendHoliday: {
    backgroundColor: '#fffbeb',
  },
  policyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe4f2',
    backgroundColor: '#f8fbff',
    padding: 12,
    gap: 10,
  },
  policyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  policyTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  policyGrid: {
    gap: 8,
  },
  policyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  policyLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  policyValue: {
    fontSize: 11,
    color: '#0f172a',
    fontWeight: '700',
    textAlign: 'right',
  },
  holidaysSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#dbe4f2',
    paddingTop: 14,
    gap: 10,
  },
  holidaysHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  holidaysTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  holidaysEmptyText: {
    fontSize: 12,
    color: '#64748b',
  },
  holidayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    shadowColor: '#c6d3e9',
    shadowOffset: { width: 4, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  holidayBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef4ff',
  },
  holidayInfo: {
    flex: 1,
  },
  holidayName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  holidayMeta: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
});

export default AttendanceTab;

