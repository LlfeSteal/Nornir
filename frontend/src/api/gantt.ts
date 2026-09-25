import axios from 'axios';
import { GanttTask } from '../types/gantt';

export interface AppConfig {
  group: string;
  gitlabUrl: string;
}

export async function fetchConfig(): Promise<AppConfig> {
  const { data } = await axios.get<AppConfig>('/api/config');
  return data;
}

export async function fetchGantt(refresh = false): Promise<GanttTask[]> {
  const { data } = await axios.get<GanttTask[]>('/api/gantt', {
    params: refresh ? { refresh: 1 } : undefined,
  });
  return data;
}

export function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const apiError = (err.response?.data as { error?: string } | undefined)?.error;
    if (apiError) return apiError;
    // No answer from the backend itself (nginx 502/503/504, or no response at all).
    if (!err.response || [502, 503, 504].includes(err.response.status)) {
      return 'The Nornir server is not responding. Check that the backend is running.';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
