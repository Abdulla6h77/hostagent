import { z } from "zod";

const unique = (values: string[]) => new Set(values.map((s) => s.toLowerCase())).size === values.length;
export const GuestSchema = z.object({
  name: z.string().trim().min(1, "Enter a guest name.").max(50),
  seeds: z.array(z.string().trim().min(1).max(100)).min(3, "Add at least 3 tastes per guest.").max(5)
    .refine(unique, "Use different tastes for each guest."),
});
export const PlanRequestSchema = z.object({
  guests: z.array(GuestSchema).min(2, "Add at least 2 guests.").max(4, "Use up to 4 guests.").refine((guests) => unique(guests.map((g) => g.name)), "Give each guest a different name."),
  occasion: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  useQloo: z.boolean().default(true),
  sampleOnly: z.boolean().default(false),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;
