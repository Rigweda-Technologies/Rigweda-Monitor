# 06. Payroll HR Guide (Fresher-Friendly)

This guide is written for new HR users who are running payroll in Upanaya for the first time.

## 1. What You Need Before Running Payroll

Complete these checks first:

1. Employees are active (terminated/resigned employees are excluded from payroll and dashboard totals).
2. Pay Group is created and mapped to employee payroll profiles.
3. Salary structure is saved for each employee (CTC and components).
4. Bank details are saved for salary disbursement.
5. Attendance data for the month is available in timesheets/attendance.
6. Leave approvals are completed for the pay period.

## 2. Simple Payroll Terms

- `CTC`: Total yearly company cost for an employee.
- `Gross`: Sum of earning components.
- `Deductions`: PF, ESI, PT, TDS, loan recovery, etc.
- `Net Pay`: Gross minus total deductions.
- `Payable Days`: Days eligible for salary in the period.
- `LOP`: Loss of Pay for unpaid absences.

## 3. First-Time Payroll Setup Flow

Follow this order when a client is setting up payroll for the first time.

### Step 1: Create the Pay Group

A Pay Group is the salary cycle and rule set for a group of employees.

Examples:
- `Monthly Staff`
- `Weekly Workers`
- `Consultants`
- `Factory Staff`

Open `Payroll > Setup`, then click `Add Pay Group`.

Fill these fields:
- `Code`: Short internal code, such as `MONTHLY`, `WEEKLY`, or `CONTRACT`.
- `Name`: Clear name that HR can recognize.
- `Pay Frequency`: Usually `Monthly` for regular employees.
- `Salary Pay Day`: The day salary is normally released, such as `30`.
- `Work Week Days`: Usually `5` or `6`, based on company policy.
- `Default Basic %`: Default Basic salary percentage used when employees follow the pay group rule.

Save the pay group.

### Step 2: Open Setup Wizard For That Pay Group

After the pay group is created, open `Setup Wizard` for that pay group.

The wizard connects salary components to the pay group. This is important because employees assigned to the pay group will receive salary packages based on these components.

### Step 3: Add Or Review Salary Components

Salary components are the rows that make up salary and payslips.

Component types:
- `Earnings`: Paid to employee. Example: Basic, HRA, Other Allowance, Bonus, Variable Pay.
- `Deductions`: Reduced from employee take-home salary. Example: PF, ESI, PT, TDS, loan recovery.
- `Employer Contributions`: Company-paid cost. Example: Employer PF. These are part of CTC but are not deducted from employee net pay.

Calculation types:
- `Fixed Amount`: Same value every month.
- `Percentage`: A percentage of another value. Example: HRA as 40% or 50% of Basic.
- `Formula`: Calculated using salary variables. Example: PF based on Basic with wage ceiling.
- `Slab`: Amount changes by salary range. Example: Professional Tax.

Use the default Telangana components if they match the client policy. Edit names, amounts, percentages, or formulas only when the client policy requires it.

Save the wizard after reviewing all components.

### Step 4: Assign Pay Group To Employees

Open `Employees`, edit the employee, and go to the `Salary` tab.

Fill these fields:
- `Pay Group`: Select the pay group created in Payroll Setup.
- `Annual CTC`: Enter yearly company cost for the employee.
- `Payroll Status`: Usually `active`.
- `Payment Mode`: Usually `bank_transfer`.
- `Tax Regime`: Select old or new regime based on employee declaration.

With auto-calculate enabled, the system calculates:
- Monthly Gross
- Basic Pay
- HRA
- Variable Pay
- Employer PF
- Employee deductions
- Estimated take-home salary

Save salary details.

### Step 5: Enable Or Disable Employee-Level Components

Use employee-level component customization only for approved exceptions.

Examples:
- Disable bonus for one employee.
- Enable a special allowance for one employee.
- Change the percentage for a specific employee.
- Disable a deduction when it does not apply.

Normal employees should use the pay group default. Employee overrides should be reviewed carefully because they change salary output only for that employee.

### Step 6: Add Bank And Statutory Details

In the employee payroll area, save:
- Bank account holder name
- Account number
- IFSC code
- Bank and branch details
- PAN
- UAN
- ESI number, if applicable
- PF/ESI/PT applicability
- Tax declaration details, if applicable

The employee should now appear in `Payroll > Employees` under the selected pay group.

### Step 7: Run Monthly Payroll

After pay groups, components, employee salary, bank, and statutory details are complete:

1. Finalize attendance and leave approvals for the month.
2. Lock the attendance month when checks are complete. This lock also generates the payroll attendance snapshot for that month.
3. Open `Payroll > Employees` and confirm employees are assigned to the correct pay group.
4. If needed, refresh or regenerate the attendance snapshot for the month or selected pay group.
5. Create payroll run for the pay group and month.
6. Preview salary values.
7. Resolve validation errors or warnings.
8. Recompute payroll after fixes.
9. Submit for approval.
10. Approve and lock the run.
11. Generate payslips and bank transfer export.

Important: Do not lock payroll until salary setup, attendance, leave approvals, bank details, and statutory details have all been checked.

## 3A. How Attendance Snapshot Moves Into Payroll

This is one of the most important concepts for clients to understand.

Payroll does not calculate salary directly from raw daily attendance punches. It first creates a monthly attendance snapshot for the payroll month.

That snapshot acts as the bridge between `Attendance` and `Payroll`.

### What the snapshot reads

When snapshot is generated, the system checks:

- Attendance punches for the month
- Approved leave records
- Holiday calendar
- Weekly off rules
- Full-day and half-day minimum work hours

### What the snapshot stores

For each employee, the snapshot stores payroll-ready monthly totals such as:

- `Calendar Days`
- `Working Days`
- `Present Days`
- `Paid Leave Days`
- `Unpaid Leave Days`
- `Holiday Days`
- `Week Off Days`
- `Payable Days`
- `LOP Days`
- `Overtime Minutes`

### What Payable Days and LOP mean

- `Payable Days`: Days for which salary should be paid in that payroll month.
- `LOP Days`: Loss Of Pay days that reduce salary for that payroll month.

Typical understanding:

- `Present` increases payable days
- `Paid Leave` increases payable days
- `Holiday` and `Week Off` usually increase payable days
- `Unpaid Leave` increases LOP
- `Absent` increases LOP
- `Half Day` usually counts as half payable and half LOP

### How payroll uses the snapshot

When payroll run is computed, the system reads the attendance snapshot totals and calculates a proration factor.

Example:

- Monthly denominator = `30` days
- Payable days = `27`
- LOP days = `3`

Then:

- `Proration Factor = 27 / 30 = 0.90`

Salary components that are marked to follow attendance are paid at `90%` for that month.

This usually affects:

- Basic
- HRA
- Variable Pay
- Other Allowance

Some components may not reduce with attendance if the company keeps them as non-prorated, such as:

- Bonus
- ESOP or Share benefit
- Special one-time employee benefits

### How overtime works

If overtime is captured in attendance, the overtime minutes are also carried into the snapshot.

During payroll compute, the system can add overtime as a separate earning component based on payroll rules.

### Recommended monthly client flow

Use this order every month:

1. Complete attendance for the month.
2. Approve all leave for that payroll month.
3. Lock attendance month.
4. Confirm payroll attendance snapshot is generated.
5. Create payroll run.
6. Compute payroll.
7. Validate and review employee salary output.
8. Approve and lock payroll.

### When to regenerate the snapshot

Regenerate attendance snapshot and recompute payroll if:

- An attendance correction is approved after snapshot generation
- A leave request is approved, rejected, or changed after snapshot generation
- A holiday or weekly off setup is corrected for that month
- Payroll team wants to refresh only one pay group or selected employees

Important:

If attendance data changes after snapshot generation and snapshot is not rebuilt, payroll will continue using old attendance totals.

## 4. Telangana Defaults (Implemented Guidance)

- Basic pay often set as `40% to 50%` of gross/CTC based on company policy.
- HRA (non-metro) commonly set as `40% of Basic`.
- PT slab (Telangana) is configured as monthly deduction logic.
- PF/ESI applicability depends on statutory thresholds and policy.

Important:
- Statutory rates and thresholds can change by notification.
- Always verify latest compliance values before final lock.

## 5. Common Validation Errors and How to Fix

### A) Missing bank details for payroll disbursement
- Go to employee salary section > bank details tab.
- Fill account holder name, account number, IFSC, bank/branch.
- Save and recompute payroll run.

### B) Missing PAN/UAN/ESI details
- Update statutory details in employee payroll profile.
- Save and recompute.

### C) Negative net pay
- Check deductions, loans, arrears, manual adjustments.
- Move excess deduction to next month or add recovery rules.

### D) Attendance snapshot missing
- Trigger attendance snapshot generation for selected month.
- Recompute payroll run.

### E) Component mismatch with CTC
- Verify component calculation types (`Fixed`, `Percentage`, `Formula`, `Slab`).
- Ensure balancing component (fixed allowance) is configured if needed.

## 6. When to Use Override

Use overrides only when:
- Employee has negotiated salary split different from pay group defaults.
- Special one-time allowance/deduction is approved.
- Transition month has partial policy/proration requirements.

Always keep notes in adjustment reason fields for audit clarity.

## 7. Maker-Checker States (What They Mean)

- `Draft`: Run created, editable.
- `Computed/Preview`: Amounts calculated.
- `Submitted`: Sent for approver review.
- `Approved`: Accepted by authorized checker.
- `Locked`: Finalized; no edits allowed unless reopened with permission.

## 8. End-of-Month HR Checklist

1. All leave approvals complete.
2. Attendance exceptions resolved.
3. Employee bank/statutory details complete.
4. Payroll validation errors resolved.
5. Approval completed by authorized checker.
6. Run locked.
7. Payslips generated and export prepared.
8. Payroll reports archived (register, deduction summary, employer contribution).

## 9. Troubleshooting Quick Tips

- If values look wrong, recompute after every major change.
- If only some employees should be processed, run payroll for selected employees.
- If duplicate run error appears for same pay month and group, reopen existing run instead of creating a new duplicate.
- If access denied, check payroll permissions and active role (HR/Org Admin).

## 10. Escalation Matrix (Suggested)

- `HR Executive`: Data entry, profile checks, first-level fixes.
- `HR Manager`: Policy decisions, overrides, final review.
- `Finance/Payroll Approver`: Approval, lock, payout controls.
- `System Admin`: Permission setup, integrations, migration/infra issues.
