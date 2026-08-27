import { describe, expect, it } from "vitest";

import {
  createPublicBookingRequestSchema,
  createPublicBookingResponseSchema,
  freeSlotsResponseSchema,
  ianaTimeZoneSchema,
  isoInstantSchema,
  localDateSchema,
  prepareBookingInputSchema,
  publicBookingPageSchema,
  publicMeetingTypeSchema,
  publicSlotSchema,
} from "@/types/publicBooking";

const meetingType = {
  meetingTypeId: "4fd1b202-5364-49e0-85d6-748d838ec1b8",
  title: "Intro call",
  description: null,
  durationMinutes: 30,
  minNoticeMinutes: 60,
  maxAdvanceDays: 60,
};

describe("public booking DTO contracts", () => {
  it("accepts real calendar dates and rejects impossible or malformed dates", () => {
    expect(localDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    expect(localDateSchema.safeParse("2023-02-29").success).toBe(false);
    expect(localDateSchema.safeParse("2024-2-9").success).toBe(false);
  });

  it("requires offset instants and valid IANA time zones", () => {
    expect(isoInstantSchema.parse("2026-08-19T14:30:00Z")).toBe(
      "2026-08-19T14:30:00Z",
    );
    expect(isoInstantSchema.safeParse("2026-08-19T14:30:00").success).toBe(
      false,
    );
    expect(
      isoInstantSchema.safeParse("2026-08-19T14:30:00.123456Z").success,
    ).toBe(true);
    expect(
      isoInstantSchema.safeParse("2026-08-19T14:30:00.1234567Z").success,
    ).toBe(false);
    expect(ianaTimeZoneSchema.parse("America/Halifax")).toBe(
      "America/Halifax",
    );
    expect(ianaTimeZoneSchema.safeParse("Not/A_Zone").success).toBe(false);
  });

  it("keeps public meeting types minimal and strict", () => {
    expect(publicMeetingTypeSchema.parse(meetingType)).toEqual(meetingType);
    expect(
      publicMeetingTypeSchema.safeParse({ ...meetingType, durationMinutes: 0 })
        .success,
    ).toBe(false);
    expect(
      publicMeetingTypeSchema.safeParse({ ...meetingType, privateNotes: "no" })
        .success,
    ).toBe(false);
  });

  it("rejects booker values that the scheduling authority cannot normalize", () => {
    const base = {
      username: "demo-host",
      meetingTypeId: meetingType.meetingTypeId,
      startAt: "2026-08-25T13:00:00Z",
      guestTimeZone: "America/Halifax",
      booker: { name: "Example Guest", email: "guest@example.invalid" },
    };

    for (const email of [
      "user+@example.com",
      "user_@example.com",
      "user-@example.com",
      "foo..bar@example.com",
    ]) {
      expect(
        prepareBookingInputSchema.safeParse({
          ...base,
          booker: { ...base.booker, email },
        }).success,
      ).toBe(false);
    }
    expect(
      prepareBookingInputSchema.safeParse({
        ...base,
        booker: { ...base.booker, name: "ab\ncd" },
      }).success,
    ).toBe(false);
  });

  it("validates the versioned public booking page contract", () => {
    const page = {
      username: "demo-host",
      displayName: "Demo Host",
      avatarUrl: null,
      hostTimeZone: "America/Halifax",
      meetingTypes: [meetingType],
    };

    expect(publicBookingPageSchema.parse(page)).toEqual(page);
    expect(
      publicBookingPageSchema.safeParse({
        ...page,
        rawAvailabilityRules: [],
      }).success,
    ).toBe(false);
  });

  it("validates slot lists without accepting private fields", () => {
    const slot = {
      startAt: "2026-08-19T14:30:00Z",
      endAt: "2026-08-19T15:00:00Z",
    };
    const response = {
      username: "demo-host",
      meetingTypeId: meetingType.meetingTypeId,
      date: "2026-08-19",
      displayTimeZone: "America/Halifax",
      generatedAt: "2026-08-18T12:00:00Z",
      slots: [slot],
    };

    expect(publicSlotSchema.parse(slot)).toEqual(slot);
    expect(freeSlotsResponseSchema.parse(response)).toEqual(response);
    expect(
      publicSlotSchema.safeParse({ ...slot, guestEmail: "guest@example.invalid" })
        .success,
    ).toBe(false);
  });

  it("normalizes preparation intent and limits create to an approved preparation", () => {
    const idempotencyKey = [
      "f7219d07",
      "16a4",
      "4dff",
      "a1d0",
      "305cd56c670d",
    ].join("-");
    const preparation = {
      username: "demo-host",
      meetingTypeId: meetingType.meetingTypeId,
      startAt: "2026-08-19T14:30:00Z",
      guestTimeZone: "America/Halifax",
      booker: {
        name: "  Demo Guest  ",
        email: "  guest@example.invalid  ",
        notes: "  Agenda  ",
      },
    };

    const parsed = prepareBookingInputSchema.parse(preparation);
    expect(parsed.booker).toEqual({
      name: "Demo Guest",
      email: "guest@example.invalid",
      notes: "Agenda",
    });
    expect(
      prepareBookingInputSchema.safeParse({
        ...preparation,
        endAt: "2026-08-19T15:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      prepareBookingInputSchema.safeParse({
        ...preparation,
        booker: { ...preparation.booker, hiddenField: "no" },
      }).success,
    ).toBe(false);

    const createRequest = {
      preparationToken: "prep_abcdefghijklmnopqrstuvwxyz0123456789",
      idempotencyKey,
    };
    expect(createPublicBookingRequestSchema.parse(createRequest)).toEqual(createRequest);
    expect(
      createPublicBookingRequestSchema.safeParse({
        ...createRequest,
        username: preparation.username,
      }).success,
    ).toBe(false);
  });

  it("validates confirmed booking responses", () => {
    const response = {
      confirmationCode: "PROJECT-S-TEST",
      status: "confirmed",
      username: "demo-host",
      meetingTypeId: meetingType.meetingTypeId,
      meetingTypeTitle: "Intro call",
      startAt: "2026-08-19T14:30:00Z",
      endAt: "2026-08-19T15:00:00Z",
      hostTimeZone: "America/Halifax",
      guestTimeZone: "America/Halifax",
      idempotencyKey: [
        "f7219d07",
        "16a4",
        "4dff",
        "a1d0",
        "305cd56c670d",
      ].join("-"),
    };

    expect(createPublicBookingResponseSchema.parse(response)).toEqual(response);
    expect(
      createPublicBookingResponseSchema.safeParse({
        ...response,
        status: "pending",
      }).success,
    ).toBe(false);
  });
});
