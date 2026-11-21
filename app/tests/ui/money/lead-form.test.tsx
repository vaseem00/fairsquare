// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../shell/test-utils";
import { fail, ok, type ApiMock } from "../shell/api-mock";

vi.mock("@/lib/api/client", async () => ({ api: (await import("../shell/api-mock")).makeApiMock() }));

import { LeadForm, mapApiFieldErrors } from "@/components/money/lead-form";
import { last4 } from "@/components/money/lead-receipt";
import { api } from "@/lib/api/client";
import { FIXTURE_CHECK_MARINA, FIXTURE_CONFIG, FIXTURE_CONFIG_NO_LEADS, FIXTURE_ME } from "../../fixtures/api-fixtures";
import { COPY, consentFor } from "@/lib/copy";
import type { CheckView, LeadView, PublicConfig } from "@/lib/types";

const apiMock = api as unknown as ApiMock;
const MORTGAGE = { downPct: 20, ratePct: 4.25, years: 25 as const };
const LEAD: LeadView = { ...FIXTURE_ME.leads[0], createdAt: "2026-11-17T10:05:00.000Z" };
const CONSENT = consentFor("Test Mortgage Partner");

/** A fresh comparison code per test, because sent receipts are remembered per code. */
let n = 0;
function check(base: CheckView = FIXTURE_CHECK_MARINA): CheckView {
  n += 1;
  return { ...base, code: `${base.code.slice(0, 4)}${String(n).padStart(2, "0")}` };
}

function renderForm(c: CheckView = check(), config: PublicConfig = FIXTURE_CONFIG) {
  return renderWithProviders(<LeadForm check={c} mortgage={MORTGAGE} />, { config });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LeadForm", () => {
  it("starts unticked, with no name or mobile field and no Send button (never a disabled Send)", () => {
    renderForm();
    const box = screen.getByRole("checkbox");
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toHaveAccessibleName(CONSENT.text);
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.queryByLabelText("UAE mobile")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send my details/ })).toBeNull();
    expect(screen.getByText("Nothing is shared unless you tick the box and press send.")).toBeInTheDocument();
  });

  it("without a configured partner: one line, no form (REAL_DATA.md section 8)", () => {
    renderForm(check(), FIXTURE_CONFIG_NO_LEADS);
    expect(screen.getByText(COPY["lead.unavailable"])).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send my details/ })).toBeNull();
    expect(document.body).not.toHaveTextContent(/fictional|demo/i);
  });

  it("shows the partner, the licence line and the promise when it is set", () => {
    const withPromise: PublicConfig = {
      ...FIXTURE_CONFIG,
      partner: { name: "Test Mortgages", regulator: "Test Regulator", licence: "123", promise: "They call within a day." },
      consent: consentFor("Test Mortgages"),
    };
    const { unmount } = renderForm(check(), withPromise);
    expect(screen.getByText("Test Mortgages")).toBeInTheDocument();
    expect(screen.getByText("Licensed by Test Regulator, licence 123.")).toBeInTheDocument();
    expect(screen.getByText("They call within a day.")).toBeInTheDocument();
    expect(screen.getByText(consentFor("Test Mortgages").text)).toBeInTheDocument();
    unmount();

    renderForm(check(), { ...withPromise, partner: { name: "Test Mortgages", regulator: "Test Regulator", licence: "123", promise: null } });
    expect(screen.queryByText("They call within a day.")).toBeNull();
  });

  it("mounts name and mobile after the tick and enables Send", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
    const name = screen.getByLabelText("Your name");
    const mobile = screen.getByLabelText("UAE mobile");
    expect(name).toHaveAttribute("autocomplete", "name");
    expect(mobile).toHaveAttribute("autocomplete", "tel");
    expect(mobile).toHaveAttribute("inputmode", "tel");
    expect(mobile).toHaveAttribute("type", "tel");
    expect(mobile).toHaveAccessibleDescription("For example +971 50 123 4567");
    expect(screen.getByRole("button", { name: /Send my details/ })).toBeEnabled();
  });

  it("clicking the consent text ticks the box (the whole row is the label)", async () => {
    renderForm();
    await userEvent.click(screen.getByText(CONSENT.text));
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("shows a field error for an invalid phone on blur", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("checkbox"));
    const mobile = screen.getByLabelText("UAE mobile");
    await userEvent.type(mobile, "12345");
    await userEvent.tab();
    expect(screen.getByText("Enter a UAE mobile number, for example +971 50 123 4567.")).toBeInTheDocument();
    expect(mobile).toHaveAttribute("aria-invalid", "true");
    expect(mobile).toHaveAccessibleDescription(/Enter a UAE mobile number/);
  });

  it("blocks submit with empty fields, focuses the first invalid one, and sends nothing", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /Send my details/ }));
    expect(screen.getByText("Enter your name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveFocus();
    expect(apiMock.leads.create).not.toHaveBeenCalled();
  });

  it("sends consent, version and the estimate, then shows a plain receipt (no JSON)", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    apiMock.leads.create.mockImplementation(() => new Promise((r) => (resolve = r)));
    const c = check();
    renderForm(c);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("Your name"), "Sara");
    await userEvent.type(screen.getByLabelText("UAE mobile"), "050 123 4567");
    await userEvent.click(screen.getByRole("button", { name: /Send my details/ }));

    expect(screen.getByRole("button", { name: /Sending/ })).toHaveAttribute("aria-disabled", "true");
    expect(apiMock.leads.create).toHaveBeenCalledWith({
      code: c.code,
      name: "Sara",
      phone: "050 123 4567",
      consent: true,
      consentVersion: "optin-v1",
      downPct: 20,
      ratePct: 4.25,
      years: 25,
    });
    resolve(ok({ lead: LEAD }));

    const heading = await screen.findByRole("heading", { name: "Sent to Test Mortgage Partner" });
    await waitFor(() => expect(heading).toHaveFocus());
    const receipt = heading.closest("[data-slot=lead-receipt]") as HTMLElement;
    expect(receipt).toHaveTextContent("Name: Sara");
    expect(receipt).toHaveTextContent("Mobile ending 4567");
    expect(receipt).toHaveTextContent("Listing: Mockup Crest Tower, 2-bed, AED 2,450,000");
    expect(receipt).toHaveTextContent("Sent 17 Nov 2026 at 14:05");
    expect(receipt.textContent).not.toMatch(/[{}[\]"]/);
    expect(within(receipt).getByRole("button", { name: "Withdraw this request" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("live-polite")).toHaveTextContent("Sent to Test Mortgage Partner"));
  });

  it("maps API field errors onto the fields", async () => {
    apiMock.leads.create.mockResolvedValue(
      fail(422, "validation_failed", "Some details need fixing.", { phone: "Enter a UAE mobile number, for example +971 50 123 4567." }),
    );
    renderForm();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("Your name"), "Sara");
    await userEvent.type(screen.getByLabelText("UAE mobile"), "+971501234567");
    await userEvent.click(screen.getByRole("button", { name: /Send my details/ }));
    const mobile = screen.getByLabelText("UAE mobile");
    await waitFor(() => expect(mobile).toHaveAttribute("aria-invalid", "true"));
    expect(mobile).toHaveFocus();
    expect(mapApiFieldErrors({ "fields.name": "Enter your name.", other: "x" })).toEqual({ name: "Enter your name." });
  });

  it("shows lead.errSend above Send when sending fails", async () => {
    apiMock.leads.create.mockResolvedValue(fail(500, "internal", "Something went wrong on our side. Try again."));
    renderForm();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("Your name"), "Sara");
    await userEvent.type(screen.getByLabelText("UAE mobile"), "0501234567");
    await userEvent.click(screen.getByRole("button", { name: /Send my details/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send your details. Nothing was shared. Try again.");
    expect(screen.getByRole("button", { name: /Send my details/ })).toBeEnabled();
  });

  it("withdraws through the AlertDialog", async () => {
    apiMock.leads.create.mockResolvedValue(ok({ lead: LEAD }));
    apiMock.leads.withdraw.mockResolvedValue(
      ok({ lead: { ...LEAD, status: "withdrawn", withdrawnAt: "2026-11-18T08:00:00.000Z" } }),
    );
    renderForm();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.type(screen.getByLabelText("Your name"), "Sara");
    await userEvent.type(screen.getByLabelText("UAE mobile"), "0501234567");
    await userEvent.click(screen.getByRole("button", { name: /Send my details/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw this request" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Withdraw your request?");
    expect(dialog).toHaveTextContent("Test Mortgage Partner will be told to delete your details.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Withdraw request" }));

    await waitFor(() => expect(apiMock.leads.withdraw).toHaveBeenCalledWith(LEAD.id));
    expect(
      await screen.findByText("Withdrawn on 18 Nov 2026. Test Mortgage Partner will be told to delete your details."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw this request" })).toBeNull();
  });

  it("last4 reads the masked phone", () => {
    expect(last4("+971 •• ••• 4567")).toBe("4567");
    expect(last4(null)).toBe("");
  });
});
