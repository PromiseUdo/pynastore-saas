'use server';

import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { signUpload, UPLOAD_PURPOSES, type SignedUpload, type UploadPurpose } from '@/lib/cloudinary/sign';

type Result = { success: true; data: SignedUpload } | { success: false; error: string };

const CAN_UPLOAD: Record<UploadPurpose, PermissionKey[]> = {
  products: [PERMISSIONS.INVENTORY_CREATE, PERMISSIONS.INVENTORY_EDIT],
  categories: [PERMISSIONS.INVENTORY_CATEGORY_MANAGE],
  brands: [PERMISSIONS.INVENTORY_CREATE, PERMISSIONS.INVENTORY_EDIT],
};

/** Short-lived signed parameters for one direct browser → Cloudinary upload. */
export async function getImageUploadSignature(purpose: UploadPurpose): Promise<Result> {
  try {
    if (!UPLOAD_PURPOSES.includes(purpose)) return { success: false, error: 'Unknown upload type' };
    const ctx = await getOrganizationContext();
    const perms = ctx.membership.role.permissions;
    if (!CAN_UPLOAD[purpose].some((p) => hasPermission(perms, p))) {
      return { success: false, error: 'You do not have permission to upload images' };
    }
    return { success: true, data: signUpload(ctx.organization.id, purpose) };
  } catch (err) {
    console.error('[media] sign upload failed:', err);
    return { success: false, error: 'Image uploads are not available right now' };
  }
}
