export type SummaryType = 'code' | 'documentation';

export interface SummarizeRequest {
  text: string;
  type: SummaryType;
}

export interface SummarizeResponse {
  summary: string;
}

export interface ErrorResponse {
  error: string;
} 