export type AttendanceDay = {
  status?: 'present' | 'half_day_present' | 'full_day_present' | 'absent' | 'pending_checkout';
  checkInAt: string | null;
  checkOutAt: string | null;
  excludeFromPayroll?: boolean;
  missedCheckout?: boolean;
  isOnLeave: boolean;
  leaveType: string | null;
  isWeekOff: boolean;
  holidayName: string | null;
  lateByMinutes?: number;
};
