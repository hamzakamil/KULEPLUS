/**
 * Kredi taksit planı üretimi (saf fonksiyonlar).
 *
 * `interestRate` aylık yüzde olarak yorumlanır (ör. 2.75 → %2,75/ay).
 * Tüm para hesapları kuruş (integer cent) üzerinden yapılır; son taksit
 * yuvarlama farkını kapatır.
 */

export interface LoanScheduleInput {
  principal: number;
  interestRate: number;
  totalInstallments: number;
  /** 0/boş ise anüite formülüyle otomatik hesaplanır. */
  installmentAmount?: number;
  /** İlk taksitin vadesi bir ay sonradır. ISO tarih (YYYY-MM-DD). */
  startDate: string;
}

export interface LoanScheduleEntry {
  installmentNo: number;
  dueDate: string;
  amount: number;
  principalAmount: number;
  interestAmount: number;
}

const toCents = (value: number): number => Math.round(Number(value ?? 0) * 100);
const fromCents = (cents: number): number => Math.round(cents) / 100;
const pad2 = (n: number): string => String(n).padStart(2, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO tarihe ay ekler; ay sonu taşmasını (31 Ocak + 1 ay) güvenli kırpar. */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  const total = month - 1 + months;
  const targetYear = year + Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth + 1));
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(targetDay)}`;
}

/** Eşit taksitli (anüite) aylık ödeme tutarı — kuruş, yukarı yuvarlanır. */
export function calculateInstallmentAmount(
  principal: number,
  monthlyRatePercent: number,
  totalInstallments: number,
): number {
  const n = Math.max(1, Math.trunc(totalInstallments));
  const principalCents = toCents(principal);
  if (principalCents <= 0) return 0;
  const rate = Math.max(0, Number(monthlyRatePercent ?? 0)) / 100;
  if (rate === 0) return fromCents(Math.ceil(principalCents / n));
  const factor = Math.pow(1 + rate, n);
  return fromCents(Math.ceil((principalCents * rate * factor) / (factor - 1)));
}

export function buildLoanSchedule(input: LoanScheduleInput): LoanScheduleEntry[] {
  const n = Math.max(1, Math.trunc(Number(input.totalInstallments) || 1));
  const rate = Math.max(0, Number(input.interestRate ?? 0)) / 100;
  let balance = toCents(input.principal);
  let payment = toCents(input.installmentAmount ?? 0);
  if (payment <= 0) {
    payment = toCents(calculateInstallmentAmount(input.principal, input.interestRate, n));
  }

  const rows: LoanScheduleEntry[] = [];
  for (let i = 1; i <= n; i += 1) {
    const interest = Math.max(0, Math.round(balance * rate));
    let principalPart: number;
    let amount: number;

    if (i === n) {
      principalPart = Math.max(0, balance);
      amount = principalPart + interest;
    } else {
      principalPart = Math.min(balance, Math.max(0, payment - interest));
      amount = principalPart + interest;
    }

    balance = Math.max(0, balance - principalPart);
    rows.push({
      installmentNo: i,
      dueDate: addMonths(input.startDate, i),
      amount: fromCents(amount),
      principalAmount: fromCents(principalPart),
      interestAmount: fromCents(interest),
    });
  }

  return rows;
}
