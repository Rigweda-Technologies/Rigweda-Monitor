import type { Appearance, ThemeId } from "../../theme/themes";

export type OrganizationTheme = { preset: ThemeId; appearance: Appearance; customPrimary?: string | null; customAccent?: string | null };
export type Organization = {
  id: string; code: string; name: string; legalName: string | null; registrationNumber: string | null;
  taxIdentifier: string | null; email: string | null; phone: string | null; website: string | null;
  logoUrl: string | null; status: "active" | "inactive"; timezone: string; locale: string; currency: string;
  fiscalYearStartMonth: number; address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };
  theme: OrganizationTheme; version: number; createdAt: string; updatedAt: string;
};
export type OrganizationInput = Omit<Organization, "id" | "version" | "createdAt" | "updatedAt">;
