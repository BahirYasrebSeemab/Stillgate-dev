import { z } from "zod";
import { MAX_APP_ARGS, MAX_ARG_CHARS, MAX_NAME_CHARS, MAX_PATH_CHARS, MAX_POLICY_ITEMS } from "./constants";
import { AppId, SiteId } from "./ids";
import { validateSitePattern } from "./site-pattern";
import { isAbsoluteWinPath } from "./win-path";

const Name = z.string().trim().min(1).max(MAX_NAME_CHARS);

const WinPath = z
  .string()
  .max(MAX_PATH_CHARS)
  .refine(isAbsoluteWinPath, "must be an absolute path like C:\\Program Files\\App\\app.exe");

// One allowed application.
// exePath   = what the launcher starts.
// folderPath = optional: any program inside this folder is also allowed
//              (for apps that start helper processes, e.g. Office).
export const AppEntry = z.strictObject({
  id: AppId,
  name: Name,
  exePath: WinPath,
  folderPath: WinPath.optional(),
  args: z.array(z.string().max(MAX_ARG_CHARS)).max(MAX_APP_ARGS).optional(),
  iconPath: WinPath.optional(),
});
export type AppEntry = z.infer<typeof AppEntry>;

// One allowed website, opened in Microsoft Edge
export const SiteEntry = z.strictObject({
  id: SiteId,
  name: Name,
  pattern: z.string().transform((value, ctx) => {
    const result = validateSitePattern(value);
    if (result.ok) return result.value;
    ctx.addIssue({ code: "custom", message: result.error });
    return z.NEVER;
  }),
});
export type SiteEntry = z.infer<typeof SiteEntry>;

export const Policy = z
  .strictObject({
    version: z.int().nonnegative(),
    apps: z.array(AppEntry).max(MAX_POLICY_ITEMS),
    sites: z.array(SiteEntry).max(MAX_POLICY_ITEMS),
  })
  .superRefine((policy, ctx) => {
    reportDuplicates(policy.apps.map((app) => app.id), "apps", ctx);
    reportDuplicates(policy.sites.map((site) => site.id), "sites", ctx);
  });
export type Policy = z.infer<typeof Policy>;

export const EMPTY_POLICY: Policy = { version: 0, apps: [], sites: [] };

function reportDuplicates(ids: readonly string[], field: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: [field], message: `duplicate id "${id}"` });
    seen.add(id);
  }
}
