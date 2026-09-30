'use client';

import * as React from 'react';
import { reportClientError } from './client-report';

/** For an error boundary: report the error it caught, once (ROADMAP 13.3). */
export function useReportError(error: (Error & { digest?: string }) | undefined): void {
  React.useEffect(() => {
    if (error) reportClientError(error, 'boundary');
  }, [error]);
}
