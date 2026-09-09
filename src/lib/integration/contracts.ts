import { z } from "zod";

export const agendaUpsertSchema = z.object({
  title: z.string().trim().min(1).max(120),
  roomName: z.string().trim().max(80).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  revision: z.string().trim().max(120).nullable().optional(),
  state: z.enum(["scheduled", "live", "ended"]).optional(),
  settings: z
    .object({
      requestsOpen: z.boolean().optional(),
      defaultDurationMs: z.number().int().min(3000).max(300000).optional(),
      forceInstrumental: z.boolean().optional(),
      autoDj: z.boolean().optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const integrationRequestSchema = z.object({
  externalRequestId: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(10).max(800),
  requesterName: z.string().trim().min(1).max(40),
  instrumental: z.boolean().optional().default(false),
});

export const playbackActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("play"),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("pause"),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("skip"),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("select"),
    trackId: z.string().uuid(),
    autoplay: z.boolean().optional(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal("ended"),
    trackId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
]);

export const spaceAssignmentSchema = z.object({
  deviceId: z.string().uuid(),
  assign: z.boolean().default(true),
});
