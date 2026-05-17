export type ExcelWizardLogEvent = {
  jobId: string;
  message: string;
  at: number;
};

type Listener = (event: ExcelWizardLogEvent) => void;
const listeners = new Set<Listener>();

export function subscribeExcelWizardEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function broadcastExcelWizardLog(event: ExcelWizardLogEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // ignore listener errors
    }
  });
}
