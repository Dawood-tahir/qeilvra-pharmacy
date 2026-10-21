/** The exact PostgreSQL JSON text is the authoritative archived representation. */
export type ArchiveInvoice = {
  saleId: string;
  completedAt: string;
  sourceHash: string;
  payload: string;
};

export type ArchiveManifestEntry = { saleId: string; sourceHash: string };

export type ArchiveLimits = {
  maxBytes: number;
  maxInflatedBytes: number;
  maxRowsPerSheet: number;
  maxCellCodeUnits: number;
  maxRevisions: number;
  maxInvoices: number;
  maxPayloadBytes: number;
  maxWorkMs: number;
};

export type BuildWorkbookOptions = {
  generation: number;
  previousSha256: string | null;
  createdAt: string;
  limits?: Partial<ArchiveLimits>;
};

export type InspectWorkbookExpected = {
  sha256?: string;
  generation?: number;
  manifest?: ArchiveManifestEntry[];
  limits?: Partial<ArchiveLimits>;
};

export type ArchiveWorkbookInspection = {
  sha256: string;
  generation: number;
  previousSha256: string | null;
  createdAt: string;
  invoiceCount: number;
  revisionCount: number;
  manifest: ArchiveManifestEntry[];
  /** Latest snapshot per invoice, ordered by sale ID. */
  invoices: ArchiveInvoice[];
  /** Every distinct snapshot in its original append order. */
  revisions: ArchiveInvoice[];
};

export type ArchiveWorkbookBuild = Pick<ArchiveWorkbookInspection, "sha256" | "invoiceCount" | "revisionCount" | "manifest"> & {
  bytes: Uint8Array;
};
