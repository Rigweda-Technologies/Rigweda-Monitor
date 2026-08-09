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
      label: 'half day present',
      icon: 'check-circle',
      chip: styles.statusHalfDayPresent,
      chipText: styles.statusHalfDayPresentText,
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

const AttendanceTab = ({
  matrixDays,
  daysInMonth,
  onRefresh,
  referenceDate,
  dayNames,
  formatTime,
  employeeName,
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
              style={[
                styles.dayCell,
                getAttendanceStyle(day),
                day === selectedDay && styles.dayCellSelected,
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
                    
                    return (
                      <>
                        <View style={styles.statusRow}>
                          <View style={[styles.statusChip, statusMeta.chip]}>
                            <MaterialCommunityIcons name={statusMeta.icon as any} size={13} color="#0f172a" />
                            <Text style={[styles.statusChipText, statusMeta.chipText]}>
                              {statusMeta.label.charAt(0).toUpperCase() + statusMeta.label.slice(1)}
                            </Text>
                          </View>
                        </View>
                        {cell.checkInAt && (
                          <View style={styles.detailRowCard}>
                            <View style={styles.detailRow}>
                            <View style={styles.detailKeyWrap}>
                              <MaterialCommunityIcons name="login" size={14} color="#64748b" />
                              <Text style={styles.detailKey}>Check-in</Text>
                            </View>
                            <Text style={styles.detailValue}>{formatTime(cell.checkInAt)}</Text>
                            </View>
                          </View>
                        )}
                        {cell.checkOutAt && (
                          <View style={styles.detailRowCard}>
                            <View style={styles.detailRow}>
                            <View style={styles.detailKeyWrap}>
                              <MaterialCommunityIcons name="logout" size={14} color="#64748b" />
                              <Text style={styles.detailKey}>Check-out</Text>
                            </View>
                            <Text style={styles.detailValue}>{formatTime(cell.checkOutAt)}</Text>
                            </View>
                          </View>
                        )}
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
  },
  dayTextSelected: {
    color: '#0f172a',
    fontWeight: '700',
  },

  /* LIGHT COLORS */

  calendarPresent: {
    backgroundColor: '#a8eabf',
  },
  calendarHalfDay: {
    backgroundColor: '#fde68a',
  },
  calendarHoliday: {
    backgroundColor: '#f3dfa1',
  },
  calendarLeave: {
    backgroundColor: '#8fe8ad',
  },

  calendarWeekOff: {
    backgroundColor: '#b8cfef',
  },

  calendarAbsent: {
    backgroundColor: '#f8dede',
  },

  calendarNeutral: {
    backgroundColor: '#ffffff',
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
    backgroundColor: '#fef3c7',
    borderColor: '#fbbf24',
  },
  statusHalfDayPresentText: {
    color: '#92400e',
  },
  statusAbsent: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  statusAbsentText: {
    color: '#b91c1c',
  },
  statusLeave: {
    backgroundColor: '#dcfce7',
    borderColor: '#4ade80',
  },
  statusLeaveText: {
    color: '#15803d',
  },
  statusWeekOff: {
    backgroundColor: '#dbeafe',
    borderColor: '#93c5fd',
  },
  statusWeekOffText: {
    color: '#1d4ed8',
  },
  statusHoliday: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
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

