// ═══ Transcript print options — the Sama "print settings" ticks
// (port of the TranscriptPrintOptions part of types.ts). ═══

export type TranscriptPrintOptions = {
  showLegend: boolean; // grade-status legend
  showBreakdown: boolean; // passed-courses breakdown table (second page)
  showRank: boolean; // rank in the entry cohort (computed separately)
  showNationality: boolean;
  showPhoto: boolean;
  showLogo: boolean;
  showAcceptance: boolean;
  showStudyMode: boolean;
  thesisQualitative: boolean; // thesis/dissertation grade as a qualitative label
};

export const DEFAULT_PRINT_OPTIONS: TranscriptPrintOptions = {
  showLegend: true,
  showBreakdown: true,
  showRank: false,
  showNationality: true,
  showPhoto: true,
  showLogo: true,
  showAcceptance: true,
  showStudyMode: true,
  thesisQualitative: false,
};

/** University of origin for the transcript header */
export type OriginUniversity = {
  title: string;
  dissolved: boolean;
};
