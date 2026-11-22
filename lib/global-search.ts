export type GlobalSearchType =
  | "medicine" | "invoice" | "return" | "purchase" | "supplier"
  | "staff" | "batch" | "expense" | "notification" | "audit";

export type GlobalSearchResult = {
  id: string;
  type: GlobalSearchType;
  title: string;
  href: string;
  fields: (string | null | undefined)[];
  subtitle?: string;
  meta?: string;
};
