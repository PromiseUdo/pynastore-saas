/*
 * /sale — kept as a permanent alias.
 *
 * The header, utility bar, footer and mega-menu have all linked here since
 * Phase 1. "On sale" is now a dynamic collection like any other, so rather
 * than maintaining a second implementation of the same page (or rewriting
 * every link and breaking anyone's bookmark), this redirects to it.
 */
import { redirect } from 'next/navigation';

export default function SalePage() {
  redirect('/collections/sale');
}
