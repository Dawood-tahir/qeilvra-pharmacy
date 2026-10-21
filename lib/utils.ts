import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const APP_TIMEZONE = "Asia/Karachi";
export const APP_CURRENCY = "PKR";

const currencyFormatter = new Intl.NumberFormat("en-PK", {
  style: "currency", currency: APP_CURRENCY, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: APP_TIMEZONE, day: "2-digit", month: "short", year: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-PK", {
  timeZone: APP_TIMEZONE, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
});
const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

export function formatCurrency(value: number | string | null | undefined) {
  if (value == null || (typeof value === "string" && !value.trim())) return "Unavailable";
  const numeric = Number(value);
  return Number.isFinite(numeric) && Math.abs(numeric) < 2 ** 45 ? currencyFormatter.format(numeric).replace("PKR", "Rs.") : "Unavailable";
}

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  if (!options) return dateFormatter.format(new Date(value));
  return new Intl.DateTimeFormat("en-PK", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date) {
  return dateTimeFormatter.format(new Date(value));
}

export function localDateISO(date = new Date()) {
  return isoFormatter.format(date);
}

export function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "Q";
}
