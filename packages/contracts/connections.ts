import { z } from "zod";
const webUrl = z.url().refine((value) => /^https?:\/\//i.test(value));
export const authorizationLinkSchema = z.object({ url: webUrl });
export const readerLinksSchema = z.object({ reader: webUrl, overlay: webUrl });
export const modelListSchema = z.object({
  models: z.array(z.object({ slug: z.string().min(1), name: z.string() })),
});
export type ReaderLinks = z.infer<typeof readerLinksSchema>;
export type AvailableModel = z.infer<typeof modelListSchema>["models"][number];
