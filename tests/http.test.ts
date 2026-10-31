/**
 * The HTTP status contract.
 *
 * Live regression: every route used to end its catch with a hard-coded 500, so a client
 * that sent a malformed JSON body was told "the server broke" instead of "your body is
 * broken". `readBody` already threw ApiError(..., 400) - the status was simply thrown
 * away. These tests pin the mapping so it cannot regress, and they run in the cheapest
 * tier (no server, no network, no tokens).
 */
import { describe, expect, it } from "vitest";
import { ApiError, errorResponse, failResponse, issueText, readBody } from "@/lib/http";
import { POST as analyzePOST } from "@/app/api/analyze/route";
import { POST as detectPOST } from "@/app/api/detect/route";

function req(body: string, path = "/api/analyze") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readBody - the thrower", () => {
  it("turns malformed JSON into an ApiError with status 400", async () => {
    const err = await readBody(req('{"problem": "warranty",}')).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toMatch(/not valid JSON/i);
  });

  it("refuses an array or a bare scalar body, and accepts an empty body", async () => {
    await expect(readBody(req("[1,2]"))).rejects.toThrow(/must be a JSON object/);
    await expect(readBody(req('"hi"'))).rejects.toThrow(/must be a JSON object/);
    expect(await readBody(req(""))).toEqual({});
  });

  it("rejects a body over the size limit with 413, not 400", async () => {
    const err = await readBody(req("x".repeat(4_100_000))).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(413);
  });
});

describe("errorResponse - the handler every route now uses", () => {
  it("keeps an ApiError's own status", () => {
    expect(errorResponse(new ApiError("Body is not valid JSON: boom", 400)).status).toBe(400);
    expect(errorResponse(new ApiError("too large", 413)).status).toBe(413);
  });

  it("still uses the envelope shape for unexpected throws", () => {
    const res = errorResponse(new TypeError("x is not a function"));
    expect(res.status).toBe(500);
    return res.json().then((j) => {
      expect(j).toMatchObject({ ok: false, data: null, is_working: false });
      expect(Array.isArray(j.checks)).toBe(true);
    });
  });

  it("classifies a config failure as 503 rather than a crash", () => {
    expect(errorResponse(new Error("Firebase Admin is not configured")).status).toBe(503);
  });
});

describe("failResponse / issueText", () => {
  it("honours an explicit status and falls back to the message otherwise", () => {
    expect(failResponse("nope", [], false, 401).status).toBe(401);
    expect(failResponse("Please sign in to continue").status).toBe(401);
    expect(failResponse("groq upstream timed out").status).toBe(502);
  });

  it("renders zod issues as one readable line", () => {
    expect(issueText([{ path: ["problem"], message: "too short" }])).toBe("problem: too short");
    expect(issueText([{ path: [], message: "bad" }])).toBe("request: bad");
  });
});

describe("the real routes end-to-end (no Groq, no writes)", () => {
  it("POST /api/analyze with a malformed JSON body returns 400, not 500", async () => {
    const res = await analyzePOST(req('{"problem": "broken,}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/not valid JSON/i);
  });

  it("POST /api/detect with a broken body also returns 400", async () => {
    const res = await detectPOST(req("{oops", "/api/detect"));
    expect(res.status).toBe(400);
  });
});
