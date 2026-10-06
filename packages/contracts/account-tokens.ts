import { z } from "zod";
export const platformTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().nonnegative(),
});
export type PlatformToken = z.infer<typeof platformTokenSchema>;
