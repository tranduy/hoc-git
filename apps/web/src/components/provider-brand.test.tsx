import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderBrand } from "./provider-brand.js";
import "../styles.css";

describe("ProviderBrand", () => {
  it("renders a distinct thumbnail and readable name for every comparison provider", () => {
    const providers = ["SABA", "IM", "SBOBET", "CMD", "APSPORT", "BTI"] as const;

    render(<>{providers.map((provider) => <ProviderBrand key={provider} provider={provider} />)}</>);

    for (const provider of providers) {
      expect(screen.getByRole("img", { name: `${provider} logo` })).toBeTruthy();
      expect(screen.getByTestId(`provider-brand-${provider}`).classList.contains(`provider-brand--${provider.toLowerCase()}`)).toBe(true);
      const brand = screen.getByTestId(`provider-brand-${provider}`);
      expect(brand.querySelector(".provider-brand__separator")?.textContent).toBe("-");
      expect(brand.querySelector(".provider-brand__name")?.textContent).toBe(`#${provider}`);
    }
  });

  it("keeps the provider display name inside the same colored badge as its icon", () => {
    const { container } = render(<ProviderBrand label="C-Sports · SABA" provider="SABA" />);
    const brand = container.querySelector('[data-testid="provider-brand-SABA"]')!;
    expect(brand.querySelector(".provider-brand__name")?.textContent).toBe("C-Sports · SABA");
  });
  it("does not let selector styles override each provider name color", () => {
    const { container } = render(<div className="provider-selector">
      <ProviderBrand provider="SABA" />
      <ProviderBrand provider="IM" />
    </div>);
    const saba = container.querySelector('[data-testid="provider-brand-SABA"] .provider-brand__name')!;
    const im = container.querySelector('[data-testid="provider-brand-IM"] .provider-brand__name')!;

    expect(getComputedStyle(saba).color).not.toBe(getComputedStyle(im).color);
  });
});
