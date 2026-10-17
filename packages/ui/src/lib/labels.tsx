import { createContext, type ReactNode, useContext } from 'react';

// Words the shared components read out to screen readers. The app provides
// them in the active language; the English defaults apply without a provider.
export interface UiLabels {
  close: string;
}

const UiLabelsContext = createContext<UiLabels>({ close: 'Close' });

export function UiLabelsProvider({ labels, children }: { labels: UiLabels; children: ReactNode }) {
  return <UiLabelsContext.Provider value={labels}>{children}</UiLabelsContext.Provider>;
}

export function useUiLabels(): UiLabels {
  return useContext(UiLabelsContext);
}
