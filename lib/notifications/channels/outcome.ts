/**
 * What one attempt at one delivery came to:
 *   sent    handed over to the provider
 *   gone    the device or browser no longer exists (and has been forgotten)
 *   retry   a temporary failure — try again later
 *   failed  a refusal that won't change by trying again
 */
export type ChannelOutcome = 'sent' | 'gone' | 'retry' | 'failed';
