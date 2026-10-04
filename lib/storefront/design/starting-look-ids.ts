/*
 * The starting looks' ids on their own (ROADMAP 15.6), so the design schema
 * can name them without importing the starting looks themselves (which
 * import the schema's types).
 */
export const STARTING_LOOK_IDS = ['fashion', 'electronics', 'grocery', 'general'] as const;
export type StartingLookId = (typeof STARTING_LOOK_IDS)[number];
