export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function money(value: number) {
  return `€${value.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function clockNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function greeting(timeZone?: string, now = new Date()) {
  let h = now.getHours();
  if (timeZone) {
    try {
      h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    } catch {
      // An invalid/missing hotel timezone falls back to the device's local time.
    }
  }
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

let counter = 0;
export function uid(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}-${Math.round(performance.now())}`;
}
